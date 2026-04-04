import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";
import { runSupervisorQualityBenchmark } from "@/server/meta-agent/todo-driven/quality";
import type { TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("offloading middleware regression", () => {
  it("keeps serial execution working with inline artifacts", async () => {
    const state = createRunState("serial offloading regression");
    addTodo(state, {
      id: "todo_inline",
      title: "Write short answer",
      description: "Write a short answer with two checks",
      capability_type: "planning",
      status: "ready",
      priority: "high",
      depends_on: [],
      acceptance_criteria: ["alpha_check", "beta_check"],
    });

    const executor: TodoExecutor = async () => ({
      status: "success",
      output: "alpha_check beta_check",
      summary: "small inline result",
      criteria_evidence: ["alpha_check", "beta_check"],
      artifact: {
        path: "inline_result.md",
        type: "final_output",
        summary: "small inline result",
      },
    });

    const result = await runTodoDrivenStep(state, executor);
    expect(result.review?.status).toBe("pass");
    expect(state.artifacts[0]?.storage_mode).toBe("inline");
  });

  it("keeps parallel wave execution working with offloaded artifacts", async () => {
    const state = createRunState("parallel offloading regression");
    addTodo(state, {
      id: "todo_a",
      title: "Research A",
      description: "Collect research notes for A",
      capability_type: "research",
      status: "ready",
      priority: "high",
      depends_on: [],
      acceptance_criteria: ["collect_a", "summarize_a"],
    });
    addTodo(state, {
      id: "todo_b",
      title: "Research B",
      description: "Collect research notes for B",
      capability_type: "research",
      status: "ready",
      priority: "high",
      depends_on: [],
      acceptance_criteria: ["collect_b", "summarize_b"],
    });

    const output = await runTodoDrivenOrchestrator(
      { goal: "parallel offload regression", maxPlanningRounds: 1, maxStepLimit: 3 },
      {
        initialState: state,
        maxSteps: 3,
        parallel: { enabled: true, max_parallel_todos: 2 },
        stepExecutor: async (_context, _s, todo) => ({
          status: "success",
          output: `${todo.acceptance_criteria.join(" ")} ${"detail ".repeat(500)}`,
          summary: `summary ${todo.id}`,
          criteria_evidence: [...todo.acceptance_criteria],
          artifact: {
            path: `${todo.id}.md`,
            type: "paper_search_result",
            summary: `summary ${todo.id}`,
          },
        }),
        subagentRunner: async (_agent, brief) => ({
          status: "success",
          summary: `summary ${brief.todo_title}`,
          artifacts: [
            {
              path: `${brief.todo_id}.md`,
              type: "paper_search_result",
              summary: `summary ${brief.todo_title}`,
            },
          ],
          open_questions: [],
          completion_notes: [],
          criteria_evidence: [...brief.acceptance_criteria],
          raw_output: `${brief.acceptance_criteria.join(" ")} ${"detail ".repeat(500)}`,
        }),
      },
    );

    expect(output.result.status).toBe("success");
    expect(output.state.workspace_files.length).toBeGreaterThanOrEqual(2);
    expect(output.state.artifacts.every((item) => item.storage_mode === "workspace")).toBe(true);
  });

  it("keeps the benchmark runner available", async () => {
    const result = await runSupervisorQualityBenchmark({
      planner: { case_ids: ["planner_research_report"] },
      routing: { case_ids: ["routing_research_delegate"] },
      review: { case_ids: ["review_pass_complete"] },
      e2e: { case_ids: ["e2e_research_write_review"] },
    });
    expect(result.summary.total_cases).toBe(4);
  });
});
