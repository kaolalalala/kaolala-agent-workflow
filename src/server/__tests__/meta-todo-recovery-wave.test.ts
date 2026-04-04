import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenStep, selectParallelTodoWave } from "@/server/meta-agent/todo-driven";
import type { SubagentDefinition, SubagentExecutionResult, TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("todo recovery in parallel wave", () => {
  it("downgrades failed wave item to serial while preserving other successful items", async () => {
    const state = createRunState("wave recovery downgrade");
    addTodo(state, {
      id: "todo_wave_research_fail",
      title: "research sources",
      description: "collect sources from web",
      status: "ready",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["source_a", "source_b"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_wave_analysis_ok",
      title: "analyze findings",
      description: "evaluate provided evidence and reason about findings",
      status: "ready",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["analysis_done", "analysis_verified"],
      depends_on: [],
    });

    const executor: TodoExecutor = async (_context, _s, todo) => ({
      status: "success",
      output: todo.acceptance_criteria.join(" "),
      summary: `ok:${todo.id}`,
      criteria_evidence: [...todo.acceptance_criteria],
    });

    await runTodoDrivenStep(state, executor, {
      parallel: { enabled: true, max_parallel_todos: 2 },
      recoveryPolicy: { max_retry_per_todo: 0, max_reroute_per_todo: 0 },
      subagentRunner: async (
        agent: SubagentDefinition,
      ): Promise<SubagentExecutionResult> => {
        if (agent.id === "research_agent") {
          return {
            status: "error",
            summary: "delegate fail",
            artifacts: [],
            open_questions: [],
            completion_notes: [],
            criteria_evidence: [],
            error_message: "timeout",
          };
        }
        return {
          status: "success",
          summary: "ok",
          artifacts: [],
          open_questions: [],
          completion_notes: [],
          criteria_evidence: [],
        };
      },
    });

    const downgraded = state.todos.find((todo) => todo.id === "todo_wave_research_fail");
    const completed = state.todos.find((todo) => todo.id === "todo_wave_analysis_ok");
    expect(downgraded?.status).toBe("ready");
    expect(downgraded?.serial_only).toBe(true);
    expect(downgraded?.downgraded_from_wave).toBe(true);
    expect(completed?.status).toBe("done");
    expect(state.execution_log.some((log) => log.action === "downgrade_to_serial" && log.todo_id === "todo_wave_research_fail")).toBe(true);

    const selection = selectParallelTodoWave(state, { max_parallel_todos: 2 });
    expect(selection.excluded.some((item) => item.todo_id === "todo_wave_research_fail" && item.reason === "todo_downgraded_to_serial")).toBe(true);
  });
});
