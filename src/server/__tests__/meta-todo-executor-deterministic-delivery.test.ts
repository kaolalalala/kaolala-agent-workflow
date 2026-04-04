import { afterEach, describe, expect, it, vi } from "vitest";

import * as llmHelper from "@/server/meta-agent/llm-helper";
import { createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { singleLlmTodoExecutor } from "@/server/meta-agent/todo-driven/executor";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("singleLlmTodoExecutor delivery path", () => {
  it("uses the LLM path instead of a hard-coded paper delivery shortcut", async () => {
    const llmSpy = vi.spyOn(llmHelper, "callLLMWithUsage").mockResolvedValue({
      content: JSON.stringify({
        summary: "delivered via llm",
        output: "final output body",
        criteria_evidence: ["used llm path"],
        artifact_type: "final_output",
        artifact_summary: "llm generated delivery",
      }),
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
        source: "estimated",
      },
    });

    const context = {
      goal: "Download 20 papers and deliver the final package.",
      run_id: "run_exec_delivery_test",
      current_todo: {
        id: "todo_deliver",
        title: "Deliver final downloaded paper package",
        description: "Produce the final answer with the requested paper count and a clear inventory of downloaded local files.",
        acceptance_criteria: [
          "Final output contains 20 downloaded papers",
          "Output is readable and organized",
        ],
      },
      input_artifacts: [],
      history_summary: {
        completed_todos: [],
        recent_logs: [],
        open_issues: [],
      },
      recovery_context: {
        retry_count: 0,
        reroute_count: 0,
        last_missing_criteria: [],
        guidance_notes: [],
      },
      resource_center: {
        skills: [],
      },
    };
    const state = createRunState(context.goal);

    const result = await singleLlmTodoExecutor(context, state, {
      ...context.current_todo,
      status: "ready",
      priority: "high",
      assignee: "single_executor",
      capability_type: "writing",
      depends_on: [],
      input_refs: [],
      retry_count: 0,
      delegation_status: "none",
      assignee_history: ["single_executor"],
      notes: [],
    });

    expect(llmSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.summary).toBe("delivered via llm");
    expect(result.output).toBe("final output body");
  });
});
