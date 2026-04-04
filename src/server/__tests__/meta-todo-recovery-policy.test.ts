import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { decideRecoveryAction } from "@/server/meta-agent/todo-driven/recovery-policy";

describe("todo recovery policy", () => {
  it("chooses retry for revise with limited missing criteria", () => {
    const state = createRunState("recovery retry");
    addTodo(state, {
      id: "todo_retry",
      title: "analyze report",
      description: "analyze and produce final notes",
      status: "reviewing",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["alpha", "beta", "gamma"],
      depends_on: [],
      retry_count: 0,
    });
    const todo = state.todos.find((item) => item.id === "todo_retry");
    if (!todo) throw new Error("todo_retry missing");

    const decision = decideRecoveryAction({
      state,
      todo,
      review_result: {
        status: "revise",
        reason: "missing one criterion",
        missing_criteria: ["gamma"],
      },
      execution_mode: "self",
      in_wave: false,
    });
    expect(decision.action).toBe("retry");
  });

  it("chooses reroute when delegated agent mismatches capability", () => {
    const state = createRunState("recovery reroute");
    addTodo(state, {
      id: "todo_reroute",
      title: "collect sources",
      description: "research references and evidence",
      status: "reviewing",
      capability_type: "research",
      priority: "high",
      assignee: "writer_agent",
      assignee_history: ["writer_agent"],
      acceptance_criteria: ["sources", "evidence"],
      depends_on: [],
    });
    const todo = state.todos.find((item) => item.id === "todo_reroute");
    if (!todo) throw new Error("todo_reroute missing");

    const decision = decideRecoveryAction(
      {
        state,
        todo,
        execution_mode: "delegate",
        delegated_agent_id: "writer_agent",
        review_result: {
          status: "fail",
          reason: "wrong agent focus",
          missing_criteria: ["sources", "evidence"],
        },
        in_wave: false,
      },
      { max_retry_per_todo: 1, max_reroute_per_todo: 2 },
    );
    expect(decision.action).toBe("reroute");
    expect(decision.target_agent_id).toBe("research_agent");
  });

  it("chooses downgrade_to_serial for wave failures before hard fail", () => {
    const state = createRunState("recovery downgrade");
    addTodo(state, {
      id: "todo_wave_fail",
      title: "research in wave",
      description: "collect wave data",
      status: "reviewing",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["a", "b"],
      depends_on: [],
      downgraded_from_wave: false,
    });
    const todo = state.todos.find((item) => item.id === "todo_wave_fail");
    if (!todo) throw new Error("todo_wave_fail missing");

    const decision = decideRecoveryAction({
      state,
      todo,
      execution_mode: "delegate",
      delegated_agent_id: "research_agent",
      execution_result: {
        status: "error",
        output: "",
        error_message: "timeout",
      },
      review_result: {
        status: "fail",
        reason: "timeout",
        missing_criteria: ["a", "b"],
      },
      in_wave: true,
      wave_id: "wave_1",
    });
    expect(decision.action).toBe("downgrade_to_serial");
  });

  it("prevents simple agent oscillation when rerouting", () => {
    const state = createRunState("recovery anti oscillation");
    addTodo(state, {
      id: "todo_oscillation",
      title: "collect sources",
      description: "research references and evidence",
      status: "reviewing",
      capability_type: "research",
      priority: "high",
      assignee: "writer_agent",
      assignee_history: ["research_agent", "writer_agent"],
      acceptance_criteria: ["sources", "evidence"],
      depends_on: [],
      retry_count: 0,
      reroute_count: 1,
    });
    const todo = state.todos.find((item) => item.id === "todo_oscillation");
    if (!todo) throw new Error("todo_oscillation missing");

    const decision = decideRecoveryAction(
      {
        state,
        todo,
        execution_mode: "delegate",
        delegated_agent_id: "writer_agent",
        review_result: {
          status: "fail",
          reason: "still wrong",
          missing_criteria: ["sources", "evidence"],
        },
        in_wave: false,
      },
      { max_retry_per_todo: 0, max_reroute_per_todo: 2 },
    );
    expect(decision.action).toBe("fail");
  });
});

