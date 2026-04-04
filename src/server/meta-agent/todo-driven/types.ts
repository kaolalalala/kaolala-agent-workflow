import type {
  RunState,
  SubagentAutonomyLevel,
  TodoRecoveryAction,
  TodoCapabilityType,
  TodoItem,
  WaveExecutionModeRecord,
  WaveExecutionResultRecord,
  WaveRecord,
  WaveReviewOutcomeRecord,
} from "../supervisor-runtime-state";

export interface TodoPlanningContext {
  goalType?: "analysis" | "research" | "delivery" | "generic";
  constraints?: string[];
  hints?: string[];
  resource_center?: {
    skills: Array<{
      id: string;
      name: string;
      description?: string;
      guide_content?: string;
      output_description?: string;
    }>;
  };
  project_context?: {
    project_id: string;
    successful_todo_skeletons?: Array<{
      goal_hint: string;
      todo_titles: string[];
      capability_flow: string[];
    }>;
    reusable_workspace_refs?: Array<{
      kind: string;
      summary: string;
      topic_hint: string;
    }>;
    planner_memories?: Array<{
      goal_pattern: string;
      recommended_capability_flow: string[];
      suggested_acceptance_patterns: string[];
      notes: string[];
    }>;
    recurring_failure_patterns?: Array<{
      type: string;
      signal: string;
    }>;
  };
}

export interface TodoExecutionContext {
  goal: string;
  run_id: string;
  current_todo: {
    id: string;
    title: string;
    description: string;
    acceptance_criteria: string[];
  };
  input_artifacts: Array<{
    id: string;
    path: string;
    type: string;
    summary: string;
    storage_mode: "inline" | "workspace";
    workspace_file_id?: string;
    inline_preview?: string;
    kind?: string;
    content?: string;
    read_mode: "inline_preview" | "workspace_summary" | "workspace_full";
  }>;
  history_summary: {
    completed_todos: Array<{ id: string; title: string }>;
    recent_logs: Array<{ todo_id: string; action: string; message: string }>;
    open_issues: Array<{ id: string; todo_id: string; message: string }>;
  };
  memory_hints?: {
    review: Array<{
      reason: string;
      weak_criteria_patterns: string[];
      frequent_missing_criteria: string[];
    }>;
  };
  recovery_context?: {
    retry_count: number;
    reroute_count: number;
    last_failure_reason?: string;
    last_review_status?: string;
    last_missing_criteria: string[];
    guidance_notes: string[];
    last_recovery_action?: string;
  };
  resource_center?: {
    skills: Array<{
      id: string;
      name: string;
      description?: string;
      guide_content?: string;
      output_description?: string;
    }>;
  };
}

export interface TodoExecutorResult {
  status: "success" | "error";
  output: string;
  summary?: string;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    source?: string;
  };
  artifact?: {
    path: string;
    type: string;
    summary: string;
  };
  artifacts?: Array<{
    path: string;
    type: string;
    summary: string;
  }>;
  criteria_evidence?: string[];
  open_questions?: string[];
  completion_notes?: string[];
  force_split?: boolean;
  split_reason?: string;
  notes?: string[];
  error_message?: string;
}

export interface TodoReviewResult {
  status: "pass" | "revise" | "split" | "fail";
  reason: string;
  missing_criteria: string[];
  /** Token usage from LLM-as-Judge review (undefined if heuristic fallback was used) */
  review_token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    source: "provider" | "estimated";
  };
  /** Detailed per-criterion LLM judgments (undefined if heuristic fallback was used) */
  llm_review_detail?: {
    criteria_judgments: Array<{
      criterion: string;
      satisfied: boolean;
      confidence: number;
      reason: string;
    }>;
  };
}

export interface SubagentDefinition {
  id: string;
  name: string;
  description: string;
  capability_types: TodoCapabilityType[];
  execution_boundary: string;
  preferred_task_kinds: string[];
  allowed_tools: string[];
  output_contract: string;
  primary_artifact_types: string[];
  side_effect_level: "none" | "low" | "medium" | "high";
  requires_runtime_guard: boolean;
  output_schema_description: string;
  system_prompt: string;
  autonomy_level: SubagentAutonomyLevel;
}

export interface DelegationDecision {
  mode: "self" | "delegate" | "split";
  target_agent_id?: string;
  reason: string;
}

export interface WavePeerInfo {
  todo_id: string;
  todo_title: string;
  agent_id: string;
  scope_boundary: string;
}

export interface WaveContext {
  wave_id: string;
  /** Total number of parallel agents in this wave */
  total_peers: number;
  /** This agent's index within the wave (0-based) */
  peer_index: number;
  /** What all the other agents in this wave are doing */
  peers: WavePeerInfo[];
  /** Explicit scope boundary for this agent — what it MUST focus on */
  my_scope_boundary: string;
  /** Explicit exclusion — what this agent must NOT do (covered by peers) */
  excluded_scopes: string[];
}

export interface DelegationBrief {
  run_id: string;
  todo_id: string;
  goal: string;
  todo_title: string;
  todo_description: string;
  acceptance_criteria: string[];
  input_refs: string[];
  artifact_summaries: Array<{
    id: string;
    path: string;
    type: string;
    summary: string;
  }>;
  constraints: string[];
  expected_output_schema: string;
  resource_center?: {
    skills: Array<{
      id: string;
      name: string;
      description?: string;
      guide_content?: string;
      output_description?: string;
    }>;
  };
  nesting_depth?: number;
  autonomy_level?: SubagentAutonomyLevel;
  workspace_file_ids?: string[];
  recovery_context?: {
    retry_count: number;
    reroute_count: number;
    last_failure_reason?: string;
    last_missing_criteria: string[];
    guidance_notes: string[];
    forced_target_agent_id?: string;
  };
  /** Present only during parallel wave execution */
  wave_context?: WaveContext;
  /** Resolved tools available for this subagent to call via function calling */
  resolved_tools?: Array<{
    toolId: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  /** Present on retry: structured analysis of why the previous attempt failed and how to improve */
  retry_analysis?: {
    failure_diagnosis: string;
    improvement_directives: string[];
    criterion_fixes: Array<{
      criterion: string;
      what_went_wrong: string;
      how_to_fix: string;
    }>;
    directive_text: string;
    /** Per-criterion judgments from the LLM reviewer on the previous attempt */
    previous_review_judgments?: Array<{
      criterion: string;
      satisfied: boolean;
      confidence: number;
      reason: string;
    }>;
  };
}

export interface SubagentExecutionResult {
  status: "success" | "error";
  summary: string;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    source?: string;
  };
  artifacts: Array<{
    path: string;
    type: string;
    summary: string;
  }>;
  open_questions: string[];
  completion_notes: string[];
  criteria_evidence: string[];
  raw_output?: string;
  error_message?: string;
}

export interface RecoveryPolicyOptions {
  max_retry_per_todo?: number;
  max_reroute_per_todo?: number;
  max_recovery_history_per_todo?: number;
}

export interface RecoveryDecision {
  action: TodoRecoveryAction;
  target_agent_id?: string;
  reason: string;
  recovery_notes?: string[];
  next_constraints?: Record<string, unknown>;
}

export type SubagentRunner = (
  agent: SubagentDefinition,
  brief: DelegationBrief,
  runtime?: {
    state: RunState;
    todo: TodoItem;
    nesting_depth?: number;
    parent_agent_id?: string;
  },
) => Promise<SubagentExecutionResult>;

export type TodoExecutor = (
  context: TodoExecutionContext,
  state: RunState,
  todo: TodoItem,
) => Promise<TodoExecutorResult>;

export interface TodoStepResult {
  state: RunState;
  selected_todo_id: string | null;
  selected_todo_ids?: string[];
  wave_id?: string | null;
  wave_record?: WaveRecord;
  wave_execution_modes?: WaveExecutionModeRecord[];
  wave_execution_results?: WaveExecutionResultRecord[];
  wave_review_outcomes?: WaveReviewOutcomeRecord[];
  delegation_decision?: DelegationDecision;
  delegated_agent_id?: string;
  review?: TodoReviewResult;
  executor_result?: TodoExecutorResult;
  recovery_decision?: RecoveryDecision;
}

export interface ParallelWaveOptions {
  enabled?: boolean;
  max_parallel_todos?: number;
  min_parallel_todos?: number;
}
