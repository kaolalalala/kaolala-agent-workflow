export type AgentDocumentType = "prompt" | "skill" | "reference";

export interface AgentDocument {
  id: string;
  runId?: string;
  ownerType: "workspace" | "node";
  ownerId: string;
  type: AgentDocumentType;
  name: string;
  format: "markdown";
  content: string;
  createdAt: string;
  updatedAt: string;
}
