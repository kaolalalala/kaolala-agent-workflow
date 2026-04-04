import type { RunState, TodoPriority } from "../supervisor-runtime-state";

const PRIORITY_ORDER: Record<TodoPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function dependenciesSatisfied(state: RunState, todoId: string) {
  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo) return false;
  if (todo.depends_on.length === 0) return true;

  return todo.depends_on.every((depId) => {
    const depTodo = state.todos.find((item) => item.id === depId);
    return Boolean(depTodo && depTodo.status === "done");
  });
}

/**
 * Select next todo from `ready` queue.
 * Priority first, then stable order in state.todos.
 */
export function selectNextTodo(state: RunState): string | null {
  const readyTodos = state.todos.filter(
    (todo) => todo.status === "ready" && dependenciesSatisfied(state, todo.id),
  );

  if (readyTodos.length === 0) {
    return null;
  }

  readyTodos.sort((a, b) => {
    const p = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (p !== 0) return p;
    return state.todos.findIndex((todo) => todo.id === a.id) - state.todos.findIndex((todo) => todo.id === b.id);
  });

  return readyTodos[0]?.id ?? null;
}

