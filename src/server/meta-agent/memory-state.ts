import type { RunState, TodoCapabilityType, TodoItem } from "./supervisor-runtime-state";
import type { MetaAgentResult } from "./types";
import {
  clampConfidence,
  computeTextRelevance,
  nowIsoSafe,
  takeRecent,
  tokenizeForMemory,
  uniqueStrings,
} from "./long-term-state-utils";

export interface PlannerMemory {
  memory_id: string;
  source_run_id: string;
  goal_pattern: string;
  recommended_capability_flow: TodoCapabilityType[];
  suggested_acceptance_patterns: string[];
  risky_mixed_task_patterns: string[];
  notes: string[];
  confidence: number;
  usage_count: number;
  updated_at: string;
}

export interface RoutingMemory {
  memory_id: string;
  source_run_id: string;
  capability_type: TodoCapabilityType;
  preferred_mode: "self" | "delegate" | "split";
  preferred_agent_id?: string;
  avoid_agent_ids: string[];
  reason: string;
  confidence: number;
  usage_count: number;
  updated_at: string;
}

export interface ReviewMemory {
  memory_id: string;
  source_run_id: string;
  capability_type?: TodoCapabilityType;
  weak_criteria_patterns: string[];
  frequent_missing_criteria: string[];
  reason: string;
  confidence: number;
  usage_count: number;
  updated_at: string;
}

export interface RecoveryMemory {
  memory_id: string;
  source_run_id: string;
  capability_type?: TodoCapabilityType;
  preferred_action: "retry" | "reroute" | "split" | "downgrade_to_serial" | "fail";
  preferred_target_agent_id?: string;
  trigger_pattern: string;
  outcome: "helpful" | "ineffective";
  reason: string;
  confidence: number;
  usage_count: number;
  updated_at: string;
}

export interface MemoryState {
  project_id: string;
  planner_memories: PlannerMemory[];
  routing_memories: RoutingMemory[];
  review_memories: ReviewMemory[];
  recovery_memories: RecoveryMemory[];
  updated_at: string;
}

function isWeakCriterion(criterion: string) {
  const tokens = tokenizeForMemory(criterion);
  if (tokens.length <= 2) return true;
  return /clear|good|usable|reasonable|appropriate|better|high quality/i.test(criterion);
}

function successfulRoutingAgent(todo: TodoItem) {
  const history = todo.assignee_history ?? [];
  if (todo.capability_type === "planning" || todo.capability_type === "review") {
    return "supervisor";
  }
  const nonSupervisor = history.filter((item) => item !== "supervisor" && item !== "single_executor");
  return nonSupervisor[nonSupervisor.length - 1];
}

function buildPlannerMemoryCandidate(state: RunState, result: MetaAgentResult) {
  if (result.status !== "success" || Number(result.finalScore ?? 0) < 0.55) return null;

  return {
    memory_id: `planner:${state.run_id}`,
    source_run_id: state.run_id,
    goal_pattern: state.goal.slice(0, 220),
    recommended_capability_flow: state.todos.map((todo) => todo.capability_type),
    suggested_acceptance_patterns: uniqueStrings(
      state.todos.flatMap((todo) => todo.acceptance_criteria.slice(0, 2)),
    ).slice(0, 6),
    risky_mixed_task_patterns: uniqueStrings(
      state.todos
        .filter((todo) =>
          (todo.notes ?? []).some((note) => note.startsWith("split_reason:") || note.includes("multi capability")),
        )
        .map((todo) => todo.title),
    ),
    notes: [`successful_flow:${state.todos.map((todo) => todo.title).join(" -> ")}`],
    confidence: clampConfidence(Number(result.finalScore ?? 0.65), 0.65),
    usage_count: 0,
    updated_at: nowIsoSafe(),
  } satisfies PlannerMemory;
}

function buildRoutingMemoryCandidates(state: RunState) {
  return state.todos.map((todo) => {
    const preferredAgent = successfulRoutingAgent(todo);
    const preferredMode =
      todo.capability_type === "planning" || todo.capability_type === "review"
        ? "self"
        : todo.serial_only
          ? "split"
          : preferredAgent
            ? "delegate"
            : "self";
    const avoid = uniqueStrings((todo.assignee_history ?? []).filter((item) => item !== preferredAgent));
    return {
      memory_id: `routing:${state.run_id}:${todo.id}`,
      source_run_id: state.run_id,
      capability_type: todo.capability_type,
      preferred_mode: preferredMode,
      preferred_agent_id: preferredMode === "delegate" ? preferredAgent : undefined,
      avoid_agent_ids: preferredMode === "delegate" ? avoid.slice(0, 3) : [],
      reason:
        todo.review_result === "pass"
          ? `successful_${todo.capability_type}_routing`
          : `observed_${todo.capability_type}_routing`,
      confidence:
        todo.status === "done"
          ? 0.72
          : todo.status === "failed"
            ? 0.42
            : 0.55,
      usage_count: 0,
      updated_at: nowIsoSafe(),
    } satisfies RoutingMemory;
  });
}

function buildReviewMemoryCandidates(state: RunState) {
  return state.todos
    .filter((todo) => (todo.last_missing_criteria ?? []).length > 0 || todo.review_result === "revise" || todo.review_result === "fail")
    .map((todo) => ({
      memory_id: `review:${state.run_id}:${todo.id}`,
      source_run_id: state.run_id,
      capability_type: todo.capability_type,
      weak_criteria_patterns: uniqueStrings(
        todo.acceptance_criteria.filter((criterion) => isWeakCriterion(criterion)),
      ).slice(0, 4),
      frequent_missing_criteria: uniqueStrings(todo.last_missing_criteria ?? []).slice(0, 4),
      reason: todo.last_failure_reason ?? todo.notes.slice(-1)[0] ?? "review_gap_observed",
      confidence: todo.review_result === "fail" ? 0.7 : 0.58,
      usage_count: 0,
      updated_at: nowIsoSafe(),
    }));
}

function buildRecoveryMemoryCandidates(state: RunState) {
  return state.todos
    .filter((todo) => (todo.recovery_history?.length ?? 0) > 0)
    .map((todo) => {
      const last = todo.recovery_history?.[todo.recovery_history.length - 1];
      const outcome = todo.status === "done" ? "helpful" : "ineffective";
      return {
        memory_id: `recovery:${state.run_id}:${todo.id}`,
        source_run_id: state.run_id,
        capability_type: todo.capability_type,
        preferred_action: last?.action ?? todo.last_recovery_action ?? "fail",
        preferred_target_agent_id: last?.target_agent_id ?? todo.forced_target_agent_id,
        trigger_pattern: todo.last_failure_reason ?? todo.review_result ?? "recovery_trigger",
        outcome,
        reason: last?.reason ?? todo.last_failure_reason ?? "recovery_history_observed",
        confidence: outcome === "helpful" ? 0.7 : 0.45,
        usage_count: 0,
        updated_at: nowIsoSafe(),
      } satisfies RecoveryMemory;
    });
}

export function createMemoryState(projectId: string): MemoryState {
  return {
    project_id: projectId,
    planner_memories: [],
    routing_memories: [],
    review_memories: [],
    recovery_memories: [],
    updated_at: nowIsoSafe(),
  };
}

function mergeByKey<T extends { updated_at: string; confidence: number; usage_count: number }>(
  current: T[],
  incoming: T[],
  keyOf: (item: T) => string,
) {
  const next = [...current];
  for (const candidate of incoming) {
    const key = keyOf(candidate);
    const existing = next.find((item) => keyOf(item) === key);
    if (existing) {
      existing.confidence = clampConfidence((existing.confidence + candidate.confidence) / 2, existing.confidence);
      existing.updated_at = nowIsoSafe();
    } else {
      next.push(candidate);
    }
  }
  return next;
}

export function updateMemoryStateFromRun(
  current: MemoryState,
  state: RunState,
  result: MetaAgentResult,
): MemoryState {
  const next: MemoryState = {
    ...current,
    planner_memories: [...current.planner_memories],
    routing_memories: [...current.routing_memories],
    review_memories: [...current.review_memories],
    recovery_memories: [...current.recovery_memories],
    updated_at: nowIsoSafe(),
  };

  const planner = buildPlannerMemoryCandidate(state, result);
  if (planner) {
    next.planner_memories = mergeByKey(
      next.planner_memories,
      [planner],
      (item) => `${item.goal_pattern}|${item.recommended_capability_flow.join(">")}`,
    );
  }

  next.routing_memories = mergeByKey(
    next.routing_memories,
    buildRoutingMemoryCandidates(state),
    (item) => `${item.capability_type}|${item.preferred_mode}|${item.preferred_agent_id ?? "-"}`,
  );
  next.review_memories = mergeByKey(
    next.review_memories,
    buildReviewMemoryCandidates(state),
    (item) => `${item.capability_type ?? "-"}|${item.frequent_missing_criteria.join(">")}|${item.reason}`,
  );
  next.recovery_memories = mergeByKey(
    next.recovery_memories,
    buildRecoveryMemoryCandidates(state),
    (item) => `${item.capability_type ?? "-"}|${item.preferred_action}|${item.preferred_target_agent_id ?? "-"}|${item.trigger_pattern}`,
  );

  next.planner_memories = takeRecent(next.planner_memories, 20);
  next.routing_memories = takeRecent(next.routing_memories, 30);
  next.review_memories = takeRecent(next.review_memories, 24);
  next.recovery_memories = takeRecent(next.recovery_memories, 24);

  return next;
}

function rankByCapabilityAndGoal<T extends { confidence: number; usage_count: number; updated_at: string }>(
  items: T[],
  goal: string,
  candidateText: (item: T) => string,
  limit: number,
) {
  const ranked = items
    .map((item) => ({
      item,
      score: computeTextRelevance(goal, candidateText(item)) + item.confidence * 0.2,
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));

  for (const entry of ranked) {
    entry.item.usage_count += 1;
    entry.item.updated_at = nowIsoSafe();
  }

  return ranked.map((entry) => entry.item);
}

export function selectPlannerMemories(memoryState: MemoryState, goal: string, limit = 3) {
  return rankByCapabilityAndGoal(
    memoryState.planner_memories,
    goal,
    (item) =>
      `${item.goal_pattern} ${item.recommended_capability_flow.join(" ")} ${item.suggested_acceptance_patterns.join(" ")}`,
    limit,
  );
}

export function selectRoutingMemories(memoryState: MemoryState, todo: TodoItem, limit = 2) {
  const candidates = memoryState.routing_memories.filter((item) => item.capability_type === todo.capability_type);
  return rankByCapabilityAndGoal(
    candidates,
    `${todo.title} ${todo.description}`,
    (item) => `${item.capability_type} ${item.preferred_mode} ${item.preferred_agent_id ?? ""} ${item.reason}`,
    limit,
  );
}

export function selectReviewMemories(memoryState: MemoryState, todo: TodoItem, limit = 2) {
  const candidates = memoryState.review_memories.filter(
    (item) => !item.capability_type || item.capability_type === todo.capability_type,
  );
  return rankByCapabilityAndGoal(
    candidates,
    `${todo.title} ${todo.description} ${todo.acceptance_criteria.join(" ")}`,
    (item) => `${item.weak_criteria_patterns.join(" ")} ${item.frequent_missing_criteria.join(" ")} ${item.reason}`,
    limit,
  );
}

export function selectRecoveryMemories(memoryState: MemoryState, todo: TodoItem, limit = 2) {
  const candidates = memoryState.recovery_memories.filter(
    (item) => !item.capability_type || item.capability_type === todo.capability_type,
  );
  return rankByCapabilityAndGoal(
    candidates,
    `${todo.title} ${todo.description} ${todo.last_failure_reason ?? ""} ${todo.review_result ?? ""}`,
    (item) => `${item.trigger_pattern} ${item.preferred_action} ${item.preferred_target_agent_id ?? ""} ${item.reason}`,
    limit,
  );
}
