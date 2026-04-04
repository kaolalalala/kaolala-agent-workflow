import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { persistExecutionArtifacts } from "@/server/meta-agent/todo-driven/artifact-offloading";

describe("workspace file offloading", () => {
  it("writes workspace files for large artifacts and keeps artifact refs", () => {
    const state = createRunState("workspace offload");
    const todo = addTodo(state, {
      id: "todo_collect",
      title: "Collect papers",
      description: "Collect many papers and summaries",
      capability_type: "research",
      priority: "high",
      status: "ready",
      depends_on: [],
      acceptance_criteria: ["collect", "summarize"],
    });

    const artifacts = persistExecutionArtifacts(
      state,
      todo,
      "research_agent",
      {
        status: "success",
        output: "paper item\n".repeat(400),
        summary: "Collected a large batch of papers",
        artifact: {
          path: "papers_batch.md",
          type: "paper_search_result",
          summary: "Large paper batch",
        },
      },
      "serial",
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.storage_mode).toBe("workspace");
    expect(artifacts[0]?.workspace_file_id).toBeTruthy();
    expect(state.workspace_files).toHaveLength(1);
    expect(state.workspace_files[0]?.related_todo).toBe(todo.id);
    expect(state.workspace_files[0]?.producer).toBe("research_agent");
    expect(existsSync(state.workspace_files[0]!.path)).toBe(true);
  });

  it("keeps small artifacts inline while preserving preview", () => {
    const state = createRunState("workspace inline");
    const todo = addTodo(state, {
      id: "todo_answer",
      title: "Write answer",
      description: "Write a short answer",
      capability_type: "writing",
      priority: "high",
      status: "ready",
      depends_on: [],
      acceptance_criteria: ["clear", "short"],
    });

    const artifacts = persistExecutionArtifacts(
      state,
      todo,
      "writer_agent",
      {
        status: "success",
        output: "Short final answer.",
        summary: "Short final answer.",
        artifact: {
          path: "final_answer.md",
          type: "final_output",
          summary: "Short final answer.",
        },
      },
      "serial",
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.storage_mode).toBe("inline");
    expect(artifacts[0]?.inline_preview).toContain("Short final answer.");
    expect(state.workspace_files).toHaveLength(0);
  });
});
