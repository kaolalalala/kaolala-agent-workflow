import { afterEach, describe, expect, it, vi } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import type { TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("todo-driven review error consistency", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("review exception does not leave current todo stuck in reviewing", async () => {
    vi.doMock("@/server/meta-agent/todo-driven/review", () => ({
      reviewTodoExecution: () => {
        throw new Error("review crashed");
      },
    }));

    const { runTodoDrivenStep } = await import("@/server/meta-agent/todo-driven/loop");
    const state = createRunState("review-crash-case");
    addTodo(state, {
      id: "todo_review_crash",
      title: "review crash todo",
      description: "test review exception path",
      status: "ready",
      acceptance_criteria: ["criterion_a"],
      depends_on: [],
    });

    const executor: TodoExecutor = async () => ({
      status: "success",
      output: "criterion_a",
      criteria_evidence: ["criterion_a"],
    });

    const step = await runTodoDrivenStep(state, executor);
    expect(step.review?.status).toBe("fail");

    const todo = state.todos.find((item) => item.id === "todo_review_crash");
    expect(todo?.status).toBe("ready");
    expect(todo?.delegation_status).toBe("none");
    expect(state.current_todo_id).toBeNull();
    expect(state.execution_log.some((log) => log.action === "review_exception")).toBe(true);
    expect(state.execution_log.some((log) => log.action === "recovery_decided")).toBe(true);
    expect(state.execution_log.some((log) => log.action === "retry_started" || log.action === "reroute_started")).toBe(true);
  });
});
