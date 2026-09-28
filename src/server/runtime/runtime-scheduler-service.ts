import { nowIso } from "@/lib/utils";
import { AgentNode, ControlActionRecord, ControlNodeState, ControlOwnerKind, ControlRunState, Event, EventType, NodeStatus } from "@/server/domain";
import { durableScheduler, DurableScheduler } from "@/server/runtime/durable-scheduler";
import { RunSnapshot, memoryStore } from "@/server/store/memory-store";

export interface LoopBackEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  maxIterations: number;
  convergenceKeyword?: string;
}

export interface DagInfo {
  orderedNodeIds: string[];
  orderMap: Map<string, number>;
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  loopBackEdges: LoopBackEdge[];
}

export interface RuntimeSchedulerDependencies {
  executeNode(runId: string, nodeId: string, rerunMode: boolean): Promise<void>;
  transitionNode(runId: string, nodeId: string, to: NodeStatus, patch?: Partial<AgentNode>): boolean;
  emit(runId: string, type: EventType, data: Omit<Event, "id" | "runId" | "type" | "timestamp">): void;
  syncRunControl(runId: string, patch?: Partial<{ state: ControlRunState; ownerKind: ControlOwnerKind; ownerRef: string; activeNodeId?: string; currentCheckpointId?: string }>): void;
  syncNodeControl(runId: string, nodeId: string, patch?: Partial<{ state: ControlNodeState; ownerKind: ControlOwnerKind; ownerRef: string; approvalRequired: boolean }>): void;
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
  }): void;
  mustNode(runId: string, nodeId: string): AgentNode;
  mustSnapshot(runId: string): RunSnapshot;
}

export class RuntimeSchedulerService {
  constructor(private readonly deps: RuntimeSchedulerDependencies) {}

  buildDagInfo(runId: string): DagInfo {
    const nodes = memoryStore.getNodes(runId);
    const edges = memoryStore.getEdges(runId);
    const nodeSet = new Set(nodes.map((node) => node.id));
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    const loopBackEdges: LoopBackEdge[] = [];

    for (const node of nodes) {
      incoming.set(node.id, []);
      outgoing.set(node.id, []);
      indegree.set(node.id, 0);
    }

    for (const edge of edges) {
      if (!nodeSet.has(edge.sourceNodeId) || !nodeSet.has(edge.targetNodeId)) {
        continue;
      }
      if (edge.type === "loop_back") {
        loopBackEdges.push({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          maxIterations: edge.maxIterations ?? 1,
          convergenceKeyword: edge.convergenceKeyword,
        });
        continue;
      }
      outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
      incoming.get(edge.targetNodeId)?.push(edge.sourceNodeId);
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    }

    const queue = nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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
      throw new Error("工作流存在环路，无法按 DAG 调度");
    }

    return {
      orderedNodeIds,
      orderMap: new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index + 1])),
      incoming,
      outgoing,
      loopBackEdges,
    };
  }

  async executeDagSchedule(
    runId: string,
    dag: DagInfo,
    scope: Set<string>,
    rerunMode: boolean,
    rerunStartNodeId?: string,
    alreadyCompleted?: Set<string>,
  ) {
    const runMode = this.deps.mustSnapshot(runId).run.runMode ?? "standard";
    const pendingDependencies = new Map<string, number>();
    const executed = new Set<string>(alreadyCompleted ?? []);
    let readyWave: string[] = [];
    let waveIndex = 0;

    for (const nodeId of dag.orderedNodeIds) {
      if (!scope.has(nodeId)) {
        continue;
      }
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
        const node = this.deps.mustNode(runId, nodeId);
        if (!rerunMode) {
          continue;
        }
        if (nodeId === rerunStartNodeId) {
          this.deps.emit(runId, "node_rerun_started", {
            relatedNodeId: node.id,
            relatedTaskId: node.taskId,
            message: `节点重跑开始: ${node.name}`,
            payload: { executionOrder: node.executionOrder },
          });
        } else {
          this.deps.emit(runId, "downstream_rerun_started", {
            relatedNodeId: node.id,
            relatedTaskId: node.taskId,
            message: `下游节点重跑开始: ${node.name}`,
            payload: { executionOrder: node.executionOrder },
          });
        }
      }

      for (const nodeId of currentWave) {
        const checkpoint = durableScheduler.checkpointNodeStarted(runId, nodeId, waveIndex);
        this.deps.recordControlAction({
          runId,
          nodeId,
          actionType: "write_checkpoint",
          targetScope: "node",
          proposer: "runtime",
          ownerKind: "runtime",
          status: "succeeded",
          payload: {
            checkpointId: checkpoint.id,
            waveIndex,
            status: checkpoint.status,
          },
        });
        this.deps.syncRunControl(runId, { currentCheckpointId: checkpoint.id });
      }

      if (runMode === "standard") {
        await Promise.all(currentWave.map(async (item) => {
          await this.executeWaveNode(runId, item, rerunMode, waveIndex);
        }));
      } else {
        for (const item of currentWave) {
          await this.executeWaveNode(runId, item, rerunMode, waveIndex);
        }
      }

      for (const nodeId of currentWave) {
        executed.add(nodeId);
      }

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
      } catch {
        // non-fatal schedule persistence failure
      }

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

  markNodeReady(runId: string, nodeId: string, orderMap: Map<string, number>, rerunMode: boolean) {
    const executionOrder = orderMap.get(nodeId);
    const node = this.deps.mustNode(runId, nodeId);
    this.deps.transitionNode(runId, nodeId, "ready", {
      blockedReason: undefined,
      error: undefined,
      executionOrder,
    });
    this.deps.emit(runId, "node_ready", {
      relatedNodeId: nodeId,
      relatedTaskId: node.taskId,
      message: `${node.name} 已就绪`,
      payload: { executionOrder, rerunMode },
    });
    this.deps.syncNodeControl(runId, nodeId, {
      state: "ready",
      ownerKind: "runtime",
      ownerRef: "scheduler",
    });
  }

  markNodeWaiting(
    runId: string,
    nodeId: string,
    dag: DagInfo,
    scope: Set<string>,
    executed: Set<string>,
    pendingCount: number,
  ) {
    const unresolved = (dag.incoming.get(nodeId) ?? [])
      .filter((dep) => scope.has(dep) && !executed.has(dep))
      .map((dep) => this.deps.mustNode(runId, dep).name);
    const blockedReason = unresolved.length > 0 ? `等待上游节点完成: ${unresolved.join(", ")}` : "等待依赖完成";
    const node = this.deps.mustNode(runId, nodeId);
    const executionOrder = dag.orderMap.get(nodeId);

    this.deps.transitionNode(runId, nodeId, "waiting", {
      blockedReason,
      executionOrder,
    });
    this.deps.emit(runId, "node_waiting", {
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
    this.deps.syncNodeControl(runId, nodeId, {
      state: "waiting_dependency",
      ownerKind: "runtime",
      ownerRef: "scheduler",
    });
  }

  getExecutionOrder(runId: string): AgentNode[] {
    const dag = this.buildDagInfo(runId);
    return dag.orderedNodeIds.map((id) => this.deps.mustNode(runId, id));
  }

  getRerunChain(runId: string, dag: DagInfo, startNodeId: string, includeDownstream: boolean): AgentNode[] {
    if (!dag.orderedNodeIds.includes(startNodeId)) {
      throw new Error("未找到重跑起点节点");
    }

    if (!includeDownstream) {
      return [this.deps.mustNode(runId, startNodeId)];
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
      .map((nodeId) => this.deps.mustNode(runId, nodeId));
  }

  private async executeWaveNode(runId: string, nodeId: string, rerunMode: boolean, waveIndex: number) {
    try {
      await this.deps.executeNode(runId, nodeId, rerunMode);
      durableScheduler.checkpointNodeCompleted(runId, nodeId, waveIndex);
      this.deps.syncRunControl(runId, {
        currentCheckpointId: durableScheduler.getCheckpoints(runId).at(-1)?.id,
      });
    } catch (nodeError) {
      const errMsg = nodeError instanceof Error ? nodeError.message : "执行异常";
      durableScheduler.checkpointNodeFailed(runId, nodeId, waveIndex, errMsg);
      this.deps.syncRunControl(runId, {
        currentCheckpointId: durableScheduler.getCheckpoints(runId).at(-1)?.id,
      });
      throw nodeError;
    }
  }
}
