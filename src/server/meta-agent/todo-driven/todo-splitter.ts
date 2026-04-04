import { makeId } from "@/lib/utils";
import type { RunState, TodoItem } from "../supervisor-runtime-state";

export interface TodoSplitResult {
  subtodos: TodoItem[];
  reason: string;
}

function deriveSplitChain(todo: TodoItem) {
  const prefix = todo.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const firstId = `${prefix}_sub_1_${makeId("s").slice(-4)}`;
  const secondId = `${prefix}_sub_2_${makeId("s").slice(-4)}`;
  const thirdId = `${prefix}_sub_3_${makeId("s").slice(-4)}`;

  const sub1: TodoItem = {
    ...todo,
    id: firstId,
    title: `${todo.title} - scope clarification`,
    description: `Clarify and narrow execution scope for: ${todo.description}`,
    capability_type: "planning",
    depends_on: [...todo.depends_on],
    // Planning step needs the same upstream context as the parent, but its own
    // input_refs are cleared — runtime resolves inputs from depends_on at execution time.
    input_refs: [],
    status: "todo",
    retry_count: 0,
    reroute_count: 0,
    delegation_status: "none",
    assignee: "supervisor",
    assignee_history: ["supervisor"],
    review_result: undefined,
    output_ref: undefined,
    recovery_history: [],
    last_failure_reason: undefined,
    last_missing_criteria: undefined,
    last_recovery_action: undefined,
    last_review_judgments: undefined,
    retry_improvement_directive: undefined,
    wave_context_snapshot: undefined,
    notes: ["generated_by_split"],
  };

  const sub2: TodoItem = {
    ...todo,
    id: secondId,
    title: `${todo.title} - focused execution`,
    description: `Execute the narrowed core part of todo: ${todo.description}`,
    capability_type: todo.capability_type,
    // sub2 depends on sub1; input artifact comes from sub1's output via depends_on.
    depends_on: [firstId],
    input_refs: [],
    status: "todo",
    retry_count: 0,
    reroute_count: 0,
    delegation_status: "none",
    assignee: "supervisor",
    assignee_history: ["supervisor"],
    review_result: undefined,
    output_ref: undefined,
    recovery_history: [],
    last_failure_reason: undefined,
    last_missing_criteria: undefined,
    last_recovery_action: undefined,
    last_review_judgments: undefined,
    retry_improvement_directive: undefined,
    wave_context_snapshot: undefined,
    notes: ["generated_by_split"],
  };

  const sub3: TodoItem = {
    ...todo,
    id: thirdId,
    title: `${todo.title} - validation`,
    description: "Validate final output against acceptance criteria and finalize.",
    capability_type: "review",
    depends_on: [secondId],
    input_refs: [],
    status: "todo",
    retry_count: 0,
    reroute_count: 0,
    delegation_status: "none",
    assignee: "supervisor",
    assignee_history: ["supervisor"],
    review_result: undefined,
    output_ref: undefined,
    recovery_history: [],
    last_failure_reason: undefined,
    last_missing_criteria: undefined,
    last_recovery_action: undefined,
    last_review_judgments: undefined,
    retry_improvement_directive: undefined,
    wave_context_snapshot: undefined,
    notes: ["generated_by_split"],
  };

  return [sub1, sub2, sub3];
}

/**
 * Minimal split strategy:
 * replace one oversized todo with a 3-step serial chain.
 */
export function splitTodoIntoSubTodos(state: RunState, todo: TodoItem, reason: string): TodoSplitResult {
  const subtodos = deriveSplitChain(todo);

  // Re-wire downstream dependencies that reference original todo.
  const tailSubtodo = subtodos[subtodos.length - 1];
  for (const item of state.todos) {
    if (item.id === todo.id) continue;
    if (!item.depends_on.includes(todo.id)) continue;
    item.depends_on = item.depends_on.map((dep) => (dep === todo.id ? tailSubtodo.id : dep));
  }

  return {
    subtodos,
    reason,
  };
}

