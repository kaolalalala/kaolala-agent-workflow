import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

import { eventStreamHub } from "@/server/api/event-stream";
import { notificationService } from "@/server/notification/notification-service";
import { LLMChatAdapter } from "@/server/agents/adapters/llm-chat-adapter";
import { MockAgentAdapter } from "@/server/agents/adapters/mock-agent-adapter";
import type { AgentAdapter } from "@/server/agents/adapters/agent-adapter";
import { configResolver, type ResolvedAgentExecutionConfig } from "@/server/config/config-resolver";
import { configService } from "@/server/config/config-service";
import {
  AgentContext,
  AgentDefinition,
  AgentNode,
  Event,
  EventType,
  HumanMessage,
  Message,
  NodeRole,
  NodeStatus,
  Run,
  StoredWorkflowEdge,
  StoredWorkflowNode,
  StoredWorkflowTask,
  Task,
  TaskStatus,
  RunMode,
} from "@/server/domain";
import { makeId, nowIso } from "@/lib/utils";
import { longTermMemoryService } from "@/server/memory/long-term-memory-service";
import { assembleContext } from "@/server/memory/working-memory";
import { consolidateScope } from "@/server/memory/memory-consolidation";
import { orchestrateInitialRun } from "@/server/runtime/orchestrator";
import { stateMachine } from "@/server/runtime/state-machine";
import { memoryStore, RunSnapshot } from "@/server/store/memory-store";
import { executeDevAgent } from "@/server/runtime/execution/dev-agent-executor";
import { durableScheduler, DurableScheduler } from "@/server/runtime/durable-scheduler";
import type { ScheduleState, SerializableDag } from "@/server/runtime/durable-scheduler";
import { localProjectService } from "@/server/workspace/local-project-service";
import { toolExecutor } from "@/server/tools/tool-executor";
import { toolResolver } from "@/server/tools/tool-resolver";
import { AgentRegistry } from "@/server/runtime/agent-registry";
import {
  DEFAULT_REFLECTION_CONFIG,
  buildReflectionPrompt,
  parseReflectionResponse,
  buildImprovementPrompt,
} from "@/server/runtime/reflection";
import { tokenBudgetTracker } from "@/server/runtime/token-budget";
import { outputManager } from "@/server/runtime/output-manager";
import {
  getBuiltinAgentTools,
  isBuiltinTool,
  BUILTIN_TOOL_TRANSFER,
  BUILTIN_TOOL_SUBTASK,
} from "@/server/runtime/builtin-agent-tools";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EXECUTION_ROLE_FALLBACK: NodeRole = "worker";
const RUNTIME_DUP_TRACE = process.env.RUNTIME_DUP_TRACE === "1";

interface WorkflowBlueprintInput {
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
}

interface LoopBackEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  maxIterations: number;
  convergenceKeyword?: string;
}

interface DagInfo {
  orderedNodeIds: string[];
  orderMap: Map<string, number>;
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  loopBackEdges: LoopBackEdge[];
}

type ExecutionPhase = "planning" | "execution" | "tool_calling" | "summarization" | "final_output";

class RuntimeEngine {
  private readonly runEventSeq = new Map<string, number>();
  // 每个 runId 对应一把串行锁，防止 startRun / rerunFromNode 并发竞态
  private readonly runLocks = new Map<string, Promise<void>>();
  // Agent registry per run — enables handoff and subtask capability discovery
  private readonly runRegistries = new Map<string, AgentRegistry>();
  // Handoff/subtask recursion depth per run — prevents infinite delegation loops
  private readonly delegationDepth = new Map<string, number>();
  private static readonly MAX_DELEGATION_DEPTH = 5;

  constructor(private readonly adapter: AgentAdapter = new MockAgentAdapter()) {}

  /**
   * 对同一 runId 的操作串行化执行，确保状态机转换不会发生并发竞态。
   */
  private async withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.runLocks.get(runId) ?? Promise.resolve();
    let resolveLock!: () => void;
    const current = new Promise<void>((r) => {
      resolveLock = r;
    });
    // 新操作排在上一个锁之后
    this.runLocks.set(runId, prev.then(() => current));
    try {
      await prev;
      return await fn();
    } finally {
      resolveLock();
    }
  }

  private resolveExecutionAdapter(
    runId: string,
    nodeId: string,
    resolved: ResolvedAgentExecutionConfig,
  ): AgentAdapter {
    if (!(this.adapter instanceof MockAgentAdapter)) {
      return this.adapter;
    }

    const provider = (resolved.provider || "").toLowerCase();
    if (!provider || provider === "mock") {
      return this.adapter;
    }

    const baseURL = (resolved.baseUrl || "").trim();
    const apiKey = (resolved.apiKey || "").trim();
    if (!baseURL || !apiKey) {
      return this.adapter;
    }

    if (provider === "anthropic") {
      return this.adapter;
    }

    return new LLMChatAdapter({
      provider,
      baseURL,
      apiKey,
      model: resolved.model,
      runId,
      nodeId,
    });
  }

  private persistRunOutputToNodePath(runId: string, nodeId: string, content: string) {
    const outputPath = configService.getNodeConfig(runId, nodeId)?.outputPath?.trim();
    if (!outputPath || !content) {
      return;
    }

    const filePath = outputManager.writeNodeTextOutput(
      runId,
      nodeId,
      content,
      outputPath,
      outputManager.createRunScopedFileName("node-output", ".md"),
    );

    this.emit(runId, "agent_context_updated", {
      relatedNodeId: nodeId,
      message: `节点输出已写入文件: ${filePath}`,
      payload: { type: "output_persisted", outputPath: filePath },
    });
  }

  private textHash(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
  }

  private isContentDuplicatedByHalves(value: string) {
    if (!value || value.length % 2 !== 0) {
      return false;
    }
    const half = value.length / 2;
    return value.slice(0, half) === value.slice(half);
  }

  private traceDuplicate(tag: string, payload: Record<string, unknown>) {
    if (!RUNTIME_DUP_TRACE) {
      return;
    }
    console.info(tag, payload);
  }

  private persistRunArtifactsSafe(runId: string) {
    try {
      configService.registerRunArtifacts(runId);
    } catch (error) {
      console.warn("[RuntimeEngine] registerRunArtifacts skipped:", error);
    }
  }

  private phaseFromNodeRole(role: NodeRole): ExecutionPhase {
    if (role === "planner") {
      return "planning";
    }
    if (role === "summarizer") {
      return "summarization";
    }
    if (role === "output") {
      return "final_output";
    }
    return "execution";
  }

  private getMemoryScope(runId: string) {
    const run = memoryStore.getRun(runId);
    if (!run || run.memoryIsolationMode === "default") {
      return {
        scopeType: (run?.workflowId ? "workflow" : "workspace") as "workflow" | "workspace",
        scopeId: run?.workflowId ?? "workspace_default",
        workflowId: run?.workflowId,
        workspaceId: "workspace_default",
        isolated: false,
      };
    }

    return {
      scopeType: "run" as const,
      scopeId: runId,
      workflowId: undefined,
      workspaceId: undefined,
      isolated: true,
    };
  }

  private emitExecutionPhase(
    runId: string,
    nodeId: string,
    taskId: string | undefined,
    phase: ExecutionPhase,
    payload?: Record<string, unknown>,
  ) {
    const node = memoryStore.getNodeById(runId, nodeId);
    const nodeName = node?.name ?? nodeId;
    this.emit(runId, "execution_phase_changed", {
      relatedNodeId: nodeId,
      relatedTaskId: taskId,
      message: `${nodeName} 进入阶段：${phase}`,
      payload: {
        phase,
        nodeRole: node?.role,
        executionOrder: node?.executionOrder,
        ...payload,
      },
    });
  }

  createRun(
    task: string,
    workflow?: WorkflowBlueprintInput,
    runMode: RunMode = "standard",
    workflowRef?: {
      workflowId?: string;
      workflowVersionId?: string;
      taskInput?: string;
      memoryIsolationMode?: "default" | "run_scoped";
    },
  ): Run {
    configService.ensureWorkspaceConfig();

    const blueprint = workflow && workflow.nodes.length > 0
      ? this.createBlueprintFromWorkflow(task, workflow)
      : orchestrateInitialRun(task);

    if (workflowRef?.workflowId || workflowRef?.workflowVersionId) {
      blueprint.run = {
        ...blueprint.run,
        runMode,
        workflowId: workflowRef.workflowId,
        workflowVersionId: workflowRef.workflowVersionId,
        taskInput: workflowRef.taskInput ?? task,
        memoryIsolationMode: workflowRef.memoryIsolationMode ?? "default",
      };
    } else {
      blueprint.run = {
        ...blueprint.run,
        runMode,
        taskInput: workflowRef?.taskInput ?? task,
        memoryIsolationMode: workflowRef?.memoryIsolationMode ?? "default",
      };
    }

    const normalizedNodes = blueprint.nodes.map((node) => {
      const roleDefaults = this.getRoleDefaults(node.role);
      const cfg = configService.ensureNodeConfig({
        runId: blueprint.run.id,
        nodeId: node.id,
        nodeRole: node.role,
        name: node.name,
        responsibility: node.responsibility ?? roleDefaults.responsibility,
        systemPrompt: roleDefaults.systemPrompt,
        allowHumanInput: true,
      });

      return {
        ...node,
        name: cfg.name,
        responsibility: cfg.responsibility ?? node.responsibility,
      };
    });

    const definitions: AgentDefinition[] = normalizedNodes.map((node) => {
      if (this.isPortRole(node.role)) {
        return this.createPortDefinition(node);
      }
      const resolved = configResolver.resolveNodeExecutionConfig(blueprint.run.id, node.id);
      return this.definitionFromResolved(node, resolved);
    });

    const contexts: AgentContext[] = normalizedNodes.map((node) => {
      const definition = definitions.find((item) => item.id === node.agentDefinitionId);
      if (!definition) {
        throw new Error("默认 Agent 定义缺失");
      }
      return this.buildInitialContext(blueprint.run.id, node, definition);
    });

    memoryStore.createRunSnapshot({
      run: blueprint.run,
      tasks: blueprint.tasks,
      nodes: normalizedNodes,
      edges: blueprint.edges,
      messages: [],
      events: [],
      agentDefinitions: definitions,
      agentContexts: contexts,
      humanMessages: [],
    });
    this.runEventSeq.set(blueprint.run.id, 0);

    this.emit(blueprint.run.id, "run_created", {
      message: "运行已创建",
    });

    for (const item of blueprint.tasks) {
      this.emit(blueprint.run.id, "task_created", {
        relatedTaskId: item.id,
        message: `任务已创建: ${item.title}`,
      });
    }

    for (const node of normalizedNodes) {
      this.emit(blueprint.run.id, "node_created", {
        relatedNodeId: node.id,
        message: `节点已创建: ${node.name}`,
      });
    }

    for (const edge of blueprint.edges) {
      this.emit(blueprint.run.id, "edge_created", {
        relatedNodeId: edge.targetNodeId,
        message: `连线已创建: ${edge.sourceNodeId} -> ${edge.targetNodeId}`,
      });
    }

    return blueprint.run;
  }

  async startRun(runId: string): Promise<void> {
    return this.withRunLock(runId, async () => {
      await this._startRunImpl(runId);
    });
  }

  private async _startRunImpl(runId: string): Promise<void> {
    const snapshot = this.mustSnapshot(runId);
    const rootTask = snapshot.tasks.find((task) => task.id === snapshot.run.rootTaskId);
    if (!rootTask) {
      throw new Error("根任务不存在");
    }

    if (snapshot.run.status === "running") {
      return;
    }

    this.transitionRun(runId, "running", {
      finishedAt: undefined,
      error: undefined,
      output: undefined,
    });
    this.transitionTask(runId, rootTask.id, "running");
    this.emit(runId, "run_started", { message: "运行已启动" });
    this.emit(runId, "execution_phase_changed", {
      relatedTaskId: rootTask.id,
      message: "运行进入阶段：planning",
      payload: { phase: "planning" },
    });

    try {
      const dag = this.buildDagInfo(runId);
      const scope = new Set(dag.orderedNodeIds);

      // ── Build agent registry for handoff/subtask capability discovery ──
      this.buildAgentRegistry(runId);

      // ── Durable: persist schedule state before execution begins ──
      const now = nowIso();
      durableScheduler.saveScheduleState({
        runId,
        dagJson: JSON.stringify(DurableScheduler.serializeDag(dag)),
        scopeJson: JSON.stringify([...scope]),
        executedJson: JSON.stringify([]),
        pendingDependenciesJson: JSON.stringify({}),
        currentWaveIndex: 0,
        rerunMode: false,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      await this.executeDagSchedule(runId, dag, scope, false);

      // Handle loop_back edges: re-execute loop segments until convergence or max iterations
      if (dag.loopBackEdges.length > 0) {
        await this.executeLoopBackEdges(runId, dag);
      }

      const latest = this.getRunSnapshot(runId);
      const output = latest.run.output || this.getLastNodeOutput(runId);
      if (!latest.run.output && output) {
        memoryStore.updateRun(runId, (run) => ({ ...run, output }));
      }
      this.emit(runId, "execution_phase_changed", {
        relatedTaskId: rootTask.id,
        message: "运行进入阶段：final_output",
        payload: { phase: "final_output", outputLength: output?.length ?? 0 },
      });

      this.transitionTask(runId, rootTask.id, "completed");
      this.transitionRun(runId, "completed", {
        finishedAt: nowIso(),
      });
      this.persistRunArtifactsSafe(runId);

      // ── Durable: mark schedule completed & cleanup ──
      durableScheduler.completeSchedule(runId);

      this.emit(runId, "run_completed", {
        relatedTaskId: rootTask.id,
        message: "运行已完成",
        payload: { output: output ?? "" },
      });

      // ── Memory consolidation: merge similar memories & apply decay ──
      const runState = memoryStore.getRun(runId);
      if (runState?.workflowId) {
        consolidateScope("workflow", runState.workflowId).catch((err) => {
          console.warn("[Runtime] Memory consolidation failed:", err instanceof Error ? err.message : err);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知运行错误";
      this.transitionTask(runId, rootTask.id, "failed");
      this.transitionRun(runId, "failed", {
        finishedAt: nowIso(),
        error: message,
      });
      this.persistRunArtifactsSafe(runId);

      // ── Durable: mark schedule failed ──
      durableScheduler.failSchedule(runId);

      this.emit(runId, "run_failed", {
        relatedTaskId: rootTask.id,
        message: `运行失败: ${message}`,
      });
    }
  }

  async rerunFromNode(runId: string, nodeId: string, includeDownstream: boolean): Promise<void> {
    return this.withRunLock(runId, async () => {
      await this._rerunFromNodeImpl(runId, nodeId, includeDownstream);
    });
  }

  private async _rerunFromNodeImpl(runId: string, nodeId: string, includeDownstream: boolean): Promise<void> {
    const snapshot = this.mustSnapshot(runId);
    if (snapshot.run.status === "running") {
      throw new Error("运行中，暂不支持并发重跑");
    }

    const node = snapshot.nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error("节点不存在");
    }

    this.emit(runId, "node_rerun_requested", {
      relatedNodeId: nodeId,
      relatedTaskId: node.taskId,
      message: `已请求从节点 ${node.name} 重跑`,
      payload: { includeDownstream },
    });

    const rootTask = snapshot.tasks.find((item) => item.id === snapshot.run.rootTaskId);
    if (!rootTask) {
      throw new Error("根任务不存在");
    }

    this.transitionRun(runId, "running", {
      finishedAt: undefined,
      error: undefined,
      output: undefined,
    });
    this.transitionTask(runId, rootTask.id, "running");

    const dag = this.buildDagInfo(runId);
    const chain = this.getRerunChain(runId, dag, nodeId, includeDownstream);
    const scope = new Set(chain.map((item) => item.id));

    // ── Durable: persist rerun schedule state ──
    const now = nowIso();
    durableScheduler.saveScheduleState({
      runId,
      dagJson: JSON.stringify(DurableScheduler.serializeDag(dag)),
      scopeJson: JSON.stringify([...scope]),
      executedJson: JSON.stringify([]),
      pendingDependenciesJson: JSON.stringify({}),
      currentWaveIndex: 0,
      rerunMode: true,
      rerunStartNodeId: nodeId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.executeDagSchedule(runId, dag, scope, true, nodeId);

      const latest = this.getRunSnapshot(runId);
      const output = latest.run.output || this.getLastNodeOutput(runId);
      if (!latest.run.output && output) {
        memoryStore.updateRun(runId, (run) => ({ ...run, output }));
      }

      this.transitionTask(runId, rootTask.id, "completed");
      this.transitionRun(runId, "completed", { finishedAt: nowIso() });
      this.persistRunArtifactsSafe(runId);
      durableScheduler.completeSchedule(runId);
      this.emit(runId, "run_completed", {
        relatedTaskId: rootTask.id,
        message: "重跑完成",
        payload: { output: output ?? "" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重跑失败";
      this.transitionTask(runId, rootTask.id, "failed");
      this.transitionRun(runId, "failed", {
        finishedAt: nowIso(),
        error: message,
      });
      this.persistRunArtifactsSafe(runId);
      durableScheduler.failSchedule(runId);
      this.emit(runId, "run_failed", {
        relatedTaskId: rootTask.id,
        message: `重跑失败: ${message}`,
      });
    }
  }

  sendHumanMessage(
    runId: string,
    nodeId: string,
    content: string,
    attachments: Array<{ name: string; mimeType: string; content: string }> = [],
  ): HumanMessage {
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      throw new Error("节点不存在");
    }

    const nodeConfig = configService.getNodeConfig(runId, nodeId);
    if (!nodeConfig) {
      throw new Error("节点配置不存在");
    }

    if (!nodeConfig.allowHumanInput) {
      throw new Error("当前节点不允许人工输入");
    }

    const context = this.mustContext(runId, nodeId);
    const humanMessage: HumanMessage = {
      id: makeId("hm"),
      runId,
      targetNodeId: nodeId,
      content,
      attachments,
      createdAt: nowIso(),
    };

    memoryStore.appendHumanMessage(runId, humanMessage);
    memoryStore.updateAgentContext(runId, context.id, (current) => ({
      ...current,
      humanMessages: [...current.humanMessages, humanMessage],
      updatedAt: nowIso(),
    }));
    const memoryScope = this.getMemoryScope(runId);

    const memoryItem = longTermMemoryService.remember({
      scopeType: memoryScope.scopeType,
      scopeId: memoryScope.scopeId,
      runId,
      workflowId: memoryScope.workflowId,
      nodeId,
      sourceType: "human_message",
      title: `人工消息 ${node.name}`,
      content: content.trim(),
      importance: 0.92,
    });

    this.emit(runId, "human_message_sent", {
      relatedNodeId: nodeId,
      relatedTaskId: node.taskId,
      message: `已向节点 ${node.name} 发送人工消息`,
      payload: {
        humanMessageId: humanMessage.id,
        attachmentCount: attachments.length,
        humanMessage,
      },
    });

    this.emit(runId, "agent_context_updated", {
      relatedNodeId: nodeId,
      relatedTaskId: node.taskId,
      message: `节点 ${node.name} 上下文已更新`,
      payload: { reason: "human_message" },
    });

    if (memoryItem) {
      this.emit(runId, "memory_indexed", {
        relatedNodeId: nodeId,
        relatedTaskId: node.taskId,
        message: `人工消息已写入长期记忆: ${node.name}`,
        payload: {
          memoryId: memoryItem.id,
          sourceType: memoryItem.sourceType,
          scopeType: memoryItem.scopeType,
          scopeId: memoryItem.scopeId,
        },
      });
    }

    return humanMessage;
  }

  getNodeAgent(runId: string, nodeId: string) {
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      throw new Error("节点不存在");
    }

    const definition = memoryStore.getAgentDefinition(runId, node.agentDefinitionId);
    const context = memoryStore.getAgentContextByNode(runId, nodeId);

    if (!definition || !context) {
      throw new Error("节点 Agent 数据不存在");
    }

    return { definition, context };
  }

  getRunSnapshot(runId: string): RunSnapshot {
    const snapshot = memoryStore.getRunSnapshot(runId);
    if (!snapshot) {
      throw new Error("运行不存在");
    }
    return snapshot;
  }

  private async executeNode(runId: string, nodeId: string, rerunMode: boolean) {
    const node = this.mustNode(runId, nodeId);
    const task = this.getTaskByNode(runId, nodeId);

    if (this.isPortRole(node.role)) {
      await this.executePortNode(runId, nodeId, task, rerunMode);
      return;
    }

    if (node.status === "completed" || node.status === "failed") {
      this.transitionNode(runId, nodeId, "ready", { error: undefined, blockedReason: undefined });
    } else if (node.status === "idle") {
      this.transitionNode(runId, nodeId, "ready", { error: undefined, blockedReason: undefined });
    }

    this.transitionNode(runId, nodeId, "running", { error: undefined, blockedReason: undefined });
    this.transitionTask(runId, task.id, "running");

    this.emit(runId, "node_started", {
      relatedNodeId: nodeId,
      relatedTaskId: task.id,
      message: `${node.name} 开始执行${rerunMode ? "（重跑）" : ""}`,
      payload: { executionOrder: node.executionOrder },
    });
    this.emitExecutionPhase(runId, nodeId, task.id, this.phaseFromNodeRole(node.role), {
      source: "node_started",
      rerunMode,
    });

    await delay(80);

    const executionId = makeId("exec");
    const traceId = makeId("ntrc");
    const traceStartedAt = nowIso();
    const resolved = configResolver.resolveNodeExecutionConfig(runId, nodeId);
    const definition = this.definitionFromResolved(node, resolved);
    const context = this.mustContext(runId, nodeId);

    // ── Trace: node execution start ──
    memoryStore.insertNodeTrace({
      id: traceId, runId, nodeId, executionId, attempt: 1,
      status: "running", role: node.role, startedAt: traceStartedAt,
      llmRoundCount: 0, toolCallCount: 0, provider: resolved.provider,
      model: resolved.model, createdAt: traceStartedAt,
    });
    memoryStore.insertStateTrace({
      id: makeId("strc"), runId, nodeId, executionId, checkpoint: "pre_execution",
      nodeStatus: "running", contextSnapshotJson: JSON.stringify({
        systemPrompt: context.systemPrompt?.slice(0, 2000),
        taskBrief: context.taskBrief,
        inboundCount: context.inboundMessages.length,
        recentOutputsCount: context.recentOutputs.length,
      }),
      createdAt: traceStartedAt,
    });

    memoryStore.replaceAgentDefinitions(
      runId,
      memoryStore
        .getAgentDefinitions(runId)
        .map((item) => (item.id === definition.id ? definition : item)),
    );

    memoryStore.updateAgentContext(runId, context.id, (current) => ({
      ...current,
      systemPrompt: definition.systemPrompt,
      taskBrief: node.taskBrief,
      updatedAt: nowIso(),
    }));

    if ((node.role === "worker" || node.role === "research" || node.role === "reviewer") && this.isFailMode(runId)) {
      this.transitionNode(runId, nodeId, "failed", {
        error: "执行器触发失败注入",
      });
      this.transitionTask(runId, task.id, "failed");
      this.emit(runId, "node_failed", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${node.name} 执行失败: 执行器触发失败注入`,
        payload: { blockedReason: "执行器触发失败注入", executionOrder: node.executionOrder },
      });
      throw new Error("执行代理失败");
    }

    const freshNode = this.mustNode(runId, nodeId);
    const freshContext = this.mustContext(runId, nodeId);
    const resolvedInput = this.resolveNodeExecutionInput(runId, freshNode, definition, freshContext);
    this.applyResolvedInput(runId, freshNode.id, freshContext.id, resolvedInput, task.id);
    const executionContext = this.mustContext(runId, nodeId);

    // ── Trace: post input resolve ──
    memoryStore.insertStateTrace({
      id: makeId("strc"), runId, nodeId, executionId, checkpoint: "post_input_resolve",
      nodeStatus: "running", contextSnapshotJson: JSON.stringify({
        resolvedInputLength: resolvedInput.length,
        resolvedInputPreview: resolvedInput.slice(0, 500),
      }),
      createdAt: nowIso(),
    });
    memoryStore.updateNodeTrace(traceId, { resolvedInput: resolvedInput.slice(0, 4000) });
    const inboundMessageDetails = executionContext.inboundMessages.map((message) => ({
      messageId: message.id,
      fromNodeId: message.fromNodeId,
      toNodeId: message.toNodeId,
      type: message.type,
      contentHash: this.textHash(message.content ?? ""),
      contentLength: (message.content ?? "").length,
    }));
    this.traceDuplicate("[Runtime][exec:start]", {
      runId,
      nodeId,
      executionId,
      nodeRole: freshNode.role,
      startedAt: nowIso(),
      executionOrder: freshNode.executionOrder,
      inboundCount: executionContext.inboundMessages.length,
      outboundCount: executionContext.outboundMessages.length,
      inputHash: this.textHash(resolvedInput),
      inputLength: resolvedInput.length,
    });
    if (freshNode.role === "summarizer" || freshNode.role === "output") {
      this.traceDuplicate("[Runtime][exec:input_sources]", {
        runId,
        nodeId,
        executionId,
        nodeRole: freshNode.role,
        inboundMessages: inboundMessageDetails,
        resolvedInputHash: this.textHash(resolvedInput),
        resolvedInputLength: resolvedInput.length,
      });
    }
    // ── Trace: tracking counters for LLM rounds and tool calls ──
    let traceLlmRounds = 0;
    let traceToolCalls = 0;
    let traceTotalPromptTokens = 0;
    let traceTotalCompletionTokens = 0;
    const promptTraceIds = new Map<number, string>(); // round → promptTraceId

    // ── Dev Mode Agent: run script executor instead of LLM adapter ──
    const nodeConfig = configService.getNodeConfig(runId, nodeId);
    if (nodeConfig?.executionMode === "dev" || nodeConfig?.executionMode === "script") {
      await this.executeDevModeNode(
        runId, nodeId, task, freshNode, resolved, executionContext,
        resolvedInput, executionId, traceId, traceStartedAt,
      );
      return;
    }

    const toolResolution = toolResolver.resolveForNode(runId, nodeId, freshNode.role);
    const runMode = this.mustSnapshot(runId).run.runMode ?? "standard";
    const resolvedTools = this.resolveToolsForRunMode(runMode, toolResolution.enabled);

    // Inject mounted Skills as synthetic tools
    const nodeSkills = configService.resolveNodeSkills(runId, nodeId);
    for (const { skill, script } of nodeSkills) {
      resolvedTools.push({
        toolId: `skill:${skill.id}`,
        name: skill.name,
        description: skill.description ?? skill.outputDescription ?? "",
        category: "custom",
        inputSchema: script.parameterSchema,
        outputSchema: {},
        sourceType: "local_script",
        sourceConfig: {
          localPath: script.localPath,
          runCommand: script.runCommand,
          environmentId: script.defaultEnvironmentId,
        },
        authRequirements: { type: "none", required: false },
        policy: { timeoutMs: 120_000 },
        enabled: true,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        effectiveEnabled: true,
        effectivePriority: 0,
        resolvedFrom: "node_override",
        effectiveConfig: {
          localPath: script.localPath,
          runCommand: script.runCommand,
          environmentId: script.defaultEnvironmentId,
        },
      });
    }

    // ── Inject built-in agent tools (handoff / subtask) ──
    // Only inject for roles that can use tools and have at least one other agent to talk to
    const registry = this.getAgentRegistry(runId);
    if (toolResolution.toolPolicy !== "disabled" && registry.size > 1) {
      const agentDesc = registry.describeAll(nodeId);
      const builtinTools = getBuiltinAgentTools(agentDesc);
      resolvedTools.push(...builtinTools);
    }

    const executionAdapter = this.resolveExecutionAdapter(runId, nodeId, resolved);
    if (executionAdapter instanceof MockAgentAdapter && resolved.provider && resolved.provider !== "mock") {
      const reason = resolved.provider === "anthropic"
        ? "当前适配器仅支持 OpenAI 兼容 chat/completions 协议，Anthropic 尚未接入"
        : "缺少可用的 baseURL 或 API Key，已回退到 Mock 执行";
      this.emit(runId, "agent_context_updated", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${resolved.name} 使用 Mock 执行: ${reason}`,
        payload: { reason: "adapter_fallback", provider: resolved.provider },
      });
    }

    try {
      if (toolResolution.toolPolicy === "required" && resolvedTools.length === 0) {
        throw new Error("节点工具策略为 required，但当前无可用工具。");
      }

      // ── Token budget check ──
      const budgetCheck = tokenBudgetTracker.check(runId, nodeId);
      if (!budgetCheck.allowed) {
        throw new Error(budgetCheck.reason ?? "Token 预算耗尽");
      }

      let result = await executionAdapter.run({
        node: freshNode,
        definition,
        context: executionContext,
        resolvedInput,
        availableTools: resolvedTools,
        maxToolRounds: nodeConfig?.maxToolRounds,
        checkBudget: () => tokenBudgetTracker.check(runId, nodeId),
        streamTokens: (token) => {
          const currentNode = this.mustNode(runId, nodeId);
          const nextOutput = `${currentNode.latestOutput ?? ""}${token}`;

          this.updateNode(runId, nodeId, {
            latestOutput: nextOutput,
          });

          memoryStore.updateAgentContext(runId, executionContext.id, (current) => ({
            ...current,
            recentOutputs: current.recentOutputs.length > 0
              ? [...current.recentOutputs.slice(0, -1), nextOutput]
              : [nextOutput],
            latestSummary: nextOutput,
            updatedAt: nowIso(),
          }));

          this.emit(runId, "token_stream", {
            relatedNodeId: nodeId,
            relatedTaskId: task.id,
            message: token,
            payload: {
              executionOrder: node.executionOrder,
              accumulatedOutput: nextOutput,
            },
          });
        },
        emitLifecycleEvent: (type, payload) => {
          this.emit(runId, type, {
            relatedNodeId: nodeId,
            relatedTaskId: task.id,
            message: type === "llm_request_sent" ? `${resolved.name} 已发送 LLM 请求` : `${resolved.name} 已接收 LLM 响应`,
            payload: {
              executionOrder: node.executionOrder,
              ...payload,
            },
          });
          // ── Trace: prompt trace ──
          try {
            const round = (payload as Record<string, unknown>)?.round as number ?? 0;
            if (type === "llm_request_sent") {
              traceLlmRounds = Math.max(traceLlmRounds, round + 1);
              const ptId = makeId("ptrc");
              promptTraceIds.set(round, ptId);
              const pt = (payload as Record<string, unknown>)?.promptTrace as Record<string, unknown> | undefined;
              memoryStore.insertPromptTrace({
                id: ptId, runId, nodeId, executionId, round,
                provider: (payload as Record<string, unknown>)?.provider as string ?? resolved.provider,
                model: (payload as Record<string, unknown>)?.model as string ?? resolved.model,
                systemPrompt: pt?.systemPrompt as string | undefined,
                userPrompt: pt?.userPrompt as string | undefined,
                messageHistoryJson: pt?.messageHistory ? JSON.stringify(pt.messageHistory) : undefined,
                toolsJson: (payload as Record<string, unknown>)?.toolsCount ? JSON.stringify({ count: (payload as Record<string, unknown>)?.toolsCount }) : undefined,
                startedAt: nowIso(), createdAt: nowIso(),
              });
            } else if (type === "llm_response_received") {
              const ptId = promptTraceIds.get(round);
              const finishedAt = nowIso();
              const pl = payload as Record<string, unknown>;
              const pTokens = typeof pl?.promptTokens === "number" ? pl.promptTokens : 0;
              const cTokens = typeof pl?.completionTokens === "number" ? pl.completionTokens : 0;
              const tTokens = typeof pl?.totalTokens === "number" ? pl.totalTokens : (pTokens + cTokens);
              traceTotalPromptTokens += pTokens;
              traceTotalCompletionTokens += cTokens;
              // Record token usage for budget tracking
              if (tTokens > 0) {
                tokenBudgetTracker.record(runId, nodeId, {
                  promptTokens: pTokens,
                  completionTokens: cTokens,
                  totalTokens: tTokens,
                });
              }
              if (ptId) {
                memoryStore.updatePromptTrace(ptId, {
                  completion: (pl?.completion as string)?.slice(0, 8000),
                  promptTokens: pTokens, completionTokens: cTokens,
                  totalTokens: tTokens,
                  statusCode: typeof pl?.status === "number" ? pl.status : undefined,
                  finishedAt, durationMs: undefined,
                });
              }
            }
          } catch { /* trace errors must not break execution */ }
        },
        invokeTool: async (request) => {
          // ── Intercept built-in agent tools (handoff / subtask) ──
          if (isBuiltinTool(request.toolId)) {
            try {
              if (request.toolId === BUILTIN_TOOL_TRANSFER) {
                return await this.executeHandoff(runId, nodeId, request.input ?? {});
              }
              if (request.toolId === BUILTIN_TOOL_SUBTASK) {
                return await this.executeSubtask(runId, nodeId, request.input ?? {});
              }
            } catch (err) {
              return {
                ok: false,
                durationMs: 0,
                error: {
                  code: "BUILTIN_TOOL_ERROR",
                  message: err instanceof Error ? err.message : "内置工具执行失败",
                  retriable: false,
                  source: "platform" as const,
                },
              };
            }
          }

          const tool = resolvedTools.find((item) => item.toolId === request.toolId);
          if (!tool) {
            return {
              ok: false,
              durationMs: 0,
              error: {
                code: "TOOL_NOT_AVAILABLE",
                message: `节点不可用工具: ${request.toolId}`,
                retriable: false,
                source: "platform",
              },
            };
          }

          // ── Trace: tool call start ──
          const toolTraceId = makeId("ttrc");
          const toolStartedAt = nowIso();
          traceToolCalls++;
          try {
            memoryStore.insertToolTrace({
              id: toolTraceId, runId, nodeId, executionId, round: traceLlmRounds - 1,
              toolId: tool.toolId, toolName: tool.name, sourceType: tool.sourceType,
              status: "running", inputJson: JSON.stringify(request.input ?? {}),
              startedAt: toolStartedAt, createdAt: toolStartedAt,
            });
          } catch { /* non-fatal */ }

          this.emit(runId, "tool_invocation_started", {
            relatedNodeId: nodeId,
            relatedTaskId: task.id,
            message: `工具调用开始: ${tool.name}`,
            payload: {
              toolId: tool.toolId,
              toolName: tool.name,
              sourceType: tool.sourceType,
              input: request.input ?? {},
            },
          });
          this.emitExecutionPhase(runId, nodeId, task.id, "tool_calling", {
            source: "tool_invocation_started",
            toolId: tool.toolId,
            toolName: tool.name,
          });

          // Skill tools → execute via dev-agent-executor instead of toolExecutor
          let result: Awaited<ReturnType<typeof toolExecutor.execute>>;
          if (tool.toolId.startsWith("skill:")) {
            const cfg = tool.effectiveConfig as { localPath?: string; runCommand?: string; environmentId?: string };
            const templateParams: Record<string, string> = {};
            for (const [k, v] of Object.entries(request.input ?? {})) {
              templateParams[k] = String(v);
            }
            const startMs = Date.now();
            try {
              const devResult = await executeDevAgent({
                workspaceId: "",
                entryFile: "",
                runCommand: cfg.runCommand ?? "",
                resolvedInput: JSON.stringify(request.input ?? {}),
                cwdOverride: cfg.localPath,
                environmentId: cfg.environmentId,
                templateParams,
              });
              const stdoutText = devResult.stdout.trim();
              let data: Record<string, unknown>;
              try { data = JSON.parse(stdoutText) as Record<string, unknown>; } catch { data = { text: stdoutText }; }
              result = devResult.success
                ? { ok: true, data, durationMs: devResult.durationMs }
                : { ok: false, durationMs: devResult.durationMs, error: { code: "SKILL_EXECUTION_FAILED", message: devResult.stderr.slice(0, 500), retriable: false, source: "local_script" as const } };
            } catch (err) {
              result = { ok: false, durationMs: Date.now() - startMs, error: { code: "SKILL_EXECUTION_ERROR", message: err instanceof Error ? err.message : "技能执行异常", retriable: false, source: "local_script" as const } };
            }
          } else {
            result = await toolExecutor.execute(
              tool,
              request.input ?? {},
              { runId, nodeId, taskId: task.id },
              { timeoutMs: request.timeoutMs, maxRetries: request.maxRetries },
            );
          }

          // ── Trace: tool call result ──
          try {
            memoryStore.updateToolTrace(toolTraceId, {
              status: result.ok ? "success" : "failed",
              outputJson: result.data ? JSON.stringify(result.data).slice(0, 8000) : undefined,
              errorJson: result.error ? JSON.stringify(result.error) : undefined,
              finishedAt: nowIso(), durationMs: result.durationMs,
            });
          } catch { /* non-fatal */ }

          if (result.ok) {
            this.emit(runId, "tool_invocation_succeeded", {
              relatedNodeId: nodeId,
              relatedTaskId: task.id,
              message: `工具调用成功: ${tool.name}`,
              payload: {
                toolId: tool.toolId,
                toolName: tool.name,
                durationMs: result.durationMs,
                output: result.data ?? undefined,
                meta: result.meta,
              },
            });
          } else {
            this.emit(runId, "tool_invocation_failed", {
              relatedNodeId: nodeId,
              relatedTaskId: task.id,
              message: `工具调用失败: ${tool.name} - ${result.error?.message ?? "未知错误"}`,
              payload: {
                toolId: tool.toolId,
                toolName: tool.name,
                durationMs: result.durationMs,
                output: result.data ?? undefined,
                error: result.error,
              },
            });
          }

          return result;
        },
      });

      // ── Reflection loop: self-evaluate and optionally re-execute ──
      const reflectionConfig = nodeConfig?.reflectionEnabled
        ? { enabled: true, maxRounds: nodeConfig.maxReflectionRounds ?? DEFAULT_REFLECTION_CONFIG.maxRounds }
        : DEFAULT_REFLECTION_CONFIG;

      if (reflectionConfig.enabled && result.latestOutput) {
        const taskBrief = executionContext.taskBrief || freshNode.taskBrief || "";
        const responsibility = resolved.responsibility || "";

        for (let reflectionRound = 1; reflectionRound <= reflectionConfig.maxRounds; reflectionRound++) {
          // Evaluate current output
          const reflectionPrompt = buildReflectionPrompt(taskBrief, responsibility, result.latestOutput);
          try {
            const reflectionResult = await executionAdapter.run({
              node: freshNode,
              definition,
              context: executionContext,
              resolvedInput: reflectionPrompt,
              availableTools: [],
              invokeTool: async () => ({ ok: false, durationMs: 0, error: { code: "NOT_AVAILABLE", message: "反思阶段不可调用工具", retriable: false, source: "platform" as const } }),
            });

            const evaluation = parseReflectionResponse(reflectionResult.latestOutput);

            this.emit(runId, "execution_phase_changed", {
              relatedNodeId: nodeId,
              relatedTaskId: task.id,
              message: `反思第 ${reflectionRound} 轮: ${evaluation.satisfied ? "通过" : "需要改进"}`,
              payload: {
                phase: "reflection",
                round: reflectionRound,
                satisfied: evaluation.satisfied,
                feedback: evaluation.feedback?.slice(0, 500),
                confidence: evaluation.confidence,
              },
            });

            if (evaluation.satisfied) break;

            // Re-execute with improvement guidance
            const improvementInput = buildImprovementPrompt(
              resolvedInput,
              result.latestOutput,
              evaluation.feedback ?? "输出质量不足，请改进",
              reflectionRound,
            );

            const improvedResult = await executionAdapter.run({
              node: freshNode,
              definition,
              context: executionContext,
              resolvedInput: improvementInput,
              availableTools: resolvedTools,
              invokeTool: async (request) => {
                // Reuse the same invokeTool logic but simplified
                const invokeTool = resolvedTools.find((item) => item.toolId === request.toolId);
                if (!invokeTool) {
                  return { ok: false, durationMs: 0, error: { code: "TOOL_NOT_AVAILABLE", message: "工具不可用", retriable: false, source: "platform" as const } };
                }
                return toolExecutor.execute(invokeTool, request.input ?? {}, { runId, nodeId, taskId: task.id });
              },
              // No streaming during reflection re-execution to avoid duplicated output
            });

            // Update result with improved output
            result = improvedResult;
          } catch (reflectionError) {
            console.warn("[Runtime] Reflection failed, keeping original output:", reflectionError instanceof Error ? reflectionError.message : reflectionError);
            break;
          }
        }
      }

      // ── Trace: node execution success ──
      const traceFinishedAt = nowIso();
      const traceDurationMs = new Date(traceFinishedAt).getTime() - new Date(traceStartedAt).getTime();
      try {
        memoryStore.updateNodeTrace(traceId, {
          status: "completed", finishedAt: traceFinishedAt, durationMs: traceDurationMs,
          latestOutput: (result.latestOutput ?? "").slice(0, 4000),
          llmRoundCount: traceLlmRounds, toolCallCount: traceToolCalls,
          promptTokens: traceTotalPromptTokens || undefined,
          completionTokens: traceTotalCompletionTokens || undefined,
          totalTokens: (traceTotalPromptTokens + traceTotalCompletionTokens) || undefined,
        });
        memoryStore.insertStateTrace({
          id: makeId("strc"), runId, nodeId, executionId, checkpoint: "post_execution",
          nodeStatus: "completed", contextSnapshotJson: JSON.stringify({
            outputLength: (result.latestOutput ?? "").length,
            outputPreview: (result.latestOutput ?? "").slice(0, 500),
            llmRounds: traceLlmRounds, toolCalls: traceToolCalls,
            totalTokens: traceTotalPromptTokens + traceTotalCompletionTokens,
          }),
          createdAt: traceFinishedAt,
        });
      } catch { /* non-fatal */ }

      this.updateNode(runId, nodeId, {
        name: resolved.name,
        latestInput: resolvedInput,
        latestOutput: result.latestOutput,
        resolvedInput,
        taskBrief: executionContext.taskBrief,
        responsibility: resolved.responsibility,
      });

      memoryStore.updateAgentContext(runId, executionContext.id, (current) => ({
        ...current,
        recentOutputs: [...current.recentOutputs, result.latestOutput].slice(-16),
        latestSummary: result.latestOutput,
        updatedAt: nowIso(),
      }));

      this.emit(runId, "agent_context_updated", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `节点 ${resolved.name} 上下文已更新`,
        payload: {
          reason: "execution",
          provider: resolved.provider,
          model: resolved.model,
          contextPatch: {
            resolvedInput,
            recentOutputs: [...(executionContext.recentOutputs ?? []), result.latestOutput].slice(-16),
            latestSummary: result.latestOutput,
          },
        },
      });

      const runState = memoryStore.getRun(runId);
      const memoryScope = this.getMemoryScope(runId);
      const nodeMemory = longTermMemoryService.remember({
        scopeType: memoryScope.scopeType,
        scopeId: memoryScope.scopeId,
        runId,
        workflowId: memoryScope.workflowId,
        nodeId,
        sourceType: "node_output",
        title: `${resolved.name} 输出`,
        content: `${executionContext.taskBrief ?? ""}\n${result.latestOutput}`,
        importance: node.role === "summarizer" ? 0.95 : 0.72,
      });

      if (nodeMemory) {
        this.emit(runId, "memory_indexed", {
          relatedNodeId: nodeId,
          relatedTaskId: task.id,
          message: `节点输出已沉淀到长期记忆: ${resolved.name}`,
          payload: {
            memoryId: nodeMemory.id,
            sourceType: nodeMemory.sourceType,
            scopeType: nodeMemory.scopeType,
            scopeId: nodeMemory.scopeId,
          },
        });
      }

      const outboundMessages = result.outboundMessages ?? [];
      const routingCondition = result.condition;
      const defaultResultDownstreamIds = this.getRoutedDownstreamNodeIds(runId, nodeId, "result", routingCondition);

      // 记录本轮显式发送到的下游节点，用于判断是否需要自动路由
      const explicitlySentTo = new Set<string>();

      for (const outbound of outboundMessages) {
        const outboundPayload =
          outbound.payload
          ?? this.buildDefaultMessagePayload(
            runId,
            nodeId,
            outbound.type,
            outbound.content,
            routingCondition,
            this.phaseFromNodeRole(freshNode.role),
          );
        if (outbound.toNodeId) {
          this.sendMessage(runId, nodeId, outbound.toNodeId, outbound.type, outbound.content, task.id, outboundPayload);
          explicitlySentTo.add(outbound.toNodeId);
          continue;
        }

        const downstreamIds = this.getRoutedDownstreamNodeIds(runId, nodeId, outbound.type, routingCondition);
        if (downstreamIds.length === 0) {
          continue;
        }

        for (const downstreamId of downstreamIds) {
          this.sendMessage(runId, nodeId, downstreamId, outbound.type, outbound.content, task.id, outboundPayload);
          explicitlySentTo.add(downstreamId);
        }
      }

      // 自动路由：当 adapter 未返回 outboundMessages（如 LLMChatAdapter）但节点有下游时，
      // 将 latestOutput 作为默认消息路由到所有下游节点，确保跨节点上下文正确传递。
      if (explicitlySentTo.size === 0 && result.latestOutput) {
        const autoType = this.inferAutoMessageType(freshNode, executionContext);
        const autoDownstreamIds = this.getRoutedDownstreamNodeIds(runId, nodeId, autoType, routingCondition);
        for (const downstreamId of autoDownstreamIds) {
          const autoPayload = this.buildDefaultMessagePayload(
            runId,
            nodeId,
            autoType,
            result.latestOutput,
            routingCondition,
            this.phaseFromNodeRole(freshNode.role),
          );
          this.sendMessage(runId, nodeId, downstreamId, autoType, result.latestOutput, task.id, autoPayload);
        }
      }

      this.transitionNode(runId, nodeId, "completed");
      this.transitionTask(runId, task.id, "completed");

      if (result.finalOutput && node.role === "summarizer") {
        this.emitExecutionPhase(runId, nodeId, task.id, "final_output", {
          source: "summarizer_final_output",
          outputLength: result.finalOutput.length,
        });
        memoryStore.updateRun(runId, (run) => ({
          ...run,
          output: result.finalOutput,
        }));
        this.persistRunOutputToNodePath(runId, nodeId, result.finalOutput);
      }

      if (!result.finalOutput && defaultResultDownstreamIds.length === 0) {
        const finalText = memoryStore.getRun(runId)?.output || result.latestOutput;
        memoryStore.updateRun(runId, (run) => ({
          ...run,
          output: finalText,
        }));
        this.persistRunOutputToNodePath(runId, nodeId, finalText);
      }

      this.emit(runId, "node_completed", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${resolved.name} 执行完成`,
        payload: {
          output: result.finalOutput ?? result.latestOutput,
          executionOrder: node.executionOrder,
        },
      });
      this.traceDuplicate("[Runtime][exec:end]", {
        runId,
        nodeId,
        executionId,
        nodeRole: freshNode.role,
        endedAt: nowIso(),
        outputHash: this.textHash(result.latestOutput ?? ""),
        outputLength: (result.latestOutput ?? "").length,
        finalOutputHash: result.finalOutput ? this.textHash(result.finalOutput) : undefined,
        finalOutputLength: result.finalOutput?.length,
        outputDuplicatedByHalves: this.isContentDuplicatedByHalves(result.latestOutput ?? ""),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "执行异常";
      this.transitionNode(runId, nodeId, "failed", {
        error: message,
        blockedReason: message,
      });
      this.transitionTask(runId, task.id, "failed");
      this.emit(runId, "node_failed", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${resolved.name} 执行失败: ${message}`,
        payload: {
          blockedReason: message,
          executionOrder: node.executionOrder,
          provider: resolved.provider,
          model: resolved.model,
          baseUrl: resolved.baseUrl,
        },
      });
      this.traceDuplicate("[Runtime][exec:error]", {
        runId,
        nodeId,
        executionId,
        nodeRole: freshNode.role,
        failedAt: nowIso(),
        error: message,
      });
      // ── Trace: node execution failure ──
      const failedAt = nowIso();
      try {
        memoryStore.updateNodeTrace(traceId, {
          status: "failed", finishedAt: failedAt,
          durationMs: new Date(failedAt).getTime() - new Date(traceStartedAt).getTime(),
          error: message, llmRoundCount: traceLlmRounds, toolCallCount: traceToolCalls,
          promptTokens: traceTotalPromptTokens || undefined,
          completionTokens: traceTotalCompletionTokens || undefined,
          totalTokens: (traceTotalPromptTokens + traceTotalCompletionTokens) || undefined,
        });
        memoryStore.insertStateTrace({
          id: makeId("strc"), runId, nodeId, executionId, checkpoint: "post_execution",
          nodeStatus: "failed", metadataJson: JSON.stringify({ error: message }),
          createdAt: failedAt,
        });
      } catch { /* non-fatal */ }
      throw error;
    }
  }

  private async executePortNode(runId: string, nodeId: string, task: Task, rerunMode: boolean) {
    const node = this.mustNode(runId, nodeId);
    if (node.status === "completed" || node.status === "failed" || node.status === "idle" || node.status === "waiting") {
      this.transitionNode(runId, nodeId, "ready", { error: undefined, blockedReason: undefined });
    }
    this.transitionNode(runId, nodeId, "running", { error: undefined, blockedReason: undefined });
    this.transitionTask(runId, task.id, "running");

    this.emit(runId, "node_started", {
      relatedNodeId: nodeId,
      relatedTaskId: task.id,
      message: `${node.name} 开始执行${rerunMode ? "（重跑）" : ""}`,
      payload: { executionOrder: node.executionOrder, nodeType: "port" },
    });
    this.emitExecutionPhase(runId, nodeId, task.id, this.phaseFromNodeRole(node.role), {
      source: "port_node_started",
      rerunMode,
    });

    try {
      if (node.role === "output") {
        await this.executeOutputPortNode(runId, node, task);
      } else {
        await this.executeInputPortNode(runId, node, task);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "端口节点执行失败";
      this.transitionNode(runId, nodeId, "failed", {
        error: message,
        blockedReason: message,
      });
      this.transitionTask(runId, task.id, "failed");
      this.emit(runId, "node_failed", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${node.name} 执行失败: ${message}`,
        payload: { blockedReason: message, executionOrder: node.executionOrder },
      });
      throw error;
    }
  }

  private async executeInputPortNode(runId: string, node: AgentNode, task: Task) {
    const context = this.mustContext(runId, node.id);
    const run = memoryStore.getRun(runId);
    const rootTask = memoryStore.getTasks(runId).find((item) => item.id === run?.rootTaskId);
    const latestHuman = context.humanMessages.at(-1);
    const baseInput = (latestHuman?.content || rootTask?.title || context.taskBrief || "").trim();
    const dispatchPayload = this.buildInputDispatchPayload(runId, node.id, rootTask?.title, baseInput, latestHuman);
    const dispatchContent = this.stringifyMessagePayload(dispatchPayload);
    const resolvedInput = dispatchContent;

    this.applyResolvedInput(runId, node.id, context.id, resolvedInput, task.id);
    this.updateNode(runId, node.id, {
      latestOutput: dispatchContent,
      error: undefined,
      blockedReason: undefined,
    });

    memoryStore.updateAgentContext(runId, context.id, (current) => ({
      ...current,
      recentOutputs: [...current.recentOutputs, dispatchContent].slice(-16),
      latestSummary: dispatchContent,
      updatedAt: nowIso(),
    }));

    this.emit(runId, "agent_context_updated", {
      relatedNodeId: node.id,
      relatedTaskId: task.id,
      message: `端口节点 ${node.name} 已注入输入`,
      payload: {
        reason: "port_input",
        contextPatch: {
          resolvedInput,
          recentOutputs: [...context.recentOutputs, dispatchContent].slice(-16),
          latestSummary: dispatchContent,
        },
      },
    });

    const downstreamIds = this.getRoutedDownstreamNodeIds(runId, node.id, "task_assignment");
    for (const targetId of downstreamIds) {
      this.sendMessage(runId, node.id, targetId, "task_assignment", dispatchContent, task.id, dispatchPayload);
    }

    if (downstreamIds.length === 0) {
      memoryStore.updateRun(runId, (current) => ({ ...current, output: dispatchContent }));
      this.persistRunOutputToNodePath(runId, node.id, dispatchContent);
    }

    this.transitionNode(runId, node.id, "completed", { blockedReason: undefined });
    this.transitionTask(runId, task.id, "completed");
    this.emit(runId, "node_completed", {
      relatedNodeId: node.id,
      relatedTaskId: task.id,
      message: `${node.name} 执行完成`,
      payload: { output: dispatchContent, executionOrder: node.executionOrder },
    });
  }

  private async executeOutputPortNode(runId: string, node: AgentNode, task: Task) {
    const context = this.mustContext(runId, node.id);
    const executionId = makeId("exec");
    const latestInboundBySource = new Map<string, Message>();
    for (const inboundMessage of context.inboundMessages) {
      if (!inboundMessage.content?.trim()) {
        continue;
      }
      latestInboundBySource.set(inboundMessage.fromNodeId, inboundMessage);
    }

    const inboundSegments = Array.from(latestInboundBySource.values()).map((item) => item.content.trim());
    const upstreamOutputs = this.getUpstreamNodeIds(runId, node.id)
      .filter((upstreamId) => !latestInboundBySource.has(upstreamId))
      .map((upstreamId) => {
        const upstreamNode = this.mustNode(runId, upstreamId);
        return {
          sourceNodeId: upstreamNode.id,
          content: upstreamNode.latestOutput?.trim() ?? "",
        };
      })
      .filter((item): item is { sourceNodeId: string; content: string } => Boolean(item.content));

    const finalSegments = [...inboundSegments, ...upstreamOutputs.map((item) => item.content)];
    const finalText = finalSegments.join("\n\n").trim() || memoryStore.getRun(runId)?.output || "无可输出内容";
    const resolvedInput = finalText;
    this.emitExecutionPhase(runId, node.id, task.id, "final_output", {
      source: "output_port_finalize",
      outputLength: finalText.length,
    });

    this.traceDuplicate("[Runtime][output:inputs]", {
      runId,
      nodeId: node.id,
      executionId,
      inboundMessages: Array.from(latestInboundBySource.values()).map((item) => ({
        sourceNodeId: item.fromNodeId,
        messageId: item.id,
        contentHash: this.textHash(item.content ?? ""),
        contentLength: (item.content ?? "").length,
      })),
      upstreamFallbackOutputs: upstreamOutputs.map((item) => ({
        sourceNodeId: item.sourceNodeId,
        contentHash: this.textHash(item.content),
        contentLength: item.content.length,
      })),
      finalTextHash: this.textHash(finalText),
      finalTextLength: finalText.length,
      finalTextDuplicatedByHalves: this.isContentDuplicatedByHalves(finalText),
    });

    this.applyResolvedInput(runId, node.id, context.id, resolvedInput, task.id);

    this.updateNode(runId, node.id, {
      latestInput: resolvedInput,
      latestOutput: finalText,
      error: undefined,
      blockedReason: undefined,
      resolvedInput,
    });

    memoryStore.updateAgentContext(runId, context.id, (current) => ({
      ...current,
      recentOutputs: [...current.recentOutputs, finalText].slice(-16),
      latestSummary: finalText,
      updatedAt: nowIso(),
    }));

    this.emit(runId, "agent_context_updated", {
      relatedNodeId: node.id,
      relatedTaskId: task.id,
      message: `端口节点 ${node.name} 上下文已更新`,
      payload: {
        reason: "port_output",
        contextPatch: {
          resolvedInput,
          recentOutputs: [...context.recentOutputs, finalText].slice(-16),
          latestSummary: finalText,
        },
      },
    });

    memoryStore.updateRun(runId, (current) => ({ ...current, output: finalText }));
    this.persistRunOutputToNodePath(runId, node.id, finalText);

    this.transitionNode(runId, node.id, "completed", { blockedReason: undefined });
    this.transitionTask(runId, task.id, "completed");
    this.emit(runId, "node_completed", {
      relatedNodeId: node.id,
      relatedTaskId: task.id,
      message: `${node.name} 执行完成`,
      payload: { output: finalText, executionOrder: node.executionOrder },
    });
  }

  private createPortDefinition(node: AgentNode): AgentDefinition {
    const now = nowIso();
    const roleDefaults = this.getRoleDefaults(node.role);
    return {
      id: node.agentDefinitionId,
      runId: node.runId,
      name: node.name,
      role: node.role,
      systemPrompt: roleDefaults.systemPrompt,
      responsibility: roleDefaults.responsibility,
      inputSchema: roleDefaults.inputSchema,
      outputSchema: roleDefaults.outputSchema,
      allowHumanInput: node.role === "input" || node.role === "human" || node.role === "output",
      createdAt: now,
      updatedAt: now,
    };
  }

  private definitionFromResolved(node: AgentNode, resolved: ResolvedAgentExecutionConfig): AgentDefinition {
    const now = nowIso();
    const roleDefaults = this.getRoleDefaults(node.role);

    return {
      id: node.agentDefinitionId,
      runId: node.runId,
      name: resolved.name,
      role: node.role,
      systemPrompt: this.composeSystemPrompt(resolved),
      responsibility: resolved.responsibility ?? roleDefaults.responsibility,
      inputSchema: roleDefaults.inputSchema,
      outputSchema: roleDefaults.outputSchema,
      allowHumanInput: true,
      model: resolved.model,
      temperature: resolved.temperature,
      provider: resolved.provider,
      createdAt: now,
      updatedAt: now,
    };
  }

  private resolveNodeExecutionInput(
    runId: string,
    node: AgentNode,
    definition: AgentDefinition,
    context: AgentContext,
  ) {
    const run = memoryStore.getRun(runId);
    const rootTask = memoryStore.getTasks(runId).find((item) => item.id === run?.rootTaskId);
    const inbound = context.inboundMessages;
    const humanMessages = context.humanMessages;
    console.info("[Runtime][context]", {
      runId,
      nodeId: node.id,
      nodeRole: node.role,
      provider: definition.provider ?? "mock",
      model: definition.model ?? "mock-agent-v1",
      inboundMessagesCount: inbound.length,
      humanMessagesCount: humanMessages.length,
      outboundMessagesCount: context.outboundMessages.length,
    });
    const inboundHumanMessages = inbound
      .slice(-12)
      .map((message) => {
        const data = this.readMessageData(message);
        if (typeof data.humanMessage === "string" && data.humanMessage.trim()) {
          return `${data.humanMessage.trim()} (from ${message.fromNodeId})`;
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));

    const inboundLines = inbound
      .slice(-12)
      .map((message) => `- [${message.type}] ${this.describeInboundMessage(message)}`);

    const explicitHumanLines = humanMessages
      .slice(-16)
      .map((message) => this.formatHumanMessage(message));
    const mergedHumanLines = Array.from(new Set([...explicitHumanLines, ...inboundHumanMessages]));

    const taskTitle = rootTask?.title || context.taskBrief || node.taskBrief || "未提供任务";
    const memoryScope = this.getMemoryScope(runId);
    const memoryQuery = [
      taskTitle,
      context.taskBrief || node.taskBrief || "",
      ...inbound.slice(-16).map((message) => this.describeInboundMessage(message)),
      ...humanMessages.slice(-4).map((message) => message.content),
    ]
      .filter(Boolean)
      .join("\n");

    const memoryHits = longTermMemoryService.search({
      query: memoryQuery,
      workspaceId: memoryScope.workspaceId ?? runId,
      workflowId: memoryScope.workflowId,
      runId,
      nodeId: node.id,
      limit: 8,
      minScore: 0.15,
    });

    if (memoryHits.length > 0) {
      this.emit(runId, "memory_retrieved", {
        relatedNodeId: node.id,
        relatedTaskId: node.taskId,
        message: `${node.name} 已检索到 ${memoryHits.length} 条长期记忆`,
        payload: {
          memoryIds: memoryHits.map((item) => item.id),
          scores: memoryHits.map((item) => Number(item.score.toFixed(4))),
        },
      });
    }

    // Use working memory assembler for dynamic token-budget allocation
    // Budget scales with model context window (heuristic based on model name)
    const modelName = (definition.model ?? "").toLowerCase();
    let tokenBudget = 6000; // Default
    if (/128k|gpt-4o|claude-3|gemini-1\.5/.test(modelName)) {
      tokenBudget = 12000;
    } else if (/32k|gpt-4-turbo/.test(modelName)) {
      tokenBudget = 10000;
    } else if (/16k/.test(modelName)) {
      tokenBudget = 8000;
    }

    const assembled = assembleContext({
      tokenBudget,
      taskTitle,
      nodeBrief: context.taskBrief || node.taskBrief || "",
      inboundLines,
      humanLines: mergedHumanLines,
      memoryHits,
      systemPrompt: definition.systemPrompt || "",
    });

    return assembled.prompt;
  }

  private applyResolvedInput(
    runId: string,
    nodeId: string,
    contextId: string,
    resolvedInput: string,
    relatedTaskId?: string,
  ) {
    this.updateNode(runId, nodeId, {
      latestInput: resolvedInput,
      resolvedInput,
      error: undefined,
      blockedReason: undefined,
    });

    memoryStore.updateAgentContext(runId, contextId, (current) => ({
      ...current,
      resolvedInput,
      updatedAt: nowIso(),
    }));

    const node = this.mustNode(runId, nodeId);
    const context = this.mustContext(runId, nodeId);
    const contextPatch = {
      resolvedInput,
      inboundMessages: context.inboundMessages.slice(-30),
      outboundMessages: context.outboundMessages.slice(-30),
      recentOutputs: context.recentOutputs.slice(-16),
    };

    this.emit(runId, "agent_context_updated", {
      relatedNodeId: nodeId,
      relatedTaskId,
      message: `${node.name} 上下文已更新（resolved input）`,
      payload: {
        reason: "context_resolved",
        contextPatch,
      },
    });

    this.emit(runId, "context_resolved", {
      relatedNodeId: nodeId,
      relatedTaskId,
      message: `${node.name} 执行上下文已解析`,
      payload: {
        executionOrder: node.executionOrder,
        sourceBreakdown: {
          inboundCount: context.inboundMessages.length,
          humanCount: context.humanMessages.length,
          outboundCount: context.outboundMessages.length,
        },
        resolvedInputSummary: resolvedInput.slice(0, 1200),
        resolvedInput,
      },
    });
  }

  private buildInputDispatchPayload(
    runId: string,
    sourceNodeId: string,
    task: string | undefined,
    userInput: string,
    latestHuman?: HumanMessage,
  ): Message["payload"] {
    const attachmentList = latestHuman?.attachments?.map((item) => ({
      name: item.name,
      mimeType: item.mimeType,
    })) ?? [];

    return {
      schemaVersion: 1,
      kind: "workflow_input",
      origin: "input_port",
      data: {
        runId,
        sourceNodeId,
        task: task || "",
        userInput,
        humanMessage: latestHuman?.content ?? userInput,
        attachments: attachmentList,
        createdAt: nowIso(),
      },
    };
  }

  private stringifyMessagePayload(payload?: Message["payload"]) {
    if (!payload) {
      return "";
    }
    return JSON.stringify(payload, null, 2);
  }

  private buildDefaultMessagePayload(
    runId: string,
    sourceNodeId: string,
    type: Message["type"],
    content: string,
    condition?: string,
    executionPhase?: ExecutionPhase,
  ): Message["payload"] {
    const sourceNode = memoryStore.getNodeById(runId, sourceNodeId);
    return {
      schemaVersion: 1,
      kind: type === "task_assignment" ? "task_assignment" : "node_result",
      origin: "runtime",
      data: {
        runId,
        sourceNodeId,
        sourceNodeRole: sourceNode?.role,
        sourceNodeName: sourceNode?.name,
        type,
        content,
        contentHash: this.textHash(content),
        contentLength: content.length,
        executionPhase: executionPhase ?? this.phaseFromNodeRole(sourceNode?.role ?? EXECUTION_ROLE_FALLBACK),
        ...(condition ? { condition } : {}),
        createdAt: nowIso(),
      },
    };
  }

  private inferAutoMessageType(node: AgentNode, context: AgentContext): Message["type"] {
    if (node.role === "planner" || node.role === "input" || node.role === "human") {
      return "task_assignment";
    }

    if (node.role === "router") {
      return context.inboundMessages.at(-1)?.type ?? "task_assignment";
    }

    return "result";
  }

  private resolveToolsForRunMode(
    runMode: RunMode,
    tools: ReturnType<typeof toolResolver.resolveForNode>["enabled"],
  ) {
    if (runMode === "safe") {
      return [];
    }
    if (runMode === "sequential") {
      return tools.slice(0, 4);
    }
    return tools;
  }

  private describeInboundMessage(message: Message) {
    const mergedData = this.readMessageData(message);
    const userInput = mergedData.userInput;
    const humanMessage = mergedData.humanMessage;
    const task = mergedData.task;

    if (typeof userInput === "string" && userInput.trim()) {
      return `${message.fromNodeId} -> ${message.toNodeId}: ${userInput.trim()}`;
    }
    if (typeof humanMessage === "string" && humanMessage.trim()) {
      return `${message.fromNodeId} -> ${message.toNodeId}: ${humanMessage.trim()}`;
    }
    if (typeof task === "string" && task.trim()) {
      return `${message.fromNodeId} -> ${message.toNodeId}: ${task.trim()}`;
    }
    return `${message.fromNodeId} -> ${message.toNodeId}: ${message.content}`;
  }

  private readMessageData(message: Message): Record<string, unknown> {
    const payloadData = message.payload?.data ?? {};
    const legacyData = this.tryParseLegacyPayload(message.content);
    return { ...legacyData, ...payloadData };
  }

  private tryParseLegacyPayload(content: string): Record<string, unknown> {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      const obj = parsed as Record<string, unknown>;
      if (obj.data && typeof obj.data === "object") {
        return obj.data as Record<string, unknown>;
      }
      return obj;
    } catch {
      return {};
    }
  }

  private formatHumanMessage(message: HumanMessage) {
    const attachments = message.attachments?.length
      ? ` (附件: ${message.attachments.map((item) => `${item.name}/${item.mimeType}`).join(", ")})`
      : "";
    return `${message.content}${attachments}`;
  }

  private composeSystemPrompt(resolved: ResolvedAgentExecutionConfig) {
    const parts = [resolved.systemPrompt || ""];

    if (resolved.additionalPrompt) {
      parts.push(`附加要求:\n${resolved.additionalPrompt}`);
    }

    if (resolved.promptDocuments.length > 0) {
      parts.push(
        `Prompt 资产:\n${resolved.promptDocuments.map((doc) => `# ${doc.name}\n${doc.content}`).join("\n\n")}`,
      );
    }

    if (resolved.skillDocuments.length > 0) {
      parts.push(
        `Skill 资产:\n${resolved.skillDocuments.map((doc) => `# ${doc.name}\n${doc.content}`).join("\n\n")}`,
      );
    }

    if (resolved.referenceDocuments.length > 0) {
      parts.push(
        `Reference 资产:\n${resolved.referenceDocuments.map((doc) => `# ${doc.name}\n${doc.content}`).join("\n\n")}`,
      );
    }

    return parts.filter(Boolean).join("\n\n");
  }

  private getRoleDefaults(role: NodeRole) {
    if (role === "input" || role === "human") {
      return {
        systemPrompt: "你是输入端口节点，负责把任务输入和人工输入注入到工作流。",
        responsibility: "接收输入并将其传递给下游节点。",
        inputSchema: "任务文本 + 人工输入",
        outputSchema: "下游可消费的输入文本",
      };
    }

    if (role === "output") {
      return {
        systemPrompt: "你是输出端口节点，负责汇总上游结果并产出最终输出。",
        responsibility: "收敛工作流输出并落盘。",
        inputSchema: "上游节点结果",
        outputSchema: "最终结果文本",
      };
    }

    if (role === "planner") {
      return {
        systemPrompt: "你是规划代理，负责拆解任务并输出给执行代理的任务书。",
        responsibility: "拆解总任务并分发执行任务。",
        inputSchema: "总任务文本",
        outputSchema: "任务书文本",
      };
    }

    if (role === "summarizer") {
      return {
        systemPrompt: "你是总结代理，基于中间结果生成最终输出。",
        responsibility: "汇总中间结果并给出最终答案。",
        inputSchema: "中间结果",
        outputSchema: "最终输出文本",
      };
    }

    if (role === "router") {
      return {
        systemPrompt: "你是路由代理，负责根据输入内容选择一个下游分支并转发结果。",
        responsibility: "识别当前任务最合适的流转分支。",
        inputSchema: "上游消息 + 人工消息",
        outputSchema: "被转发的消息 + 路由条件",
      };
    }

    return {
      systemPrompt: "你是执行类代理，基于上游消息和人工补充要求产出结果。",
      responsibility: "执行任务并输出可供下游消费的结果。",
      inputSchema: "任务书 + 人工消息",
      outputSchema: "中间结果文本",
    };
  }

  private buildInitialContext(runId: string, node: AgentNode, definition: AgentDefinition): AgentContext {
    return {
      id: node.contextId ?? makeId("agent_ctx"),
      nodeId: node.id,
      runId,
      systemPrompt: definition.systemPrompt,
      taskBrief: node.taskBrief,
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      humanMessages: [],
      recentOutputs: [],
      latestSummary: undefined,
      updatedAt: nowIso(),
    };
  }

  private createBlueprintFromWorkflow(task: string, workflow: WorkflowBlueprintInput) {
    const runId = makeId("run");
    const now = nowIso();

    const nodeIdMap = new Map<string, string>();
    for (const node of workflow.nodes) {
      nodeIdMap.set(node.id, makeId("node"));
    }

    const taskIdMap = new Map<string, string>();
    for (const item of workflow.tasks) {
      taskIdMap.set(item.id, makeId("task"));
    }

    const fallbackRootTaskId = makeId("task");

    const tasks: Task[] = workflow.tasks.length
      ? workflow.tasks.map((item) => ({
          id: taskIdMap.get(item.id) ?? makeId("task"),
          runId,
          title: item.title,
          summary: item.summary,
          parentTaskId: item.parentTaskId ? taskIdMap.get(item.parentTaskId) : undefined,
          assignedNodeId: item.assignedNodeId ? nodeIdMap.get(item.assignedNodeId) : undefined,
          status: "pending",
        }))
      : [];

    let rootTask = tasks.find((item) => !item.parentTaskId);
    if (!rootTask) {
      rootTask = {
        id: fallbackRootTaskId,
        runId,
        title: task,
        summary: "总任务",
        status: "pending",
      };
      tasks.unshift(rootTask);
    }

    const nodeAssignedTaskMap = new Map<string, string>();
    for (const taskItem of tasks) {
      if (taskItem.assignedNodeId) {
        nodeAssignedTaskMap.set(taskItem.assignedNodeId, taskItem.id);
      }
    }

    const nodes: AgentNode[] = workflow.nodes.map((item, index) => {
      const nodeId = nodeIdMap.get(item.id) as string;
      let taskId = nodeAssignedTaskMap.get(nodeId);
      if (!taskId) {
        const autoTaskId = makeId("task");
        taskId = autoTaskId;
        tasks.push({
          id: autoTaskId,
          runId,
          title: item.taskSummary || `${item.name} 任务`,
          summary: item.taskSummary,
          parentTaskId: rootTask?.id,
          assignedNodeId: nodeId,
          status: "pending",
        });
      }

      return {
        id: nodeId,
        runId,
        name: item.name || `节点-${index + 1}`,
        role: this.normalizeRole(item.role),
        status: "idle",
        taskId,
        position: item.position ?? { x: 120 + index * 240, y: 140 },
        width: item.width,
        height: item.height,
        responsibility: item.responsibilitySummary,
        taskBrief: item.taskSummary,
        inboundMessages: [],
        outboundMessages: [],
        resolvedInput: "",
        createdAt: now,
        updatedAt: now,
        agentDefinitionId: makeId("agent_def"),
        contextId: makeId("agent_ctx"),
      };
    });

    const edges = workflow.edges
      .map((edge) => ({
        id: makeId("edge"),
        runId,
        sourceNodeId: nodeIdMap.get(edge.sourceNodeId) ?? "",
        targetNodeId: nodeIdMap.get(edge.targetNodeId) ?? "",
        type: (edge.type === "loop_back" ? "loop_back" : edge.type === "output_flow" ? "output_flow" : "task_flow") as "task_flow" | "output_flow" | "loop_back",
        condition: edge.condition,
        maxIterations: edge.maxIterations,
        convergenceKeyword: edge.convergenceKeyword,
      }))
      .filter((edge) => edge.sourceNodeId && edge.targetNodeId);

    const run: Run = {
      id: runId,
      name: `运行-${new Date().toLocaleTimeString()}`,
      rootTaskId: rootTask.id,
      status: "idle",
      runMode: "standard",
      runType: "workflow_run",
      taskInput: task,
      memoryIsolationMode: "default",
      createdAt: now,
    };

    return { run, tasks, nodes, edges };
  }

  private normalizeRole(role: string): NodeRole {
    if (role === "human") {
      return "input";
    }
    const roleValue = role as NodeRole;
    const allowed: NodeRole[] = ["planner", "worker", "summarizer", "research", "reviewer", "router", "human", "tool", "input", "output"];
    if (allowed.includes(roleValue)) {
      return roleValue;
    }
    return EXECUTION_ROLE_FALLBACK;
  }

  /**
   * Execute loop_back edges: for each loop_back edge (source→target),
   * re-execute the sub-DAG from target to source repeatedly until:
   *   1. max iterations reached, or
   *   2. source node output contains the convergence keyword
   */
  private async executeLoopBackEdges(runId: string, dag: DagInfo): Promise<void> {
    for (const loopEdge of dag.loopBackEdges) {
      const { sourceNodeId, targetNodeId, maxIterations, convergenceKeyword } = loopEdge;

      // Find the sub-path from target to source in the DAG order
      const targetOrder = dag.orderMap.get(targetNodeId) ?? 0;
      const sourceOrder = dag.orderMap.get(sourceNodeId) ?? 0;
      if (targetOrder > sourceOrder) continue; // invalid loop direction

      // Collect nodes in the loop segment (from target to source inclusive, in DAG order)
      const loopSegment = dag.orderedNodeIds.filter((id) => {
        const order = dag.orderMap.get(id) ?? 0;
        return order >= targetOrder && order <= sourceOrder;
      });
      if (loopSegment.length === 0) continue;
      const loopScope = new Set(loopSegment);

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        // Check convergence: if source node's last output contains keyword, stop
        if (convergenceKeyword) {
          const sourceNode = memoryStore.getNodeById(runId, sourceNodeId);
          const output = sourceNode?.latestOutput ?? "";
          if (output.includes(convergenceKeyword)) {
            this.emit(runId, "loop_converged", {
              relatedNodeId: sourceNodeId,
              message: `回环已收敛：输出包含关键词「${convergenceKeyword}」(第 ${iteration - 1} 次迭代后)`,
              payload: { loopEdgeId: loopEdge.id, iteration: iteration - 1, keyword: convergenceKeyword },
            });
            break;
          }
        }

        this.emit(runId, "loop_iteration", {
          relatedNodeId: targetNodeId,
          message: `回环迭代 ${iteration}/${maxIterations}: ${this.mustNode(runId, targetNodeId).name} → ${this.mustNode(runId, sourceNodeId).name}`,
          payload: { loopEdgeId: loopEdge.id, iteration, maxIterations, loopSegment },
        });

        // Forward source output to target as inbound message for the next iteration
        const sourceNode = memoryStore.getNodeById(runId, sourceNodeId);
        if (sourceNode?.latestOutput) {
          this.sendMessage(runId, sourceNodeId, targetNodeId, "result", sourceNode.latestOutput);
        }

        // Reset loop segment nodes to ready and re-execute
        for (const nodeId of loopSegment) {
          this.transitionNode(runId, nodeId, "ready", {
            error: undefined,
            blockedReason: undefined,
          });
        }

        await this.executeDagSchedule(runId, dag, loopScope, false);

        // Check convergence after execution
        if (convergenceKeyword) {
          const freshSource = memoryStore.getNodeById(runId, sourceNodeId);
          const output = freshSource?.latestOutput ?? "";
          if (output.includes(convergenceKeyword)) {
            this.emit(runId, "loop_converged", {
              relatedNodeId: sourceNodeId,
              message: `回环已收敛：输出包含关键词「${convergenceKeyword}」(第 ${iteration} 次迭代后)`,
              payload: { loopEdgeId: loopEdge.id, iteration, keyword: convergenceKeyword },
            });
            break;
          }
        }

        if (iteration === maxIterations) {
          this.emit(runId, "loop_converged", {
            relatedNodeId: sourceNodeId,
            message: `回环已达最大迭代次数 ${maxIterations}，强制结束`,
            payload: { loopEdgeId: loopEdge.id, iteration, reason: "max_iterations" },
          });
        }
      }
    }
  }

  private buildDagInfo(runId: string): DagInfo {
    const nodes = memoryStore.getNodes(runId);
    const edges = memoryStore.getEdges(runId);
    const nodeIds = new Set(nodes.map((node) => node.id));

    // Separate loop_back edges from forward edges
    const loopBackEdges: LoopBackEdge[] = [];
    const forwardEdges: typeof edges = [];
    for (const edge of edges) {
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
        continue;
      }
      if (edge.type === "loop_back") {
        loopBackEdges.push({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          maxIterations: edge.maxIterations ?? 3,
          convergenceKeyword: edge.convergenceKeyword,
        });
      } else {
        forwardEdges.push(edge);
      }
    }

    const incoming = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
    const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
    const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));

    for (const edge of forwardEdges) {
      outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
      incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) ?? []), edge.sourceNodeId]);
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    }

    const queue = nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id);
    const orderedNodeIds: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      orderedNodeIds.push(current);
      for (const next of outgoing.get(current) ?? []) {
        const left = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, left);
        if (left === 0) {
          queue.push(next);
        }
      }
    }

    if (orderedNodeIds.length !== nodes.length) {
      const cyclicNodes = nodes
        .map((node) => node.id)
        .filter((nodeId) => !orderedNodeIds.includes(nodeId));
      throw new Error(`工作流存在环路，无法按 DAG 执行（请使用回环连线标记循环边）: ${cyclicNodes.join(", ")}`);
    }

    return {
      orderedNodeIds,
      orderMap: new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index + 1])),
      incoming,
      outgoing,
      loopBackEdges,
    };
  }

  private async executeDagSchedule(
    runId: string,
    dag: DagInfo,
    scope: Set<string>,
    rerunMode: boolean,
    rerunStartNodeId?: string,
    /** For recovery: set of already-completed node IDs to skip */
    alreadyCompleted?: Set<string>,
  ) {
    const runMode = this.mustSnapshot(runId).run.runMode ?? "standard";
    const pendingDependencies = new Map<string, number>();
    const executed = new Set<string>(alreadyCompleted ?? []);
    let readyWave: string[] = [];
    let waveIndex = 0;

    for (const nodeId of dag.orderedNodeIds) {
      if (!scope.has(nodeId)) {
        continue;
      }
      // For recovery: completed nodes count as resolved dependencies
      const deps = (dag.incoming.get(nodeId) ?? []).filter(
        (dep) => scope.has(dep) && !executed.has(dep),
      ).length;
      pendingDependencies.set(nodeId, deps);
    }

    for (const nodeId of dag.orderedNodeIds) {
      if (!scope.has(nodeId) || executed.has(nodeId)) {
        continue;
      }
      const deps = pendingDependencies.get(nodeId) ?? 0;
      if (deps === 0) {
        this.markNodeReady(runId, nodeId, dag.orderMap, rerunMode);
        readyWave.push(nodeId);
      } else {
        this.markNodeWaiting(runId, nodeId, dag, scope, executed, deps);
      }
    }

    while (readyWave.length > 0) {
      const currentWave = [...readyWave];
      readyWave = [];
      waveIndex++;

      for (const nodeId of currentWave) {
        const node = this.mustNode(runId, nodeId);
        if (!rerunMode) {
          continue;
        }
        if (nodeId === rerunStartNodeId) {
          this.emit(runId, "node_rerun_started", {
            relatedNodeId: node.id,
            relatedTaskId: node.taskId,
            message: `节点重跑开始: ${node.name}`,
            payload: { executionOrder: node.executionOrder },
          });
        } else {
          this.emit(runId, "downstream_rerun_started", {
            relatedNodeId: node.id,
            relatedTaskId: node.taskId,
            message: `下游节点重跑开始: ${node.name}`,
            payload: { executionOrder: node.executionOrder },
          });
        }
      }

      // ── Durable: checkpoint each node as "running" before execution ──
      for (const nodeId of currentWave) {
        durableScheduler.checkpointNodeStarted(runId, nodeId, waveIndex);
      }

      if (runMode === "standard") {
        await Promise.all(currentWave.map(async (item) => {
          try {
            await this.executeNode(runId, item, rerunMode);
            // ── Durable: checkpoint node completed ──
            durableScheduler.checkpointNodeCompleted(runId, item, waveIndex);
          } catch (nodeError) {
            // ── Durable: checkpoint node failed ──
            const errMsg = nodeError instanceof Error ? nodeError.message : "执行异常";
            durableScheduler.checkpointNodeFailed(runId, item, waveIndex, errMsg);
            throw nodeError;
          }
        }));
      } else {
        for (const item of currentWave) {
          try {
            await this.executeNode(runId, item, rerunMode);
            durableScheduler.checkpointNodeCompleted(runId, item, waveIndex);
          } catch (nodeError) {
            const errMsg = nodeError instanceof Error ? nodeError.message : "执行异常";
            durableScheduler.checkpointNodeFailed(runId, item, waveIndex, errMsg);
            throw nodeError;
          }
        }
      }

      for (const nodeId of currentWave) {
        executed.add(nodeId);
      }

      // ── Durable: persist schedule progress after each wave ──
      try {
        const pendingObj: Record<string, number> = {};
        for (const [k, v] of pendingDependencies) pendingObj[k] = v;
        durableScheduler.saveScheduleState({
          runId,
          dagJson: JSON.stringify(DurableScheduler.serializeDag(dag)),
          scopeJson: JSON.stringify([...scope]),
          executedJson: JSON.stringify([...executed]),
          pendingDependenciesJson: JSON.stringify(pendingObj),
          currentWaveIndex: waveIndex,
          rerunMode,
          rerunStartNodeId,
          status: "active",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      } catch { /* non-fatal: schedule state update failure should not break execution */ }

      for (const nodeId of currentWave) {
        for (const next of dag.outgoing.get(nodeId) ?? []) {
          if (!scope.has(next) || executed.has(next)) {
            continue;
          }
          const left = (pendingDependencies.get(next) ?? 0) - 1;
          pendingDependencies.set(next, left);

          if (left <= 0) {
            this.markNodeReady(runId, next, dag.orderMap, rerunMode);
            if (!readyWave.includes(next)) {
              readyWave.push(next);
            }
          } else {
            this.markNodeWaiting(runId, next, dag, scope, executed, left);
          }
        }
      }
    }

    if (executed.size !== scope.size) {
      const remaining = Array.from(scope).filter((nodeId) => !executed.has(nodeId));
      throw new Error(`DAG 调度未完成，仍有节点未执行: ${remaining.join(", ")}`);
    }
  }

  private markNodeReady(runId: string, nodeId: string, orderMap: Map<string, number>, rerunMode: boolean) {
    const executionOrder = orderMap.get(nodeId);
    const node = this.mustNode(runId, nodeId);
    this.transitionNode(runId, nodeId, "ready", {
      blockedReason: undefined,
      error: undefined,
      executionOrder,
    });
    this.emit(runId, "node_ready", {
      relatedNodeId: nodeId,
      relatedTaskId: node.taskId,
      message: `${node.name} 已就绪`,
      payload: { executionOrder, rerunMode },
    });
  }

  private markNodeWaiting(
    runId: string,
    nodeId: string,
    dag: DagInfo,
    scope: Set<string>,
    executed: Set<string>,
    pendingCount: number,
  ) {
    const unresolved = (dag.incoming.get(nodeId) ?? [])
      .filter((dep) => scope.has(dep) && !executed.has(dep))
      .map((dep) => this.mustNode(runId, dep).name);
    const blockedReason = unresolved.length > 0 ? `等待上游节点完成: ${unresolved.join(", ")}` : "等待依赖完成";
    const node = this.mustNode(runId, nodeId);
    const executionOrder = dag.orderMap.get(nodeId);

    this.transitionNode(runId, nodeId, "waiting", {
      blockedReason,
      executionOrder,
    });
    this.emit(runId, "node_waiting", {
      relatedNodeId: nodeId,
      relatedTaskId: node.taskId,
      message: `${node.name} 等待依赖`,
      payload: {
        blockedReason,
        pendingDependencies: pendingCount,
        executionOrder,
        unresolved,
      },
    });
  }

  private getExecutionOrder(runId: string): AgentNode[] {
    const dag = this.buildDagInfo(runId);
    return dag.orderedNodeIds.map((id) => this.mustNode(runId, id));
  }

  private getRerunChain(runId: string, dag: DagInfo, startNodeId: string, includeDownstream: boolean): AgentNode[] {
    if (!dag.orderedNodeIds.includes(startNodeId)) {
      throw new Error("未找到重跑起点节点");
    }

    if (!includeDownstream) {
      return [this.mustNode(runId, startNodeId)];
    }

    const reachable = new Set<string>([startNodeId]);
    const queue = [startNodeId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const next of dag.outgoing.get(current) ?? []) {
        if (reachable.has(next)) {
          continue;
        }
        reachable.add(next);
        queue.push(next);
      }
    }

    return dag.orderedNodeIds
      .filter((nodeId) => reachable.has(nodeId))
      .map((nodeId) => this.mustNode(runId, nodeId));
  }

  private sendMessage(
    runId: string,
    fromNodeId: string,
    toNodeId: string,
    type: Message["type"],
    content: string,
    relatedTaskId?: string,
    payload?: Message["payload"],
  ): Message {
    const message: Message = {
      id: makeId("msg"),
      runId,
      fromNodeId,
      toNodeId,
      type,
      content,
      payload: payload ?? this.buildDefaultMessagePayload(runId, fromNodeId, type, content),
      createdAt: nowIso(),
    };

    memoryStore.appendMessage(runId, message);
    this.updateNode(runId, fromNodeId, {
      outboundMessages: [...(this.mustNode(runId, fromNodeId).outboundMessages ?? []), message].slice(-30),
    });

    const sourceContext = memoryStore.getAgentContextByNode(runId, fromNodeId);
    if (sourceContext) {
      memoryStore.updateAgentContext(runId, sourceContext.id, (current) => ({
        ...current,
        outboundMessages: [...(current.outboundMessages ?? []), message].slice(-30),
        updatedAt: nowIso(),
      }));
      const refreshedSourceContext = this.mustContext(runId, fromNodeId);

      this.emit(runId, "agent_context_updated", {
        relatedNodeId: fromNodeId,
        relatedTaskId,
        message: `节点 ${fromNodeId} 发送消息`,
        payload: {
          reason: "message",
          contextPatch: {
            outboundMessages: refreshedSourceContext.outboundMessages.slice(-30),
          },
        },
      });
    }

    if (type === "task_assignment") {
      this.emit(runId, "task_assigned", {
        relatedNodeId: toNodeId,
        relatedTaskId,
        message: `任务已分配到节点 ${toNodeId}`,
      });
    }

    this.emit(runId, "message_sent", {
      relatedNodeId: toNodeId,
      relatedTaskId,
      message: `消息已发送: ${fromNodeId} -> ${toNodeId}`,
      payload: {
        messageId: message.id,
        messageType: message.type,
        fromNodeId,
        toNodeId,
        content: message.content,
        message,
      },
    });

    const targetContext = memoryStore.getAgentContextByNode(runId, toNodeId);
    if (targetContext) {
      memoryStore.updateAgentContext(runId, targetContext.id, (current) => ({
        ...current,
        inboundMessages: [...current.inboundMessages, message].slice(-30),
        updatedAt: nowIso(),
      }));
      const refreshedTargetContext = this.mustContext(runId, toNodeId);

      this.updateNode(runId, toNodeId, {
        inboundMessages: [...(this.mustNode(runId, toNodeId).inboundMessages ?? []), message].slice(-30),
      });

      this.emit(runId, "agent_context_updated", {
        relatedNodeId: toNodeId,
        message: `节点 ${toNodeId} 收到新消息`,
        payload: {
          reason: "message",
          contextPatch: {
            inboundMessages: refreshedTargetContext.inboundMessages.slice(-30),
          },
        },
      });

      this.emit(runId, "message_delivered", {
        relatedNodeId: toNodeId,
        relatedTaskId,
        message: `消息已投递到节点 ${toNodeId}`,
        payload: {
          message,
        },
      });
    }

    return message;
  }

  private transitionRun(runId: string, to: Run["status"], patch?: Partial<Run>) {
    const run = memoryStore.getRun(runId);
    if (!run) {
      throw new Error("运行不存在");
    }

    const status = run.status === to ? to : stateMachine.run(run.status, to);
    memoryStore.updateRun(runId, (current) => ({
      ...current,
      status,
      startedAt: to === "running" ? current.startedAt ?? nowIso() : current.startedAt,
      ...patch,
    }));
  }

  private transitionTask(runId: string, taskId: string, to: TaskStatus) {
    const task = this.getTask(runId, taskId);
    const status = task.status === to ? to : stateMachine.task(task.status, to);
    memoryStore.updateTask(runId, taskId, (current) => ({ ...current, status }));
  }

  private transitionNode(runId: string, nodeId: string, to: NodeStatus, patch?: Partial<AgentNode>) {
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      throw new Error("节点不存在");
    }

    const status = node.status === to ? to : stateMachine.node(node.status, to);
    memoryStore.updateNode(runId, nodeId, (current) => ({
      ...current,
      status,
      updatedAt: nowIso(),
      ...patch,
    }));
  }

  private updateNode(runId: string, nodeId: string, patch: Partial<AgentNode>) {
    memoryStore.updateNode(runId, nodeId, (current) => ({
      ...current,
      ...patch,
      updatedAt: nowIso(),
    }));
  }

  private emit(runId: string, type: EventType, data: Omit<Event, "id" | "runId" | "type" | "timestamp">) {
    const seq = (this.runEventSeq.get(runId) ?? 0) + 1;
    this.runEventSeq.set(runId, seq);
    const event: Event = {
      id: makeId("event"),
      runId,
      type,
      timestamp: nowIso(),
      runEventSeq: seq,
      ...data,
    };

    memoryStore.appendEvent(runId, event);
    eventStreamHub.publish(runId, event);

    // Fire-and-forget notification for terminal run events
    if (type === "run_completed" || type === "run_failed") {
      const run = memoryStore.getRun(runId);
      notificationService
        .notifyRunEvent(runId, type, {
          runName: run?.name,
          status: run?.status,
          finishedAt: event.timestamp,
          ...(data as Record<string, unknown>),
        })
        .catch((err) => console.warn("[Runtime] Notification dispatch failed:", err instanceof Error ? err.message : err));
    }
  }

  private getTaskByNode(runId: string, nodeId: string): Task {
    const task = memoryStore.getTasks(runId).find((item) => item.assignedNodeId === nodeId);
    if (!task) {
      throw new Error(`任务不存在: ${nodeId}`);
    }
    return task;
  }

  private getTask(runId: string, taskId: string): Task {
    const task = memoryStore.getTasks(runId).find((item) => item.id === taskId);
    if (!task) {
      throw new Error("任务不存在");
    }
    return task;
  }

  private getDownstreamNodeIdsByEdgeType(
    runId: string,
    nodeId: string,
    edgeType: "task_flow" | "output_flow",
    condition?: string,
  ) {
    const edges = memoryStore
      .getEdges(runId)
      .filter((edge) => edge.sourceNodeId === nodeId && edge.type === edgeType);

    const normalizedCondition = condition?.trim().toLowerCase();
    if (!normalizedCondition) {
      return Array.from(new Set(edges.map((edge) => edge.targetNodeId)));
    }

    const matched = edges.filter((edge) => edge.condition?.trim().toLowerCase() === normalizedCondition);
    if (matched.length > 0) {
      return Array.from(new Set(matched.map((edge) => edge.targetNodeId)));
    }

    return Array.from(new Set(edges
      .filter((edge) => !edge.condition?.trim())
      .map((edge) => edge.targetNodeId)));
  }

  private getRoutedDownstreamNodeIds(
    runId: string,
    nodeId: string,
    messageType: Message["type"],
    condition?: string,
  ) {
    if (messageType === "task_assignment") {
      return this.getDownstreamNodeIdsByEdgeType(runId, nodeId, "task_flow", condition);
    }

    const outputFlowTargets = this.getDownstreamNodeIdsByEdgeType(runId, nodeId, "output_flow", condition);
    if (outputFlowTargets.length > 0) {
      return outputFlowTargets;
    }
    return this.getDownstreamNodeIdsByEdgeType(runId, nodeId, "task_flow", condition);
  }

  private getUpstreamNodeIds(runId: string, nodeId: string) {
    return Array.from(new Set(memoryStore
      .getEdges(runId)
      .filter((edge) => edge.targetNodeId === nodeId)
      .map((edge) => edge.sourceNodeId)));
  }

  /**
   * Dev Mode Agent execution — runs a workspace script instead of LLM adapter.
   */
  private async executeDevModeNode(
    runId: string,
    nodeId: string,
    task: Task,
    node: AgentNode,
    resolved: ResolvedAgentExecutionConfig,
    executionContext: AgentContext,
    resolvedInput: string,
    executionId: string,
    traceId: string,
    traceStartedAt: string,
  ) {
    const nodeConfig = configService.getNodeConfig(runId, nodeId);
    const isScriptMode = nodeConfig?.executionMode === "script";

    if (!nodeConfig?.workspaceId || !nodeConfig.runCommand) {
      throw new Error(`${isScriptMode ? "Script" : "Dev"} Mode 缺少 workspaceId / runCommand 配置`);
    }
    if (!isScriptMode && !nodeConfig.entryFile) {
      throw new Error("Dev Mode Agent 缺少 entryFile 配置");
    }

    // Check for local project binding — use its path as CWD
    const localConfig = localProjectService.getConfig(nodeConfig.workspaceId);
    const cwdOverride = localConfig?.localPath;

    // Script mode: parse resolvedInput as JSON for template params
    let templateParams: Record<string, string> | undefined;
    if (isScriptMode && resolvedInput) {
      try {
        const parsed = JSON.parse(resolvedInput);
        if (typeof parsed === "object" && parsed !== null) {
          templateParams = {};
          for (const [k, v] of Object.entries(parsed)) {
            templateParams[k] = String(v);
          }
        }
      } catch {
        // Not JSON — pass as-is via AGENT_INPUT env var
      }
    }

    const modeLabel = isScriptMode ? "Script" : "Dev";
    this.emit(runId, "agent_context_updated", {
      relatedNodeId: nodeId,
      relatedTaskId: task.id,
      message: `${resolved.name} 以 ${modeLabel} Mode 执行: ${nodeConfig.runCommand}`,
      payload: { reason: "dev_mode_execution", entryFile: nodeConfig.entryFile, runCommand: nodeConfig.runCommand, cwdOverride },
    });

    try {
      const devResult = await executeDevAgent({
        workspaceId: nodeConfig.workspaceId,
        entryFile: nodeConfig.entryFile ?? "",
        runCommand: nodeConfig.runCommand,
        resolvedInput,
        cwdOverride,
        environmentId: localConfig?.environmentId,
        templateParams,
        outputDirOverride: outputManager.getRunNodeOutputDir(runId, nodeId),
      });

      const latestOutput = devResult.success
        ? (devResult.stdout || "(无输出)")
        : `[exit code ${devResult.exitCode}]\n${devResult.stderr || devResult.stdout || "(无输出)"}`;

      // ── Trace: dev mode node success / failure ──
      const traceFinishedAt = nowIso();
      const traceDurationMs = new Date(traceFinishedAt).getTime() - new Date(traceStartedAt).getTime();
      try {
        memoryStore.updateNodeTrace(traceId, {
          status: devResult.success ? "completed" : "failed",
          finishedAt: traceFinishedAt,
          durationMs: traceDurationMs,
          latestOutput: latestOutput.slice(0, 4000),
          llmRoundCount: 0,
          toolCallCount: 0,
        });
        memoryStore.insertStateTrace({
          id: makeId("strc"), runId, nodeId, executionId, checkpoint: "post_execution",
          nodeStatus: devResult.success ? "completed" : "failed",
          contextSnapshotJson: JSON.stringify({
            executionMode: "dev",
            command: nodeConfig.runCommand,
            exitCode: devResult.exitCode,
            stdoutLength: devResult.stdout.length,
            stderrLength: devResult.stderr.length,
            outputFiles: devResult.outputFiles,
            durationMs: devResult.durationMs,
          }),
          createdAt: traceFinishedAt,
        });
      } catch { /* non-fatal */ }

      if (!devResult.success) {
        this.transitionNode(runId, nodeId, "failed", { error: latestOutput.slice(0, 1000) });
        this.transitionTask(runId, task.id, "failed");
        this.emit(runId, "node_failed", {
          relatedNodeId: nodeId,
          relatedTaskId: task.id,
          message: `${node.name} Dev 脚本执行失败 (exit ${devResult.exitCode})`,
          payload: {
            exitCode: devResult.exitCode,
            stderr: devResult.stderr.slice(0, 2000),
            durationMs: devResult.durationMs,
            executionOrder: node.executionOrder,
          },
        });
        return;
      }

      // Success path — update node and route messages like standard execution
      this.updateNode(runId, nodeId, {
        name: resolved.name,
        latestInput: resolvedInput,
        latestOutput,
        resolvedInput,
        taskBrief: executionContext.taskBrief,
        responsibility: resolved.responsibility,
      });

      memoryStore.updateAgentContext(runId, executionContext.id, (current) => ({
        ...current,
        recentOutputs: [...current.recentOutputs, latestOutput].slice(-16),
        latestSummary: latestOutput,
        updatedAt: nowIso(),
      }));

      this.emit(runId, "agent_context_updated", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `Dev Agent ${resolved.name} 脚本执行完成`,
        payload: {
          reason: "dev_mode_completed",
          exitCode: devResult.exitCode,
          durationMs: devResult.durationMs,
          outputFiles: devResult.outputFiles,
        },
      });

      // Route output to downstream nodes
      const defaultResultDownstreamIds = this.getRoutedDownstreamNodeIds(runId, nodeId, "result", undefined);
      for (const downstreamId of defaultResultDownstreamIds) {
        this.sendMessage(
          runId, nodeId, downstreamId, "result", latestOutput, task.id,
          this.buildDefaultMessagePayload(runId, nodeId, "result", latestOutput, undefined, this.phaseFromNodeRole(node.role)),
        );
      }

      // Persist output to file if configured
      if (nodeConfig.outputPath) {
        try {
          outputManager.writeNodeTextOutput(
            runId,
            nodeId,
            latestOutput,
            nodeConfig.outputPath,
            outputManager.createRunScopedFileName("dev-node-output", ".md"),
          );
        } catch { /* non-fatal */ }
      }

      this.transitionNode(runId, nodeId, "completed");
      this.transitionTask(runId, task.id, "completed");

      this.emit(runId, "node_completed", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${node.name} Dev 脚本执行完成`,
        payload: {
          executionOrder: node.executionOrder,
          durationMs: devResult.durationMs,
          outputFiles: devResult.outputFiles,
        },
      });

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Dev Agent 执行异常";
      this.transitionNode(runId, nodeId, "failed", { error: errMsg });
      this.transitionTask(runId, task.id, "failed");

      // ── Trace: dev mode failure ──
      try {
        memoryStore.updateNodeTrace(traceId, {
          status: "failed", error: errMsg,
          finishedAt: nowIso(),
          durationMs: new Date().getTime() - new Date(traceStartedAt).getTime(),
        });
      } catch { /* non-fatal */ }

      this.emit(runId, "node_failed", {
        relatedNodeId: nodeId,
        relatedTaskId: task.id,
        message: `${node.name} Dev 执行异常: ${errMsg}`,
        payload: { executionOrder: node.executionOrder },
      });
    }
  }

  private isPortRole(role: NodeRole) {
    return role === "input" || role === "output" || role === "human";
  }

  private mustNode(runId: string, nodeId: string) {
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      throw new Error("节点不存在");
    }
    return node;
  }

  private mustContext(runId: string, nodeId: string) {
    const context = memoryStore.getAgentContextByNode(runId, nodeId);
    if (!context) {
      throw new Error("Agent 上下文不存在");
    }
    return context;
  }

  private isFailMode(runId: string) {
    const rootTask = memoryStore.getTasks(runId).find((task) => !task.parentTaskId);
    return /失败|fail|错误/i.test(rootTask?.title ?? "");
  }

  private getLastNodeOutput(runId: string) {
    const ordered = this.getExecutionOrder(runId);
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const node = memoryStore.getNodeById(runId, ordered[i].id);
      if (node?.latestOutput) {
        return node.latestOutput;
      }
    }
    return "";
  }

  private mustSnapshot(runId: string) {
    const snapshot = memoryStore.getRunSnapshot(runId);
    if (!snapshot) {
      throw new Error("运行不存在");
    }
    return snapshot;
  }

  // ──────────────────────────────────────────────────────────
  // Durable Execution: crash recovery
  // ──────────────────────────────────────────────────────────

  /**
   * Resume a run that was interrupted by a process crash.
   * Loads the persisted schedule state and checkpoints, determines which nodes
   * already completed, and re-executes only the remaining nodes.
   */
  async resumeRun(runId: string): Promise<void> {
    return this.withRunLock(runId, async () => {
      await this._resumeRunImpl(runId);
    });
  }

  private async _resumeRunImpl(runId: string): Promise<void> {
    const plan = durableScheduler.buildRecoveryPlan(runId);
    if (!plan) {
      console.warn(`[RuntimeEngine] No active schedule found for run ${runId}, skip resume.`);
      return;
    }

    const { scheduleState, completedNodeIds, dag: serializedDag, scope, remainingScope } = plan;

    // Nothing remaining — just finalize
    if (remainingScope.size === 0) {
      durableScheduler.completeSchedule(runId);
      return;
    }

    const snapshot = memoryStore.getRunSnapshot(runId);
    if (!snapshot) {
      console.warn(`[RuntimeEngine] Run ${runId} not found in memory, skip resume.`);
      durableScheduler.failSchedule(runId);
      return;
    }

    // Restore DAG with Map types
    const dag = DurableScheduler.deserializeDag(serializedDag);

    // Ensure run is in running state
    if (snapshot.run.status !== "running") {
      this.transitionRun(runId, "running", {
        finishedAt: undefined,
        error: undefined,
      });
    }

    const rootTask = snapshot.tasks.find((task) => task.id === snapshot.run.rootTaskId);
    if (!rootTask) {
      durableScheduler.failSchedule(runId);
      throw new Error("根任务不存在");
    }
    if (rootTask.status !== "running") {
      this.transitionTask(runId, rootTask.id, "running");
    }

    this.emit(runId, "run_started", {
      message: `运行从中断处恢复 (已完成 ${completedNodeIds.size}/${scope.size} 节点)`,
      payload: {
        resumed: true,
        completedCount: completedNodeIds.size,
        remainingCount: remainingScope.size,
        totalCount: scope.size,
      },
    });

    try {
      // Resume DAG execution, passing already-completed nodes so they are skipped
      await this.executeDagSchedule(
        runId, dag, scope, scheduleState.rerunMode,
        scheduleState.rerunStartNodeId,
        completedNodeIds,
      );

      // Handle loop_back edges
      if (dag.loopBackEdges.length > 0) {
        await this.executeLoopBackEdges(runId, dag);
      }

      const latest = this.getRunSnapshot(runId);
      const output = latest.run.output || this.getLastNodeOutput(runId);
      if (!latest.run.output && output) {
        memoryStore.updateRun(runId, (run) => ({ ...run, output }));
      }
      this.emit(runId, "execution_phase_changed", {
        relatedTaskId: rootTask.id,
        message: "运行进入阶段：final_output",
        payload: { phase: "final_output", outputLength: output?.length ?? 0 },
      });

      this.transitionTask(runId, rootTask.id, "completed");
      this.transitionRun(runId, "completed", { finishedAt: nowIso() });
      this.persistRunArtifactsSafe(runId);
      durableScheduler.completeSchedule(runId);

      this.emit(runId, "run_completed", {
        relatedTaskId: rootTask.id,
        message: `运行恢复完成 (跳过 ${completedNodeIds.size} 个已完成节点)`,
        payload: { output: output ?? "", resumed: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复执行失败";
      this.transitionTask(runId, rootTask.id, "failed");
      this.transitionRun(runId, "failed", {
        finishedAt: nowIso(),
        error: message,
      });
      this.persistRunArtifactsSafe(runId);
      durableScheduler.failSchedule(runId);

      this.emit(runId, "run_failed", {
        relatedTaskId: rootTask.id,
        message: `运行恢复失败: ${message}`,
      });
    }
  }

  /**
   * Scan for interrupted runs on startup and attempt to resume them.
   * Should be called once when the server boots.
   */
  async recoverInterruptedRuns(): Promise<{ recovered: string[]; failed: string[] }> {
    const interrupted = durableScheduler.getInterruptedSchedules();
    const recovered: string[] = [];
    const failed: string[] = [];

    for (const schedule of interrupted) {
      const runId = schedule.runId;
      try {
        console.log(`[RuntimeEngine] Attempting to recover interrupted run: ${runId}`);
        await this.resumeRun(runId);
        recovered.push(runId);
        console.log(`[RuntimeEngine] Successfully recovered run: ${runId}`);
      } catch (error) {
        failed.push(runId);
        const msg = error instanceof Error ? error.message : "恢复失败";
        console.error(`[RuntimeEngine] Failed to recover run ${runId}: ${msg}`);
        // Mark as failed so we don't retry on next startup
        durableScheduler.failSchedule(runId);
      }
    }

    if (interrupted.length > 0) {
      console.log(
        `[RuntimeEngine] Recovery complete: ${recovered.length} recovered, ${failed.length} failed out of ${interrupted.length} interrupted runs.`,
      );
    }

    return { recovered, failed };
  }

  // ──────────────────────────────────────────────────────────
  // Agent Registry & Built-in Tools (Handoff / Subtask)
  // ──────────────────────────────────────────────────────────

  private buildAgentRegistry(runId: string): AgentRegistry {
    const registry = new AgentRegistry();
    const snapshot = this.mustSnapshot(runId);

    for (const node of snapshot.nodes) {
      const def = memoryStore.getAgentDefinitions(runId).find((d) => d.id === node.agentDefinitionId);
      if (def) {
        registry.register(node, def);
      }
    }

    this.runRegistries.set(runId, registry);
    return registry;
  }

  private getAgentRegistry(runId: string): AgentRegistry {
    return this.runRegistries.get(runId) ?? this.buildAgentRegistry(runId);
  }

  /**
   * Execute a handoff: transfer the current task to another agent node.
   * Returns the target node's output as the handoff result.
   */
  private async executeHandoff(
    runId: string,
    sourceNodeId: string,
    input: Record<string, unknown>,
  ): Promise<{ ok: boolean; data: Record<string, unknown>; durationMs: number }> {
    const startMs = Date.now();

    // Guard: prevent infinite delegation recursion
    const currentDepth = this.delegationDepth.get(runId) ?? 0;
    if (currentDepth >= RuntimeEngine.MAX_DELEGATION_DEPTH) {
      return {
        ok: false,
        data: { error: `委托深度超限 (max ${RuntimeEngine.MAX_DELEGATION_DEPTH})，终止 Handoff 以防止无限递归。` },
        durationMs: Date.now() - startMs,
      };
    }

    const registry = this.getAgentRegistry(runId);
    const targetName = String(input.target_agent_name ?? "");
    const reason = String(input.reason ?? "");
    const context = String(input.context ?? "");

    // Resolve target node
    let target = registry.findByName(targetName);
    if (!target) {
      // Try capability matching
      const match = registry.findBestMatch(targetName, sourceNodeId);
      if (match) {
        target = registry.findById(match.nodeId) ?? undefined;
      }
    }

    if (!target) {
      return {
        ok: false,
        data: { error: `找不到匹配的 Agent: ${targetName}`, availableAgents: registry.describeAll(sourceNodeId) },
        durationMs: Date.now() - startMs,
      };
    }

    // Send handoff message to target node
    const handoffContent = [
      `[Handoff] 来自 ${this.mustNode(runId, sourceNodeId).name} 的任务委托`,
      `原因: ${reason}`,
      context ? `上下文: ${context}` : "",
      `原节点最新输出: ${this.mustNode(runId, sourceNodeId).latestOutput?.slice(0, 2000) ?? "无"}`,
    ].filter(Boolean).join("\n\n");

    this.sendMessage(runId, sourceNodeId, target.nodeId, "task_assignment", handoffContent);

    this.emit(runId, "message_sent", {
      relatedNodeId: sourceNodeId,
      message: `Agent Handoff: ${this.mustNode(runId, sourceNodeId).name} → ${target.nodeName}`,
      payload: { type: "handoff", targetNodeId: target.nodeId, reason },
    });

    // Execute the target node with delegation depth tracking
    const targetNode = this.mustNode(runId, target.nodeId);
    if (targetNode.status === "completed" || targetNode.status === "running") {
      this.transitionNode(runId, target.nodeId, "ready");
    }

    this.delegationDepth.set(runId, currentDepth + 1);
    try {
      await this.executeNode(runId, target.nodeId, false);
    } finally {
      this.delegationDepth.set(runId, currentDepth);
    }

    // Read target's output
    const resultNode = this.mustNode(runId, target.nodeId);
    return {
      ok: true,
      data: {
        handoff_result: resultNode.latestOutput ?? "目标 Agent 未产出结果",
        target_agent: target.nodeName,
        target_role: target.role,
      },
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Execute a subtask: delegate to another agent and return its result.
   * The source node retains control and continues after getting the result.
   */
  private async executeSubtask(
    runId: string,
    sourceNodeId: string,
    input: Record<string, unknown>,
  ): Promise<{ ok: boolean; data: Record<string, unknown>; durationMs: number }> {
    const startMs = Date.now();

    // Guard: prevent infinite delegation recursion
    const currentDepth = this.delegationDepth.get(runId) ?? 0;
    if (currentDepth >= RuntimeEngine.MAX_DELEGATION_DEPTH) {
      return {
        ok: false,
        data: { error: `委托深度超限 (max ${RuntimeEngine.MAX_DELEGATION_DEPTH})，终止 Subtask 以防止无限递归。` },
        durationMs: Date.now() - startMs,
      };
    }

    const registry = this.getAgentRegistry(runId);
    const targetName = String(input.target_agent_name ?? "");
    const taskDescription = String(input.task_description ?? "");
    const context = String(input.context ?? "");

    // Resolve target node
    let target = registry.findByName(targetName);
    if (!target) {
      const match = registry.findBestMatch(targetName, sourceNodeId);
      if (match) {
        target = registry.findById(match.nodeId) ?? undefined;
      }
    }

    if (!target) {
      return {
        ok: false,
        data: { error: `找不到匹配的 Agent: ${targetName}`, availableAgents: registry.describeAll(sourceNodeId) },
        durationMs: Date.now() - startMs,
      };
    }

    // Send subtask message to target
    const subtaskContent = [
      `[Subtask] 来自 ${this.mustNode(runId, sourceNodeId).name} 的子任务委托`,
      `任务: ${taskDescription}`,
      context ? `上下文: ${context}` : "",
    ].filter(Boolean).join("\n\n");

    this.sendMessage(runId, sourceNodeId, target.nodeId, "task_assignment", subtaskContent);

    this.emit(runId, "message_sent", {
      relatedNodeId: sourceNodeId,
      message: `Subtask: ${this.mustNode(runId, sourceNodeId).name} → ${target.nodeName}`,
      payload: { type: "subtask", targetNodeId: target.nodeId, taskDescription: taskDescription.slice(0, 200) },
    });

    // Execute the target node with delegation depth tracking
    const targetNode = this.mustNode(runId, target.nodeId);
    if (targetNode.status === "completed" || targetNode.status === "running") {
      this.transitionNode(runId, target.nodeId, "ready");
    }

    this.delegationDepth.set(runId, currentDepth + 1);
    try {
      await this.executeNode(runId, target.nodeId, false);
    } finally {
      this.delegationDepth.set(runId, currentDepth);
    }

    const resultNode = this.mustNode(runId, target.nodeId);
    return {
      ok: true,
      data: {
        subtask_result: resultNode.latestOutput ?? "子任务 Agent 未产出结果",
        target_agent: target.nodeName,
        target_role: target.role,
      },
      durationMs: Date.now() - startMs,
    };
  }
}

export const runtimeEngine = new RuntimeEngine();
