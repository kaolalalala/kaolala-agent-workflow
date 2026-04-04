import { makeId, nowIso } from "@/lib/utils";
import {
  addExecutionLog,
  addIssue,
  addTodo,
  addTodoRecoveryRecord,
  addWaveRecord,
  setCurrentTodo,
  setCurrentWave,
  updateTodoStatus,
  updateWaveRecord,
  type RunState,
  type TodoItem,
  type WaveExecutionModeRecord,
  type WaveExecutionResultRecord,
  type WaveRecord,
  type WaveReviewOutcomeRecord,
} from "../supervisor-runtime-state";
import { buildDelegationBrief } from "./delegation-brief-builder";
import { decideTodoExecutionMode } from "./delegation-policy";
import { buildTodoExecutionContext } from "./execution-context-builder";
import { assertArtifactOwnership, assertTodoBoundAction } from "./ownership-guard";
import { decideRecoveryAction } from "./recovery-policy";
import { reviewTodoExecution } from "./review";
import { getSubagentById } from "./subagent-registry";
import { splitTodoIntoSubTodos } from "./todo-splitter";
import { sanitizeModelText } from "../text-cleaner";
import type { MemoryState } from "../memory-state";
import { analyzeFailureForRetry } from "./retry-analyzer";
import { runSubagentTodo } from "./subagent-executor";
import { persistExecutionArtifacts } from "./artifact-offloading";
import type {
  ParallelWaveOptions,
  RecoveryDecision,
  RecoveryPolicyOptions,
  SubagentExecutionResult,
  SubagentRunner,
  TodoExecutor,
  TodoExecutorResult,
  TodoReviewResult,
  TodoStepResult,
} from "./types";

const PRIORITY_WEIGHT: Record<TodoItem["priority"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

interface WaveCandidate {
  todo: TodoItem;
  decision: WaveExecutionModeRecord;
}

export interface ParallelWaveSelection {
  selected: WaveCandidate[];
  excluded: Array<{ todo_id: string; reason: string }>;
  selection_reason_summary: string[];
}

interface WaveExecutionTaskResult {
  todo_id: string;
  mode: "self" | "delegate" | "split";
  target_agent_id?: string;
  result: TodoExecutorResult;
}

function message(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function markTodoAssignee(todo: TodoItem, assignee: string) {
  todo.assignee = assignee;
  if (todo.assignee_history[todo.assignee_history.length - 1] !== assignee) {
    todo.assignee_history.push(assignee);
  }
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
    open_questions: Array.isArray(parsed.open_questions)
      ? parsed.open_questions
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeModelText(item))
      : [],
    completion_notes: Array.isArray(parsed.completion_notes)
      ? parsed.completion_notes
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeModelText(item))
      : [],
    criteria_evidence: Array.isArray(parsed.criteria_evidence)
      ? parsed.criteria_evidence
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeModelText(item))
      : [],
    raw_output: typeof parsed.raw_output === "string" ? sanitizeModelText(parsed.raw_output) : undefined,
    error_message: typeof parsed.error_message === "string" ? parsed.error_message : undefined,
  };
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

function isMixedTask(todo: TodoItem) {
  const hasNarrativeOutput = todo.acceptance_criteria.some((criterion) =>
    /summary|report|write|draft|document|deliverable/i.test(criterion),
  );
  const hasDeterministicChecks = todo.acceptance_criteria.some((criterion) =>
    /count|verify|validation|schema|path|file|inventory|manifest/i.test(criterion),
  );
  return hasNarrativeOutput && hasDeterministicChecks;
}

function isCapabilityUnclear(todo: TodoItem) {
  const text = `${todo.title} ${todo.description}`.trim();
  if (text.length < 16) return true;
  if (todo.capability_type === "analysis" && !/分析|evaluate|assess|reason|结论|diagnose/i.test(text)) {
    return true;
  }
  return false;
}

function hasDependencyConflict(left: TodoItem, right: TodoItem) {
  if (left.depends_on.includes(right.id) || right.depends_on.includes(left.id)) return true;
  return false;
}

function hasOutputRefConflict(left: TodoItem, right: TodoItem) {
  if (!left.output_ref || !right.output_ref) return false;
  return left.output_ref === right.output_ref;
}

function recordWaveGuardIssue(
  state: RunState,
  action: string,
  waveId: string | null | undefined,
  todoId: string,
  detail: string,
) {
  addIssue(state, {
    todo_id: todoId,
    type: "critical_wave_guard",
    message: `[wave=${waveId ?? "null"}] ${action}: ${detail}`,
    status: "open",
  });
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todoId,
    actor: "wave_guard",
    action: "wave_guard_triggered",
    message: message({
      action,
      wave_id: waveId ?? null,
      todo_id: todoId,
      reason: detail,
    }),
  });
}

function assertWaveBoundAction(state: RunState, action: string, waveId: string | null | undefined, todoId: string) {
  if (!waveId || waveId.trim().length === 0) {
    const detail = "missing wave_id";
    recordWaveGuardIssue(state, action, waveId, todoId, detail);
    throw new Error(`[WaveOwnershipGuard] ${action} requires wave_id for todo ${todoId}`);
  }
  if (state.current_wave_id !== waveId) {
    const detail = `wave_id mismatch: state.current_wave_id=${state.current_wave_id ?? "null"}, got=${waveId}`;
    recordWaveGuardIssue(state, action, waveId, todoId, detail);
    throw new Error(`[WaveOwnershipGuard] ${action} invalid current wave context for todo ${todoId}`);
  }
}

function safeMarkTodoFailed(state: RunState, todo: TodoItem, issueType: string, issueMessage: string, waveId: string) {
  addIssue(state, {
    todo_id: todo.id,
    type: issueType,
    message: issueMessage,
    status: "open",
  });
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "wave_executor",
    action: "wave_item_failed",
    message: message({
      wave_id: waveId,
      issue_type: issueType,
      error: issueMessage,
    }),
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
  }
}

function applyExecutorArtifacts(
  state: RunState,
  waveId: string,
  todo: TodoItem,
  producer: string,
  result: TodoExecutorResult,
) {
  assertWaveBoundAction(state, "wave_artifact_writeback", waveId, todo.id);
  assertArtifactOwnership(state, "wave_artifact_writeback", todo.id);
  const createdIds = persistExecutionArtifacts(state, todo, producer, result, "wave").map((item) => item.id);
  if (createdIds.length > 0) {
    todo.output_ref = createdIds[0];
  }
}

function markTodoReadyOrFail(state: RunState, todo: TodoItem, waveId: string) {
  try {
    if (todo.status !== "ready") {
      updateTodoStatus(state, todo.id, "ready");
    }
  } catch (error) {
    safeMarkTodoFailed(
      state,
      todo,
      "critical_recovery_transition_error",
      error instanceof Error ? error.message : String(error),
      waveId,
    );
  }
}

function applyWaveRecoveryDecision(
  state: RunState,
  waveId: string,
  todo: TodoItem,
  recovery: RecoveryDecision,
  context: {
    review: TodoReviewResult;
    delegatedAgentId?: string;
  },
) {
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "wave_recovery",
    action: "recovery_decided",
    message: message({
      wave_id: waveId,
      action: recovery.action,
      reason: recovery.reason,
      target_agent_id: recovery.target_agent_id ?? null,
    }),
  });
  addTodoRecoveryRecord(state, todo.id, {
    action: recovery.action,
    reason: recovery.reason,
    target_agent_id: recovery.target_agent_id,
    wave_id: waveId,
  });
  todo.last_failure_reason = recovery.reason;
  todo.last_missing_criteria = [...(context.review.missing_criteria ?? [])];
  if (Array.isArray(recovery.recovery_notes) && recovery.recovery_notes.length > 0) {
    todo.notes.push(...recovery.recovery_notes.map((note) => `recovery_note:${note}`));
  }
  todo.notes.push(
    `recovery_feedback:status=${context.review.status};reason=${context.review.reason};missing=${context.review.missing_criteria.join(",") || "none"}`,
  );

  if (recovery.action === "retry") {
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_recovery",
      action: "retry_started",
      message: message({ wave_id: waveId, reason: recovery.reason }),
    });
    todo.retry_count += 1;
    todo.delegation_status = "none";
    todo.review_result = "revise";
    markTodoReadyOrFail(state, todo, waveId);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_recovery",
      action: "retry_completed",
      message: message({ wave_id: waveId, retry_count: todo.retry_count }),
    });
    return;
  }

  if (recovery.action === "reroute") {
    const target = recovery.target_agent_id;
    if (!target) {
      safeMarkTodoFailed(state, todo, "recovery_reroute_missing_target", recovery.reason, waveId);
      return;
    }
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_recovery",
      action: "reroute_started",
      message: message({ wave_id: waveId, from: todo.assignee, to: target, reason: recovery.reason }),
    });
    todo.reroute_count = (todo.reroute_count ?? 0) + 1;
    todo.forced_target_agent_id = target;
    todo.assignee = target;
    if (todo.assignee_history[todo.assignee_history.length - 1] !== target) {
      todo.assignee_history.push(target);
    }
    todo.delegation_status = "none";
    markTodoReadyOrFail(state, todo, waveId);
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_recovery",
      action: "reroute_completed",
      message: message({ wave_id: waveId, reroute_count: todo.reroute_count, target_agent_id: target }),
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
    return;
  }

  if (recovery.action === "downgrade_to_serial") {
    todo.downgraded_from_wave = true;
    todo.serial_only = true;
    todo.delegation_status = "none";
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_recovery",
      action: "downgrade_to_serial",
      message: message({ wave_id: waveId, reason: recovery.reason }),
    });
    markTodoReadyOrFail(state, todo, waveId);
    return;
  }

  if ((recovery.recovery_notes ?? []).some((note) => note.includes("retry_exhausted"))) {
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_recovery",
      action: "retry_exhausted",
      message: message({ wave_id: waveId, retry_count: todo.retry_count, reason: recovery.reason }),
    });
  }
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: todo.id,
    actor: "wave_recovery",
    action: "recovery_failed",
    message: message({ wave_id: waveId, reason: recovery.reason }),
  });
  safeMarkTodoFailed(state, todo, "todo_recovery_failed", recovery.reason, waveId);
}

function runModeGuard(todo: TodoItem, mode: "self" | "delegate" | "split") {
  if (todo.serial_only || todo.downgraded_from_wave) return "todo_downgraded_to_serial";
  if (mode === "split") return "split_mode_excluded_from_parallel_wave";
  if (todo.capability_type === "planning" || todo.capability_type === "review") {
    return "planning_review_todo_must_run_serial";
  }
  const text = `${todo.title} ${todo.description}`.toLowerCase();
  if (/rewrite todo|todo rewrite|split todo|todo management/.test(text)) {
    return "todo_management_task_must_run_serial";
  }
  if (isMixedTask(todo)) return "mixed_task_must_split_or_serial";
  if (isCapabilityUnclear(todo)) return "capability_unclear_for_parallel";
  return null;
}

export function selectParallelTodoWave(
  state: RunState,
  options: ParallelWaveOptions & { memoryState?: MemoryState } = {},
): ParallelWaveSelection {
  const maxParallel = Math.max(2, options.max_parallel_todos ?? 2);
  const candidates = state.todos
    .filter((todo) => todo.status === "ready")
    .sort((left, right) => {
      const priorityDiff = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return state.todos.findIndex((todo) => todo.id === left.id) - state.todos.findIndex((todo) => todo.id === right.id);
    });

  const eligible: WaveCandidate[] = [];
  const excluded: Array<{ todo_id: string; reason: string }> = [];
  for (const todo of candidates) {
    const decision = decideTodoExecutionMode(state, todo, options.memoryState);
    const guardReason = runModeGuard(todo, decision.mode);
    if (guardReason) {
      excluded.push({ todo_id: todo.id, reason: guardReason });
      continue;
    }
    eligible.push({
      todo,
      decision: {
        todo_id: todo.id,
        mode: decision.mode,
        reason: decision.reason,
        target_agent_id: decision.target_agent_id,
      },
    });
  }

  const selected: WaveCandidate[] = [];
  for (const candidate of eligible) {
    if (selected.length >= maxParallel) break;
    const hasConflict = selected.some((existing) =>
      hasDependencyConflict(existing.todo, candidate.todo) || hasOutputRefConflict(existing.todo, candidate.todo),
    );
    if (hasConflict) {
      excluded.push({ todo_id: candidate.todo.id, reason: "dependency_or_output_conflict_with_selected_wave_item" });
      continue;
    }
    selected.push(candidate);
  }

  const selectionSummary = [
    `ready_candidates=${candidates.length}`,
    `eligible_candidates=${eligible.length}`,
    `selected_wave_size=${selected.length}`,
    `max_parallel=${maxParallel}`,
  ];

  return {
    selected,
    excluded,
    selection_reason_summary: selectionSummary,
  };
}

import type { WaveContext, WavePeerInfo } from "./types";

/**
 * Build scope boundary descriptions for each wave candidate.
 * Extracts boundary from todo title + description + acceptance criteria.
 */
function buildScopeBoundary(todo: TodoItem): string {
  const criteria = todo.acceptance_criteria.slice(0, 3).join("; ");
  return `[${todo.title}] ${todo.description.slice(0, 120)}${criteria ? ` | Criteria: ${criteria}` : ""}`;
}

/**
 * Build wave contexts for all selected candidates so each agent knows:
 * - Who its peers are and what they're doing
 * - Its own scope boundary
 * - What scopes are excluded (handled by peers)
 */
function buildWaveContexts(
  waveId: string,
  candidates: WaveCandidate[],
): Map<string, WaveContext> {
  const peerInfos: Array<WavePeerInfo & { index: number }> = candidates.map((c, i) => ({
    index: i,
    todo_id: c.todo.id,
    todo_title: c.todo.title,
    agent_id: c.decision.target_agent_id ?? "supervisor",
    scope_boundary: buildScopeBoundary(c.todo),
  }));

  const contexts = new Map<string, WaveContext>();
  for (let i = 0; i < candidates.length; i++) {
    const self = peerInfos[i];
    const peers = peerInfos
      .filter((_, j) => j !== i)
      .map((info) => {
        const { index: ignoredIndex, ...rest } = info;
        void ignoredIndex;
        return rest;
      });
    const excludedScopes = peers.map(
      (p) => `${p.todo_title} (handled by ${p.agent_id})`,
    );

    contexts.set(candidates[i].todo.id, {
      wave_id: waveId,
      total_peers: candidates.length,
      peer_index: i,
      peers,
      my_scope_boundary: self.scope_boundary,
      excluded_scopes: excludedScopes,
    });
  }

  return contexts;
}

import { callLLMWithUsage } from "../llm-helper";
import { sanitizeJsonLikeText } from "../text-cleaner";

/**
 * Threshold: if output + summary combined length is short enough,
 * skip LLM summarization and return as-is to save tokens.
 */
// Only compress outputs that are large enough to justify an extra LLM call.
// 600 was too low: typical tool results (manifest JSON, download summaries) routinely
// exceed it, triggering unnecessary compression on every wave item.
const COMPRESSION_THRESHOLD = 2500;

/**
 * Use LLM to summarize a long agent output into a compact but lossless digest.
 * Falls back to head-truncation only if LLM call fails.
 */
async function llmSummarizeOutput(
  todoTitle: string,
  acceptanceCriteria: string[],
  fullOutput: string,
  fullSummary: string,
  criteriaEvidence: string[],
): Promise<{ summary: string; output: string; criteria_evidence: string[]; token_usage?: TodoExecutorResult["token_usage"] }> {
  const prompt = [
    "You are a result compression agent.",
    "Your job is to distill a sub-agent's full output into a concise but comprehensive digest for the supervisor.",
    "",
    "Rules:",
    "- Preserve ALL key findings, conclusions, data points, and evidence.",
    "- Remove redundancy, filler, and verbose explanations.",
    "- Keep the digest under 500 characters for summary, under 1500 characters for output.",
    "- Retain criteria evidence mapped to each criterion.",
    "- Do NOT drop information that would be needed to judge acceptance criteria.",
    "",
    `Todo: ${todoTitle}`,
    `Acceptance criteria: ${acceptanceCriteria.join("; ")}`,
    "",
    `Original summary: ${fullSummary}`,
    "",
    `Original output (may be long):`,
    fullOutput.slice(0, 8000),
    "",
    `Original criteria evidence: ${criteriaEvidence.join(" | ")}`,
    "",
    "Return ONLY valid JSON:",
    "{",
    '  "compressed_summary": "concise summary preserving key info",',
    '  "compressed_output": "distilled output preserving all key findings and evidence",',
    '  "compressed_evidence": ["evidence for criterion 1", "evidence for criterion 2"]',
    "}",
  ].join("\n");

  const llmResult = await callLLMWithUsage([
    { role: "system", content: "You are a strict JSON-only result compression agent." },
    { role: "user", content: prompt },
  ]);

  const clean = sanitizeJsonLikeText(llmResult.content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    // LLM returned non-JSON (truncated, think-block residue, etc.) — fall back to originals.
    return {
      summary: fullSummary,
      output: fullOutput,
      criteria_evidence: criteriaEvidence,
      token_usage: llmResult.usage,
    };
  }
  return {
    summary: typeof parsed.compressed_summary === "string" ? parsed.compressed_summary : fullSummary,
    output: typeof parsed.compressed_output === "string" ? parsed.compressed_output : fullOutput,
    criteria_evidence: Array.isArray(parsed.compressed_evidence)
      ? (parsed.compressed_evidence as unknown[]).filter((item): item is string => typeof item === "string")
      : criteriaEvidence,
    token_usage: llmResult.usage,
  };
}

/**
 * Compress agent output for supervisor consumption.
 * Uses LLM summarization for long outputs and propagates errors when compression fails.
 */
async function compressAgentOutput(
  result: TodoExecutorResult,
  todoTitle: string,
  acceptanceCriteria: string[],
): Promise<{ compressed: TodoExecutorResult; compressionTokenUsage?: TodoExecutorResult["token_usage"] }> {
  const rawOutput = result.output ?? "";
  const rawSummary = result.summary ?? "";
  const evidence = result.criteria_evidence ?? [];

  // Short outputs: pass through without LLM call
  if (rawOutput.length + rawSummary.length <= COMPRESSION_THRESHOLD) {
    return { compressed: result };
  }

  // Long outputs: use LLM summarization
  const compressed = await llmSummarizeOutput(
    todoTitle,
    acceptanceCriteria,
    rawOutput,
    rawSummary,
    evidence,
  );
  return {
    compressed: {
      ...result,
      summary: compressed.summary,
      output: compressed.output,
      criteria_evidence: compressed.criteria_evidence,
    },
    compressionTokenUsage: compressed.token_usage,
  };
}

async function executeWaveItem(
  state: RunState,
  waveId: string,
  item: WaveCandidate,
  executor: TodoExecutor,
  subagentRunner: SubagentRunner,
  waveContexts: Map<string, WaveContext>,
  memoryState?: MemoryState,
): Promise<WaveExecutionTaskResult> {
  const todo = assertTodoBoundAction(state, "wave_item_execute", item.todo.id);
  assertWaveBoundAction(state, "wave_item_execute", waveId, todo.id);
  const waveContext = waveContexts.get(todo.id);

  if (item.decision.mode === "self") {
    const context = buildTodoExecutionContext(state, todo, { memoryState });
    const rawResult = await executor(context, state, todo);
    const { compressed, compressionTokenUsage } = await compressAgentOutput(rawResult, todo.title, todo.acceptance_criteria);
    if (compressionTokenUsage) {
      accumulateTokenUsage(state, todo, "wave_compressor", "result_compression", compressionTokenUsage);
    }
    return {
      todo_id: todo.id,
      mode: "self",
      result: compressed,
    };
  }

  if (item.decision.mode === "delegate") {
    const targetAgentId = item.decision.target_agent_id;
    const agent = targetAgentId ? getSubagentById(targetAgentId) : undefined;
    if (!agent) {
      return {
        todo_id: todo.id,
        mode: "delegate",
        result: {
          status: "error",
          output: "",
          error_message: `Delegation target not found: ${targetAgentId ?? "unknown"}`,
        },
      };
    }
    if (todo.forced_target_agent_id === agent.id) {
      todo.forced_target_agent_id = undefined;
    }
    // On retry within wave, analyze previous failure for improvement directives
    let retryAnalysis: Awaited<ReturnType<typeof analyzeFailureForRetry>> | undefined;
    if ((todo.retry_count ?? 0) > 0) {
      retryAnalysis = await analyzeFailureForRetry(todo);
      accumulateTokenUsage(state, todo, "retry_analyzer", "failure_analysis", retryAnalysis.token_usage);
    }
    const brief = buildDelegationBrief(state, todo, agent, waveContext, retryAnalysis);
    const raw = await subagentRunner(agent, brief, { state, todo });
    const subResult = normalizeSubagentResult(raw);
    const fullResult: TodoExecutorResult = {
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
    const { compressed, compressionTokenUsage } = await compressAgentOutput(fullResult, todo.title, todo.acceptance_criteria);
    if (compressionTokenUsage) {
      accumulateTokenUsage(state, todo, "wave_compressor", "result_compression", compressionTokenUsage);
    }
    return {
      todo_id: todo.id,
      mode: "delegate",
      target_agent_id: agent.id,
      result: compressed,
    };
  }

  return {
    todo_id: todo.id,
    mode: "split",
    result: {
      status: "error",
      output: "",
      error_message: "split mode should not enter parallel execution",
    },
  };
}

export async function runParallelTodoWave(
  state: RunState,
  executor: TodoExecutor,
  options?: {
    parallel?: ParallelWaveOptions;
    subagentRunner?: SubagentRunner;
    recoveryPolicy?: RecoveryPolicyOptions;
    reviewFailRetryBudget?: number;
    memoryState?: MemoryState;
  },
): Promise<TodoStepResult | null> {
  const recoveryPolicy: RecoveryPolicyOptions = {
    ...(options?.recoveryPolicy ?? {}),
    ...(typeof options?.reviewFailRetryBudget === "number"
      ? { max_retry_per_todo: Math.max(0, options.reviewFailRetryBudget) }
      : {}),
  };
  const parallelOptions = options?.parallel ?? {};
  const enabled = parallelOptions.enabled ?? true;
  if (!enabled) return null;
  if (state.current_todo_id) return null;
  if (state.current_wave_id) return null;

  const selection = selectParallelTodoWave(state, {
    ...parallelOptions,
    memoryState: options?.memoryState,
  });
  const minParallel = Math.max(2, parallelOptions.min_parallel_todos ?? 2);
  if (selection.selected.length < minParallel) {
    return null;
  }

  const waveId = makeId("wave");
  const waveRecord: WaveRecord = {
    wave_id: waveId,
    todo_ids: selection.selected.map((item) => item.todo.id),
    created_at: nowIso(),
    selection_reason_summary: [
      ...selection.selection_reason_summary,
      ...selection.excluded.map((item) => `excluded:${item.todo_id}:${item.reason}`),
    ],
    execution_mode_per_todo: selection.selected.map((item) => ({ ...item.decision })),
    result_summary_per_todo: [],
    review_outcome_per_todo: [],
  };

  setCurrentTodo(state, null);
  addWaveRecord(state, waveRecord);
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: `wave:${waveId}`,
    actor: "wave_scheduler",
    action: "wave_created",
    message: message({
      wave_id: waveId,
      todo_ids: waveRecord.todo_ids,
      selection_reason_summary: waveRecord.selection_reason_summary,
    }),
  });

  const subagentRunner = options?.subagentRunner ?? runSubagentTodo;

  // Build wave contexts with scope boundaries for all parallel agents
  const waveContexts = buildWaveContexts(waveId, selection.selected);

  for (const item of selection.selected) {
    const todo = assertTodoBoundAction(state, "wave_item_mark_start", item.todo.id);
    assertWaveBoundAction(state, "wave_item_mark_start", waveId, todo.id);
    if (todo.status === "ready") {
      updateTodoStatus(state, todo.id, "in_progress");
    }
    if (item.decision.mode === "delegate") {
      todo.delegation_status = "delegated";
      markTodoAssignee(todo, item.decision.target_agent_id ?? "delegate_unknown");
    } else if (item.decision.mode === "self") {
      todo.delegation_status = "self";
      markTodoAssignee(todo, "supervisor");
    }

    // Persist wave context onto todo so retries can restore it
    const wc = waveContexts.get(todo.id);
    if (wc) {
      todo.wave_context_snapshot = {
        wave_id: wc.wave_id,
        total_peers: wc.total_peers,
        peer_index: wc.peer_index,
        my_scope_boundary: wc.my_scope_boundary,
        excluded_scopes: [...wc.excluded_scopes],
        peers: wc.peers.map((p) => ({ ...p })),
      };
    }
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_scheduler",
      action: "wave_item_started",
      message: message({
        wave_id: waveId,
        mode: item.decision.mode,
        target_agent_id: item.decision.target_agent_id ?? null,
        scope_boundary: wc?.my_scope_boundary ?? null,
        peer_count: wc?.total_peers ?? 0,
      }),
    });
  }

  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: `wave:${waveId}`,
    actor: "wave_scheduler",
    action: "wave_plan_finalized",
    message: message({
      wave_id: waveId,
      assignments: selection.selected.map((item) => ({
        todo_id: item.todo.id,
        agent_id: item.decision.target_agent_id ?? "supervisor",
        scope: waveContexts.get(item.todo.id)?.my_scope_boundary ?? "unscoped",
      })),
    }),
  });

  const settled = await Promise.allSettled(
    selection.selected.map((item) =>
      executeWaveItem(state, waveId, item, executor, subagentRunner, waveContexts, options?.memoryState),
    ),
  );

  const executionResults: WaveExecutionResultRecord[] = [];
  const reviewOutcomes: WaveReviewOutcomeRecord[] = [];
  for (let i = 0; i < selection.selected.length; i++) {
    const selectedItem = selection.selected[i];
    const settledItem = settled[i];
    const todo = assertTodoBoundAction(state, "wave_item_finalize", selectedItem.todo.id);
    assertWaveBoundAction(state, "wave_item_finalize", waveId, todo.id);

    let taskResult: WaveExecutionTaskResult;
    if (settledItem?.status === "fulfilled") {
      taskResult = settledItem.value;
    } else {
      const errorMessage = settledItem?.reason instanceof Error
        ? settledItem.reason.message
        : String(settledItem?.reason ?? "unknown wave execution error");
      taskResult = {
        todo_id: todo.id,
        mode: selectedItem.decision.mode,
        target_agent_id: selectedItem.decision.target_agent_id,
        result: {
          status: "error",
          output: "",
          error_message: errorMessage,
        },
      };
    }

    const result = taskResult.result;
    accumulateTokenUsage(
      state,
      todo,
      taskResult.target_agent_id ?? "supervisor",
      taskResult.mode,
      result.token_usage,
    );
    if (result.status === "success") {
      const producer = taskResult.mode === "delegate"
        ? (taskResult.target_agent_id ?? "delegate_unknown")
        : "supervisor";
      applyExecutorArtifacts(state, waveId, todo, producer, result);
      if (Array.isArray(result.notes) && result.notes.length > 0) {
        todo.notes.push(...result.notes);
      }
      if (Array.isArray(result.completion_notes) && result.completion_notes.length > 0) {
        todo.notes.push(...result.completion_notes);
      }
      if (todo.status === "in_progress") {
        updateTodoStatus(state, todo.id, "reviewing");
      }
    } else {
      todo.delegation_status = "failed";
      todo.last_failure_reason = result.error_message ?? "wave item execution failed";
      if (todo.status === "in_progress") {
        updateTodoStatus(state, todo.id, "reviewing");
      }
    }

    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_executor",
      action: "wave_item_completed",
      message: message({
        wave_id: waveId,
        status: result.status,
        mode: taskResult.mode,
        error_message: result.error_message ?? null,
      }),
    });

    let review: TodoReviewResult;
    if (result.status === "error") {
      review = {
        status: "fail",
        reason: result.error_message ?? "wave item execution failed",
        missing_criteria: [...todo.acceptance_criteria],
      };
    } else {
      try {
        assertTodoBoundAction(state, "wave_item_review", todo.id);
        assertWaveBoundAction(state, "wave_item_review", waveId, todo.id);
        const context = buildTodoExecutionContext(state, todo, { memoryState: options?.memoryState });
        review = await reviewTodoExecution(todo, result, context, {
          memoryState: options?.memoryState,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        review = {
          status: "fail",
          reason: errorMessage,
          missing_criteria: [...todo.acceptance_criteria],
        };
        todo.last_failure_reason = errorMessage;
      }
    }

    if (review.review_token_usage) {
      accumulateTokenUsage(state, todo, "wave_reviewer", "llm_review", review.review_token_usage);
    }

    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: todo.id,
      actor: "wave_reviewer",
      action: "wave_review_completed",
      message: message({
        wave_id: waveId,
        status: review.status,
        reason: review.reason,
        missing_criteria: review.missing_criteria,
      }),
    });

    todo.review_result = review.status;
    if (review.status === "pass") {
      updateTodoStatus(state, todo.id, "done");
    } else if (review.status === "split") {
      const split = splitTodoIntoSubTodos(state, todo, review.reason);
      for (const sub of split.subtodos) {
        addTodo(state, sub);
      }
      todo.notes.push(`split_reason: ${split.reason}`);
      updateTodoStatus(state, todo.id, "done");
    } else {
      const recovery = decideRecoveryAction(
        {
          state,
          todo,
          execution_result: result,
          review_result: review,
          execution_mode: taskResult.mode,
          delegated_agent_id: taskResult.target_agent_id,
          in_wave: true,
          wave_id: waveId,
        },
        recoveryPolicy,
        options?.memoryState,
      );
      applyWaveRecoveryDecision(state, waveId, todo, recovery, {
        review,
        delegatedAgentId: taskResult.target_agent_id,
      });
    }

    executionResults.push({
      todo_id: todo.id,
      status: result.status,
      summary: result.summary ?? result.output.slice(0, 180),
      error_message: result.error_message,
    });
    reviewOutcomes.push({
      todo_id: todo.id,
      status: review.status,
      reason: review.reason,
    });
  }

  updateWaveRecord(state, waveId, (wave) => {
    wave.result_summary_per_todo = executionResults.map((item) => ({ ...item }));
    wave.review_outcome_per_todo = reviewOutcomes.map((item) => ({ ...item }));
    wave.completed_at = nowIso();
  });
  state.parallel_execution_metadata = {
    ...state.parallel_execution_metadata,
    last_wave_id: waveId,
    last_wave_size: waveRecord.todo_ids.length,
    last_wave_completed_at: nowIso(),
    last_wave_success_count: executionResults.filter((item) => item.status === "success").length,
    last_wave_failure_count: executionResults.filter((item) => item.status === "error").length,
  };
  setCurrentWave(state, null);

  return {
    state,
    selected_todo_id: waveRecord.todo_ids[0] ?? null,
    selected_todo_ids: [...waveRecord.todo_ids],
    wave_id: waveId,
    wave_record: state.wave_history.find((item) => item.wave_id === waveId),
    wave_execution_modes: waveRecord.execution_mode_per_todo.map((item) => ({ ...item })),
    wave_execution_results: executionResults,
    wave_review_outcomes: reviewOutcomes,
    review: reviewOutcomes.length > 0
      ? {
        status: reviewOutcomes.some((item) => item.status === "fail") ? "fail"
          : reviewOutcomes.some((item) => item.status === "split") ? "split"
            : reviewOutcomes.some((item) => item.status === "revise") ? "revise"
              : "pass",
        reason: `wave:${waveId} completed (${reviewOutcomes.length} items)`,
        missing_criteria: [],
      }
      : undefined,
  };
}
