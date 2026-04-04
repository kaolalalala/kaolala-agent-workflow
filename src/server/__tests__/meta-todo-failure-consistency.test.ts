import { describe, expect, it } from "vitest";

import { addArtifact, addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import type { TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("todo-driven failure consistency", () => {
  it("subagent executor error keeps state consistent and delegation_status not stuck", async () => {
    const state = createRunState("subagent-failure");
    addTodo(state, {
      id: "todo_research",
      title: "Research sources",
      description: "Collect source materials.",
      status: "ready",
      capability_type: "research",
      acceptance_criteria: ["criteria_a", "criteria_b"],
      depends_on: [],
    });

    const selfExecutor: TodoExecutor = async () => ({
      status: "error",
      output: "",
      error_message: "self path should not be used",
    });

    const output = await runTodoDrivenStep(state, selfExecutor, {
      subagentRunner: async () => {
        throw new Error("subagent exploded");
      },
    });

    const todo = state.todos.find((item) => item.id === "todo_research");
    expect(output.review?.status).toBe("fail");
    expect(todo?.status).toBe("ready");
    expect(todo?.delegation_status).toBe("none");
    expect(state.current_todo_id).toBeNull();

    const actions = state.execution_log.map((log) => log.action);
    expect(actions).toContain("delegate");
    expect(actions).toContain("subagent_return");
    expect(actions).toContain("review_fail");
    expect(actions).toContain("recovery_decided");
    expect(actions.some((action) => action === "reroute_started" || action === "retry_started")).toBe(true);
  });

  it("orchestrator resume continues from existing state without re-planning or re-running done todos", async () => {
    const state = createRunState("resume-case");
    const doneTodo = addTodo(state, {
      id: "todo_done",
      title: "already done",
      description: "done step",
      status: "done",
      acceptance_criteria: ["x"],
      notes: ["done-note"],
      assignee_history: ["supervisor", "writer_agent"],
      review_result: "pass",
    });
    addArtifact(state, {
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\resume_existing.md",
      type: "note",
      producer: "writer_agent",
      related_todo: doneTodo.id,
      summary: "existing artifact",
    });
    addTodo(state, {
      id: "todo_ready",
      title: "remaining",
      description: "pending step",
      status: "ready",
      acceptance_criteria: ["remaining_ok"],
      depends_on: [],
    });

    const executed: string[] = [];
    const output = await runTodoDrivenOrchestrator(
      { goal: "resume-case", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 3,
        stepExecutor: async (_context, _state, todo) => {
          executed.push(todo.id);
          return {
            status: "success",
            output: "remaining_ok",
            criteria_evidence: ["remaining_ok"],
            artifact: {
              path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\resume_new.md",
              type: "note",
              summary: "new artifact",
            },
          };
        },
      },
    );

    expect(executed).toEqual(["todo_ready"]);
    expect(output.result.status).toBe("success");
    expect(output.state.execution_log.some((entry) => entry.action === "plan_initial_todos")).toBe(false);
    expect(output.state.artifacts.some((item) => item.path.includes("resume_existing.md"))).toBe(true);

    const resumedDoneTodo = output.state.todos.find((todo) => todo.id === "todo_done");
    expect(resumedDoneTodo?.review_result).toBe("pass");
    expect(resumedDoneTodo?.assignee_history).toContain("writer_agent");
  });
});
