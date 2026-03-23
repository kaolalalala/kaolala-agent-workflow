export type AgentNodeToolPolicy = "disabled" | "allowed" | "required";
export type ExecutionMode = "standard" | "dev" | "script";

export interface AgentNodeConfig {
  id: string;
  runId: string;
  nodeId: string;
  name: string;
  description?: string;
  responsibility?: string;
  systemPrompt?: string;
  additionalPrompt?: string;
  useWorkspaceModelDefault: boolean;
  provider?: string;
  model?: string;
  credentialId?: string;
  baseUrl?: string;
  outputPath?: string;
  temperature?: number;
  allowHumanInput: boolean;
  toolPolicy: AgentNodeToolPolicy;
  executionMode: ExecutionMode;
  workspaceId?: string;
  entryFile?: string;
  runCommand?: string;
  /** Enable reflection loop: self-evaluate output quality and re-execute if needed */
  reflectionEnabled?: boolean;
  /** Max reflection rounds (default 2) */
  maxReflectionRounds?: number;
  /** Max tool-call rounds for agentic loop (default 10, cap 20) */
  maxToolRounds?: number;
  createdAt: string;
  updatedAt: string;
}
