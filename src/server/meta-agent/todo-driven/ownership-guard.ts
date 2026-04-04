import { nowIso } from "@/lib/utils";
import {
  addExecutionLog,
  addIssue,
  type RunState,
  type TodoItem,
} from "../supervisor-runtime-state";

export class TodoOwnershipError extends Error {
  readonly action: string;
  readonly todoId?: string | null;

  constructor(action: string, todoId?: string | null, detail?: string) {
    super(
      `[TodoOwnershipGuard] action="${action}" requires a valid todo_id. ${
        detail ?? "missing or unknown todo_id"
      }`,
    );
    this.name = "TodoOwnershipError";
    this.action = action;
    this.todoId = todoId;
  }
}

function recordOwnershipIssue(state: RunState, action: string, todoId: string | null | undefined, message: string) {
  addIssue(state, {
    todo_id: todoId && todoId.trim().length > 0 ? todoId : "ownership_guard",
    type: "critical_ownership_guard",
    message,
    status: "open",
  });
  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: "ownership_guard",
    actor: "todo_guard",
    action: "ownership_guard_triggered",
    message: JSON.stringify({
      action,
      todo_id: todoId ?? null,
      reason: message,
    }),
  });
}

export function assertTodoBoundAction(
  state: RunState,
  action: string,
  todoId: string | null | undefined,
): TodoItem {
  if (!todoId || todoId.trim().length === 0) {
    const message = `Missing todo_id for action "${action}"`;
    recordOwnershipIssue(state, action, todoId, message);
    throw new TodoOwnershipError(action, todoId, message);
  }

  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo) {
    const message = `Unknown todo_id "${todoId}" for action "${action}"`;
    recordOwnershipIssue(state, action, todoId, message);
    throw new TodoOwnershipError(action, todoId, message);
  }
  return todo;
}

export function assertArtifactOwnership(
  state: RunState,
  action: string,
  relatedTodoId: string | null | undefined,
) {
  assertTodoBoundAction(state, action, relatedTodoId);
}

export function guardOwnedExecution<T>(
  state: RunState,
  action: string,
  todoId: string | null | undefined,
  fn: (todo: TodoItem) => Promise<T>,
) {
  const todo = assertTodoBoundAction(state, action, todoId);
  return fn(todo);
}

