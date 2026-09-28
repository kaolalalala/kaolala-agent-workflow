import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenOrchestrator } from "@/server/meta-agent/todo-driven/orchestrator";
import type {
  SubagentExecutionResult,
  TodoExecutor,
} from "@/server/meta-agent/todo-driven";

describe("parallel paper download recovery regression", () => {
  it("starts both paper batches in the same wave and recovers a failed batch in serial", async () => {
    const waveStarts: string[] = [];
    const attemptCount = new Map<string, number>();
    let releaseFirstBatch: (() => void) | null = null;
    const firstBatchGate = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });

    const executor: TodoExecutor = async (context, _state, todo) => ({
      status: "success",
      output: context.current_todo.acceptance_criteria.join(" "),
      summary: `ok:${todo.id}`,
      criteria_evidence: [...context.current_todo.acceptance_criteria],
      artifact: {
        path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\${todo.id}.md`,
        type: todo.id === "todo_deliver" ? "final_output" : "todo_result",
        summary: todo.id === "todo_deliver" ? "final paper delivery completed" : `artifact ${todo.id}`,
      },
    });

    const state = createRunState("Download 20 agent RL papers with two parallel collection batches.");
    addTodo(state, {
      id: "todo_collect_1",
      title: "Download paper batch 1",
      description: "Collect papers 1 through 10 and persist a structured batch manifest.",
      status: "ready",
      priority: "high",
      assignee: "single_executor",
      capability_type: "collection",
      depends_on: [],
      acceptance_criteria: [
        "batch_1_manifest_ready",
        "batch_1_contains_10_papers",
      ],
      input_refs: [],
      notes: ["planner_parallel_batch:1-10"],
    });
    addTodo(state, {
      id: "todo_collect_2",
      title: "Download paper batch 2",
      description: "Collect papers 11 through 20 and persist a structured batch manifest.",
      status: "ready",
      priority: "high",
      assignee: "single_executor",
      capability_type: "collection",
      depends_on: [],
      acceptance_criteria: [
        "batch_2_manifest_ready",
        "batch_2_contains_10_papers",
      ],
      input_refs: [],
      notes: ["planner_parallel_batch:11-20"],
    });
    addTodo(state, {
      id: "todo_merge",
      title: "Merge both paper manifests",
      description: "Merge the two batch manifests into one deduplicated paper manifest.",
      status: "todo",
      priority: "high",
      assignee: "single_executor",
      capability_type: "merge",
      depends_on: ["todo_collect_1", "todo_collect_2"],
      acceptance_criteria: [
        "merged_manifest_ready",
        "merged_manifest_contains_20_papers",
      ],
      input_refs: [],
    });
    addTodo(state, {
      id: "todo_deliver",
      title: "Deliver final paper package",
      description: "Produce the final delivery package from the merged paper manifest.",
      status: "todo",
      priority: "high",
      assignee: "single_executor",
      capability_type: "writing",
      depends_on: ["todo_merge"],
      acceptance_criteria: [
        "final_delivery_ready",
        "final_delivery_manifest_present",
      ],
      input_refs: [],
    });

    const result = await runTodoDrivenOrchestrator(
      {
        goal: "Download 20 agent RL papers with two parallel collection subagents.",
        maxPlanningRounds: 2,
      },
      {
        initialState: state,
        maxSteps: 9,
        parallel: { enabled: true, max_parallel_todos: 2 },
        stepExecutor: executor,
        subagentRunner: async (_agent, brief): Promise<SubagentExecutionResult> => {
          const nextAttempt = (attemptCount.get(brief.todo_id) ?? 0) + 1;
          attemptCount.set(brief.todo_id, nextAttempt);

          if (brief.todo_id === "todo_collect_1") {
            waveStarts.push(`${brief.todo_id}:${nextAttempt}`);
            await firstBatchGate;
            return {
              status: "success",
              summary: "batch 1 downloaded",
              artifacts: [],
              open_questions: [],
              completion_notes: [],
              criteria_evidence: [...brief.acceptance_criteria],
            };
          }

          if (brief.todo_id === "todo_collect_2" && nextAttempt === 1) {
            waveStarts.push(`${brief.todo_id}:${nextAttempt}`);
            releaseFirstBatch?.();
            return {
              status: "error",
              summary: "batch 2 failed once",
              artifacts: [],
              open_questions: [],
              completion_notes: [],
              criteria_evidence: [],
              error_message: "transient structured download failure",
            };
          }

          if (brief.todo_id === "todo_collect_2" && nextAttempt === 2) {
            return {
              status: "error",
              summary: "batch 2 serial retry needed",
              artifacts: [],
              open_questions: [],
              completion_notes: [],
              criteria_evidence: [],
              error_message: "serial retry still needed",
            };
          }

          if (brief.todo_id === "todo_collect_2") {
            return {
              status: "success",
              summary: "batch 2 recovered",
              artifacts: [],
              open_questions: [],
              completion_notes: [],
              criteria_evidence: [...brief.acceptance_criteria],
            };
          }

          return {
            status: "success",
            summary: `delegated:${brief.todo_id}`,
            artifacts: [],
            open_questions: [],
            completion_notes: [],
            criteria_evidence: [...brief.acceptance_criteria],
          };
        },
      },
    );

    expect(waveStarts.slice(0, 2).sort()).toEqual(["todo_collect_1:1", "todo_collect_2:1"]);
    expect(result.result.status).toBe("success");
    expect(result.state.status).toBe("completed");

    const recoveredBatch = result.state.todos.find((todo) => todo.id === "todo_collect_2");
    expect(recoveredBatch?.status).toBe("done");
    expect(recoveredBatch?.serial_only).toBe(true);
    expect(recoveredBatch?.downgraded_from_wave).toBe(true);
    expect(recoveredBatch?.retry_count).toBe(1);

    expect(
      result.state.execution_log.some((entry) =>
        entry.todo_id === "todo_collect_2" && entry.action === "downgrade_to_serial"),
    ).toBe(true);
    expect(
      result.state.execution_log.some((entry) =>
        entry.todo_id === "todo_collect_2" && entry.action === "retry_started"),
    ).toBe(true);
    expect(
      result.state.execution_log.some((entry) =>
        entry.todo_id === "todo_collect_2" && entry.action === "reroute_started"),
    ).toBe(false);
  });
});
