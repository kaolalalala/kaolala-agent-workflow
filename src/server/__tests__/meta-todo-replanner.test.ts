import { describe, expect, it } from "vitest";

import {
  addTodo,
  createRunState,
} from "@/server/meta-agent/supervisor-runtime-state";
import {
  applyReplanDecision,
  checkReplanTrigger,
  evaluateReplan,
} from "@/server/meta-agent/todo-driven/replanner";

describe("todo replanner", () => {
  it("triggers replanning when new discovery signals appear", () => {
    const state = createRunState("replan trigger");
    addTodo(state, {
      id: "todo_a",
      title: "Done A",
      description: "done a",
      status: "done",
      priority: "high",
      capability_type: "research",
      acceptance_criteria: ["a1", "a2"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_b",
      title: "Done B",
      description: "done b",
      status: "done",
      priority: "high",
      capability_type: "analysis",
      acceptance_criteria: ["b1", "b2"],
      depends_on: [],
      notes: ["discover: need follow-up branch"],
    });
    addTodo(state, {
      id: "todo_c",
      title: "Ready C",
      description: "ready c",
      status: "ready",
      priority: "high",
      capability_type: "writing",
      acceptance_criteria: ["c1", "c2"],
      depends_on: [],
    });

    const trigger = checkReplanTrigger(state, undefined, undefined, { currentStep: 4 });
    expect(trigger.shouldReplan).toBe(true);
    expect(trigger.reasons).toContain("new_discovery_signal_detected");
  });

  it("applies prune + add decisions after validation", async () => {
    const state = createRunState("replan apply");
    addTodo(state, {
      id: "todo_scope",
      title: "Define scope",
      description: "define scope well enough",
      status: "done",
      priority: "critical",
      capability_type: "planning",
      acceptance_criteria: ["scope clear", "constraints clear"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_old",
      title: "Old ready work",
      description: "old branch to prune",
      status: "ready",
      priority: "medium",
      capability_type: "research",
      acceptance_criteria: ["old one", "old two"],
      depends_on: ["todo_scope"],
    });

    const decision = await evaluateReplan(state, 12, 4, {
      invokeLlm: async () => ({
        content: JSON.stringify({
          action: "replace_plan",
          reason: "new findings require a more focused branch",
          new_todos: [
            {
              id: "todo_follow_research",
              title: "Investigate the new branch",
              description: "research the newly discovered branch in detail",
              priority: "high",
              capability_type: "research",
              assignee: "single_executor",
              depends_on: ["todo_scope"],
              acceptance_criteria: ["new branch is investigated", "findings are structured"],
              input_refs: [],
            },
            {
              id: "todo_follow_delivery",
              title: "Deliver the adjusted answer",
              description: "write the adjusted answer from the new branch findings",
              priority: "high",
              capability_type: "writing",
              assignee: "single_executor",
              depends_on: ["todo_follow_research"],
              acceptance_criteria: ["answer is updated", "result is readable"],
              input_refs: [],
            },
          ],
          prune_todo_ids: ["todo_old"],
        }),
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
          source: "estimated",
        },
      }),
    });

    const applied = applyReplanDecision(state, decision, 4);
    expect(applied.prunedTodoIds).toContain("todo_old");
    expect(state.todos.find((todo) => todo.id === "todo_old")?.status).toBe("pruned");
    expect(applied.addedTodoIds).toContain("todo_follow_research");
    expect(applied.addedTodoIds).toContain("todo_follow_delivery");
    expect(Number(state.metadata.replan_count)).toBe(1);
    expect(Number(state.metadata.last_replan_step)).toBe(4);
  });

  it("repairs weak replanner drafts instead of failing validation outright", () => {
    const state = createRunState("replan repair");
    addTodo(state, {
      id: "todo_scope",
      title: "Define scope",
      description: "define scope with enough detail for downstream work",
      status: "done",
      priority: "critical",
      capability_type: "planning",
      acceptance_criteria: ["scope is clear", "constraints are clear"],
      depends_on: [],
    });

    const applied = applyReplanDecision(
      state,
      {
        action: "add_todos",
        reason: "new evidence requires a follow-up branch",
        new_todos: [
          {
            id: "todo_follow_1",
            title: "Investigate branch",
            description: "",
            priority: "high",
            capability_type: "research",
            assignee: "single_executor",
            depends_on: [],
            acceptance_criteria: ["done"],
            input_refs: [],
          },
          {
            id: "todo_follow_2",
            title: "Deliver branch update",
            description: "",
            priority: "high",
            capability_type: "writing",
            assignee: "single_executor",
            depends_on: [],
            acceptance_criteria: [],
            input_refs: [],
          },
        ],
      },
      6,
    );

    expect(applied.addedTodoIds).toEqual(["todo_follow_1", "todo_follow_2"]);
    const follow1 = state.todos.find((todo) => todo.id === "todo_follow_1");
    const follow2 = state.todos.find((todo) => todo.id === "todo_follow_2");
    expect(follow1?.description.length ?? 0).toBeGreaterThanOrEqual(14);
    expect((follow1?.acceptance_criteria ?? []).length).toBeGreaterThanOrEqual(2);
    expect(follow1?.depends_on).toContain("todo_scope");
    expect(follow2?.depends_on).toContain("todo_follow_1");
    expect(state.issues.some((issue) => issue.type === "replan_validation_failed")).toBe(false);
  });
});
