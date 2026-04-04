import { describe, expect, it } from "vitest";

import {
  addIssue,
  addTodo,
  addWorkspaceFile,
  createRunState,
} from "@/server/meta-agent/supervisor-runtime-state";
import {
  createProjectState,
  updateProjectStateFromRun,
} from "@/server/meta-agent/project-state";
import type { MetaAgentResult } from "@/server/meta-agent/types";

function buildResult(goal: string, status: MetaAgentResult["status"], finalScore = 0.86): MetaAgentResult {
  return {
    status,
    goal,
    finalOutput: "final output",
    finalScore,
    steps: [],
    iterations: [],
    totalDurationMs: 1200,
    totalTokensUsed: 88,
    workflowEvolution: [],
  };
}

describe("project state", () => {
  it("summarizes successful runs and promotes reusable workspace refs", () => {
    const state = createRunState("find 10 agent papers", { projectId: "proj_alpha" });
    addTodo(state, {
      id: "todo_scope",
      title: "Define scope",
      description: "Clarify scope",
      status: "done",
      capability_type: "planning",
      priority: "critical",
      acceptance_criteria: ["scope is clear", "constraints listed"],
      depends_on: [],
      assignee: "supervisor",
    });
    addTodo(state, {
      id: "todo_research",
      title: "Collect papers",
      description: "Find papers",
      status: "done",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["papers listed", "relevance noted"],
      depends_on: ["todo_scope"],
      assignee: "research_agent",
      review_result: "pass",
      assignee_history: ["research_agent"],
    });
    addTodo(state, {
      id: "todo_deliver",
      title: "Deliver answer",
      description: "Write final answer",
      status: "done",
      capability_type: "writing",
      priority: "high",
      acceptance_criteria: ["final answer complete", "readable output"],
      depends_on: ["todo_research"],
      assignee: "writer_agent",
      assignee_history: ["writer_agent"],
    });

    addWorkspaceFile(state, {
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\run1\\todo_research\\notes.md",
      kind: "research_notes",
      related_todo: "todo_research",
      producer: "research_agent",
      content_summary: "ten relevant papers with short notes",
      retention: "reusable",
    });
    addWorkspaceFile(state, {
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\run1\\todo_deliver\\final.md",
      kind: "final_output",
      related_todo: "todo_deliver",
      producer: "writer_agent",
      content_summary: "final curated paper list",
      retention: "final",
    });
    addIssue(state, {
      todo_id: "todo_research",
      type: "verifiability_low",
      message: "relevance note was initially too weak",
      status: "open",
    });

    const next = updateProjectStateFromRun(
      createProjectState("proj_alpha", "paper research"),
      state,
      buildResult(state.goal, "success"),
    );

    expect(next.run_summaries).toHaveLength(1);
    expect(next.run_summaries[0].source_run_id).toBe(state.run_id);
    expect(next.reusable_workspace_refs.some((item) => item.kind === "research_notes")).toBe(true);
    expect(next.reusable_workspace_refs.some((item) => item.kind === "final_output")).toBe(true);
    expect(next.recurring_failure_patterns.some((item) => item.type === "verifiability_low")).toBe(true);
    expect(next.successful_todo_skeletons).toHaveLength(1);
    expect(next.stable_source_profiles.some((item) => item.source_key === "research_agent:research_notes")).toBe(true);
  });

  it("does not promote a successful skeleton from a failed run", () => {
    const state = createRunState("failed project run", { projectId: "proj_beta" });
    addTodo(state, {
      id: "todo_fail",
      title: "Broken task",
      description: "This fails",
      status: "failed",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["must succeed"],
      depends_on: [],
    });

    const next = updateProjectStateFromRun(
      createProjectState("proj_beta"),
      state,
      buildResult(state.goal, "failed", 0.2),
    );

    expect(next.successful_todo_skeletons).toHaveLength(0);
  });
});
