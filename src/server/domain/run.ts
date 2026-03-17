export type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
export type RunMode = "standard" | "sequential" | "safe";
export type RunType = "workflow_run" | "dev_run";

export interface Run {
  id: string;
  name: string;
  rootTaskId: string;
  status: RunStatus;
  runMode: RunMode;
  runType: RunType;
  workflowId?: string;
  workflowVersionId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  error?: string;
}

export interface DevRunDetail {
  id: string;
  runSnapshotId: string;
  workspaceId: string;
  entryFile?: string;
  runCommand: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  environmentId?: string;
  createdAt: string;
}
