import { afterEach, describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { buildDelegationBrief } from "@/server/meta-agent/todo-driven/delegation-brief-builder";
import { getSubagentById } from "@/server/meta-agent/todo-driven/subagent-registry";

afterEach(() => {
  // keep symmetrical with other meta-agent tests
});

describe("meta-agent no longer hard-codes structured paper ops", () => {
  it("keeps merge todos generic and leaves merge strategy to the model", () => {
    const state = createRunState("Merge the collected materials.");
    addTodo(state, {
      id: "todo_collect_1",
      title: "Collect batch 1",
      description: "Collect batch 1",
      status: "done",
      capability_type: "collection",
      acceptance_criteria: ["batch complete", "output exists"],
    });
    addTodo(state, {
      id: "todo_collect_2",
      title: "Collect batch 2",
      description: "Collect batch 2",
      status: "done",
      capability_type: "collection",
      acceptance_criteria: ["batch complete", "output exists"],
    });
    const todo = addTodo(state, {
      id: "todo_merge_results",
      title: "Merge results",
      description: "Merge previous outputs into one result.",
      status: "ready",
      capability_type: "merge",
      depends_on: ["todo_collect_1", "todo_collect_2"],
      acceptance_criteria: ["merged result exists", "duplicates removed"],
    });

    const agent = getSubagentById("merge_agent");
    if (!agent) throw new Error("merge_agent missing");

    const brief = buildDelegationBrief(state, todo, agent);
    expect("structured_task" in brief).toBe(false);
  });

  it("keeps verification todos generic and does not force deterministic paper verification", () => {
    const state = createRunState("Verify the final outputs.");
    addTodo(state, {
      id: "todo_collect_1",
      title: "Collect batch 1",
      description: "Collect batch 1",
      status: "done",
      capability_type: "collection",
      acceptance_criteria: ["batch complete", "output exists"],
    });
    addTodo(state, {
      id: "todo_collect_2",
      title: "Collect batch 2",
      description: "Collect batch 2",
      status: "done",
      capability_type: "collection",
      acceptance_criteria: ["batch complete", "output exists"],
    });
    const todo = addTodo(state, {
      id: "todo_verify_results",
      title: "Verify final outputs",
      description: "Verify the merged outputs before delivery.",
      status: "ready",
      capability_type: "verification",
      depends_on: ["todo_collect_1", "todo_collect_2"],
      acceptance_criteria: ["checks are complete", "problems are reported"],
    });

    const agent = getSubagentById("verification_agent");
    if (!agent) throw new Error("verification_agent missing");

    const brief = buildDelegationBrief(state, todo, agent);
    expect("structured_task" in brief).toBe(false);
  });
});
