import { describe, expect, it } from "vitest";

import { addTodo, createRunState, updateTodoStatus } from "@/server/meta-agent/supervisor-runtime-state";
import { buildTodoExecutionContext } from "@/server/meta-agent/todo-driven/execution-context-builder";
import { persistExecutionArtifacts } from "@/server/meta-agent/todo-driven/artifact-offloading";

describe("execution context read-back", () => {
  it("defaults to summary-only for offloaded artifacts when full detail is not needed", () => {
    const state = createRunState("summary readback");
    const source = addTodo(state, {
      id: "todo_source",
      title: "Research source",
      description: "Collect research notes",
      capability_type: "research",
      priority: "high",
      status: "ready",
      depends_on: [],
      acceptance_criteria: ["collect", "summarize"],
    });
    updateTodoStatus(state, source.id, "in_progress");
    updateTodoStatus(state, source.id, "done");

    persistExecutionArtifacts(
      state,
      source,
      "research_agent",
      {
        status: "success",
        output: "research detail\n".repeat(400),
        summary: "Research summary",
        artifact: {
          path: "research_notes.md",
          type: "paper_search_result",
          summary: "Research summary",
        },
      },
      "serial",
    );

    const consumer = addTodo(state, {
      id: "todo_consumer",
      title: "Follow-up research",
      description: "Need a compact research context",
      capability_type: "research",
      priority: "high",
      status: "ready",
      depends_on: [source.id],
      acceptance_criteria: ["use source"],
    });

    const context = buildTodoExecutionContext(state, consumer);
    expect(context.input_artifacts).toHaveLength(1);
    expect(context.input_artifacts[0]?.read_mode).toBe("workspace_summary");
    expect(context.input_artifacts[0]?.content).toBeUndefined();
  });

  it("reads back full content selectively for writing/analysis todos and ignores unrelated files", () => {
    const state = createRunState("full readback");
    const source = addTodo(state, {
      id: "todo_source",
      title: "Research source",
      description: "Collect research notes",
      capability_type: "research",
      priority: "high",
      status: "ready",
      depends_on: [],
      acceptance_criteria: ["collect", "summarize"],
    });
    updateTodoStatus(state, source.id, "in_progress");
    updateTodoStatus(state, source.id, "done");
    persistExecutionArtifacts(
      state,
      source,
      "research_agent",
      {
        status: "success",
        output: "important detail\n".repeat(240),
        summary: "Important research summary",
        artifact: {
          path: "important_notes.md",
          type: "paper_search_result",
          summary: "Important research summary",
        },
      },
      "serial",
    );

    const unrelated = addTodo(state, {
      id: "todo_unrelated",
      title: "Unrelated source",
      description: "Collect unrelated notes",
      capability_type: "research",
      priority: "medium",
      status: "ready",
      depends_on: [],
      acceptance_criteria: ["collect"],
    });
    updateTodoStatus(state, unrelated.id, "in_progress");
    updateTodoStatus(state, unrelated.id, "done");
    persistExecutionArtifacts(
      state,
      unrelated,
      "research_agent",
      {
        status: "success",
        output: "unrelated detail\n".repeat(240),
        summary: "Unrelated summary",
        artifact: {
          path: "unrelated_notes.md",
          type: "paper_search_result",
          summary: "Unrelated summary",
        },
      },
      "serial",
    );

    const consumer = addTodo(state, {
      id: "todo_writer",
      title: "Write report",
      description: "Need detailed source material",
      capability_type: "writing",
      priority: "high",
      status: "ready",
      depends_on: [source.id],
      acceptance_criteria: ["use source"],
    });

    const context = buildTodoExecutionContext(state, consumer);
    expect(context.input_artifacts).toHaveLength(1);
    expect(context.input_artifacts[0]?.read_mode).toBe("workspace_full");
    expect(context.input_artifacts[0]?.content).toContain("important detail");
  });
});
