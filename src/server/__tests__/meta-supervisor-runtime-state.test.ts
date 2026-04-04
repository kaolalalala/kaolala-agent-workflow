import { describe, expect, it } from "vitest";

import {
  addTodo,
  canEnterInProgress,
  createRunState,
  updateTodoStatus,
} from "@/server/meta-agent/supervisor-runtime-state";

describe("meta supervisor runtime state", () => {
  it("auto marks dependent todos as ready when dependencies are done", () => {
    const state = createRunState("test goal");
    const todoA = addTodo(state, {
      id: "todo_a",
      title: "A",
      description: "first",
    });
    const todoB = addTodo(state, {
      id: "todo_b",
      title: "B",
      description: "second",
      depends_on: ["todo_a"],
    });

    expect(todoA.status).toBe("ready");
    expect(todoB.status).toBe("todo");

    updateTodoStatus(state, "todo_a", "in_progress");
    updateTodoStatus(state, "todo_a", "reviewing");
    updateTodoStatus(state, "todo_a", "done");

    const refreshedB = state.todos.find((todo) => todo.id === "todo_b");
    expect(refreshedB?.status).toBe("ready");
  });

  it("blocks entering in_progress when dependencies are incomplete", () => {
    const state = createRunState("test goal");
    addTodo(state, {
      id: "todo_a",
      title: "A",
      description: "first",
    });
    addTodo(state, {
      id: "todo_b",
      title: "B",
      description: "second",
      depends_on: ["todo_a"],
      status: "ready",
    });

    const depCheck = canEnterInProgress(state, "todo_b");
    expect(depCheck.allowed).toBe(false);
    expect(depCheck.missingDependencies).toContain("todo_a");

    expect(() => updateTodoStatus(state, "todo_b", "in_progress")).toThrow(
      /Dependencies are not completed|Illegal transition/,
    );
  });

  it("rejects invalid status jump from done to in_progress", () => {
    const state = createRunState("test goal");
    addTodo(state, {
      id: "todo_a",
      title: "A",
      description: "first",
    });

    updateTodoStatus(state, "todo_a", "in_progress");
    updateTodoStatus(state, "todo_a", "reviewing");
    updateTodoStatus(state, "todo_a", "done");

    expect(() => updateTodoStatus(state, "todo_a", "in_progress")).toThrow(
      /Illegal transition|cannot go back/,
    );
  });
});
