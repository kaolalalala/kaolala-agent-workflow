export type EventType =
  | "run_created"
  | "run_started"
  | "task_created"
  | "node_created"
  | "edge_created"
  | "node_ready"
  | "node_waiting"
  | "task_assigned"
  | "node_started"
  | "execution_phase_changed"
  | "message_sent"
  | "message_delivered"
  | "context_resolved"
  | "node_completed"
  | "node_failed"
  | "run_completed"
  | "run_failed"
  | "human_message_sent"
  | "node_rerun_requested"
  | "node_rerun_started"
  | "downstream_rerun_started"
  | "agent_context_updated"
  | "llm_request_sent"
  | "llm_response_received"
  | "tool_invocation_started"
  | "tool_invocation_succeeded"
  | "tool_invocation_failed"
  | "memory_indexed"
  | "memory_retrieved"
  | "token_stream"
  | "loop_iteration"
  | "loop_converged";

export interface Event {
  id: string;
  runId: string;
  type: EventType;
  timestamp: string;
  runEventSeq?: number;
  relatedNodeId?: string;
  relatedTaskId?: string;
  message: string;
  payload?: Record<string, unknown>;
}
