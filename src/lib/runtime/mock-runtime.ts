import {
  AgentNode,
  AgentRole,
  NodeInspectorData,
  RunEvent,
  RunInfo,
  RuntimeBlueprint,
  SubmitRootTaskPayload,
  TaskItem,
  WorkflowEdge,
} from "@/features/workflow/types";
import { ROLE_LABELS, ROLE_RESPONSIBILITY } from "@/features/workflow/constants";
import { makeId, nowIso } from "@/lib/utils";

interface RuntimeRecord {
  run: RunInfo;
  nodeIds: string[];
  failMode: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
}

type EventHandler = (event: RunEvent) => void;

const listeners = new Map<string, Set<EventHandler>>();
const runs = new Map<string, RuntimeRecord>();
const nodeDetails = new Map<string, NodeInspectorData>();

function emit(runId: string, event: RunEvent) {
  const set = listeners.get(runId);
  if (!set) {
    return;
  }
  for (const handler of set) {
    handler(event);
  }
}

function buildNode(name: string, role: AgentRole, x: number, y: number, taskSummary: string): AgentNode {
  const id = makeId("node");
  const now = nowIso();
  nodeDetails.set(id, {
    objective: `完成${ROLE_LABELS[role]}分配任务`,
    background: "来自总任务拆解后的执行链路。",
    inputConstraints: "遵循上游输出，不引入未验证事实。",
    successCriteria: "产出可被下游直接消费的结构化结果。",
    outputRequirements: "输出结论、证据、风险点与下一步建议。",
    upstreamDependencies: [],
  });

  return {
    id,
    name,
    role,
    status: "idle",
    taskSummary,
    responsibilitySummary: ROLE_RESPONSIBILITY[role],
    position: { x, y },
    upstreamIds: [],
    downstreamIds: [],
    createdAt: now,
    lastUpdatedAt: now,
    blocked: false,
    retryCount: 0,
    lastInput: "",
    lastOutput: "",
  };
}

function wireDependencies(nodes: AgentNode[], edges: WorkflowEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    node.upstreamIds = [];
    node.downstreamIds = [];
  }

  for (const edge of edges) {
    byId.get(edge.sourceNodeId)?.downstreamIds.push(edge.targetNodeId);
    byId.get(edge.targetNodeId)?.upstreamIds.push(edge.sourceNodeId);
  }

  for (const node of nodes) {
    const detail = nodeDetails.get(node.id);
    if (detail) {
      detail.upstreamDependencies = node.upstreamIds;
      nodeDetails.set(node.id, detail);
    }
  }
}

export class MockRuntimeEngine {
  createRun(input: SubmitRootTaskPayload): RuntimeBlueprint {
    const rootTaskId = makeId("task");
    const runId = makeId("run");
    const now = nowIso();

    const planner = buildNode("规划代理-1", "planner", 120, 140, `拆解任务：${input.title}`);
    const worker = buildNode("执行代理-1", "worker", 390, 140, "执行主子任务并产出中间结果");
    const summarizer = buildNode("总结代理-1", "summarizer", 660, 140, "汇总结果并输出最终结论");

    const nodes = [planner, worker, summarizer];
    const edges: WorkflowEdge[] = [
      { id: makeId("edge"), sourceNodeId: planner.id, targetNodeId: worker.id, type: "task_flow" },
      { id: makeId("edge"), sourceNodeId: worker.id, targetNodeId: summarizer.id, type: "task_flow" },
    ];

    wireDependencies(nodes, edges);

    const tasks: TaskItem[] = [
      {
        id: rootTaskId,
        title: input.title,
        summary: "总任务",
        status: "ready",
      },
      {
        id: makeId("task"),
        title: "规划执行路径",
        summary: "拆解目标并制定子任务",
        status: "ready",
        parentTaskId: rootTaskId,
        assignedNodeId: planner.id,
      },
      {
        id: makeId("task"),
        title: "执行核心子任务",
        summary: "执行并整理中间结果",
        status: "ready",
        parentTaskId: rootTaskId,
        assignedNodeId: worker.id,
      },
      {
        id: makeId("task"),
        title: "汇总最终输出",
        summary: "整合结果形成最终答案",
        status: "ready",
        parentTaskId: rootTaskId,
        assignedNodeId: summarizer.id,
      },
    ];

    const run: RunInfo = {
      id: runId,
      name: `运行-${new Date().toLocaleTimeString()}`,
      status: "idle",
      rootTaskId,
      startedAt: now,
    };

    const failMode = /fail|失败|错误/i.test(input.title);

    runs.set(runId, {
      run,
      nodeIds: nodes.map((item) => item.id),
      failMode,
      timers: [],
    });

    return { run, nodes, edges, tasks };
  }

  startRun(runId: string) {
    const record = runs.get(runId);
    if (!record) {
      return;
    }

    record.run.status = "running";

    const [plannerId, workerId, summarizerId] = record.nodeIds;
    const timeline: Array<{ delay: number; event: RunEvent }> = [
      {
        delay: 200,
        event: { id: makeId("event"), time: nowIso(), type: "run_started", message: "运行已启动" },
      },
      {
        delay: 650,
        event: {
          id: makeId("event"),
          time: nowIso(),
          type: "node_started",
          relatedNodeId: plannerId,
          message: "规划代理开始拆解任务",
        },
      },
      {
        delay: 1300,
        event: {
          id: makeId("event"),
          time: nowIso(),
          type: "node_completed",
          relatedNodeId: plannerId,
          message: "规划代理完成任务拆解",
        },
      },
      {
        delay: 1750,
        event: {
          id: makeId("event"),
          time: nowIso(),
          type: "node_started",
          relatedNodeId: workerId,
          message: "执行代理开始执行子任务",
        },
      },
    ];

    if (record.failMode) {
      timeline.push(
        {
          delay: 2500,
          event: {
            id: makeId("event"),
            time: nowIso(),
            type: "node_failed",
            relatedNodeId: workerId,
            message: "执行代理失败：检索源不可用",
          },
        },
        {
          delay: 3000,
          event: {
            id: makeId("event"),
            time: nowIso(),
            type: "output_generated",
            message: "运行失败，输出包含错误摘要。",
          },
        },
      );
    } else {
      timeline.push(
        {
          delay: 2500,
          event: {
            id: makeId("event"),
            time: nowIso(),
            type: "node_completed",
            relatedNodeId: workerId,
            message: "执行代理完成执行并提交中间结果",
          },
        },
        {
          delay: 2950,
          event: {
            id: makeId("event"),
            time: nowIso(),
            type: "node_started",
            relatedNodeId: summarizerId,
            message: "总结代理开始生成最终输出",
          },
        },
        {
          delay: 3600,
          event: {
            id: makeId("event"),
            time: nowIso(),
            type: "node_completed",
            relatedNodeId: summarizerId,
            message: "总结代理已完成最终汇总",
          },
        },
        {
          delay: 4050,
          event: {
            id: makeId("event"),
            time: nowIso(),
            type: "output_generated",
            message: "最终输出已生成。",
          },
        },
      );
    }

    for (const item of timeline) {
      const timer = setTimeout(() => {
        emit(runId, item.event);
      }, item.delay);
      record.timers.push(timer);
    }
  }

  subscribeRunEvents(runId: string, cb: EventHandler) {
    const set = listeners.get(runId) ?? new Set<EventHandler>();
    set.add(cb);
    listeners.set(runId, set);

    return () => {
      const current = listeners.get(runId);
      current?.delete(cb);
      if (current && current.size === 0) {
        listeners.delete(runId);
      }
    };
  }

  getNodeDetail(nodeId: string) {
    return (
      nodeDetails.get(nodeId) ?? {
        objective: "无",
        background: "无",
        inputConstraints: "无",
        successCriteria: "无",
        outputRequirements: "无",
        upstreamDependencies: [],
      }
    );
  }

  submitRootTask(payload: SubmitRootTaskPayload) {
    return this.createRun(payload);
  }
}

export const mockRuntimeEngine = new MockRuntimeEngine();
