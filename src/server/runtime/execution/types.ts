import { MessageType, NodeRole } from "@/server/domain";

export interface ExecutionContext {
  runId: string;
  nodeId: string;
  role: NodeRole;
  input: string;
  taskTitle: string;
}

export interface ExecutorResult {
  latestOutput: string;
  outboundMessages?: Array<{
    toNodeId: string;
    type: MessageType;
    content: string;
  }>;
  finalOutput?: string;
}
