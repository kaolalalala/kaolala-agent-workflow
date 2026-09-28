import { makeId, nowIso } from "@/lib/utils";
import {
  AgentNode,
  AllowedControlAction,
  ControlActionRecord,
  ControlBudgetSnapshot,
  ControlNodeState,
  ControlOwnerKind,
  ControlRecoveryPolicy,
  ControlRunState,
  NodeRole,
  Run,
} from "@/server/domain";
import { configService } from "@/server/config/config-service";
import { DEFAULT_TOKEN_BUDGET, tokenBudgetTracker } from "@/server/runtime/token-budget";
import { durableScheduler } from "@/server/runtime/durable-scheduler";
import { memoryStore } from "@/server/store/memory-store";

export class RuntimeControlService {
  ownerKindForRole(role: NodeRole): ControlOwnerKind {
    switch (role) {
      case "planner":
        return "planner";
      case "reviewer":
        return "reviewer";
      case "human":
        return "human";
      default:
        return "worker";
    }
  }

  mapRunStatusToControlState(status: Run["status"]): ControlRunState {
    switch (status) {
      case "running":
        return "running";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "terminated";
      default:
        return "pending";
    }
  }

  mapNodeStatusToControlState(node: AgentNode): ControlNodeState {
    switch (node.status) {
      case "ready":
        return "ready";
      case "running":
        return "running";
      case "waiting":
        return node.role === "human" ? "waiting_input" : "waiting_dependency";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      default:
        return "pending";
    }
  }

  buildRunBudgetSnapshot(runId: string): ControlBudgetSnapshot {
    const run = memoryStore.getRun(runId);
    const usage = tokenBudgetTracker.getRunUsage(runId);
    const nodes = memoryStore.getNodes(runId);
    const usedSteps = nodes.filter((item) => item.status === "running" || item.status === "completed" || item.status === "failed").length;
    const usedWallMs = run?.startedAt ? Math.max(0, Date.now() - new Date(run.startedAt).getTime()) : 0;
    return {
      maxSteps: nodes.length || undefined,
      usedSteps,
      maxTokens: DEFAULT_TOKEN_BUDGET.runBudget,
      usedTokens: usage.totalTokens,
      maxCostUsd: undefined,
      usedCostUsd: 0,
      maxWallMs: undefined,
      usedWallMs,
    };
  }

  buildNodeBudgetSnapshot(runId: string, nodeId: string): ControlBudgetSnapshot {
    const node = memoryStore.getNodeById(runId, nodeId);
    const usage = tokenBudgetTracker.getNodeUsage(runId, nodeId);
    const usedSteps = node && (node.status === "running" || node.status === "completed" || node.status === "failed") ? 1 : 0;
    return {
      maxSteps: 1,
      usedSteps,
      maxTokens: DEFAULT_TOKEN_BUDGET.nodeBudget,
      usedTokens: usage.totalTokens,
      maxCostUsd: undefined,
      usedCostUsd: 0,
      maxWallMs: undefined,
      usedWallMs: 0,
    };
  }

  buildRunAllowedActions(runId: string, state: ControlRunState): AllowedControlAction[] {
    const hasHumanInput = memoryStore.getNodes(runId)
      .some((node) => configService.getNodeConfig(runId, node.id)?.allowHumanInput);

    if (state === "pending") {
      return [{ actionType: "start_execution", label: "启动运行", source: "runtime", enabled: true }];
    }

    if (state === "running" || state === "retrying") {
      return [
        { actionType: "execute_ready_nodes", label: "推进可执行节点", source: "runtime", enabled: true },
        { actionType: "write_checkpoint", label: "写入检查点", source: "runtime", enabled: true },
        ...(hasHumanInput
          ? [{ actionType: "accept_human_input", label: "接收人工输入", source: "policy" as const, enabled: true }]
          : []),
      ];
    }

    if (state === "waiting_human") {
      return [{ actionType: "accept_human_input", label: "等待人工输入", source: "policy", enabled: true }];
    }

    if (state === "completed" || state === "failed" || state === "terminated") {
      return [
        { actionType: "replay_run", label: "回放运行", source: "runtime", enabled: true },
        { actionType: "compare_run", label: "比较运行", source: "runtime", enabled: true },
        { actionType: "rerun_from_node", label: "从节点重跑", source: "runtime", enabled: true },
      ];
    }

    return [{ actionType: "observe_run", label: "观察运行", source: "runtime", enabled: true }];
  }

  buildNodeAllowedActions(runId: string, node: AgentNode, state: ControlNodeState): AllowedControlAction[] {
    const allowHumanInput = Boolean(configService.getNodeConfig(runId, node.id)?.allowHumanInput);
    if (state === "ready") {
      return [{ actionType: "execute_node", label: "执行节点", source: "runtime", enabled: true }];
    }
    if (state === "running") {
      return [{ actionType: "continue_execution", label: "继续执行", source: "runtime", enabled: true }];
    }
    if (state === "waiting_dependency") {
      return [{ actionType: "await_dependencies", label: "等待依赖完成", source: "runtime", enabled: true }];
    }
    if (state === "waiting_input") {
      return [{
        actionType: "accept_human_input",
        label: allowHumanInput ? "接收人工输入" : "等待外部输入",
        source: "policy",
        enabled: true,
      }];
    }
    if (state === "waiting_approval") {
      return [{ actionType: "await_approval", label: "等待审批", source: "policy", enabled: true, approvalRequired: true }];
    }
    if (state === "failed") {
      return [
        { actionType: "retry_node", label: "重试节点", source: "runtime", enabled: true },
        { actionType: "reroute_to_review", label: "改道到审查节点", source: "policy", enabled: true },
      ];
    }
    if (state === "completed") {
      return [
        { actionType: "rerun_node", label: "重跑当前节点", source: "runtime", enabled: true },
        { actionType: "rerun_downstream", label: "重跑下游节点", source: "runtime", enabled: true },
      ];
    }
    return [{ actionType: "await_dispatch", label: "等待调度", source: "runtime", enabled: true }];
  }

  defaultRunRecoveryPolicy(): ControlRecoveryPolicy {
    return {
      onFailure: "fallback",
      maxRetries: 1,
      fallbackTarget: "human_review",
      terminateReasons: ["budget_exhausted", "policy_rejected", "provider_unavailable"],
    };
  }

  defaultNodeRecoveryPolicy(node: AgentNode): ControlRecoveryPolicy {
    if (node.role === "router" || node.role === "reviewer") {
      return {
        onFailure: "reroute",
        maxRetries: 1,
        fallbackTarget: "reviewer",
        terminateReasons: ["invalid_route", "policy_rejected"],
      };
    }

    if (node.role === "input" || node.role === "output" || node.role === "human") {
      return {
        onFailure: "terminate",
        maxRetries: 0,
        terminateReasons: ["port_execution_failed"],
      };
    }

    return {
      onFailure: "retry",
      maxRetries: 2,
      fallbackTarget: "human_review",
      terminateReasons: ["budget_exhausted", "provider_unavailable"],
    };
  }

  buildReplayScope(run: Run | undefined, currentCheckpointId?: string) {
    const terminal = run?.status === "completed" || run?.status === "failed";
    const hasCheckpoint = Boolean(currentCheckpointId);
    return {
      nodeReplayReady: hasCheckpoint || terminal,
      stepRerunReady: hasCheckpoint,
      runCompareReady: terminal,
    };
  }

  syncRunControl(
    runId: string,
    patch?: Partial<{
      state: ControlRunState;
      ownerKind: ControlOwnerKind;
      ownerRef: string;
      activeNodeId?: string;
      currentCheckpointId?: string;
    }>,
  ) {
    const run = memoryStore.getRun(runId);
    if (!run) {
      return;
    }
    const existing = memoryStore.getRunControl(runId);
    const activeNode = patch?.activeNodeId
      ? memoryStore.getNodeById(runId, patch.activeNodeId)
      : memoryStore.getNodes(runId).find((item) => item.status === "running");
    const state = patch?.state ?? this.mapRunStatusToControlState(run.status);
    const ownerKind = patch?.ownerKind ?? (activeNode ? this.ownerKindForRole(activeNode.role) : existing?.ownerKind ?? "runtime");
    const ownerRef = patch?.ownerRef ?? (activeNode?.id ?? existing?.ownerRef ?? "runtime-engine");
    const currentCheckpointId = patch?.currentCheckpointId
      ?? existing?.currentCheckpointId
      ?? durableScheduler.getCheckpoints(runId).at(-1)?.id;
    memoryStore.upsertRunControl({
      runId,
      state,
      ownerKind,
      ownerRef,
      activeNodeId: patch?.activeNodeId ?? activeNode?.id ?? existing?.activeNodeId,
      currentCheckpointId,
      budget: this.buildRunBudgetSnapshot(runId),
      allowedActions: this.buildRunAllowedActions(runId, state),
      recoveryPolicy: existing?.recoveryPolicy ?? this.defaultRunRecoveryPolicy(),
      replayScope: this.buildReplayScope(run, currentCheckpointId),
      pendingApprovalCount: memoryStore.listApprovalRequests(runId).filter((item) => item.status === "pending").length,
      createdAt: existing?.createdAt ?? run.createdAt,
      updatedAt: nowIso(),
    });
  }

  syncNodeControl(
    runId: string,
    nodeId: string,
    patch?: Partial<{
      state: ControlNodeState;
      ownerKind: ControlOwnerKind;
      ownerRef: string;
      approvalRequired: boolean;
    }>,
  ) {
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      return;
    }
    const existing = memoryStore.getNodeControl(runId, nodeId);
    const state = patch?.state ?? this.mapNodeStatusToControlState(node);
    memoryStore.upsertNodeControl({
      runId,
      nodeId,
      state,
      ownerKind: patch?.ownerKind ?? existing?.ownerKind ?? this.ownerKindForRole(node.role),
      ownerRef: patch?.ownerRef ?? existing?.ownerRef ?? node.id,
      allowedActions: this.buildNodeAllowedActions(runId, node, state),
      recoveryPolicy: existing?.recoveryPolicy ?? this.defaultNodeRecoveryPolicy(node),
      budget: this.buildNodeBudgetSnapshot(runId, nodeId),
      checkpointEligible: node.role !== "input",
      replayEligible: node.status === "completed" || node.status === "failed",
      partialRerunEligible: node.executionOrder !== undefined,
      approvalRequired: patch?.approvalRequired ?? existing?.approvalRequired ?? false,
      approvalStatus: existing?.approvalStatus,
      createdAt: existing?.createdAt ?? node.createdAt,
      updatedAt: nowIso(),
    });
  }

  syncAllNodeControls(runId: string) {
    for (const node of memoryStore.getNodes(runId)) {
      this.syncNodeControl(runId, node.id);
    }
    this.syncRunControl(runId);
  }

  recordControlAction(input: {
    runId: string;
    nodeId?: string;
    actionType: string;
    targetScope: ControlActionRecord["targetScope"];
    proposer: string;
    ownerKind: ControlOwnerKind;
    status: ControlActionRecord["status"];
    sideEffectLevel?: ControlActionRecord["sideEffectLevel"];
    approvalRequired?: boolean;
    payload?: Record<string, unknown>;
    recoveryDecision?: ControlActionRecord["recoveryDecision"];
  }) {
    const now = nowIso();
    memoryStore.appendControlAction(input.runId, {
      id: makeId("cact"),
      runId: input.runId,
      nodeId: input.nodeId,
      actionType: input.actionType,
      targetScope: input.targetScope,
      proposer: input.proposer,
      ownerKind: input.ownerKind,
      status: input.status,
      sideEffectLevel: input.sideEffectLevel ?? "none",
      approvalRequired: input.approvalRequired ?? false,
      payload: input.payload,
      recoveryDecision: input.recoveryDecision,
      createdAt: now,
      updatedAt: now,
    });
  }

  initializeControlPlane(runId: string) {
    this.syncAllNodeControls(runId);
    this.recordControlAction({
      runId,
      actionType: "create_run",
      targetScope: "run",
      proposer: "runtime",
      ownerKind: "runtime",
      status: "succeeded",
      payload: { source: "runtime_engine" },
    });
  }
}
