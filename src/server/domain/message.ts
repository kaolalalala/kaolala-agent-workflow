export type MessageType = "task_assignment" | "result";

export interface MessagePayload {
  schemaVersion: 1;
  kind: string;
  origin: string;
  data: Record<string, unknown>;
}

export interface Message {
  id: string;
  runId: string;
  fromNodeId: string;
  toNodeId: string;
  type: MessageType;
  content: string;
  payload?: MessagePayload;
  createdAt: string;
}
