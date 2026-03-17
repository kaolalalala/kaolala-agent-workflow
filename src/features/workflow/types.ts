export type AgentRole =
  | "planner"
  | "worker"
  | "research"
  | "reviewer"
  | "summarizer"
  | "router"
  | "human"
  | "tool"
  | "input"
  | "output";

export type NodeStatus = "idle" | "ready" | "running" | "waiting" | "completed" | "failed";

export type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type EventType =
  | "edge_connected"
  | "edge_deleted"
  | "output_generated"
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
  | "token_stream"
  | "loop_iteration"
  | "loop_converged";

export interface AgentNode {
  id: string;
  name: string;
  role: AgentRole;
  status: NodeStatus;
  taskSummary: string;
  responsibilitySummary: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string;
  upstreamIds: string[];
  downstreamIds: string[];
  createdAt: string;
  lastUpdatedAt: string;
  blocked: boolean;
  retryCount: number;
  lastError?: string;
  blockedReason?: string;
  executionOrder?: number;
  lastInput?: string;
  lastOutput?: string;
  inboundMessages?: WorkflowMessage[];
  outboundMessages?: WorkflowMessage[];
  resolvedInput?: string;
  taskBrief?: string;
  agentDefinitionId?: string;
  contextId?: string;
  /** Accumulates streaming LLM tokens while node is running */
  streamingOutput?: string;
}

export interface NodeTemplate {
  id: string;
  name: string;
  role: AgentRole;
  responsibilitySummary: string;
  taskSummary: string;
  defaultPrompt?: string;
  builtIn: boolean;
  disabled?: boolean;
  source?: "node_template" | "agent_template";
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: "task_flow" | "output_flow" | "loop_back";
  /** Conditional routing label — only active when upstream emits matching condition */
  condition?: string;
  /** Maximum loop iterations before forced stop (loop_back edges only) */
  maxIterations?: number;
  /** If the upstream output contains this keyword, the loop stops (loop_back edges only) */
  convergenceKeyword?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: NodeStatus;
  parentTaskId?: string;
  assignedNodeId?: string;
  summary: string;
}

export interface WorkflowMessage {
  id: string;
  runId: string;
  fromNodeId: string;
  toNodeId: string;
  type: "task_assignment" | "result";
  content: string;
  payload?: {
    schemaVersion: 1;
    kind: string;
    origin: string;
    data: Record<string, unknown>;
  };
  createdAt: string;
}

export interface RunEvent {
  id: string;
  time: string;
  type: EventType;
  runEventSeq?: number;
  relatedNodeId?: string;
  relatedTaskId?: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface RunInfo {
  id: string;
  name: string;
  status: RunStatus;
  workflowId?: string;
  workflowVersionId?: string;
  startedAt?: string;
  finishedAt?: string;
  rootTaskId: string;
  output?: string;
  error?: string;
}

export interface NodeInspectorData {
  objective: string;
  background: string;
  inputConstraints: string;
  successCriteria: string;
  outputRequirements: string;
  upstreamDependencies: string[];
}

export interface AgentDefinitionView {
  id: string;
  name: string;
  role: AgentRole;
  systemPrompt: string;
  responsibility: string;
  inputSchema?: string;
  outputSchema?: string;
  allowHumanInput: boolean;
  model?: string;
  temperature?: number;
  provider?: string;
}

export interface HumanMessageView {
  id: string;
  runId: string;
  targetNodeId: string;
  content: string;
  attachments?: Array<{
    name: string;
    mimeType: string;
    content: string;
  }>;
  createdAt: string;
}

export interface AgentContextView {
  id: string;
  nodeId: string;
  systemPrompt: string;
  taskBrief?: string;
  inboundMessages: WorkflowMessage[];
  outboundMessages: WorkflowMessage[];
  resolvedInput?: string;
  humanMessages?: HumanMessageView[];
  recentOutputs: string[];
  latestSummary?: string;
  updatedAt: string;
}

export interface RuntimeBlueprint {
  run: RunInfo;
  nodes: AgentNode[];
  edges: WorkflowEdge[];
  tasks: TaskItem[];
}

export interface SubmitRootTaskPayload {
  title: string;
}
