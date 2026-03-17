import { NodeStatus, RunStatus, TaskStatus } from "@/server/domain";

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  idle: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: ["running"],
  failed: ["running"],
  cancelled: ["running"],
};

const NODE_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  idle: ["ready", "waiting"],
  ready: ["waiting", "running"],
  waiting: ["ready", "running"],
  running: ["completed", "failed", "waiting"],
  completed: ["ready", "waiting"],
  failed: ["ready", "waiting"],
};

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["running"],
  running: ["completed", "failed"],
  completed: ["running"],
  failed: ["running"],
};

function assertTransition<T extends string>(
  kind: "run" | "node" | "task",
  from: T,
  to: T,
  graph: Record<T, T[]>,
) {
  if (!graph[from]?.includes(to)) {
    throw new Error(`非法${kind}状态流转: ${from} -> ${to}`);
  }
}

export const stateMachine = {
  run(from: RunStatus, to: RunStatus) {
    assertTransition("run", from, to, RUN_TRANSITIONS);
    return to;
  },
  node(from: NodeStatus, to: NodeStatus) {
    assertTransition("node", from, to, NODE_TRANSITIONS);
    return to;
  },
  task(from: TaskStatus, to: TaskStatus) {
    assertTransition("task", from, to, TASK_TRANSITIONS);
    return to;
  },
};
