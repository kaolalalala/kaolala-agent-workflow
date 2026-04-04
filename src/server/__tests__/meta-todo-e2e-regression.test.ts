import { describe, expect, it } from "vitest";

import { addArtifact, addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";
import type {
  SubagentDefinition,
  SubagentExecutionResult,
} from "@/server/meta-agent/todo-driven";

describe("todo-driven E2E regression", () => {
  it("normal flow: goal -> plan -> delegate/self -> review -> completed", async () => {
    const state = createRunState("e2e normal flow");
    addTodo(state, {
      id: "todo_self_planning",
      title: "Scope requirement",
      description: "Clarify output scope before delegation.",
      capability_type: "planning",
      status: "ready",
      priority: "high",
      acceptance_criteria: ["scope_ready"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_delegate_research",
      title: "Research material",
      description: "Collect materials for output.",
      capability_type: "research",
      status: "todo",
      priority: "high",
      acceptance_criteria: ["material_ready", "evidence_ready"],
      depends_on: ["todo_self_planning"],
    });

    const output = await runTodoDrivenOrchestrator(
      { goal: "e2e normal flow", maxIterations: 2, qualityThreshold: 0.7 },
      {
        initialState: state,
        maxSteps: 5,
        subagentRunner: async (
          agent: SubagentDefinition,
        ): Promise<SubagentExecutionResult> => ({
          status: "success",
          summary: `done by ${agent.id}`,
          artifacts: [
            {
              path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\e2e_${agent.id}.md`,
              type: "subagent_result",
              summary: "artifact",
            },
          ],
          open_questions: [],
          completion_notes: [],
          criteria_evidence: ["material_ready", "evidence_ready"],
        }),
        stepExecutor: async (_context, _state, todo) => ({
          status: "success",
          output: todo.acceptance_criteria.join(" "),
          criteria_evidence: [...todo.acceptance_criteria],
          artifact: {
            path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\e2e_self_${todo.id}.md`,
            type: "todo_result",
            summary: "self result",
          },
        }),
      },
    );

    expect(output.result.status).toBe("success");
    expect(output.state.status).toBe("completed");
    expect(output.state.execution_log.some((entry) => entry.action === "select_todo")).toBe(true);
    expect(output.state.execution_log.some((entry) => entry.action === "decide_mode")).toBe(true);
  });

  it("failure/blocked flow reaches terminal blocked/failed semantics", async () => {
    const state = createRunState("e2e blocked flow");
    addTodo(state, {
      id: "todo_external",
      title: "Wait external",
      description: "Requires external signal",
      status: "blocked",
      acceptance_criteria: ["external_ready"],
    });
    addTodo(state, {
      id: "todo_downstream",
      title: "Downstream",
      description: "Depends on external",
      status: "todo",
      depends_on: ["todo_external"],
      acceptance_criteria: ["downstream_ready"],
    });

    const output = await runTodoDrivenOrchestrator(
      { goal: "e2e blocked flow", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 2,
        idleStepLimit: 1,
      },
    );

    expect(output.result.status).toBe("failed");
    expect(output.state.status).toBe("blocked");
  });

  it("resume flow continues from existing state without replaying done todo", async () => {
    const state = createRunState("e2e resume");
    const done = addTodo(state, {
      id: "todo_done",
      title: "Done first",
      description: "Already done",
      status: "done",
      acceptance_criteria: ["done_ok"],
      review_result: "pass",
      assignee_history: ["supervisor", "research_agent"],
    });
    addArtifact(state, {
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\e2e_resume_old.md",
      type: "note",
      producer: "research_agent",
      related_todo: done.id,
      summary: "existing artifact",
    });
    addTodo(state, {
      id: "todo_remaining",
      title: "Remaining",
      description: "Need execute",
      status: "ready",
      acceptance_criteria: ["remaining_ok"],
    });

    const executed: string[] = [];
    const output = await runTodoDrivenOrchestrator(
      { goal: "e2e resume", maxIterations: 1 },
      {
        initialState: state,
        maxSteps: 3,
        stepExecutor: async (_context, _state, todo) => {
          executed.push(todo.id);
          return {
            status: "success",
            output: "remaining_ok",
            criteria_evidence: ["remaining_ok"],
          };
        },
      },
    );

    expect(output.result.status).toBe("success");
    expect(executed).toEqual(["todo_remaining"]);
    expect(output.state.todos.find((todo) => todo.id === "todo_done")?.review_result).toBe("pass");
  });
});
