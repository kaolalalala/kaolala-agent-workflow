import { AgentNode, Run, Task, WorkflowEdge } from "@/server/domain";
import { makeId, nowIso } from "@/lib/utils";

interface OrchestratedRun {
  run: Run;
  tasks: Task[];
  nodes: AgentNode[];
  edges: WorkflowEdge[];
}

export function orchestrateInitialRun(task: string): OrchestratedRun {
  const runId = makeId("run");
  const rootTaskId = makeId("task");
  const now = nowIso();

  const plannerId = makeId("node");
  const workerId = makeId("node");
  const summarizerId = makeId("node");
  const plannerTaskId = makeId("task");
  const workerTaskId = makeId("task");
  const summarizerTaskId = makeId("task");

  const nodes: AgentNode[] = [
    {
      id: plannerId,
      runId,
      name: "规划代理-1",
      role: "planner",
      status: "idle",
      taskId: plannerTaskId,
      position: { x: 120, y: 140 },
      responsibility: "拆解任务并分配执行任务书。",
      taskBrief: `拆解总任务: ${task}`,
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      createdAt: now,
      updatedAt: now,
      agentDefinitionId: makeId("agent_def"),
      contextId: makeId("agent_ctx"),
    },
    {
      id: workerId,
      runId,
      name: "执行代理-1",
      role: "worker",
      status: "idle",
      taskId: workerTaskId,
      position: { x: 390, y: 140 },
      responsibility: "执行任务书并产出中间结果。",
      taskBrief: "等待规划代理下发任务书",
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      createdAt: now,
      updatedAt: now,
      agentDefinitionId: makeId("agent_def"),
      contextId: makeId("agent_ctx"),
    },
    {
      id: summarizerId,
      runId,
      name: "总结代理-1",
      role: "summarizer",
      status: "idle",
      taskId: summarizerTaskId,
      position: { x: 660, y: 140 },
      responsibility: "汇总中间结果并生成最终输出。",
      taskBrief: "等待执行代理结果",
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      createdAt: now,
      updatedAt: now,
      agentDefinitionId: makeId("agent_def"),
      contextId: makeId("agent_ctx"),
    },
  ];

  const edges: WorkflowEdge[] = [
    {
      id: makeId("edge"),
      runId,
      sourceNodeId: plannerId,
      targetNodeId: workerId,
      type: "task_flow",
    },
    {
      id: makeId("edge"),
      runId,
      sourceNodeId: workerId,
      targetNodeId: summarizerId,
      type: "task_flow",
    },
  ];

  const tasks: Task[] = [
    {
      id: rootTaskId,
      runId,
      title: task,
      summary: "总任务",
      status: "pending",
    },
    {
      id: plannerTaskId,
      runId,
      title: "规划执行路径",
      summary: "拆解目标并生成任务书",
      parentTaskId: rootTaskId,
      assignedNodeId: plannerId,
      status: "pending",
    },
    {
      id: workerTaskId,
      runId,
      title: "执行核心任务",
      summary: "执行任务并输出中间结果",
      parentTaskId: rootTaskId,
      assignedNodeId: workerId,
      status: "pending",
    },
    {
      id: summarizerTaskId,
      runId,
      title: "汇总最终输出",
      summary: "汇总中间结果形成最终答案",
      parentTaskId: rootTaskId,
      assignedNodeId: summarizerId,
      status: "pending",
    },
  ];

  const run: Run = {
    id: runId,
    name: `运行-${new Date().toLocaleTimeString()}`,
    rootTaskId,
    status: "idle",
    runMode: "standard",
    runType: "workflow_run",
    createdAt: now,
  };

  return { run, tasks, nodes, edges };
}
