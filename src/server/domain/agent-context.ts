import { Message } from "@/server/domain/message";
import { HumanMessage } from "@/server/domain/human-message";

export interface AgentContext {
  id: string;
  nodeId: string;
  runId: string;
  systemPrompt: string;
  taskBrief?: string;
  inboundMessages: Message[];
  outboundMessages: Message[];
  resolvedInput?: string;
  humanMessages: HumanMessage[];
  recentOutputs: string[];
  latestSummary?: string;
  updatedAt: string;
}
