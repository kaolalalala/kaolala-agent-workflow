import { describe, expect, it } from "vitest";

import { planInitialTodos } from "@/server/meta-agent/todo-driven/planner";

function buildValidTodosJson() {
  return JSON.stringify({
    todos: [
      {
        id: "todo_scope",
        title: "Define research scope",
        description: "Define concrete scope, target platforms, and output format.",
        priority: "high",
        capability_type: "planning",
        assignee: "single_executor",
        depends_on: [],
        acceptance_criteria: [
          "Scope and constraints are explicit",
          "Deliverable structure is clearly defined",
        ],
        input_refs: [],
      },
      {
        id: "todo_collect",
        title: "Collect candidate projects",
        description: "Collect representative multi-agent collaboration projects from 2024 to 2026.",
        priority: "high",
        capability_type: "research",
        assignee: "single_executor",
        depends_on: ["todo_scope"],
        acceptance_criteria: [
          "At least 10 projects with source links",
          "Each project has a short capability summary",
        ],
        input_refs: [],
      },
      {
        id: "todo_report",
        title: "Write comparison report",
        description: "Analyze the collected projects and produce a structured comparison report.",
        priority: "high",
        capability_type: "writing",
        assignee: "single_executor",
        depends_on: ["todo_collect"],
        acceptance_criteria: [
          "Report includes comparison dimensions and conclusions",
          "Final report is readable and actionable",
        ],
        input_refs: ["todo_collect_output"],
      },
    ],
  });
}

describe("todo planner - robust JSON parsing", () => {
  it("accepts <think> blocks before JSON output", async () => {
    const response = `<think>I should reason first and then provide strict JSON.</think>\n${buildValidTodosJson()}`;
    const todos = await planInitialTodos("Research multi-agent collaboration platforms", undefined, {
      invokeLlm: async () => response,
      maxAttempts: 1,
    });

    expect(todos.length).toBe(3);
    expect(todos[0]?.id).toBe("todo_scope");
  });

  it("accepts prefixed explanation text with embedded JSON payload", async () => {
    const response = `I will now provide the structured todo plan in JSON.\n\n${buildValidTodosJson()}`;
    const todos = await planInitialTodos("Produce a research report", undefined, {
      invokeLlm: async () => response,
      maxAttempts: 1,
    });

    expect(todos.length).toBe(3);
    expect(todos[1]?.id).toBe("todo_collect");
  });
});

