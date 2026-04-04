import { describe, expect, it } from "vitest";

import {
  addTodo,
  addWorkspaceFile,
  createRunState,
} from "@/server/meta-agent/supervisor-runtime-state";
import { buildDelegationBrief } from "@/server/meta-agent/todo-driven/delegation-brief-builder";
import { getSubagentById } from "@/server/meta-agent/todo-driven/subagent-registry";
import {
  getAutonomyMaxRounds,
  injectAutonomyTools,
} from "@/server/meta-agent/todo-driven/subagent-workspace-tools";

describe("subagent autonomy upgrade", () => {
  it("injects the correct autonomy tools per level", () => {
    expect(injectAutonomyTools("basic")).toHaveLength(0);
    expect(injectAutonomyTools("enhanced").map((tool) => tool.toolId)).toEqual([
      "workspace_read",
      "workspace_write",
      "think_and_plan",
    ]);
    expect(injectAutonomyTools("full", 0).map((tool) => tool.toolId)).toContain("delegate_subtask");
    expect(injectAutonomyTools("full", 1).map((tool) => tool.toolId)).not.toContain("delegate_subtask");

    expect(getAutonomyMaxRounds("basic")).toBe(6);
    expect(getAutonomyMaxRounds("enhanced")).toBe(12);
    expect(getAutonomyMaxRounds("full")).toBe(20);
  });

  it("builds delegation brief with workspace permissions and autonomy override", () => {
    const state = createRunState("autonomy brief");
    addTodo(state, {
      id: "todo_source",
      title: "Collect notes",
      description: "collect notes",
      status: "done",
      priority: "high",
      capability_type: "research",
      acceptance_criteria: ["notes exist", "notes are relevant"],
      depends_on: [],
    });
    addWorkspaceFile(state, {
      file_id: "wsf_dep",
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\run\\todo_source\\notes.md",
      kind: "research_notes",
      related_todo: "todo_source",
      producer: "research_agent",
      content_summary: "dependency notes",
    });
    addTodo(state, {
      id: "todo_target",
      title: "Analyze notes",
      description: "analyze dependency notes",
      status: "ready",
      priority: "high",
      capability_type: "analysis",
      acceptance_criteria: ["analysis complete", "recommendations extracted"],
      depends_on: ["todo_source"],
      autonomy_override: "full",
    });

    const agent = getSubagentById("analyst_agent");
    if (!agent) throw new Error("analyst_agent missing");

    const brief = buildDelegationBrief(state, state.todos.find((todo) => todo.id === "todo_target")!, agent);
    expect(brief.autonomy_level).toBe("full");
    expect(brief.workspace_file_ids).toEqual(["wsf_dep"]);
    expect(agent.autonomy_level).toBe("enhanced");
  });
});
