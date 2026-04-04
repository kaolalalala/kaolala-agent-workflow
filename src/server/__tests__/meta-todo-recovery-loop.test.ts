import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import type {
  SubagentDefinition,
  SubagentExecutionResult,
  TodoExecutionContext,
  TodoExecutor,
} from "@/server/meta-agent/todo-driven";

describe("todo recovery loop integration", () => {
  it("retries revise todo and injects recovery feedback into next execution context", async () => {
    const state = createRunState("retry with context feedback");
    addTodo(state, {
      id: "todo_retry_ctx",
      title: "write summary",
      description: "produce final summary with all criteria",
      status: "ready",
      capability_type: "planning",
      priority: "high",
      acceptance_criteria: ["alphaunique", "betaunique", "gammaunique"],
      depends_on: [],
    });

    const contexts: TodoExecutionContext[] = [];
    const executor: TodoExecutor = async (context) => {
      contexts.push(context);
      if (contexts.length === 1) {
        return {
          status: "success",
          output: "alphaunique betaunique",
          summary: "partial result",
          criteria_evidence: ["alphaunique", "betaunique"],
        };
      }
      return {
        status: "success",
        output: "alphaunique betaunique gammaunique",
        summary: "full result",
        criteria_evidence: ["alphaunique", "betaunique", "gammaunique"],
      };
    };

    const step1 = await runTodoDrivenStep(state, executor, {
      recoveryPolicy: { max_retry_per_todo: 2, max_reroute_per_todo: 1 },
    });
    expect(step1.review?.status).toBe("revise");
    expect(step1.recovery_decision?.action).toBe("retry");
    expect(state.todos.find((todo) => todo.id === "todo_retry_ctx")?.status).toBe("ready");

    const step2 = await runTodoDrivenStep(state, executor, {
      recoveryPolicy: { max_retry_per_todo: 2, max_reroute_per_todo: 1 },
    });
    expect(step2.review?.status).toBe("pass");
    expect(state.todos.find((todo) => todo.id === "todo_retry_ctx")?.status).toBe("done");
    expect(contexts.length).toBe(2);
    expect((contexts[1]?.recovery_context?.last_missing_criteria ?? []).length).toBeGreaterThan(0);
    expect((contexts[1]?.recovery_context?.guidance_notes ?? []).some((item) => item.includes("recovery_feedback:"))).toBe(true);
  });

  it("reroutes delegate failure to a better matched agent", async () => {
    const state = createRunState("reroute delegate");
    addTodo(state, {
      id: "todo_reroute_delegate",
      title: "research sources",
      description: "collect reliable references",
      status: "ready",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["collect_ref", "produce_evidence"],
      depends_on: [],
      forced_target_agent_id: "writer_agent",
      assignee: "writer_agent",
      assignee_history: ["writer_agent"],
    });

    const executor: TodoExecutor = async () => ({
      status: "success",
      output: "unused",
      summary: "unused",
    });

    const step1 = await runTodoDrivenStep(state, executor, {
      recoveryPolicy: { max_retry_per_todo: 0, max_reroute_per_todo: 2 },
      subagentRunner: async (
        agent: SubagentDefinition,
      ): Promise<SubagentExecutionResult> => {
        if (agent.id === "writer_agent") {
          return {
            status: "error",
            summary: "writer mismatch",
            artifacts: [],
            open_questions: [],
            completion_notes: [],
            criteria_evidence: [],
            error_message: "writer cannot complete research todo",
          };
        }
        return {
          status: "success",
          summary: "research success",
          artifacts: [],
          open_questions: [],
          completion_notes: [],
          criteria_evidence: ["collect_ref", "produce_evidence"],
        };
      },
    });

    expect(step1.recovery_decision?.action).toBe("reroute");
    const todoAfterStep1 = state.todos.find((todo) => todo.id === "todo_reroute_delegate");
    expect(todoAfterStep1?.status).toBe("ready");
    expect(todoAfterStep1?.forced_target_agent_id).toBe("research_agent");
    expect(todoAfterStep1?.reroute_count).toBe(1);
    expect(state.execution_log.some((entry) => entry.action === "reroute_started")).toBe(true);
    expect(state.execution_log.some((entry) => entry.action === "reroute_completed")).toBe(true);

    const step2 = await runTodoDrivenStep(state, executor, {
      recoveryPolicy: { max_retry_per_todo: 0, max_reroute_per_todo: 2 },
      subagentRunner: async (
        agent: SubagentDefinition,
      ): Promise<SubagentExecutionResult> => ({
        status: agent.id === "research_agent" ? "success" : "error",
        summary: agent.id === "research_agent" ? "research success" : "unexpected agent",
        artifacts: [],
        open_questions: [],
        completion_notes: [],
        criteria_evidence: ["collect_ref", "produce_evidence"],
        error_message: agent.id === "research_agent" ? undefined : "unexpected",
      }),
    });

    expect(step2.review?.status).toBe("pass");
    expect(state.todos.find((todo) => todo.id === "todo_reroute_delegate")?.status).toBe("done");
  });
});
