import { afterEach, describe, expect, it, vi } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { buildDelegationBrief } from "@/server/meta-agent/todo-driven/delegation-brief-builder";
import { getSubagentById } from "@/server/meta-agent/todo-driven/subagent-registry";
import * as skillCenter from "@/server/meta-agent/skill-resource-center";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("meta-agent resource-center tool exposure", () => {
  it("does not inject paper-specific structured tasks into collection briefs", () => {
    const state = createRunState("Download 20 agent RL papers with two parallel subagents.");
    const todo = addTodo(state, {
      id: "todo_collect_1",
      title: "Parallel paper download batch 1",
      description: "Collect the first half of the requested materials.",
      status: "ready",
      priority: "high",
      assignee: "single_executor",
      capability_type: "collection",
      depends_on: [],
      acceptance_criteria: [
        "batch result is complete",
        "batch output can be merged later",
      ],
      input_refs: [],
      notes: ["planner_parallel_batch:1-10"],
      extra_tools: ["tool_arxiv_search_download_batch"],
    });
    const agent = getSubagentById("collector_agent");
    if (!agent) {
      throw new Error("collector_agent missing");
    }

    const brief = buildDelegationBrief(state, todo, agent);
    expect("structured_task" in brief).toBe(false);
  });

  it("exposes enabled resource-center skills as callable tools for subagents", () => {
    vi.spyOn(skillCenter, "selectMetaAgentSkillResources").mockReturnValue([
      {
        id: "skill_agent_rl_pack",
        name: "Agent RL Pack",
        description: "Download and normalize Agent RL resources",
        outputDescription: "Structured paper manifest",
        parameterSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
        localPath: "D:\\skills\\agent_rl",
        runCommand: "python tool.py {query}",
      },
    ]);

    const state = createRunState("Collect materials");
    const todo = addTodo(state, {
      id: "todo_collect",
      title: "Collect materials",
      description: "Collect the requested materials.",
      status: "ready",
      priority: "high",
      assignee: "single_executor",
      capability_type: "collection",
      depends_on: [],
      acceptance_criteria: ["collection completes", "output is structured"],
      input_refs: [],
    });
    const agent = getSubagentById("collector_agent");
    if (!agent) {
      throw new Error("collector_agent missing");
    }

    const brief = buildDelegationBrief(state, todo, agent);
    expect(brief.resolved_tools?.some((tool) => tool.toolId === "skill:skill_agent_rl_pack")).toBe(true);
    expect(brief.resource_center?.skills[0]?.name).toBe("Agent RL Pack");
  });
});
