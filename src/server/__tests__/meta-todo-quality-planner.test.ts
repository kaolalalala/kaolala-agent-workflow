import { describe, expect, it } from "vitest";

import type { TodoItem } from "@/server/meta-agent/supervisor-runtime-state";
import {
  evaluatePlannerQuality,
  evaluatePlannerRawDraft,
  plannerBenchmarkCases,
  runPlannerBenchmark,
} from "@/server/meta-agent/todo-driven/quality";

function mockTodo(id: string, title: string, description: string): TodoItem {
  return {
    id,
    title,
    description,
    status: "todo",
    priority: "high",
    assignee: "single_executor",
    capability_type: "analysis",
    depends_on: id === "todo_1" ? [] : ["todo_1"],
    acceptance_criteria: ["包含结构化结论", "包含可执行建议"],
    input_refs: [],
    retry_count: 0,
    delegation_status: "none",
    assignee_history: ["single_executor"],
    notes: [],
  };
}

describe("supervisor quality benchmark - planner", () => {
  it("runs planner benchmark and returns aggregate scores", async () => {
    const result = await runPlannerBenchmark({
      case_ids: [
        "planner_research_report",
        "planner_code_refactor",
        "planner_invalid_then_repair",
      ],
    });
    expect(result.total_cases).toBe(3);
    expect(result.aggregate_scores.overall).toBeGreaterThan(0);
    expect(result.per_case_results.length).toBe(3);
  });

  it("detects coarse todo draft and missing acceptance criteria", () => {
    const benchmarkCase = plannerBenchmarkCases[0];
    const evaluation = evaluatePlannerRawDraft(benchmarkCase, [
      {
        id: "bad_1",
        title: "todo",
        description: "do work",
        priority: "high",
        assignee: "single_executor",
        depends_on: [],
        acceptance_criteria: ["ok"],
      },
      {
        id: "bad_2",
        title: "todo",
        description: "do work",
        priority: "high",
        assignee: "single_executor",
        depends_on: ["bad_1"],
        acceptance_criteria: ["ok"],
      },
      {
        id: "bad_3",
        title: "todo",
        description: "do work",
        priority: "high",
        assignee: "single_executor",
        depends_on: ["bad_2"],
        acceptance_criteria: ["ok"],
      },
    ]);

    expect(evaluation.pass).toBe(false);
    expect(evaluation.issues.join(" ")).toContain("description too weak/too generic");
    expect(evaluation.issues.join(" ")).toContain("at least 2 acceptance criteria required");
  });

  it("detects over-fine granularity todo patterns", () => {
    const benchmarkCase = plannerBenchmarkCases[0];
    const todos: TodoItem[] = [
      mockTodo("todo_1", "打开网页", "Open browser and click button to copy one paragraph."),
      mockTodo("todo_2", "复制文本", "Click and copy text line by line into local note."),
      mockTodo("todo_3", "粘贴文本", "Open page and paste copied text into another tab."),
    ];

    const evaluation = evaluatePlannerQuality(benchmarkCase, todos);
    expect(evaluation.per_dimension_scores.granularity).toBeLessThan(0.7);
    expect(evaluation.issues).toContain("granularity_low");
  });
});
