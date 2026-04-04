import { describe, expect, it } from "vitest";

import { addIssue, addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { determineRunTerminalState } from "@/server/meta-agent/todo-driven/terminal-state";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";

describe("todo-driven terminal semantics", () => {
  it("all todos done => completed", () => {
    const state = createRunState("completed-case");
    addTodo(state, {
      id: "todo_done",
      title: "done",
      description: "done todo",
      status: "done",
      acceptance_criteria: ["x"],
    });

    const decision = determineRunTerminalState(state, {
      step: 1,
      maxSteps: 5,
      idleCount: 0,
      idleStepLimit: 2,
    });
    expect(decision.runStatus).toBe("completed");
    expect(decision.shouldTerminate).toBe(true);
    expect(decision.resultStatus).toBe("success");
  });

  it("critical failure with no actionable path => failed", () => {
    const state = createRunState("failed-case");
    addTodo(state, {
      id: "todo_failed",
      title: "failed",
      description: "failed todo",
      status: "failed",
      acceptance_criteria: ["x"],
    });
    addIssue(state, {
      todo_id: "todo_failed",
      type: "critical_executor_error",
      message: "unrecoverable",
      status: "open",
    });

    const decision = determineRunTerminalState(state, {
      step: 2,
      maxSteps: 5,
      idleCount: 2,
      idleStepLimit: 2,
    });
    expect(decision.runStatus).toBe("failed");
    expect(decision.shouldTerminate).toBe(true);
    expect(decision.resultStatus).toBe("failed");
  });

  it("no ready todo with blocked/todo backlog => blocked after idle limit", () => {
    const state = createRunState("blocked-case");
    addTodo(state, {
      id: "todo_blocked_root",
      title: "blocked root",
      description: "blocked by external condition",
      status: "blocked",
      acceptance_criteria: ["external_ready"],
    });
    addTodo(state, {
      id: "todo_waiting",
      title: "waiting",
      description: "waiting external signal",
      status: "todo",
      depends_on: ["todo_blocked_root"],
      acceptance_criteria: ["x"],
    });

    const decision = determineRunTerminalState(state, {
      step: 3,
      maxSteps: 5,
      idleCount: 2,
      idleStepLimit: 2,
    });
    expect(decision.runStatus).toBe("blocked");
    expect(decision.shouldTerminate).toBe(true);
  });

  it("failed todo plus waiting backlog => failed instead of blocked", () => {
    const state = createRunState("failed-waiting-case");
    addTodo(state, {
      id: "todo_failed_root",
      title: "failed root",
      description: "failed upstream task",
      status: "failed",
      acceptance_criteria: ["x"],
    });
    addTodo(state, {
      id: "todo_waiting_on_failed",
      title: "waiting child",
      description: "cannot continue because upstream failed",
      status: "todo",
      depends_on: ["todo_failed_root"],
      acceptance_criteria: ["y"],
    });

    const decision = determineRunTerminalState(state, {
      step: 3,
      maxSteps: 5,
      idleCount: 2,
      idleStepLimit: 2,
    });

    expect(decision.runStatus).toBe("failed");
    expect(decision.shouldTerminate).toBe(true);
    expect(decision.issueType).toBe("run_failed_no_recovery");
  });

  it("no ready todo but idle limit not reached => idle", () => {
    const state = createRunState("idle-case");
    addTodo(state, {
      id: "todo_blocked_root",
      title: "blocked root",
      description: "blocked by external condition",
      status: "blocked",
      acceptance_criteria: ["external_ready"],
    });
    addTodo(state, {
      id: "todo_waiting",
      title: "waiting",
      description: "waiting for dependency",
      status: "todo",
      depends_on: ["todo_blocked_root"],
      acceptance_criteria: ["x"],
    });

    const decision = determineRunTerminalState(state, {
      step: 1,
      maxSteps: 5,
      idleCount: 1,
      idleStepLimit: 2,
    });
    expect(decision.runStatus).toBe("idle");
    expect(decision.shouldTerminate).toBe(false);
  });

  it("max_steps_reached keeps consistent status/issue/current_todo/log", async () => {
    const state = createRunState("max-iter-case");
    addTodo(state, {
      id: "todo_long",
      title: "long running todo",
      description: "cannot finish in one step",
      status: "ready",
      acceptance_criteria: ["alpha", "beta"],
    });

    const output = await runTodoDrivenOrchestrator(
      {
        goal: "max-iter-case",
        maxPlanningRounds: 1,
        maxStepLimit: 1,
      },
      {
        initialState: state,
        maxSteps: 1,
        stepExecutor: async () => ({
          status: "success",
          output: "alpha",
          criteria_evidence: ["alpha"],
        }),
      },
    );

    expect(output.result.status).toBe("max_steps_reached");
    expect(output.state.current_todo_id).toBeNull();
    expect(output.state.issues.some((issue) => issue.type === "max_steps_reached")).toBe(true);
    expect(output.state.execution_log.some((entry) => entry.action === "terminal_state_determined")).toBe(true);
  });
});
