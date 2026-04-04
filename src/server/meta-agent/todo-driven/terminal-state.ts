import { nowIso } from "@/lib/utils";
import {
  addExecutionLog,
  addIssue,
  type RunState,
  type RunStatus,
  type TodoItem,
} from "../supervisor-runtime-state";

export interface RunTerminalRuntimeContext {
  step: number;
  maxSteps: number;
  idleCount: number;
  idleStepLimit: number;
  maxStepsReached?: boolean;
}

export interface RunTerminalDecision {
  runStatus: RunStatus;
  shouldTerminate: boolean;
  resultStatus?: "success" | "failed" | "max_iterations_reached";
  terminationReason: string;
  issueType?: string;
}

interface TodoStatusStats {
  done: number;
  pruned: number;
  ready: number;
  todo: number;
  in_progress: number;
  reviewing: number;
  blocked: number;
  failed: number;
}

function statsFromTodos(todos: TodoItem[]): TodoStatusStats {
  return todos.reduce<TodoStatusStats>(
    (acc, todo) => {
      acc[todo.status] += 1;
      return acc;
    },
    {
      done: 0,
      pruned: 0,
      ready: 0,
      todo: 0,
      in_progress: 0,
      reviewing: 0,
      blocked: 0,
      failed: 0,
    },
  );
}

function hasOpenCriticalIssue(state: RunState) {
  return state.issues.some((issue) => {
    if (issue.status !== "open") return false;
    return /(critical|unrecoverable|ownership_guard|legacy_guard|review_error|executor_error)/i.test(issue.type);
  });
}

function normalizeCurrentTodoPointer(state: RunState) {
  if (!state.current_todo_id) return;
  const current = state.todos.find((todo) => todo.id === state.current_todo_id);
  if (!current) {
    state.current_todo_id = null;
    return;
  }
  if (current.status === "done" || current.status === "failed" || current.status === "blocked" || current.status === "pruned") {
    state.current_todo_id = null;
  }
}

function upsertTerminationMetadata(state: RunState, decision: RunTerminalDecision, context: RunTerminalRuntimeContext) {
  state.metadata = {
    ...state.metadata,
    termination: {
      run_status: decision.runStatus,
      result_status: decision.resultStatus ?? null,
      reason: decision.terminationReason,
      issue_type: decision.issueType ?? null,
      step: context.step,
      max_steps: context.maxSteps,
      idle_count: context.idleCount,
      idle_step_limit: context.idleStepLimit,
      determined_at: nowIso(),
    },
  };
}

export function determineRunTerminalState(
  state: RunState,
  context: RunTerminalRuntimeContext,
): RunTerminalDecision {
  normalizeCurrentTodoPointer(state);
  const stats = statsFromTodos(state.todos);
  const hasTodos = state.todos.length > 0;
  const hasActionable = stats.ready > 0 || stats.in_progress > 0 || stats.reviewing > 0;
  const hasWaiting = stats.todo > 0 || stats.blocked > 0;
  const terminalTodoCount = stats.done + stats.pruned;
  const allDone = hasTodos && terminalTodoCount === state.todos.length;
  const currentTodoExists = Boolean(state.current_todo_id);
  const criticalIssue = hasOpenCriticalIssue(state);

  if (allDone && !currentTodoExists && !hasActionable) {
    return {
      runStatus: "completed",
      shouldTerminate: true,
      resultStatus: "success",
      terminationReason: "all_todos_done_and_no_pending_pointer",
    };
  }

  if (context.maxStepsReached) {
    const runStatus: RunStatus =
      hasActionable ? "running"
        : hasWaiting ? "blocked"
          : criticalIssue || stats.failed > 0 ? "failed"
            : "idle";
    return {
      runStatus,
      shouldTerminate: true,
      resultStatus: "max_iterations_reached",
      terminationReason: "max_step_limit_reached_before_terminal_state",
      issueType: "max_steps_reached",
    };
  }

  if (criticalIssue && !hasActionable) {
    return {
      runStatus: "failed",
      shouldTerminate: true,
      resultStatus: "failed",
      terminationReason: "critical_open_issue_and_no_actionable_todos",
      issueType: "critical_failure",
    };
  }

  if (!hasActionable && stats.failed > 0) {
    // Check whether every failed todo has been covered by a successful replan.
    // applyReplanDecision writes replan_recovery_map: { [failedTodoId]: [replanTodoId, ...] }
    // A failed todo is considered resolved when at least one of its mapped replan todos is "done".
    const recoveryMap = (state.metadata.replan_recovery_map ?? {}) as Record<string, string[]>;
    const failedTodos = state.todos.filter((t) => t.status === "failed");
    const allFailedResolved = failedTodos.length > 0 && failedTodos.every((failed) => {
      const replanIds = recoveryMap[failed.id] ?? [];
      return replanIds.length > 0 &&
        replanIds.some((rid) => state.todos.find((t) => t.id === rid)?.status === "done");
    });

    if (allFailedResolved) {
      return {
        runStatus: "completed",
        shouldTerminate: true,
        resultStatus: "success",
        terminationReason: "all_failed_todos_resolved_by_replan",
      };
    }

    return {
      runStatus: "failed",
      shouldTerminate: true,
      resultStatus: "failed",
      terminationReason: "failed_todos_present_without_recoverable_path",
      issueType: "run_failed_no_recovery",
    };
  }

  if (!hasActionable && hasWaiting) {
    if (context.idleCount < context.idleStepLimit) {
      return {
        runStatus: "idle",
        shouldTerminate: false,
        terminationReason: "waiting_backlog_but_idle_limit_not_reached",
      };
    }
    return {
      runStatus: "blocked",
      shouldTerminate: true,
      resultStatus: "failed",
      terminationReason: "no_ready_or_running_todo_with_waiting_backlog",
      issueType: "run_blocked",
    };
  }

  if (!hasActionable) {
    return {
      runStatus: hasTodos ? "idle" : "pending",
      shouldTerminate: false,
      terminationReason: hasTodos ? "transient_idle_no_action_in_this_step" : "no_todos_planned_yet",
    };
  }

  return {
    runStatus: "running",
    shouldTerminate: false,
    terminationReason: "actionable_todos_available",
  };
}

export function applyRunTerminalDecision(
  state: RunState,
  decision: RunTerminalDecision,
  context: RunTerminalRuntimeContext,
) {
  state.status = decision.runStatus;
  upsertTerminationMetadata(state, decision, context);
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: "run_terminal",
    actor: "orchestrator",
    action: "terminal_state_determined",
    message: JSON.stringify({
      run_status: decision.runStatus,
      result_status: decision.resultStatus ?? null,
      should_terminate: decision.shouldTerminate,
      reason: decision.terminationReason,
      issue_type: decision.issueType ?? null,
      step: context.step,
      max_steps_reached: Boolean(context.maxStepsReached),
    }),
  });

  if (decision.issueType) {
    addIssue(state, {
      todo_id: "run_terminal",
      type: decision.issueType,
      message: decision.terminationReason,
      status: "open",
    });
  }
}
