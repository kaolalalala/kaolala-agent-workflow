import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";
import type {
  DelegationBrief,
  SubagentDefinition,
  SubagentExecutionResult,
} from "@/server/meta-agent/todo-driven";

describe("todo-driven orchestrator ownership", () => {
  it("stays idle/blocked when no current todo and no ready todo (no fallback execution)", async () => {
    const state = createRunState("idle case");
    addTodo(state, {
      id: "todo_failed_only",
      title: "failed",
      description: "already failed todo",
      status: "failed",
      capability_type: "analysis",
      acceptance_criteria: ["x"],
      depends_on: [],
    });

    let executorCalls = 0;
    const output = await runTodoDrivenOrchestrator(
      { goal: "idle case", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 2,
        stepExecutor: async () => {
          executorCalls += 1;
          return {
            status: "error",
            output: "",
            error_message: "should not execute",
          };
        },
      },
    );

    expect(executorCalls).toBe(0);
    expect(output.result.status).toBe("failed");
    expect(output.state.status).toBe("failed");
    expect(output.result.finalRunId).toBeUndefined();
  });

  it("uses todo state as completion source (no legacy completion condition)", async () => {
    const state = createRunState("todo completion case");
    addTodo(state, {
      id: "todo_single",
      title: "single todo",
      description: "execute single todo and finish",
      status: "ready",
      capability_type: "analysis",
      acceptance_criteria: ["criterion_a", "criterion_b"],
      depends_on: [],
    });

    const output = await runTodoDrivenOrchestrator(
      { goal: "todo completion case", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 3,
        stepExecutor: async () => ({
          status: "success",
          output: "criterion_a criterion_b",
          criteria_evidence: ["criterion_a", "criterion_b"],
          artifact: {
            path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\ownership_completion.md",
            type: "todo_result",
            summary: "completion artifact",
          },
        }),
      },
    );

    expect(output.result.status).toBe("success");
    const todo = output.state.todos.find((item) => item.id === "todo_single");
    expect(todo?.status).toBe("done");
    expect(output.result.finalRunId).toBeUndefined();
  });

  it("delegate path sends local brief and writeback/logs are bound to todo_id", async () => {
    const state = createRunState("delegate case");
    addTodo(state, {
      id: "todo_research_case",
      title: "research materials",
      description: "collect research materials",
      status: "ready",
      capability_type: "research",
      acceptance_criteria: ["criteria_one", "criteria_two"],
      depends_on: [],
    });

    let capturedBrief: DelegationBrief | null = null;
    const output = await runTodoDrivenOrchestrator(
      { goal: "delegate case", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 1,
        stepExecutor: async () => ({
          status: "error",
          output: "",
          error_message: "self executor should not run in delegate path",
        }),
        subagentRunner: async (
          _agent: SubagentDefinition,
          brief: DelegationBrief,
        ): Promise<SubagentExecutionResult> => {
          capturedBrief = brief;
          return {
            status: "success",
            summary: "delegated done",
            artifacts: [
              {
                path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\ownership_delegate.md",
                type: "research_notes",
                summary: "delegated artifact",
              },
            ],
            open_questions: [],
            completion_notes: [],
            criteria_evidence: ["criteria_one", "criteria_two"],
          };
        },
      },
    );

    expect(capturedBrief).not.toBeNull();
    if (!capturedBrief) {
      throw new Error("Expected delegation brief to be captured.");
    }
    const brief: DelegationBrief = capturedBrief;
    expect(brief.todo_title).toBe("research materials");
    expect("execution_log" in (brief as unknown as Record<string, unknown>)).toBe(false);

    const todo = output.state.todos.find((item) => item.id === "todo_research_case");
    expect(todo?.status).toBe("done");

    const related = output.state.artifacts.filter((artifact) => artifact.related_todo === "todo_research_case");
    expect(related.length).toBeGreaterThan(0);

    const delegateLog = output.state.execution_log.find((log) => log.action === "delegate");
    const returnLog = output.state.execution_log.find((log) => log.action === "subagent_return");
    expect(delegateLog?.todo_id).toBe("todo_research_case");
    expect(returnLog?.todo_id).toBe("todo_research_case");
  });

  it("split branch changes path and bypasses self executor", async () => {
    const state = createRunState("split case");
    addTodo(state, {
      id: "todo_mixed_case",
      title: "research and write report",
      description: "collect evidence and write report in one single task",
      status: "ready",
      capability_type: "analysis",
      acceptance_criteria: ["collect_evidence", "write_report", "validate_report"],
      depends_on: [],
    });

    let selfCalls = 0;
    const output = await runTodoDrivenOrchestrator(
      { goal: "split case", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 1,
        stepExecutor: async () => {
          selfCalls += 1;
          return {
            status: "error",
            output: "",
            error_message: "self should not run for split",
          };
        },
      },
    );

    expect(selfCalls).toBe(0);
    const original = output.state.todos.find((item) => item.id === "todo_mixed_case");
    expect(original?.review_result).toBe("split");
    const subtodos = output.state.todos.filter((item) => item.id.startsWith("todo_mixed_case_sub_"));
    expect(subtodos.length).toBe(3);
  });
});
