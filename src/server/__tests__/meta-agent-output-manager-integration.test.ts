import { describe, expect, it } from "vitest";

import { createRunState, addTodo } from "@/server/meta-agent/supervisor-runtime-state";
import { singleLlmTodoExecutor } from "@/server/meta-agent/todo-driven/executor";

describe("meta-agent output path integration", () => {
  it("returns artifact paths under the unified .output/v0_2 root", async () => {
    const state = createRunState("Write a short summary");
    const todo = addTodo(state, {
      id: "todo_write",
      title: "Write summary",
      description: "Write one short summary paragraph",
      priority: "high",
      capability_type: "writing",
      assignee: "single_executor",
      depends_on: [],
      acceptance_criteria: ["Has one paragraph", "Readable"],
      input_refs: [],
    });

    const result = await singleLlmTodoExecutor(
      {
        goal: state.goal,
        run_id: state.run_id,
        current_todo: {
          id: todo.id,
          title: todo.title,
          description: todo.description,
          acceptance_criteria: todo.acceptance_criteria,
        },
        input_artifacts: [],
        history_summary: {
          completed_todos: [],
          recent_logs: [],
          open_issues: [],
        },
      },
      state,
      todo,
    );

    expect(result.artifact?.path).toContain(".output\\v0_2");
    expect(result.artifact?.path).toContain(state.run_id);
    expect(result.artifact?.path).toContain(todo.id);
  });
});
