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
  outputPath?: string;
  temperature?: number;
  allowHumanInput: boolean;
  toolPolicy: AgentNodeToolPolicy;
  executionMode: ExecutionMode;
  workspaceId?: string;
  entryFile?: string;
  runCommand?: string;
  createdAt: string;
  updatedAt: string;
}
