import type { ResolvedTool } from "@/server/tools/contracts";

export interface ToolAdapterContext {
  runId: string;
  nodeId: string;
  taskId?: string;
}

export interface ToolAdapterInput {
  tool: ResolvedTool;
  input: Record<string, unknown>;
  timeoutMs: number;
  context: ToolAdapterContext;
  apiKey?: string;
}

export interface ToolAdapterOutput {
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface ToolAdapter {
  invoke(input: ToolAdapterInput): Promise<ToolAdapterOutput>;
}
