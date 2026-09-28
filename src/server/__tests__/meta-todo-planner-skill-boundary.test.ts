import { describe, expect, it } from "vitest";

import { planInitialTodos } from "@/server/meta-agent/todo-driven/planner";

describe("todo planner generic skill boundary", () => {
  it("does not inject paper-pipeline directives into the generic prompt", async () => {
    let capturedPrompt = "";

    await planInitialTodos("Download 10 papers and deliver a merged bundle", undefined, {
      invokeLlm: async (messages) => {
        capturedPrompt = messages.find((message) => message.role === "user")?.content ?? "";
        return JSON.stringify({
          todos: [
            {
              id: "todo_collect_a",
              title: "Collect batch A",
              description: "Use the available collection skill for batch A.",
              priority: "high",
              capability_type: "collection",
              assignee: "single_executor",
              depends_on: [],
              acceptance_criteria: ["batch A collected", "batch A evidence captured"],
              input_refs: [],
            },
            {
              id: "todo_collect_b",
              title: "Collect batch B",
              description: "Use the available collection skill for batch B.",
              priority: "high",
              capability_type: "collection",
              assignee: "single_executor",
              depends_on: [],
              acceptance_criteria: ["batch B collected", "batch B evidence captured"],
              input_refs: [],
            },
            {
              id: "todo_merge",
              title: "Merge bundles",
              description: "Merge the collected artifacts.",
              priority: "high",
              capability_type: "merge",
              assignee: "single_executor",
              depends_on: ["todo_collect_a", "todo_collect_b"],
              acceptance_criteria: ["merged bundle produced", "merge output is ready for downstream delivery"],
              input_refs: [],
            },
          ],
        });
      },
    });

    expect(capturedPrompt).not.toContain("Paper-pipeline planning directive");
    expect(capturedPrompt).not.toContain("review_profile:paper_pipeline_relaxed");
    expect(capturedPrompt).not.toContain("review_expected_count:");
  });
});
