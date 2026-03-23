export interface HumanMessageAttachment {
  name: string;
  mimeType: string;
  content: string;
}

export interface HumanMessage {
  id: string;
  runId: string;
  targetNodeId: string;
  content: string;
  attachments?: HumanMessageAttachment[];
  createdAt: string;
}
