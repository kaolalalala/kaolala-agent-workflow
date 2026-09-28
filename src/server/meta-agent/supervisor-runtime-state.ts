import { makeId, nowIso } from "@/lib/utils";

export type RunStatus = "pending" | "running" | "idle" | "reviewing" | "completed" | "failed" | "blocked";

export type TodoStatus = "todo" | "ready" | "in_progress" | "reviewing" | "done" | "blocked" | "failed" | "pruned";

export type TodoPriority = "low" | "medium" | "high" | "critical";

export type IssueStatus = "open" | "resolved" | "ignored";

export type TodoCapabilityType =
  | "planning"
  | "research"
  | "collection"
  | "writing"
  | "analysis"
  | "review"
  | "verification"
  | "merge"
  | "browser_ops"
  | "terminal_ops";

export type TodoDelegationStatus =
  | "none"
  | "self"
  | "delegated"
  | "returned"
  | "split"
  | "failed";

export type TodoReviewStatus = "pass" | "revise" | "split" | "fail";

export type TodoRecoveryAction =
  | "retry"
  | "reroute"
  | "split"
  | "downgrade_to_serial"
  | "fail";

export type ArtifactStorageMode = "inline" | "workspace";

export type WorkspaceFileKind =
  | "raw_tool_result"
  | "research_notes"
  | "intermediate_summary"
  | "final_output"
  | "review_notes"
  | "analysis_output"
  | "verification_report"
  | "merge_bundle";

export type SubagentAutonomyLevel = "basic" | "enhanced" | "full";

export type WorkspaceScope = "run" | "project";

export type WorkspaceRetention = "ephemeral" | "reusable" | "final";

export interface TodoRecoveryRecord {
  timestamp: string;
  action: TodoRecoveryAction;
  reason: string;
  target_agent_id?: string;
  wave_id?: string | null;
}

export interface TodoItem {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  assignee: string;
  capability_type: TodoCapabilityType;
  depends_on: string[];
  acceptance_criteria: string[];
  input_refs: string[];
  output_ref?: string;
  retry_count: number;
  delegation_status: TodoDelegationStatus;
  assignee_history: string[];
  review_result?: TodoReviewStatus;
  notes: string[];
  recovery_history?: TodoRecoveryRecord[];
  last_failure_reason?: string;
  last_missing_criteria?: string[];
  last_recovery_action?: TodoRecoveryAction;
  downgraded_from_wave?: boolean;
  reroute_count?: number;
  forced_target_agent_id?: string;
  serial_only?: boolean;
  autonomy_override?: SubagentAutonomyLevel;
  /** Last LLM review per-criterion judgments, preserved for retry improvement */
  last_review_judgments?: Array<{
    criterion: string;
    satisfied: boolean;
    confidence: number;
    reason: string;
  }>;
  /** LLM-generated improvement directive for next retry attempt */
  retry_improvement_directive?: string;
  /** Snapshot of wave context from original parallel execution, preserved for retry */
  wave_context_snapshot?: {
    wave_id: string;
    total_peers: number;
    peer_index: number;
    my_scope_boundary: string;
    excluded_scopes: string[];
    peers: Array<{
      todo_id: string;
      todo_title: string;
      agent_id: string;
      scope_boundary: string;
    }>;
  };
  /** Extra tool IDs requested by planner for this specific todo (merged with agent baseline tools at execution) */
  extra_tools?: string[];
}

export interface ArtifactRecord {
  id: string;
  path: string;
  type: string;
  producer: string;
  related_todo: string;
  summary: string;
  storage_mode: ArtifactStorageMode;
  workspace_file_id?: string;
  inline_preview?: string;
  kind?: WorkspaceFileKind;
}

export interface WorkspaceFileRecord {
  file_id: string;
  path: string;
  kind: WorkspaceFileKind;
  related_todo: string;
  producer: string;
  content_summary: string;
  scope?: WorkspaceScope;
  retention?: WorkspaceRetention;
  mime_type?: string;
  format?: string;
  size_bytes?: number;
  created_at: string;
}

export interface ExecutionLogEntry {
  timestamp: string;
  todo_id: string;
  actor: string;
  action: string;
  message: string;
}

export interface IssueRecord {
  id: string;
  todo_id: string;
  type: string;
  message: string;
  status: IssueStatus;
}

export interface WaveExecutionModeRecord {
  todo_id: string;
  mode: "self" | "delegate" | "split";
  reason: string;
  target_agent_id?: string;
}

export interface WaveExecutionResultRecord {
  todo_id: string;
  status: "success" | "error";
  summary: string;
  error_message?: string;
}

export interface WaveReviewOutcomeRecord {
  todo_id: string;
  status: TodoReviewStatus;
  reason: string;
}

export interface WaveRecord {
  wave_id: string;
  todo_ids: string[];
  created_at: string;
  selection_reason_summary: string[];
  execution_mode_per_todo: WaveExecutionModeRecord[];
  result_summary_per_todo: WaveExecutionResultRecord[];
  review_outcome_per_todo: WaveReviewOutcomeRecord[];
  completed_at?: string;
}

export interface RunState {
  run_id: string;
  goal: string;
  status: RunStatus;
  current_todo_id: string | null;
  current_wave_id: string | null;
  todos: TodoItem[];
  artifacts: ArtifactRecord[];
  workspace_files: WorkspaceFileRecord[];
  execution_log: ExecutionLogEntry[];
  issues: IssueRecord[];
  wave_history: WaveRecord[];
  wave_count: number;
  parallel_execution_metadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface TodoDraft {
  id?: string;
  title: string;
  description: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  assignee?: string;
  capability_type?: TodoCapabilityType;
  depends_on?: string[];
  acceptance_criteria?: string[];
  input_refs?: string[];
  extra_tools?: string[];
  output_ref?: string;
  retry_count?: number;
  delegation_status?: TodoDelegationStatus;
  assignee_history?: string[];
  review_result?: TodoReviewStatus;
  notes?: string[];
  recovery_history?: TodoRecoveryRecord[];
  last_failure_reason?: string;
  last_missing_criteria?: string[];
  last_recovery_action?: TodoRecoveryAction;
  downgraded_from_wave?: boolean;
  reroute_count?: number;
  forced_target_agent_id?: string;
  serial_only?: boolean;
  autonomy_override?: SubagentAutonomyLevel;
}

export interface ArtifactDraft {
  id?: string;
  path: string;
  type: string;
  producer: string;
  related_todo: string;
  summary: string;
  storage_mode?: ArtifactStorageMode;
  workspace_file_id?: string;
  inline_preview?: string;
  kind?: WorkspaceFileKind;
}

export interface WorkspaceFileDraft {
  file_id?: string;
  path: string;
  kind: WorkspaceFileKind;
  related_todo: string;
  producer: string;
  content_summary: string;
  scope?: WorkspaceScope;
  retention?: WorkspaceRetention;
  mime_type?: string;
  format?: string;
  size_bytes?: number;
  created_at?: string;
}

export interface IssueDraft {
  id?: string;
  todo_id: string;
  type: string;
  message: string;
  status?: IssueStatus;
}

export interface TodoRecoveryDraft {
  timestamp?: string;
  action: TodoRecoveryAction;
  reason: string;
  target_agent_id?: string;
  wave_id?: string | null;
}

const ALLOWED_TODO_TRANSITIONS: Record<TodoStatus, ReadonlyArray<TodoStatus>> = {
  todo: ["ready", "blocked", "failed", "pruned"],
  ready: ["in_progress", "blocked", "failed", "pruned"],
  in_progress: ["reviewing", "done", "blocked", "failed", "ready"],
  reviewing: ["done", "ready", "failed", "blocked"],
  done: ["done"],
  blocked: ["ready", "failed", "blocked"],
  failed: ["ready", "blocked", "failed"],
  pruned: ["pruned"],
};

function touch(state: RunState) {
  state.metadata = {
    ...state.metadata,
    updated_at: nowIso(),
  };
}

function inferCapabilityType(title: string, description: string): TodoCapabilityType {
  const text = `${title} ${description}`.toLowerCase();
  if (/review|审核|复核|验收|qa/.test(text)) return "review";
  if (/research|调研|检索|收集资料|资料/.test(text)) return "research";
  if (/write|writing|撰写|改写|文案|正文|输出文档/.test(text)) return "writing";
  if (/plan|planning|规划|拆解|范围|需求/.test(text)) return "planning";
  return "analysis";
}

function getTodoOrThrow(state: RunState, todoId: string): TodoItem {
  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo) {
    throw new Error(`Todo not found: ${todoId}`);
  }
  return todo;
}

function normalizeDependencyReference(value: string) {
  return value
    .toLowerCase()
    .replace(/^(title|id|todo)\s*:\s*/g, "")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveExistingDependencyId(state: RunState, rawDependencyId: string) {
  if (state.todos.some((todo) => todo.id === rawDependencyId)) {
    return rawDependencyId;
  }

  const aliasToId = new Map<string, string>();
  for (const todo of state.todos) {
    const aliases = new Set<string>([
      normalizeDependencyReference(todo.id),
      normalizeDependencyReference(todo.title),
    ]);
    for (const alias of aliases) {
      if (alias && !aliasToId.has(alias)) {
        aliasToId.set(alias, todo.id);
      }
    }
  }

  const normalized = normalizeDependencyReference(rawDependencyId);
  if (!normalized) {
    return rawDependencyId;
  }

  return aliasToId.get(normalized) ?? rawDependencyId;
}

function verifyDependenciesExist(state: RunState, dependsOn: string[]) {
  const resolved = dependsOn.map((depId) => resolveExistingDependencyId(state, depId));
  for (const depId of resolved) {
    const exists = state.todos.some((todo) => todo.id === depId);
    if (!exists) {
      throw new Error(`Dependency todo does not exist: ${depId}`);
    }
  }
  return resolved;
}

function getTodoDependencyStatus(state: RunState, todo: TodoItem) {
  if (todo.depends_on.length === 0) {
    return { allDone: true, missing: [] as string[] };
  }

  const missing = todo.depends_on.filter((depId) => {
    const depTodo = state.todos.find((item) => item.id === depId);
    return !depTodo || depTodo.status !== "done";
  });

  return {
    allDone: missing.length === 0,
    missing,
  };
}

function recomputeRunStatus(state: RunState) {
  if (state.todos.length === 0) {
    state.status = "pending";
    return;
  }

  const hasInProgress = state.todos.some((todo) => todo.status === "in_progress");
  if (hasInProgress) {
    state.status = "running";
    return;
  }

  const hasReviewing = state.todos.some((todo) => todo.status === "reviewing");
  if (hasReviewing) {
    state.status = "reviewing";
    return;
  }

  const allDone = state.todos.every((todo) => todo.status === "done" || todo.status === "pruned");
  if (allDone) {
    state.status = "completed";
    return;
  }

  const hasBlocked = state.todos.some((todo) => todo.status === "blocked");
  if (hasBlocked && !hasInProgress && !hasReviewing) {
    state.status = "blocked";
    return;
  }

  const hasReady = state.todos.some((todo) => todo.status === "ready");
  if (hasReady) {
    state.status = "running";
    return;
  }

  const hasTodo = state.todos.some((todo) => todo.status === "todo");
  if (hasTodo) {
    state.status = "idle";
    return;
  }

  const hasFailed = state.todos.some((todo) => todo.status === "failed");
  if (hasFailed && !hasInProgress && !hasReviewing) {
    state.status = "failed";
    return;
  }

  state.status = "idle";
}

/**
 * Create a new supervisor run state.
 */
export function createRunState(goal: string, options?: { projectId?: string | null }): RunState {
  const createdAt = nowIso();
  return {
    run_id: makeId("sup_run"),
    goal,
    status: "pending",
    current_todo_id: null,
    current_wave_id: null,
    todos: [],
    artifacts: [],
    workspace_files: [],
    execution_log: [],
    issues: [],
    wave_history: [],
    wave_count: 0,
    parallel_execution_metadata: {},
    metadata: {
      created_at: createdAt,
      updated_at: createdAt,
      phase: "supervisor_runtime_state_initialized",
      project_id: options?.projectId ?? "default_project",
      llm_prompt_tokens_total: 0,
      llm_completion_tokens_total: 0,
      llm_total_tokens: 0,
      llm_call_count: 0,
      replan_count: 0,
      last_replan_step: 0,
    },
  };
}

/**
 * Add a todo to the run state and auto-refresh dependency readiness.
 */
export function addTodo(state: RunState, draft: TodoDraft): TodoItem {
  const rawDependsOn = draft.depends_on ? [...new Set(draft.depends_on)] : [];
  const dependsOn = verifyDependenciesExist(state, rawDependsOn);

  const todo: TodoItem = {
    id: draft.id ?? makeId("todo"),
    title: draft.title,
    description: draft.description,
    status: draft.status ?? "todo",
    priority: draft.priority ?? "medium",
    assignee: draft.assignee ?? "supervisor",
      capability_type: draft.capability_type ?? inferCapabilityType(draft.title, draft.description),
    depends_on: dependsOn,
    acceptance_criteria: draft.acceptance_criteria ? [...draft.acceptance_criteria] : [],
    input_refs: draft.input_refs ? [...draft.input_refs] : [],
    extra_tools: draft.extra_tools ? [...draft.extra_tools] : undefined,
    output_ref: draft.output_ref,
    retry_count: draft.retry_count ?? 0,
    delegation_status: draft.delegation_status ?? "none",
    assignee_history: draft.assignee_history ? [...draft.assignee_history] : [draft.assignee ?? "supervisor"],
    review_result: draft.review_result,
    notes: draft.notes ? [...draft.notes] : [],
    recovery_history: draft.recovery_history ? draft.recovery_history.map((item) => ({ ...item })) : [],
    last_failure_reason: draft.last_failure_reason,
    last_missing_criteria: draft.last_missing_criteria ? [...draft.last_missing_criteria] : [],
    last_recovery_action: draft.last_recovery_action,
    downgraded_from_wave: draft.downgraded_from_wave ?? false,
    reroute_count: draft.reroute_count ?? 0,
    forced_target_agent_id: draft.forced_target_agent_id,
    serial_only: draft.serial_only ?? false,
    autonomy_override: draft.autonomy_override,
  };

  state.todos.push(todo);
  refreshTodoReadiness(state);
  recomputeRunStatus(state);
  touch(state);
  return todo;
}

/**
 * Ensure current todo pointer stays valid and references an existing todo.
 */
export function setCurrentTodo(state: RunState, todoId: string | null) {
  if (todoId !== null) {
    getTodoOrThrow(state, todoId);
  }
  state.current_todo_id = todoId;
  touch(state);
}

/**
 * Set currently active wave id.
 */
export function setCurrentWave(state: RunState, waveId: string | null) {
  state.current_wave_id = waveId;
  touch(state);
}

/**
 * Append wave execution record and mark it as current wave.
 */
export function addWaveRecord(state: RunState, wave: WaveRecord) {
  state.wave_history.push({
    ...wave,
    todo_ids: [...wave.todo_ids],
    selection_reason_summary: [...wave.selection_reason_summary],
    execution_mode_per_todo: wave.execution_mode_per_todo.map((item) => ({ ...item })),
    result_summary_per_todo: wave.result_summary_per_todo.map((item) => ({ ...item })),
    review_outcome_per_todo: wave.review_outcome_per_todo.map((item) => ({ ...item })),
  });
  state.wave_count += 1;
  state.current_wave_id = wave.wave_id;
  touch(state);
}

/**
 * Update an existing wave record by wave id.
 */
export function updateWaveRecord(
  state: RunState,
  waveId: string,
  updater: (wave: WaveRecord) => void,
) {
  const wave = state.wave_history.find((item) => item.wave_id === waveId);
  if (!wave) {
    throw new Error(`Wave record not found: ${waveId}`);
  }
  updater(wave);
  touch(state);
}

/**
 * Add an artifact generated by a todo/actor to the run state.
 */
export function addArtifact(state: RunState, draft: ArtifactDraft): ArtifactRecord {
  if (!draft.related_todo || draft.related_todo.trim().length === 0) {
    throw new Error("Artifact writeback requires related_todo.");
  }
  getTodoOrThrow(state, draft.related_todo);
  const artifact: ArtifactRecord = {
    id: draft.id ?? makeId("artifact"),
    path: draft.path,
    type: draft.type,
    producer: draft.producer,
    related_todo: draft.related_todo,
    summary: draft.summary,
    storage_mode: draft.storage_mode ?? "inline",
    workspace_file_id: draft.workspace_file_id,
    inline_preview: draft.inline_preview,
    kind: draft.kind,
  };
  state.artifacts.push(artifact);
  touch(state);
  return artifact;
}

/**
 * Add a workspace-backed file record that can later be read back into execution context.
 */
export function addWorkspaceFile(state: RunState, draft: WorkspaceFileDraft): WorkspaceFileRecord {
  if (!draft.related_todo || draft.related_todo.trim().length === 0) {
    throw new Error("Workspace file requires related_todo.");
  }
  getTodoOrThrow(state, draft.related_todo);
  const record: WorkspaceFileRecord = {
    file_id: draft.file_id ?? makeId("wsf"),
    path: draft.path,
    kind: draft.kind,
    related_todo: draft.related_todo,
    producer: draft.producer,
    content_summary: draft.content_summary,
    scope: draft.scope ?? "run",
    retention: draft.retention ?? (draft.kind === "final_output" ? "final" : "ephemeral"),
    mime_type: draft.mime_type,
    format: draft.format,
    size_bytes: draft.size_bytes,
    created_at: draft.created_at ?? nowIso(),
  };
  state.workspace_files.push(record);
  touch(state);
  return record;
}

/**
 * Append a normalized execution log record.
 * If state.metadata.session_id is set, also emits a real-time log_line event
 * to the SessionEventBus so SSE subscribers receive it immediately.
 */
export function addExecutionLog(state: RunState, log: ExecutionLogEntry) {
  if (!log.todo_id || log.todo_id.trim().length === 0) {
    throw new Error("Execution log requires todo_id.");
  }
  state.execution_log.push(log);
  touch(state);

  // Real-time push: emit to SSE bus if this state is bound to a live session.
  const sessionId = state.metadata?.session_id as string | undefined;
  if (sessionId) {
    // Lazy import to avoid circular deps at module load time.
    import("./session-event-bus").then(({ emitSessionEvent }) => {
      emitSessionEvent(sessionId, {
        type: "log_line",
        timestamp: log.timestamp,
        todo_id: log.todo_id,
        actor: log.actor,
        action: log.action,
        message: typeof log.message === "string" ? log.message : JSON.stringify(log.message),
      });
    }).catch(() => { /* non-critical */ });
  }
}

/**
 * Append an issue record for debugging/recovery tracking.
 */
export function addIssue(state: RunState, draft: IssueDraft): IssueRecord {
  const issue: IssueRecord = {
    id: draft.id ?? makeId("issue"),
    todo_id: draft.todo_id,
    type: draft.type,
    message: draft.message,
    status: draft.status ?? "open",
  };
  state.issues.push(issue);
  touch(state);
  return issue;
}

/**
 * Append one recovery decision/action record to a todo.
 */
export function addTodoRecoveryRecord(state: RunState, todoId: string, draft: TodoRecoveryDraft) {
  const todo = getTodoOrThrow(state, todoId);
  const record: TodoRecoveryRecord = {
    timestamp: draft.timestamp ?? nowIso(),
    action: draft.action,
    reason: draft.reason,
    target_agent_id: draft.target_agent_id,
    wave_id: draft.wave_id ?? null,
  };
  todo.recovery_history = [...(todo.recovery_history ?? []), record];
  todo.last_recovery_action = draft.action;
  touch(state);
  return record;
}

/**
 * If all dependencies are done, todo auto becomes `ready`.
 * If dependencies are no longer satisfied, a `ready` todo is demoted to `todo`.
 */
export function refreshTodoReadiness(state: RunState): TodoItem[] {
  const changed: TodoItem[] = [];

  for (const todo of state.todos) {
    const depStatus = getTodoDependencyStatus(state, todo);
    if (todo.status === "todo" && depStatus.allDone) {
      todo.status = "ready";
      changed.push(todo);
      continue;
    }
    if (todo.status === "ready" && !depStatus.allDone) {
      todo.status = "todo";
      changed.push(todo);
    }
  }

  if (changed.length > 0) {
    recomputeRunStatus(state);
    touch(state);
  }
  return changed;
}

/**
 * Check whether a todo can enter in_progress according to dependency status.
 */
export function canEnterInProgress(state: RunState, todoId: string) {
  const todo = getTodoOrThrow(state, todoId);
  const depStatus = getTodoDependencyStatus(state, todo);
  return {
    allowed: depStatus.allDone,
    missingDependencies: depStatus.missing,
  };
}

/**
 * Validate whether a todo status change is legal.
 */
export function validateTodoStatusTransition(state: RunState, todo: TodoItem, next: TodoStatus) {
  const allowedTransitions = ALLOWED_TODO_TRANSITIONS[todo.status];
  if (!allowedTransitions.includes(next)) {
    return {
      valid: false,
      reason: `Illegal transition: ${todo.status} -> ${next}`,
    };
  }

  if (next === "in_progress") {
    if (todo.status !== "ready") {
      return {
        valid: false,
        reason: "Todo must be in `ready` before entering `in_progress`.",
      };
    }
    const depCheck = canEnterInProgress(state, todo.id);
    if (!depCheck.allowed) {
      return {
        valid: false,
        reason: `Dependencies are not completed: ${depCheck.missingDependencies.join(", ")}`,
      };
    }
  }

  if (next === "reviewing" && todo.status !== "in_progress") {
    return {
      valid: false,
      reason: "Only an `in_progress` todo can enter `reviewing`.",
    };
  }

  if (todo.status === "done" && next === "in_progress") {
    return {
      valid: false,
      reason: "A `done` todo cannot go back to `in_progress` directly.",
    };
  }

  return { valid: true, reason: "" };
}

/**
 * Update todo status with strict transition guard + dependency guard.
 */
export function updateTodoStatus(state: RunState, todoId: string, newStatus: TodoStatus) {
  const todo = getTodoOrThrow(state, todoId);
  const validation = validateTodoStatusTransition(state, todo, newStatus);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  todo.status = newStatus;

  if (newStatus === "done" && state.current_todo_id === todoId) {
    state.current_todo_id = null;
  }

  refreshTodoReadiness(state);
  recomputeRunStatus(state);
  touch(state);
}

/**
 * Minimal example:
 * 1) create run state
 * 2) add three dependent todos
 * 3) execute status transitions in order
 */
export function buildMinimalSupervisorStateExample() {
  const state = createRunState("输出一份 Todo-Driven Supervisor 运行时重构方案");

  const todo1 = addTodo(state, {
    id: "todo_collect_requirements",
    title: "收集需求",
    description: "整理目标、约束和验收标准",
    priority: "high",
    acceptance_criteria: ["形成结构化需求清单"],
  });

  const todo2 = addTodo(state, {
    id: "todo_design_state_model",
    title: "设计状态模型",
    description: "定义 RunState/Todo/Artifact/Issue 结构",
    priority: "high",
    depends_on: [todo1.id],
    acceptance_criteria: ["状态字段完整", "状态流转有约束"],
  });

  const todo3 = addTodo(state, {
    id: "todo_review_and_finalize",
    title: "评审与定稿",
    description: "检查边界条件并形成最终说明",
    depends_on: [todo2.id],
    acceptance_criteria: ["示例流程可演示", "错误流转能被拦截"],
  });

  setCurrentTodo(state, todo1.id);
  updateTodoStatus(state, todo1.id, "in_progress");
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo1.id,
    actor: "supervisor",
    action: "start",
    message: "开始收集需求",
  });
  updateTodoStatus(state, todo1.id, "reviewing");
  updateTodoStatus(state, todo1.id, "done");
  addArtifact(state, {
    path: ".output/v0_2/requirements.md",
    type: "document",
    producer: "supervisor",
    related_todo: todo1.id,
    summary: "需求清单初稿",
  });

  setCurrentTodo(state, todo2.id);
  updateTodoStatus(state, todo2.id, "in_progress");
  updateTodoStatus(state, todo2.id, "reviewing");
  updateTodoStatus(state, todo2.id, "done");
  addArtifact(state, {
    path: ".output/v0_2/state-model.md",
    type: "design_doc",
    producer: "supervisor",
    related_todo: todo2.id,
    summary: "运行时状态模型设计文档",
  });

  setCurrentTodo(state, todo3.id);
  updateTodoStatus(state, todo3.id, "in_progress");
  updateTodoStatus(state, todo3.id, "reviewing");
  updateTodoStatus(state, todo3.id, "done");
  addArtifact(state, {
    path: ".output/v0_2/final-review.md",
    type: "review_report",
    producer: "reviewer",
    related_todo: todo3.id,
    summary: "最终评审结论与后续建议",
  });

  return state;
}

export const create_run_state = createRunState;
export const add_todo = addTodo;
export const update_todo_status = updateTodoStatus;
export const set_current_todo = setCurrentTodo;
export const add_artifact = addArtifact;
export const add_execution_log = addExecutionLog;
export const add_issue = addIssue;
