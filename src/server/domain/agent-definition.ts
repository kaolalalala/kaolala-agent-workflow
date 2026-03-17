export type AgentRole =
  | "planner"
  | "worker"
  | "summarizer"
  | "reviewer"
  | "research"
  | "router"
  | "human"
  | "tool"
  | "input"
  | "output";

export interface AgentDefinition {
  id: string;
  runId: string;
  name: string;
  role: AgentRole;
  systemPrompt: string;
  responsibility: string;
  inputSchema?: string;
  outputSchema?: string;
  allowHumanInput: boolean;
  model?: string;
  temperature?: number;
  provider?: string;
  createdAt: string;
  updatedAt: string;
}
