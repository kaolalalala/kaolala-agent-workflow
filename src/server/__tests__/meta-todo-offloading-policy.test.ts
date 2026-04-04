import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { decideOffload } from "@/server/meta-agent/todo-driven/offloading-policy";

function buildTodo(capability: "research" | "writing" | "analysis" | "review") {
  const state = createRunState("offload test");
  return addTodo(state, {
    id: `todo_${capability}`,
    title: `${capability} todo`,
    description: `${capability} description with enough detail`,
    capability_type: capability,
    priority: "high",
    status: "ready",
    depends_on: [],
    acceptance_criteria: ["criterion_a", "criterion_b"],
  });
}

describe("offloading policy", () => {
  it("offloads large research text", () => {
    const todo = buildTodo("research");
    const decision = decideOffload({
      content: "paper\n".repeat(500),
      result_type: "paper_search_result",
      related_todo: todo,
      producer: "research_agent",
    });
    expect(decision.should_offload).toBe(true);
    expect(decision.artifact_kind).toBe("research_notes");
  });

  it("keeps small final output inline", () => {
    const todo = buildTodo("writing");
    const decision = decideOffload({
      content: "Here is a compact final answer.",
      result_type: "final_output",
      related_todo: todo,
      producer: "writer_agent",
    });
    expect(decision.should_offload).toBe(false);
    expect(decision.offload_mode).toBe("inline");
  });

  it("offloads large json payloads", () => {
    const todo = buildTodo("analysis");
    const payload = JSON.stringify({
      items: Array.from({ length: 80 }, (_, index) => ({
        id: index,
        title: `item-${index}`,
        body: "x".repeat(40),
      })),
    });
    const decision = decideOffload({
      content: payload,
      result_type: "tool_result_json",
      related_todo: todo,
      producer: "tool_runner",
    });
    expect(decision.should_offload).toBe(true);
    expect(decision.offload_mode).toBe("structured_file");
  });

  it("keeps short review feedback inline", () => {
    const todo = buildTodo("review");
    const decision = decideOffload({
      content: "Two criteria missing. Please add citations.",
      result_type: "review_notes",
      related_todo: todo,
      producer: "reviewer",
    });
    expect(decision.should_offload).toBe(false);
  });
});
