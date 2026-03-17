import { Message } from "@/server/domain/message";

export type NodeRole =
  | "planner"
  | "worker"
  | "summarizer"
  | "research"
  | "reviewer"
  | "router"
  | "human"
  | "tool"
  | "input"
  | "output";

export type NodeStatus = "idle" | "ready" | "running" | "waiting" | "completed" | "failed";

export interface AgentNode {
  id: string;
  runId: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  taskId?: string;
  parentNodeId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  responsibility?: string;
  taskBrief?: string;
  latestInput?: string;
  latestOutput?: string;
  inboundMessages: Message[];
  outboundMessages: Message[];
  resolvedInput?: string;
  error?: string;
  blockedReason?: string;
  executionOrder?: number;
  createdAt: string;
  updatedAt: string;
  agentDefinitionId: string;
  contextId?: string;
}
