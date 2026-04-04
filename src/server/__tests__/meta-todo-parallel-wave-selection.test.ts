import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { selectParallelTodoWave } from "@/server/meta-agent/todo-driven";

describe("parallel wave selection", () => {
  it("selects only ready and independent todos by priority", () => {
    const state = createRunState("wave selection");
    addTodo(state, {
      id: "todo_high_research",
      title: "调研关键资料",
      description: "收集证据并形成结构化资料包。",
      status: "ready",
      priority: "high",
      capability_type: "research",
      acceptance_criteria: ["资料可追溯", "形成结构化输出"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_critical_write",
      title: "撰写结论文档",
      description: "根据输入材料撰写结构化结论文档。",
      status: "ready",
      priority: "critical",
      capability_type: "writing",
      acceptance_criteria: ["结论完整", "建议可执行"],
      depends_on: [],
      input_refs: ["seed_material"],
    });
    addTodo(state, {
      id: "todo_medium_planning",
      title: "规划下一阶段",
      description: "定义后续 todo 规划和拆解策略。",
      status: "ready",
      priority: "medium",
      capability_type: "planning",
      acceptance_criteria: ["范围明确", "验收标准明确"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_mixed",
      title: "Research and write full report",
      description: "Collect and write in one task.",
      status: "ready",
      priority: "high",
      capability_type: "analysis",
      acceptance_criteria: ["source list", "final report"],
      depends_on: [],
    });

    const wave = selectParallelTodoWave(state, { max_parallel_todos: 2 });
    const selectedIds = wave.selected.map((item) => item.todo.id);

    expect(selectedIds).toEqual(["todo_critical_write", "todo_high_research"]);
    expect(wave.excluded.some((item) => item.todo_id === "todo_medium_planning")).toBe(true);
    expect(wave.excluded.some((item) => item.todo_id === "todo_mixed")).toBe(true);
  });

  it("does not put dependency-related todos in the same wave", () => {
    const state = createRunState("wave dependency guard");
    addTodo(state, {
      id: "todo_a",
      title: "独立调研 A",
      description: "执行 A 调研任务。",
      status: "ready",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["A evidence", "A summary"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_b",
      title: "依赖 A 的任务",
      description: "该任务依赖 A 的结果。",
      status: "todo",
      capability_type: "writing",
      priority: "high",
      acceptance_criteria: ["B output", "B checked"],
      depends_on: ["todo_a"],
    });

    const forcedReady = state.todos.find((todo) => todo.id === "todo_b");
    if (!forcedReady) throw new Error("todo_b not found");
    forcedReady.status = "ready";

    const wave = selectParallelTodoWave(state, { max_parallel_todos: 3 });
    const selectedIds = wave.selected.map((item) => item.todo.id);
    expect(selectedIds).toContain("todo_a");
    expect(selectedIds).not.toContain("todo_b");
  });
});
