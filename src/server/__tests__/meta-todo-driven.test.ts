import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import { planInitialTodos } from "@/server/meta-agent/todo-driven/planner";
import { selectNextTodo } from "@/server/meta-agent/todo-driven/selector";
import type { TodoExecutor } from "@/server/meta-agent/todo-driven";

function mockPlannerJson() {
  return JSON.stringify({
    todos: [
      {
        id: "todo_scope",
        title: "明确范围与约束",
        description: "梳理目标边界、关键约束和可量化验收标准。",
        priority: "critical",
        assignee: "single_executor",
        depends_on: [],
        acceptance_criteria: ["定义明确任务范围和非范围", "列出至少两条可验证验收标准"],
        input_refs: [],
      },
      {
        id: "todo_analyze",
        title: "整理输入并分析",
        description: "收集关键材料并形成可执行分析结论。",
        priority: "high",
        assignee: "single_executor",
        depends_on: ["todo_scope"],
        acceptance_criteria: ["输入来源可追溯", "分析结论可直接支撑后续产出"],
        input_refs: [],
      },
      {
        id: "todo_output",
        title: "产出方案并复核",
        description: "生成最终方案草案并进行一致性复核。",
        priority: "high",
        assignee: "single_executor",
        depends_on: ["todo_analyze"],
        acceptance_criteria: ["方案结构完整并包含执行步骤", "明确风险与后续行动建议"],
        input_refs: [],
      },
    ],
  });
}

describe("todo-driven supervisor phase2", () => {
  it("plans initial todos with dependency chain", async () => {
    const todos = await planInitialTodos("输出可执行方案", undefined, {
      invokeLlm: async () => mockPlannerJson(),
    });
    expect(todos.length).toBeGreaterThanOrEqual(3);
    expect(todos.length).toBeLessThanOrEqual(5);
    expect(todos[0]?.depends_on.length).toBe(0);
    expect(todos[1]?.depends_on.length).toBeGreaterThan(0);
  });

  it("re-generates todo draft when validator fails", async () => {
    let callCount = 0;
    const todos = await planInitialTodos("输出可执行方案", undefined, {
      invokeLlm: async () => {
        callCount += 1;
        if (callCount === 1) {
          return JSON.stringify({
            todos: [
              {
                id: "bad_1",
                title: "todo",
                description: "do work",
                priority: "high",
                assignee: "single_executor",
                depends_on: ["bad_1"],
                acceptance_criteria: ["ok"],
              },
            ],
          });
        }
        return mockPlannerJson();
      },
    });

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(todos.length).toBeGreaterThanOrEqual(3);
  });

  it("selects highest-priority ready todo", () => {
    const state = createRunState("test");
    addTodo(state, {
      id: "todo_low",
      title: "low",
      description: "this is low priority",
      priority: "low",
      status: "ready",
      acceptance_criteria: ["criterion low"],
    });
    addTodo(state, {
      id: "todo_high",
      title: "high",
      description: "this is high priority",
      priority: "high",
      status: "ready",
      acceptance_criteria: ["criterion high"],
    });
    expect(selectNextTodo(state)).toBe("todo_high");
  });

  it("runs one todo-driven step and completes review", async () => {
    const state = createRunState("产出项目方案");
    const executor: TodoExecutor = async (context) => ({
      status: "success",
      summary: "done",
      output: context.current_todo.acceptance_criteria.join(" ; "),
      criteria_evidence: [...context.current_todo.acceptance_criteria],
      artifact: {
        path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\todo_step_result.md",
        type: "todo_result",
        summary: "todo output",
      },
    });

    const result = await runTodoDrivenStep(state, executor, {
      planningInvokeLlm: async () => mockPlannerJson(),
    });
    expect(result.selected_todo_id).toBeTruthy();
    expect(result.review?.status).toBe("pass");

    const completedCount = state.todos.filter((todo) => todo.status === "done").length;
    expect(completedCount).toBeGreaterThanOrEqual(1);
    expect(state.artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it("returns revise when acceptance criteria is only partially satisfied", async () => {
    const state = createRunState("test revise");
    addTodo(state, {
      id: "todo_revise",
      title: "revise",
      description: "revise description with context details",
      status: "ready",
      priority: "high",
      acceptance_criteria: ["alphauniquetoken", "betauniquetoken", "gammauniquetoken"],
      depends_on: [],
    });

    const executor: TodoExecutor = async () => ({
      status: "success",
      output: "alphauniquetoken betauniquetoken",
      summary: "partial",
      criteria_evidence: ["alphauniquetoken", "betauniquetoken"],
    });

    const result = await runTodoDrivenStep(state, executor);
    expect(result.review?.status).toBe("revise");

    const todo = state.todos.find((item) => item.id === "todo_revise");
    expect(todo?.status).toBe("ready");
    expect(todo?.retry_count).toBe(1);
  });

  it("schedules retry instead of failing immediately when review fail budget is set", async () => {
    const state = createRunState("test fail retry budget");
    addTodo(state, {
      id: "todo_fail_once",
      title: "collect materials",
      description: "collect materials with complete evidence",
      status: "ready",
      priority: "high",
      acceptance_criteria: ["alphauniquekey", "betauniquekey", "gammauniquekey"],
      depends_on: [],
    });

    const executor: TodoExecutor = async () => ({
      status: "success",
      output: "only alphauniquekey evidence",
      summary: "insufficient evidence",
      criteria_evidence: ["alphauniquekey"],
    });

    const result = await runTodoDrivenStep(state, executor, {
      reviewFailRetryBudget: 1,
    });
    expect(result.review?.status).toBe("fail");

    const todo = state.todos.find((item) => item.id === "todo_fail_once");
    expect(todo?.status).toBe("ready");
    expect(todo?.review_result).toBe("revise");
    expect(todo?.retry_count).toBe(1);
    expect((state.execution_log ?? []).some((entry) => entry.action === "recovery_decided")).toBe(true);
    expect((state.execution_log ?? []).some((entry) => entry.action === "retry_started")).toBe(true);
    expect((state.execution_log ?? []).some((entry) => entry.action === "retry_completed")).toBe(true);
  });
});
