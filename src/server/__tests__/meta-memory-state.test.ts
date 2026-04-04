import { describe, expect, it } from "vitest";

import {
  addTodo,
  createRunState,
  type TodoRecoveryRecord,
} from "@/server/meta-agent/supervisor-runtime-state";
import {
  createMemoryState,
  updateMemoryStateFromRun,
} from "@/server/meta-agent/memory-state";
import type { MetaAgentResult } from "@/server/meta-agent/types";

function buildResult(goal: string, status: MetaAgentResult["status"], finalScore = 0.82): MetaAgentResult {
  return {
    status,
    goal,
    finalOutput: "result",
    finalScore,
    steps: [],
    iterations: [],
    totalDurationMs: 900,
    totalTokensUsed: 42,
    workflowEvolution: [],
  };
}

describe("memory state", () => {
  it("extracts planner, routing, review, and recovery memories from a run", () => {
    const state = createRunState("research and write summary", { projectId: "proj_mem" });
    addTodo(state, {
      id: "todo_scope",
      title: "Define scope",
      description: "Clarify scope",
      status: "done",
      capability_type: "planning",
      priority: "critical",
      acceptance_criteria: ["scope clear", "constraints listed"],
      depends_on: [],
      assignee: "supervisor",
    });
    addTodo(state, {
      id: "todo_research",
      title: "Collect evidence",
      description: "Research evidence",
      status: "done",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["sources found", "evidence extracted"],
      depends_on: ["todo_scope"],
      assignee: "research_agent",
      assignee_history: ["writer_agent", "research_agent"],
      review_result: "pass",
      recovery_history: [
        {
          timestamp: new Date().toISOString(),
          action: "reroute",
          reason: "writer agent lacked source coverage",
          target_agent_id: "research_agent",
        } satisfies TodoRecoveryRecord,
      ],
      reroute_count: 1,
      last_recovery_action: "reroute",
    });
    addTodo(state, {
      id: "todo_write",
      title: "Write summary",
      description: "Write the final answer",
      status: "done",
      capability_type: "writing",
      priority: "high",
      acceptance_criteria: ["include title author year abstract", "readable summary"],
      depends_on: ["todo_research"],
      assignee: "writer_agent",
      assignee_history: ["writer_agent"],
      review_result: "revise",
      last_missing_criteria: ["include title author year abstract"],
      last_failure_reason: "missing structured metadata",
    });

    const next = updateMemoryStateFromRun(
      createMemoryState("proj_mem"),
      state,
      buildResult(state.goal, "success"),
    );

    expect(next.planner_memories).toHaveLength(1);
    expect(next.planner_memories[0].source_run_id).toBe(state.run_id);
    expect(next.planner_memories[0].confidence).toBeGreaterThan(0.5);
    expect(next.routing_memories.some((item) => item.capability_type === "research" && item.preferred_agent_id === "research_agent")).toBe(true);
    expect(next.review_memories.some((item) => item.frequent_missing_criteria.includes("include title author year abstract"))).toBe(true);
    expect(next.recovery_memories.some((item) => item.preferred_action === "reroute" && item.preferred_target_agent_id === "research_agent")).toBe(true);
  });

  it("does not generate planner memory from a failed low-quality run", () => {
    const state = createRunState("failed planning memory", { projectId: "proj_fail_mem" });
    addTodo(state, {
      id: "todo_fail",
      title: "Failed task",
      description: "This task failed",
      status: "failed",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["must pass"],
      depends_on: [],
    });

    const next = updateMemoryStateFromRun(
      createMemoryState("proj_fail_mem"),
      state,
      buildResult(state.goal, "failed", 0.2),
    );

    expect(next.planner_memories).toHaveLength(0);
  });
});
