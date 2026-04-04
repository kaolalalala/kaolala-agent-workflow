import type { RunState, TodoItem } from "../supervisor-runtime-state";
import type { MemoryState } from "../memory-state";
import { selectRecoveryMemories } from "../memory-state";
import type {
  RecoveryDecision,
  RecoveryPolicyOptions,
  TodoExecutorResult,
  TodoReviewResult,
} from "./types";

interface RecoveryInput {
  state: RunState;
  todo: TodoItem;
  execution_result?: TodoExecutorResult;
  review_result?: TodoReviewResult;
  delegated_agent_id?: string;
  execution_mode?: "self" | "delegate" | "split";
  in_wave?: boolean;
  wave_id?: string | null;
}

const DEFAULT_POLICY: Required<RecoveryPolicyOptions> = {
  max_retry_per_todo: 2,
  max_reroute_per_todo: 2,
  max_recovery_history_per_todo: 8,
};

function mergedPolicy(options?: RecoveryPolicyOptions) {
  return {
    max_retry_per_todo: Math.max(0, options?.max_retry_per_todo ?? DEFAULT_POLICY.max_retry_per_todo),
    max_reroute_per_todo: Math.max(0, options?.max_reroute_per_todo ?? DEFAULT_POLICY.max_reroute_per_todo),
    max_recovery_history_per_todo: Math.max(
      1,
      options?.max_recovery_history_per_todo ?? DEFAULT_POLICY.max_recovery_history_per_todo,
    ),
  };
}

function preferredAgents(todo: TodoItem) {
  if (todo.capability_type === "research") return ["research_agent", "analyst_agent"];
  if (todo.capability_type === "collection") return ["collector_agent", "research_agent"];
  if (todo.capability_type === "writing") return ["writer_agent", "analyst_agent"];
  if (todo.capability_type === "analysis") return ["analyst_agent", "research_agent"];
  if (todo.capability_type === "planning") return ["planner_agent", "analyst_agent"];
  if (todo.capability_type === "review") return ["reviewer_agent", "analyst_agent"];
  if (todo.capability_type === "verification") return ["verification_agent", "reviewer_agent"];
  if (todo.capability_type === "merge") return ["merge_agent", "analyst_agent"];
  if (todo.capability_type === "browser_ops") return ["browser_operator_agent", "analyst_agent"];
  if (todo.capability_type === "terminal_ops") return ["terminal_operator_agent", "analyst_agent"];
  return ["analyst_agent"] as string[];
}

function isDelegatedAgentMismatch(todo: TodoItem, currentAgent: string) {
  if (!currentAgent || currentAgent === "supervisor") return false;
  return !preferredAgents(todo).includes(currentAgent);
}

function canRetry(todo: TodoItem, policy: ReturnType<typeof mergedPolicy>) {
  return (todo.retry_count ?? 0) < policy.max_retry_per_todo;
}

function canReroute(todo: TodoItem, policy: ReturnType<typeof mergedPolicy>) {
  return (todo.reroute_count ?? 0) < policy.max_reroute_per_todo;
}

function wouldOscillate(todo: TodoItem, currentAgent: string, candidate: string) {
  const history = todo.assignee_history ?? [];
  if (history.length < 2) return false;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  return last === currentAgent && prev === candidate;
}

function pickRerouteTarget(todo: TodoItem, currentAgent: string, policy: ReturnType<typeof mergedPolicy>) {
  if (!canReroute(todo, policy)) return null;
  const candidates = preferredAgents(todo);
  if (candidates.length === 0) return null;

  const history = todo.assignee_history ?? [];
  if (history.length >= 2 && wouldOscillate(todo, currentAgent, candidates[0] ?? "")) {
    return null;
  }
  const attemptCount = (agentId: string) => history.filter((item) => item === agentId).length;

  for (const candidate of candidates) {
    if (candidate === currentAgent) continue;
    if (attemptCount(candidate) >= 2) continue;
    if (wouldOscillate(todo, currentAgent, candidate)) continue;
    return candidate;
  }
  return null;
}

function hasCriticalExecutorError(input: RecoveryInput) {
  return input.execution_result?.status === "error";
}

function isDeterministicPaperDownloadTodo(todo: TodoItem) {
  return (todo.extra_tools ?? []).includes("tool_arxiv_search_download_batch") ||
    (todo.notes ?? []).some((note) => note.startsWith("planner_parallel_batch:"));
}

function shouldStayWithDeterministicVerifier(todo: TodoItem, currentAgent: string) {
  return todo.capability_type === "verification" && currentAgent === "verification_agent";
}

function retryExhaustedReason(todo: TodoItem, policy: ReturnType<typeof mergedPolicy>) {
  return `retry budget exhausted (${todo.retry_count ?? 0}/${policy.max_retry_per_todo})`;
}

function rerouteExhaustedReason(todo: TodoItem, policy: ReturnType<typeof mergedPolicy>) {
  return `reroute budget exhausted (${todo.reroute_count ?? 0}/${policy.max_reroute_per_todo})`;
}

function pickMemoryRecovery(
  todo: TodoItem,
  memoryState: MemoryState | undefined,
  allowedTargetAgent: string | null,
  inWave: boolean,
  policy: ReturnType<typeof mergedPolicy>,
) {
  if (!memoryState) return null;
  const memory = selectRecoveryMemories(memoryState, todo, 2).find(
    (item) => item.confidence >= 0.55 && item.outcome === "helpful",
  );
  if (!memory) return null;

  if (memory.preferred_action === "retry" && canRetry(todo, policy)) {
    return {
      action: "retry" as const,
      reason: `Project recovery memory recommends retry: ${memory.reason}`,
      recovery_notes: ["memory_guided_retry"],
    };
  }
  if (memory.preferred_action === "reroute" && allowedTargetAgent) {
    return {
      action: "reroute" as const,
      target_agent_id: memory.preferred_target_agent_id ?? allowedTargetAgent,
      reason: `Project recovery memory recommends reroute: ${memory.reason}`,
      recovery_notes: ["memory_guided_reroute"],
    };
  }
  if (memory.preferred_action === "downgrade_to_serial" && inWave && !todo.downgraded_from_wave) {
    return {
      action: "downgrade_to_serial" as const,
      reason: `Project recovery memory recommends serial recovery: ${memory.reason}`,
      recovery_notes: ["memory_guided_downgrade"],
    };
  }
  return null;
}

export function decideRecoveryAction(
  input: RecoveryInput,
  options?: RecoveryPolicyOptions,
  memoryState?: MemoryState,
): RecoveryDecision {
  const policy = mergedPolicy(options);
  const todo = input.todo;
  const review = input.review_result;
  const currentAgent = input.delegated_agent_id ?? todo.assignee ?? "supervisor";
  const inWave = Boolean(input.in_wave);
  const history = todo.recovery_history ?? [];

  if (history.length >= policy.max_recovery_history_per_todo) {
    return {
      action: "fail",
      reason: `recovery history budget exhausted (${history.length}/${policy.max_recovery_history_per_todo})`,
      recovery_notes: ["recovery_failed:history_budget_exhausted"],
    };
  }

  if (review?.status === "split") {
    return {
      action: "split",
      reason: review.reason || "review requested split",
      recovery_notes: ["review_result=split"],
    };
  }

  const rerouteTarget = pickRerouteTarget(todo, currentAgent, policy);
  const memoryRecovery = pickMemoryRecovery(todo, memoryState, rerouteTarget, inWave, policy);

  if (hasCriticalExecutorError(input)) {
    if (memoryRecovery) {
      return memoryRecovery;
    }
    if (inWave && !todo.downgraded_from_wave) {
      return {
        action: "downgrade_to_serial",
        reason: "wave item executor failed; downgrade this todo to serial recovery path",
        recovery_notes: ["wave_failure_isolated"],
      };
    }
    if (isDeterministicPaperDownloadTodo(todo) && canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "deterministic paper-download batch should retry in place before rerouting",
        recovery_notes: ["structured_download_retry"],
      };
    }
    if (input.execution_mode === "delegate" && rerouteTarget) {
      return {
        action: "reroute",
        target_agent_id: rerouteTarget,
        reason: `delegated execution failed on ${currentAgent}; reroute to ${rerouteTarget}`,
        recovery_notes: ["delegate_failed_reroute"],
      };
    }
    if (canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "executor error appears recoverable; retry with failure feedback",
        recovery_notes: ["executor_error_retry"],
      };
    }
    return {
      action: "fail",
      reason: retryExhaustedReason(todo, policy),
      recovery_notes: ["retry_exhausted"],
    };
  }

  if (review?.status === "revise") {
    const missingCount = review.missing_criteria.length;
    const totalCriteria = Math.max(1, todo.acceptance_criteria.length);
    const missingRatio = missingCount / totalCriteria;

    if (memoryRecovery) {
      return memoryRecovery;
    }

    if (isDeterministicPaperDownloadTodo(todo) && canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "structured paper-download batch should retry with the same deterministic executor",
        recovery_notes: ["structured_download_retry"],
      };
    }

    if (shouldStayWithDeterministicVerifier(todo, currentAgent) && canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "deterministic verification should retry in place before rerouting to a qualitative reviewer",
        recovery_notes: ["deterministic_verification_retry"],
      };
    }

    if (missingRatio <= 0.5 && canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: `partial criteria miss (${missingCount}/${totalCriteria}); retry with focused feedback`,
        recovery_notes: ["review_revise_retry"],
      };
    }

    if (input.execution_mode === "delegate" && rerouteTarget) {
      return {
        action: "reroute",
        target_agent_id: rerouteTarget,
        reason: `current delegate ${currentAgent} did not converge; reroute to ${rerouteTarget}`,
        recovery_notes: ["review_revise_reroute"],
      };
    }

    if (inWave && !todo.downgraded_from_wave) {
      return {
        action: "downgrade_to_serial",
        reason: "wave revise instability detected; continue recovery in serial mode",
        recovery_notes: ["wave_revise_downgrade"],
      };
    }

    if (canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "revise requires one more attempt before failing",
        recovery_notes: ["review_revise_retry_fallback"],
      };
    }

    if (!canReroute(todo, policy)) {
      return {
        action: "fail",
        reason: rerouteExhaustedReason(todo, policy),
        recovery_notes: ["reroute_exhausted"],
      };
    }
    return {
      action: "fail",
      reason: retryExhaustedReason(todo, policy),
      recovery_notes: ["retry_exhausted"],
    };
  }

  if (review?.status === "fail") {
    if (memoryRecovery) {
      return memoryRecovery;
    }
    if (isDeterministicPaperDownloadTodo(todo) && canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "structured paper-download batch should retry before rerouting specialists",
        recovery_notes: ["structured_download_retry"],
      };
    }
    if (shouldStayWithDeterministicVerifier(todo, currentAgent) && canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "deterministic verification should retry before rerouting to a different specialist",
        recovery_notes: ["deterministic_verification_retry"],
      };
    }
    if (input.execution_mode === "delegate" && rerouteTarget && isDelegatedAgentMismatch(todo, currentAgent)) {
      return {
        action: "reroute",
        target_agent_id: rerouteTarget,
        reason: `review fail indicates possible agent mismatch; reroute from ${currentAgent} to ${rerouteTarget}`,
        recovery_notes: ["review_fail_reroute"],
      };
    }
    if (canRetry(todo, policy)) {
      return {
        action: "retry",
        reason: "review fail still has retry budget",
        recovery_notes: ["review_fail_retry"],
      };
    }
    if (input.execution_mode === "delegate" && rerouteTarget) {
      return {
        action: "reroute",
        target_agent_id: rerouteTarget,
        reason: `review fail indicates possible agent mismatch; reroute from ${currentAgent} to ${rerouteTarget}`,
        recovery_notes: ["review_fail_reroute"],
      };
    }
    if (inWave && !todo.downgraded_from_wave) {
      return {
        action: "downgrade_to_serial",
        reason: "wave review fail; downgrade todo to serial for safer recovery",
        recovery_notes: ["wave_review_fail_downgrade"],
      };
    }
    return {
      action: "fail",
      reason: retryExhaustedReason(todo, policy),
      recovery_notes: ["retry_exhausted"],
    };
  }

  return {
    action: "fail",
    reason: "no_recovery_rule_matched",
    recovery_notes: ["recovery_failed:unmatched"],
  };
}
