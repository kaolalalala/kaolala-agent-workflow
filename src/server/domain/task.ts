export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  runId: string;
  title: string;
  summary?: string;
  parentTaskId?: string;
  assignedNodeId?: string;
  status: TaskStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}
