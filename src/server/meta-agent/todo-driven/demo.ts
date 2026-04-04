import { createRunState } from "../supervisor-runtime-state";
import { runTodoDrivenOrchestrator, type TodoDrivenOrchestratorOutput } from "./orchestrator";
import { runTodoDrivenStep } from "./loop";
import type { SubagentDefinition, SubagentExecutionResult, TodoStepResult } from "./types";
import { singleLlmTodoExecutor } from "./executor";

/**
 * Generic minimal demo:
 * create run state -> auto plan todos -> execute one upgraded step.
 */
export async function runTodoDrivenDemo(goal: string): Promise<TodoStepResult> {
  const state = createRunState(goal);
  return runTodoDrivenStep(state, singleLlmTodoExecutor);
}

/**
 * Phase 3.2 minimal demo:
 * run the independent todo-driven orchestrator as the only control loop.
 */
export async function runTodoDrivenOrchestratorDemo(goal: string): Promise<TodoDrivenOrchestratorOutput> {
  return runTodoDrivenOrchestrator(
    { goal, maxIterations: 3, qualityThreshold: 0.7 },
    { maxSteps: 6, idleStepLimit: 2 },
  );
}

/**
 * Phase-3 delegation demo:
 * goal -> generate todos (research-first) -> delegate to research_agent -> review -> updated state.
 * Uses injected sample planning/subagent outputs to keep local verification deterministic.
 */
export async function runSupervisorDelegationDemo(goal: string): Promise<TodoStepResult> {
  const state = createRunState(goal);

  return runTodoDrivenStep(
    state,
    async () => ({
      status: "success",
      output: "supervisor fallback execution",
      summary: "fallback",
      criteria_evidence: [],
    }),
    {
      planningInvokeLlm: async () =>
        JSON.stringify({
          todos: [
            {
              id: "todo_research",
              title: "Collect research evidence",
              description: "Search and collect evidence relevant to the goal.",
              capability_type: "research",
              priority: "high",
              assignee: "single_executor",
              depends_on: [],
              acceptance_criteria: [
                "Provide at least three evidence bullets",
                "List unresolved research questions",
              ],
              input_refs: [],
            },
            {
              id: "todo_write",
              title: "Draft final write-up",
              description: "Write final content using collected evidence.",
              capability_type: "writing",
              priority: "high",
              assignee: "single_executor",
              depends_on: ["todo_research"],
              acceptance_criteria: [
                "Draft includes actionable structure",
                "Draft references research evidence",
              ],
              input_refs: [],
            },
            {
              id: "todo_review",
              title: "Review and finalize",
              description: "Review the deliverable against criteria.",
              capability_type: "review",
              priority: "medium",
              assignee: "single_executor",
              depends_on: ["todo_write"],
              acceptance_criteria: [
                "All criteria are checked",
                "Final revision notes are explicit",
              ],
              input_refs: [],
            },
          ],
        }),
      subagentRunner: async (
        agent: SubagentDefinition,
      ): Promise<SubagentExecutionResult> => ({
        status: "success",
        summary: `Delegated execution completed by ${agent.id}.`,
        artifacts: [
          {
            path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\delegation_demo_research.md",
            type: "research_notes",
            summary: "Research notes from delegated execution.",
          },
        ],
        open_questions: ["Need one more source for edge-case validation."],
        completion_notes: ["Delegation demo path executed successfully."],
        criteria_evidence: [
          "Provide at least three evidence bullets",
          "List unresolved research questions",
        ],
        raw_output: "delegation-demo-raw-output",
      }),
    },
  );
}
