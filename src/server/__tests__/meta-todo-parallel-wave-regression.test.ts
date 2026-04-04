import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";
import type { TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("parallel wave orchestrator regression", () => {
  it("falls back to serial execution when no valid parallel wave exists", async () => {
    const state = createRunState("serial fallback");
    addTodo(state, {
      id: "todo_only_one",
      title: "唯一可执行任务",
      description: "当前只有一个 ready todo。",
      status: "ready",
      capability_type: "planning",
      priority: "high",
      acceptance_criteria: ["result_ready", "result_verified"],
      depends_on: [],
    });

    const executor: TodoExecutor = async (_context, _s, todo) => ({
      status: "success",
      output: todo.acceptance_criteria.join(" "),
      criteria_evidence: [...todo.acceptance_criteria],
      summary: "serial ok",
    });

    const result = await runTodoDrivenStep(state, executor, {
      parallel: { enabled: true, max_parallel_todos: 2 },
    });

    expect(result.wave_id).toBeUndefined();
    expect(result.selected_todo_id).toBe("todo_only_one");
    expect(state.todos.find((todo) => todo.id === "todo_only_one")?.status).toBe("done");
  });

  it("keeps terminal semantics valid with parallel waves", async () => {
    const state = createRunState("parallel terminal");
    addTodo(state, {
      id: "todo_a",
      title: "调研 A",
      description: "收集 A 相关资料并结构化。",
      status: "ready",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["collect_a", "summarize_a"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_b",
      title: "分析 B",
      description: "分析 B 并给出结论。",
      status: "ready",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["analyze_b", "conclude_b"],
      depends_on: [],
    });

    const output = await runTodoDrivenOrchestrator(
      { goal: "parallel terminal", maxIterations: 2 },
      {
        initialState: state,
        maxSteps: 3,
        parallel: { enabled: true, max_parallel_todos: 2 },
        stepExecutor: async (_context, _s, todo) => ({
          status: "success",
          output: todo.acceptance_criteria.join(" "),
          criteria_evidence: [...todo.acceptance_criteria],
          summary: "ok",
        }),
        subagentRunner: async (_agent, brief) => ({
          status: "success",
          summary: `delegated: ${brief.todo_title}`,
          artifacts: [],
          open_questions: [],
          completion_notes: [],
          criteria_evidence: [...brief.acceptance_criteria],
        }),
      },
    );

    expect(output.state.status).toBe("completed");
    expect(output.result.status).toBe("success");
    expect(output.state.wave_count).toBeGreaterThanOrEqual(1);
  });
});
