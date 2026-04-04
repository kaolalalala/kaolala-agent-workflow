import { describe, expect, it } from "vitest";

import { compactExecutionContext } from "@/server/meta-agent/todo-driven/context-compactor";
import { compactToolConversation } from "@/server/meta-agent/llm-helper";

describe("context compaction", () => {
  it("compacts oversized execution context while keeping key artifacts", () => {
    const context = {
      goal: "analyze a large set of materials",
      run_id: "run_1",
      current_todo: {
        id: "todo_1",
        title: "Analyze materials",
        description: "analyze many materials",
        acceptance_criteria: ["analysis complete", "answer is grounded"],
      },
      input_artifacts: Array.from({ length: 6 }).map((_, index) => ({
        id: `artifact_${index}`,
        path: `memory://artifact_${index}`,
        type: "note",
        summary: "x".repeat(400),
        storage_mode: "workspace" as const,
        workspace_file_id: `wsf_${index}`,
        inline_preview: "x".repeat(200),
        kind: "research_notes",
        content: "y".repeat(1500),
        read_mode: "workspace_full" as const,
      })),
      history_summary: {
        completed_todos: Array.from({ length: 8 }).map((_, index) => ({ id: `done_${index}`, title: `done ${index}` })),
        recent_logs: Array.from({ length: 10 }).map((_, index) => ({
          todo_id: `todo_${index}`,
          action: "log",
          message: "m".repeat(300),
        })),
        open_issues: Array.from({ length: 6 }).map((_, index) => ({
          id: `issue_${index}`,
          todo_id: `todo_${index}`,
          message: "i".repeat(240),
        })),
      },
      memory_hints: { review: [] },
      recovery_context: {
        retry_count: 1,
        reroute_count: 0,
        last_missing_criteria: [],
        guidance_notes: [],
      },
    };

    const compacted = compactExecutionContext(context, 3500);
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(context).length);
    expect(compacted.input_artifacts.length).toBeLessThanOrEqual(4);
    expect(compacted.history_summary.recent_logs.length).toBeLessThanOrEqual(5);
  });

  it("compacts long tool conversations while keeping recent turns", async () => {
    const conversation = [
      { role: "system" as const, content: "system prompt" },
      ...Array.from({ length: 8 }).flatMap((_, index) => ([
        { role: "assistant" as const, content: `assistant message ${index} ${"a".repeat(300)}` },
        { role: "tool" as const, tool_call_id: `tc_${index}`, content: `tool result ${index} ${"b".repeat(300)}` },
      ])),
    ];

    const compacted = await compactToolConversation(conversation, 4);
    expect(compacted.compacted.length).toBeLessThan(conversation.length);
    expect(compacted.compacted[0]?.role).toBe("system");
    expect(compacted.compacted.some((message) => "content" in message && String(message.content).includes("Conversation summary:"))).toBe(true);
  });
});
