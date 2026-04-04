import { describe, expect, it } from "vitest";

import { addArtifact, addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import {
  assertArtifactOwnership,
  assertTodoBoundAction,
} from "@/server/meta-agent/todo-driven/ownership-guard";

describe("todo ownership hard guard", () => {
  it("self execute without todo_id must fail", () => {
    const state = createRunState("ownership-self");
    expect(() => assertTodoBoundAction(state, "self_execute", null)).toThrow(/todo_id/i);
  });

  it("delegate without todo_id must fail", () => {
    const state = createRunState("ownership-delegate");
    expect(() => assertTodoBoundAction(state, "delegate", "")).toThrow(/todo_id/i);
  });

  it("review without todo_id must fail", () => {
    const state = createRunState("ownership-review");
    expect(() => assertTodoBoundAction(state, "review", undefined)).toThrow(/todo_id/i);
  });

  it("artifact writeback without related_todo must fail", () => {
    const state = createRunState("ownership-artifact");
    addTodo(state, {
      id: "todo_1",
      title: "todo",
      description: "desc",
      status: "ready",
      acceptance_criteria: ["x"],
    });

    expect(() => assertArtifactOwnership(state, "artifact_writeback", "")).toThrow(/todo_id/i);
    expect(() =>
      addArtifact(state, {
        path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\bad.md",
        type: "report",
        producer: "supervisor",
        related_todo: "",
        summary: "bad artifact",
      }),
    ).toThrow(/related_todo/i);
  });
});

