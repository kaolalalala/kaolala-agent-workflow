import { AgentContext, AgentDefinition, AgentNode, MessageType } from "@/server/domain";
import type { ResolvedTool, ToolExecutionResult } from "@/server/tools/contracts";

export interface ToolInvocationRequest {
  toolId: string;
  input?: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AgentExecutionInput {
  node: AgentNode;
  definition: AgentDefinition;
  context: AgentContext;
  resolvedInput: string;
  availableTools: ResolvedTool[];
  invokeTool: (request: ToolInvocationRequest) => Promise<ToolExecutionResult>;
  emitLifecycleEvent?: (
    type: "llm_request_sent" | "llm_response_received",
    payload: Record<string, unknown>,
  ) => void;
  /** Called with each streaming token during LLM response generation */
  streamTokens?: (token: string) => void;
  /** Max tool-call rounds before forcing final answer (default 10, cap 20) */
  maxToolRounds?: number;
  /** Called before each LLM request to check if token budget allows it */
  checkBudget?: () => { allowed: boolean; reason?: string };
}

export interface AgentExecutionOutput {
  latestOutput: string;
  outboundMessages?: Array<{
    toNodeId: string;
    type: MessageType;
    content: string;
    payload?: {
      schemaVersion: 1;
      kind: string;
      origin: string;
      data: Record<string, unknown>;
    };
  }>;
  finalOutput?: string;
  /** For router nodes: the chosen branch condition label */
  condition?: string;
}
