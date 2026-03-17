/* ── Execution Debug Trace Types ── */

export interface NodeTrace {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  attempt: number;
  status: "running" | "completed" | "failed";
  role: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  resolvedInput?: string;
  latestOutput?: string;
  error?: string;
  provider?: string;
  model?: string;
  llmRoundCount: number;
  toolCallCount: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  createdAt: string;
}

export interface PromptTrace {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  round: number;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
  messageHistoryJson?: string;
  toolsJson?: string;
  completion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  statusCode?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
}

export interface ToolTrace {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  round: number;
  toolId?: string;
  toolName?: string;
  sourceType?: string;
  status: "running" | "success" | "failed";
  inputJson?: string;
  outputJson?: string;
  errorJson?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  createdAt: string;
}

export type StateCheckpoint = "pre_execution" | "post_input_resolve" | "post_llm" | "post_execution";

export interface StateTrace {
  id: string;
  runId: string;
  nodeId: string;
  executionId: string;
  checkpoint: StateCheckpoint;
  nodeStatus?: string;
  contextSnapshotJson?: string;
  metadataJson?: string;
  createdAt: string;
}
