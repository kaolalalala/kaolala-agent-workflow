import { nowIso } from "@/lib/utils";
import {
  addExecutionLog,
  addIssue,
  addTodo,
  addTodoRecoveryRecord,
  refreshTodoReadiness,
  setCurrentTodo,
  updateTodoStatus,
  type RunState,
  type TodoItem,
} from "../supervisor-runtime-state";
import { buildDelegationBrief } from "./delegation-brief-builder";
import { decideTodoExecutionMode } from "./delegation-policy";
import { buildTodoExecutionContext } from "./execution-context-builder";
import { assertArtifactOwnership, assertTodoBoundAction, type TodoOwnershipError } from "./ownership-guard";
import { planInitialTodos, type TodoPlannerLlmInvoker } from "./planner";
import { decideRecoveryAction } from "./recovery-policy";
import { applyReplanDecision, checkReplanTrigger, evaluateReplan } from "./replanner";
import { reviewTodoExecution } from "./review";
import { selectNextTodo } from "./selector";
import { runSubagentTodo } from "./subagent-executor";
import { getSubagentById } from "./subagent-registry";
import { splitTodoIntoSubTodos } from "./todo-splitter";
import { runParallelTodoWave } from "./parallel-wave";
import { analyzeFailureForRetry } from "./retry-analyzer";
import type { MemoryState } from "../memory-state";
import { sanitizeModelText } from "../text-cleaner";
import { persistExecutionArtifacts } from "./artifact-offloading";
import type {
  DelegationDecision,
  ParallelWaveOptions,
  RecoveryDecision,
  RecoveryPolicyOptions,
  SubagentExecutionResult,
  SubagentRunner,
  TodoExecutor,
  TodoExecutorResult,
  TodoPlanningContext,
  TodoReviewResult,
  TodoStepResult,
} from "./types";

function message(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function markTodoAssignee(todo: TodoItem, assignee: string) {
  todo.assignee = assignee;
  if (todo.assignee_history[todo.assignee_history.length - 1] !== assignee) {
    todo.assignee_history.push(assignee);
  }
}

function isTodoRunnableStatus(status: TodoItem["status"]) {
  return status === "ready" || status === "in_progress" || status === "reviewing";
}

function normalizeSubagentResult(raw: unknown): SubagentExecutionResult {
  const parsed = raw as Partial<SubagentExecutionResult> | null | undefined;
  if (!parsed || typeof parsed !== "object") {
    return {
      status: "error",
      summary: "Subagent returned invalid non-object payload.",
      token_usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        source: "invalid_payload",
      },
      artifacts: [],
      open_questions: [],
      completion_notes: [],
      criteria_evidence: [],
      error_message: "invalid_subagent_payload_object",
    };
  }

  const status = parsed.status === "success" ? "success" : "error";
  const summary = sanitizeModelText(
    typeof parsed.summary === "string" ? parsed.summary : "Subagent returned invalid structure.",
  );
  const artifacts = Array.isArray(parsed.artifacts)
    ? parsed.artifacts
        .filter((item): item is { path: string; type: string; summary: string } =>
          Boolean(
            item &&
            typeof item === "object" &&
            typeof (item as { path?: unknown }).path === "string" &&
            typeof (item as { type?: unknown }).type === "string" &&
            typeof (item as { summary?: unknown }).summary === "string",
          ),
        )
    : [];
  const openQuestions = Array.isArray(parsed.open_questions)
    ? parsed.open_questions.filter((item): item is string => typeof item === "string")
    : [];
  const completionNotes = Array.isArray(parsed.completion_notes)
    ? parsed.completion_notes.filter((item): item is string => typeof item === "string")
    : [];
  const criteriaEvidence = Array.isArray(parsed.criteria_evidence)
    ? parsed.criteria_evidence.filter((item): item is string => typeof item === "string")
    : [];

  return {
    status,
    summary,
    token_usage:
      parsed.token_usage && typeof parsed.token_usage === "object"
        ? {
            prompt_tokens:
              Number.isFinite(Number((parsed.token_usage as { prompt_tokens?: unknown }).prompt_tokens))
                ? Number((parsed.token_usage as { prompt_tokens?: unknown }).prompt_tokens)
                : 0,
            completion_tokens:
              Number.isFinite(
                Number((parsed.token_usage as { completion_tokens?: unknown }).completion_tokens),
              )
                ? Number((parsed.token_usage as { completion_tokens?: unknown }).completion_tokens)
                : 0,
            total_tokens:
              Number.isFinite(Number((parsed.token_usage as { total_tokens?: unknown }).total_tokens))
                ? Number((parsed.token_usage as { total_tokens?: unknown }).total_tokens)
                : 0,
            source:
              typeof (parsed.token_usage as { source?: unknown }).source === "string"
                ? String((parsed.token_usage as { source?: unknown }).source)
                : undefined,
          }
        : undefined,
    artifacts,
    open_questions: openQuestions.map((item) => sanitizeModelText(item)),
    completion_notes: completionNotes.map((item) => sanitizeModelText(item)),
    criteria_evidence: criteriaEvidence.map((item) => sanitizeModelText(item)),
    raw_output: typeof parsed.raw_output === "string" ? sanitizeModelText(parsed.raw_output) : undefined,
    error_message: typeof parsed.error_message === "string" ? parsed.error_message : undefined,
  };
}

function safeSetTodoFailed(state: RunState, todo: TodoItem, issueType: string, issueMessage: string) {
  addIssue(state, {
    todo_id: todo.id,
    type: issueType,
    message: issueMessage,
    status: "open",
  });
  try {
    if (todo.status !== "failed") {
      updateTodoStatus(state, todo.id, "failed");
    }
  } catch (error) {
    addIssue(state, {
      todo_id: todo.id,
      type: "critical_state_transition_error",
      message: error instanceof Error ? error.message : String(error),
      status: "open",
    });
  } finally {
    setCurrentTodo(state, null);
  }
}

function accumulateTokenUsage(
  state: RunState,
  todo: TodoItem,
  actor: string,
  source: string,
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    source?: string;
  },
) {
  if (!usage) return;
  const prompt = Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : 0;
  const completion = Number.isFinite(Number(usage.completion_tokens))
    ? Number(usage.completion_tokens)
    : 0;
  const total = Number.isFinite(Number(usage.total_tokens))
    ? Number(usage.total_tokens)
    : prompt + completion;
  if (total <= 0) return;

  const prevPrompt = Number(state.metadata.llm_prompt_tokens_total ?? 0);
  const prevCompletion = Number(state.metadata.llm_completion_tokens_total ?? 0);
  const prevTotal = Number(state.metadata.llm_total_tokens ?? 0);
  const prevCalls = Number(state.metadata.llm_call_count ?? 0);
  state.metadata.llm_prompt_tokens_total = prevPrompt + prompt;
  state.metadata.llm_completion_tokens_total = prevCompletion + completion;
  state.metadata.llm_total_tokens = prevTotal + total;
  state.metadata.llm_call_count = prevCalls + 1;
  state.metadata.last_llm_usage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    source: usage.source ?? "unknown",
    actor,
    todo_id: todo.id,
  };

  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor,
    action: "llm_usage",
    message: message({
      source,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      usage_source: usage.source ?? "unknown",
    }),
  });
}

function accumulateSystemTokenUsage(
  state: RunState,
  actor: string,
  source: string,
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    source?: string;
  },
) {
  if (!usage) return;
  const prompt = Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : 0;
  const completion = Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : 0;
  const total = Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : prompt + completion;
  if (total <= 0) return;

  state.metadata.llm_prompt_tokens_total = Number(state.metadata.llm_prompt_tokens_total ?? 0) + prompt;
  state.metadata.llm_completion_tokens_total = Number(state.metadata.llm_completion_tokens_total ?? 0) + completion;
  state.metadata.llm_total_tokens = Number(state.metadata.llm_total_tokens ?? 0) + total;
  state.metadata.llm_call_count = Number(state.metadata.llm_call_count ?? 0) + 1;
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: actor,
    actor,
    action: "llm_usage",
    message: message({
      source,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      usage_source: usage.source ?? "unknown",
    }),
  });
}

function applyExecutorArtifacts(state: RunState, todo: TodoItem, producer: string, result: TodoExecutorResult) {
  assertArtifactOwnership(state, "artifact_writeback", todo.id);
  const createdIds = persistExecutionArtifacts(state, todo, producer, result, "serial").map((item) => item.id);

  if (createdIds.length > 0) {
    todo.output_ref = createdIds[0];
  }
}

async function executeByMode(
  state: RunState,
  todo: TodoItem,
  executor: TodoExecutor,
  decision: DelegationDecision,
  subagentRunner: SubagentRunner,
  memoryState?: MemoryState,
): Promise<{
  result: TodoExecutorResult;
  delegatedAgentId?: string;
}> {
  if (decision.mode === "delegate") {
    assertTodoBoundAction(state, "delegate", todo.id);
    const agent = decision.target_agent_id ? getSubagentById(decision.target_agent_id) : undefined;
    if (!agent) {
      return {
        result: {
          status: "error",
          output: "",
          error_message: `Delegation target not found: ${decision.target_agent_id ?? "unknown"}`,
        },
      };
    }

    // Restore wave context from snapshot if this is a retry of a wave todo
    const restoredWaveContext = todo.wave_context_snapshot
      ? {
          wave_id: todo.wave_context_snapshot.wave_id,
          total_peers: todo.wave_context_snapshot.total_peers,
          peer_index: todo.wave_context_snapshot.peer_index,
          peers: todo.wave_context_snapshot.peers,
          my_scope_boundary: todo.wave_context_snapshot.my_scope_boundary,
          excluded_scopes: todo.wave_context_snapshot.excluded_scopes,
        }
      : undefined;
    // On retry, analyze previous failure to generate improvement directives
    let retryAnalysis: Awaited<ReturnType<typeof analyzeFailureForRetry>> | undefined;
    if ((todo.retry_count ?? 0) > 0) {
      retryAnalysis = await analyzeFailureForRetry(todo);
      accumulateTokenUsage(state, todo, "retry_analyzer", "failure_analysis", retryAnalysis.token_usage);
    }
    const brief = buildDelegationBrief(state, todo, agent, restoredWaveContext, retryAnalysis);
    todo.delegation_status = "delegated";
    if (todo.forced_target_agent_id === agent.id) {
      todo.forced_target_agent_id = undefined;
    }
    markTodoAssignee(todo, agent.id);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor",
      action: "delegate",
      message: message({
        target_agent_id: agent.id,
        reason: decision.reason,
      }),
    });

    let subResult: SubagentExecutionResult;
    try {
      subResult = normalizeSubagentResult(await subagentRunner(agent, brief, { state, todo }));
    } catch (error) {
      todo.delegation_status = "failed";
      const errorMessage = error instanceof Error ? error.message : String(error);
      addExecutionLog(state, {
        timestamp: nowIso(),
        todo_id: todo.id,
        actor: agent.id,
        action: "subagent_return",
        message: message({
          status: "error",
          error: errorMessage,
          reason: "subagent_runner_threw",
        }),
      });
      return {
        result: {
          status: "error",
          output: "",
          error_message: `Subagent runner exception: ${errorMessage}`,
        },
        delegatedAgentId: agent.id,
      };
    }

    todo.delegation_status = subResult.status === "success" ? "returned" : "failed";
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: agent.id,
      action: "subagent_return",
      message: message({
        status: subResult.status,
        artifact_count: subResult.artifacts.length,
        open_question_count: subResult.open_questions.length,
        error_message: subResult.error_message ?? null,
      }),
    });

    const result: TodoExecutorResult = {
      status: subResult.status,
      output: sanitizeModelText(subResult.raw_output ?? subResult.summary),
      summary: sanitizeModelText(subResult.summary),
      token_usage: subResult.token_usage,
      artifacts: subResult.artifacts,
      open_questions: subResult.open_questions,
      completion_notes: subResult.completion_notes,
      criteria_evidence: subResult.criteria_evidence,
      notes: subResult.completion_notes,
      error_message: subResult.error_message,
    };
    return {
      result,
      delegatedAgentId: agent.id,
    };
  }

  if (decision.mode === "split") {
    assertTodoBoundAction(state, "split", todo.id);
    todo.delegation_status = "split";
    markTodoAssignee(todo, "supervisor");
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor",
      action: "split",
      message: message({
        reason: decision.reason,
        source: "delegation_policy",
      }),
    });
    return {
      result: {
        status: "success",
        output: decision.reason,
        summary: "Todo requires split before execution.",
        force_split: true,
        split_reason: decision.reason,
      },
    };
  }

  // Direct supervisor execution remains valid for planning / review / generic analysis todos.
  assertTodoBoundAction(state, "self_execute", todo.id);
  todo.delegation_status = "self";
  markTodoAssignee(todo, "supervisor");
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "supervisor",
    action: "self_execute",
    message: message({
      reason: decision.reason,
      warning: "Supervisor executed directly — delegation policy should route all tasks to agents.",
    }),
  });
  const context = buildTodoExecutionContext(state, todo, { memoryState });
  const result = await executor(context, state, todo);
  return { result };
}

function setTodoReadyForRecovery(state: RunState, todo: TodoItem) {
  if (todo.status !== "ready") {
    try {
      updateTodoStatus(state, todo.id, "ready");
    } catch (error) {
      safeSetTodoFailed(
        state,
        todo,
        "critical_recovery_transition_error",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
  }
  setCurrentTodo(state, null);
}

function applyRecoveryDecision(
  state: RunState,
  todo: TodoItem,
  recovery: RecoveryDecision,
  context: {
    review?: TodoReviewResult;
    delegatedAgentId?: string;
    waveId?: string | null;
  },
) {
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "supervisor_recovery",
    action: "recovery_decided",
    message: message({
      action: recovery.action,
      reason: recovery.reason,
      target_agent_id: recovery.target_agent_id ?? null,
      wave_id: context.waveId ?? null,
    }),
  });

  addTodoRecoveryRecord(state, todo.id, {
    action: recovery.action,
    reason: recovery.reason,
    target_agent_id: recovery.target_agent_id,
    wave_id: context.waveId ?? null,
  });
  todo.last_failure_reason = recovery.reason;
  todo.last_missing_criteria = [...(context.review?.missing_criteria ?? [])];

  // Preserve LLM review per-criterion judgments for retry agent
  if (context.review?.llm_review_detail?.criteria_judgments) {
    todo.last_review_judgments = context.review.llm_review_detail.criteria_judgments.map((j) => ({
      criterion: j.criterion,
      satisfied: j.satisfied,
      confidence: j.confidence,
      reason: j.reason,
    }));
  }

  if (Array.isArray(recovery.recovery_notes) && recovery.recovery_notes.length > 0) {
    todo.notes.push(...recovery.recovery_notes.map((note) => `recovery_note:${note}`));
  }
  if (context.review) {
    todo.notes.push(
      `recovery_feedback:status=${context.review.status};reason=${context.review.reason};missing=${context.review.missing_criteria.join(",") || "none"}`,
    );
  }

  if (recovery.action === "retry") {
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_recovery",
      action: "retry_started",
      message: message({
        retry_count_before: todo.retry_count,
        reason: recovery.reason,
      }),
    });
    todo.retry_count += 1;
    todo.delegation_status = "none";
    todo.review_result = "revise";
    setTodoReadyForRecovery(state, todo);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_recovery",
      action: "retry_completed",
      message: message({
        retry_count_after: todo.retry_count,
        reason: recovery.reason,
      }),
    });
    return;
  }

  if (recovery.action === "reroute") {
    const target = recovery.target_agent_id;
    if (!target) {
      safeSetTodoFailed(state, todo, "recovery_reroute_missing_target", recovery.reason);
      return;
    }
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_recovery",
      action: "reroute_started",
      message: message({
        from_assignee: todo.assignee,
        to_assignee: target,
        reason: recovery.reason,
      }),
    });
    todo.reroute_count = (todo.reroute_count ?? 0) + 1;
    todo.forced_target_agent_id = target;
    todo.delegation_status = "none";
    markTodoAssignee(todo, target);
    setTodoReadyForRecovery(state, todo);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_recovery",
      action: "reroute_completed",
      message: message({
        reroute_count: todo.reroute_count,
        target_agent_id: target,
      }),
    });
    return;
  }

  if (recovery.action === "split") {
    const split = splitTodoIntoSubTodos(state, todo, recovery.reason);
    for (const sub of split.subtodos) {
      addTodo(state, sub);
    }
    todo.notes.push(`split_reason: ${split.reason}`);
    updateTodoStatus(state, todo.id, "done");
    setCurrentTodo(state, null);
    return;
  }

  if (recovery.action === "downgrade_to_serial") {
    todo.downgraded_from_wave = true;
    todo.serial_only = true;
    todo.delegation_status = "none";
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_recovery",
      action: "downgrade_to_serial",
      message: message({
        reason: recovery.reason,
        wave_id: context.waveId ?? null,
      }),
    });
    setTodoReadyForRecovery(state, todo);
    return;
  }

  if ((recovery.recovery_notes ?? []).some((note) => note.includes("retry_exhausted"))) {
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_recovery",
      action: "retry_exhausted",
      message: message({
        retry_count: todo.retry_count,
        reason: recovery.reason,
      }),
    });
  }
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "supervisor_recovery",
    action: "recovery_failed",
    message: message({
      reason: recovery.reason,
      action: recovery.action,
    }),
  });
  safeSetTodoFailed(state, todo, "todo_recovery_failed", recovery.reason);
}

function normalizeCurrentSelection(state: RunState) {
  if (!state.current_todo_id) return;
  const todo = state.todos.find((item) => item.id === state.current_todo_id);
  if (!todo || !isTodoRunnableStatus(todo.status)) {
    setCurrentTodo(state, null);
  }
}

/**
 * Phase-3 upgraded loop:
 * supervisor selects todo -> decides self/delegate/split -> executes -> reviews -> updates state.
 * Serial-only in this stage (no parallel dispatch/swarm).
 */
export async function runTodoDrivenStep(
  state: RunState,
  executor: TodoExecutor,
  options?: {
    planningContext?: TodoPlanningContext;
    memoryState?: MemoryState;
    planningMaxAttempts?: number;
    planningInvokeLlm?: TodoPlannerLlmInvoker;
    currentStep?: number;
    maxSteps?: number;
    subagentRunner?: SubagentRunner;
    parallel?: ParallelWaveOptions;
    recoveryPolicy?: RecoveryPolicyOptions;
    reviewFailRetryBudget?: number;
    allowInternalReplan?: boolean;
    replanInvokeLlm?: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<{
      content: string;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        source: "provider" | "estimated";
      };
    }>;
  },
): Promise<TodoStepResult> {
  const recoveryPolicy: RecoveryPolicyOptions = {
    ...(options?.recoveryPolicy ?? {}),
    ...(typeof options?.reviewFailRetryBudget === "number"
      ? { max_retry_per_todo: Math.max(0, options.reviewFailRetryBudget) }
      : {}),
  };

  if (state.todos.length === 0) {
    let planned: TodoItem[];
    try {
      planned = await planInitialTodos(state.goal, options?.planningContext, {
        maxAttempts: options?.planningMaxAttempts,
        invokeLlm: options?.planningInvokeLlm,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      addIssue(state, {
        todo_id: "planner",
        type: "todo_planning_failed",
        message: messageText,
        status: "open",
      });
      addExecutionLog(state, {
        timestamp: nowIso(),
        todo_id: "planner",
        actor: "supervisor_planner",
        action: "plan_failed",
        message: message({ error: messageText }),
      });
      throw error;
    }

    for (const todo of planned) {
      addTodo(state, todo);
    }
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: "planner",
      actor: "supervisor_planner",
      action: "plan_initial_todos",
      message: message({ generated_count: planned.length }),
    });
  }

  refreshTodoReadiness(state);
  normalizeCurrentSelection(state);

  let selectedTodoId = state.current_todo_id;
  if (!selectedTodoId) {
      const waveResult = await runParallelTodoWave(state, executor, {
        parallel: options?.parallel,
        subagentRunner: options?.subagentRunner,
        recoveryPolicy,
        memoryState: options?.memoryState,
      });
    if (waveResult) {
      return waveResult;
    }

    selectedTodoId = selectNextTodo(state);
    if (!selectedTodoId) {
      addExecutionLog(state, {
        timestamp: nowIso(),
        todo_id: "selector",
        actor: "supervisor_selector",
        action: "idle",
        message: message({ reason: "no_ready_todo_available" }),
      });
      return { state, selected_todo_id: null };
    }
    setCurrentTodo(state, selectedTodoId);
  }

  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: selectedTodoId,
    actor: "supervisor_selector",
    action: "select_todo",
    message: message({ selected_todo_id: selectedTodoId }),
  });

  let todo: TodoItem;
  try {
    todo = assertTodoBoundAction(state, "select_todo", selectedTodoId);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    addIssue(state, {
      todo_id: "selector",
      type: "critical_todo_selection_error",
      message: messageText,
      status: "open",
    });
    return { state, selected_todo_id: null };
  }

  if (todo.status === "ready") {
    updateTodoStatus(state, todo.id, "in_progress");
  } else if (!isTodoRunnableStatus(todo.status)) {
    setCurrentTodo(state, null);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_selector",
      action: "idle",
      message: message({ reason: "selected_todo_not_runnable", status: todo.status }),
    });
    return { state, selected_todo_id: null };
  }

  const decision = decideTodoExecutionMode(state, todo, options?.memoryState);
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "supervisor_policy",
    action: "decide_mode",
    message: message({
      mode: decision.mode,
      target_agent_id: decision.target_agent_id ?? null,
      reason: decision.reason,
    }),
  });

  let execution: { result: TodoExecutorResult; delegatedAgentId?: string };
  try {
    execution = await executeByMode(
      state,
      todo,
      executor,
      decision,
      options?.subagentRunner ?? runSubagentTodo,
      options?.memoryState,
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const issueType =
      (error as Partial<TodoOwnershipError>)?.name === "TodoOwnershipError"
        ? "critical_ownership_guard"
        : "critical_executor_error";
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor",
      action: "execution_exception",
      message: message({
        issue_type: issueType,
        error: messageText,
      }),
    });
    todo.delegation_status = "failed";
    const syntheticExecutionResult: TodoExecutorResult = {
      status: "error",
      output: "",
      error_message: messageText,
    };
    const recovery = decideRecoveryAction(
      {
        state,
        todo,
        execution_result: syntheticExecutionResult,
        review_result: {
          status: "fail",
          reason: messageText,
          missing_criteria: [...todo.acceptance_criteria],
        },
        execution_mode: decision.mode,
        delegated_agent_id: decision.target_agent_id,
        in_wave: false,
      },
      recoveryPolicy,
      options?.memoryState,
    );
    applyRecoveryDecision(state, todo, recovery, {
      review: {
        status: "fail",
        reason: messageText,
        missing_criteria: [...todo.acceptance_criteria],
      },
    });
    return {
      state,
      selected_todo_id: todo.id,
      delegation_decision: decision,
      review: {
        status: "fail",
        reason: messageText,
        missing_criteria: [...todo.acceptance_criteria],
      },
      executor_result: syntheticExecutionResult,
      recovery_decision: recovery,
    };
  }

  const executorResult = execution.result;
  accumulateTokenUsage(
    state,
    todo,
    execution.delegatedAgentId ?? "supervisor",
    execution.delegatedAgentId ? "delegate" : "self",
    executorResult.token_usage,
  );
  if (execution.delegatedAgentId) {
    applyExecutorArtifacts(state, todo, execution.delegatedAgentId, executorResult);
  } else {
    applyExecutorArtifacts(state, todo, "supervisor", executorResult);
  }

  if (Array.isArray(executorResult.notes) && executorResult.notes.length > 0) {
    todo.notes.push(...executorResult.notes);
  }
  if (Array.isArray(executorResult.completion_notes) && executorResult.completion_notes.length > 0) {
    todo.notes.push(...executorResult.completion_notes);
  }

  if (todo.status !== "reviewing") {
    updateTodoStatus(state, todo.id, "reviewing");
  }

  let review: TodoReviewResult;
  try {
    assertTodoBoundAction(state, "review", todo.id);
    const context = buildTodoExecutionContext(state, todo, { memoryState: options?.memoryState });
    review = await reviewTodoExecution(todo, executorResult, context, {
      memoryState: options?.memoryState,
    });
    if (review.review_token_usage) {
      accumulateTokenUsage(state, todo, "supervisor_reviewer", "llm_review", review.review_token_usage);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "supervisor_reviewer",
      action: "review_exception",
      message: message({ error: messageText }),
    });
    const recovery = decideRecoveryAction(
      {
        state,
        todo,
        execution_result: executorResult,
        review_result: {
          status: "fail",
          reason: messageText,
          missing_criteria: [...todo.acceptance_criteria],
        },
        execution_mode: decision.mode,
        delegated_agent_id: execution.delegatedAgentId,
        in_wave: false,
      },
      recoveryPolicy,
      options?.memoryState,
    );
    applyRecoveryDecision(state, todo, recovery, {
      review: {
        status: "fail",
        reason: messageText,
        missing_criteria: [...todo.acceptance_criteria],
      },
    });
    return {
      state,
      selected_todo_id: todo.id,
      delegation_decision: decision,
      delegated_agent_id: execution.delegatedAgentId,
      review: {
        status: "fail",
        reason: messageText,
        missing_criteria: [...todo.acceptance_criteria],
      },
      executor_result: executorResult,
      recovery_decision: recovery,
    };
  }

  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "supervisor_reviewer",
    action:
      review.status === "pass" ? "review_pass"
        : review.status === "revise" ? "review_revise"
          : review.status === "split" ? "review_split"
            : "review_fail",
    message: message({
      reason: review.reason,
      missing_criteria: review.missing_criteria,
    }),
  });

  todo.review_result = review.status;
  let recoveryDecision: RecoveryDecision | undefined;
  if (review.status === "pass") {
    updateTodoStatus(state, todo.id, "done");
    setCurrentTodo(state, null);
  } else if (review.status === "split") {
    const split = splitTodoIntoSubTodos(state, todo, review.reason);
    for (const sub of split.subtodos) {
      addTodo(state, sub);
    }
    todo.notes.push(`split_reason: ${split.reason}`);
    updateTodoStatus(state, todo.id, "done");
    setCurrentTodo(state, null);
  } else {
    recoveryDecision = decideRecoveryAction(
      {
        state,
        todo,
        execution_result: executorResult,
        review_result: review,
        execution_mode: decision.mode,
        delegated_agent_id: execution.delegatedAgentId,
        in_wave: false,
      },
      recoveryPolicy,
      options?.memoryState,
    );
    applyRecoveryDecision(state, todo, recoveryDecision, {
      review,
      delegatedAgentId: execution.delegatedAgentId,
    });
  }

  const currentStep = Math.max(1, options?.currentStep ?? 1);
  const maxSteps = Math.max(currentStep, options?.maxSteps ?? currentStep);
  if (options?.allowInternalReplan === true) {
    const replanTrigger = checkReplanTrigger(state, review, recoveryDecision, {
      currentStep,
      minStepsBetweenReplans: 3,
    });
    if (replanTrigger.shouldReplan) {
      const replanDecision = await evaluateReplan(state, maxSteps, currentStep, {
        invokeLlm: options?.replanInvokeLlm,
      });
      if (replanDecision.token_usage) {
        accumulateSystemTokenUsage(state, "replanner", "replan", replanDecision.token_usage);
      }
      if (replanDecision.action !== "no_change") {
        applyReplanDecision(state, replanDecision, currentStep);
      } else {
        addExecutionLog(state, {
          timestamp: nowIso(),
          todo_id: "replanner",
          actor: "replanner",
          action: "replan_skipped",
          message: message({
            reason: replanDecision.reason,
            trigger_reasons: replanTrigger.reasons,
            step: currentStep,
          }),
        });
      }
    }
  }

  return {
    state,
    selected_todo_id: todo.id,
    delegation_decision: decision,
    delegated_agent_id: execution.delegatedAgentId,
    review,
    executor_result: executorResult,
    recovery_decision: recoveryDecision,
  };
}
