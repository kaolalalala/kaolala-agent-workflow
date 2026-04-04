import { describe, expect, it } from "vitest";

import { createMemoryState, type MemoryState } from "@/server/meta-agent/memory-state";
import { createProjectState } from "@/server/meta-agent/project-state";
import {
  addTodo,
  createRunState,
  type TodoItem,
} from "@/server/meta-agent/supervisor-runtime-state";
import { decideTodoExecutionMode } from "@/server/meta-agent/todo-driven/delegation-policy";
import { planInitialTodos } from "@/server/meta-agent/todo-driven/planner";
import { decideRecoveryAction } from "@/server/meta-agent/todo-driven/recovery-policy";
import { reviewTodoExecution } from "@/server/meta-agent/todo-driven/review";
import type { TodoExecutionContext } from "@/server/meta-agent/todo-driven/types";

function buildContext(todo: TodoItem): TodoExecutionContext {
  return {
    goal: "write a structured research answer",
    run_id: "run_test",
    current_todo: {
      id: todo.id,
      title: todo.title,
      description: todo.description,
      acceptance_criteria: todo.acceptance_criteria,
    },
    input_artifacts: [],
    history_summary: {
      completed_todos: [],
      recent_logs: [],
      open_issues: [],
    },
    memory_hints: {
      review: [],
    },
    recovery_context: {
      retry_count: todo.retry_count ?? 0,
      reroute_count: todo.reroute_count ?? 0,
      last_missing_criteria: todo.last_missing_criteria ?? [],
      guidance_notes: [],
    },
  };
}

describe("project/memory integration", () => {
  it("injects project and planner memory hints into planner prompt", async () => {
    const projectState = createProjectState("proj_plan");
    projectState.successful_todo_skeletons.push({
      template_id: "skeleton_1",
      source_run_id: "run_a",
      goal_hint: "parallel literature search",
      todo_titles: ["Define scope", "Parallel search batch 1", "Parallel search batch 2", "Merge", "Deliver"],
      capability_flow: ["planning", "research", "research", "analysis", "writing"],
      dependency_edges: [],
      confidence: 0.8,
      usage_count: 0,
      updated_at: new Date().toISOString(),
    });
    projectState.reusable_workspace_refs.push({
      ref_id: "ref_1",
      source_run_id: "run_a",
      workspace_file_id: "wsf_1",
      path: "D:\\tmp\\papers.md",
      kind: "research_notes",
      related_todo: "todo_research",
      producer: "research_agent",
      summary: "previous project found authoritative benchmark papers",
      topic_hint: "agent framework papers",
      scope: "project",
      retention: "reusable",
      confidence: 0.8,
      created_at: new Date().toISOString(),
    });

    const memoryState = createMemoryState("proj_plan");
    memoryState.planner_memories.push({
      memory_id: "pm_1",
      source_run_id: "run_a",
      goal_pattern: "agent framework literature review",
      recommended_capability_flow: ["planning", "research", "analysis", "writing"],
      suggested_acceptance_patterns: ["each batch has clear ownership", "final merge removes duplicates"],
      risky_mixed_task_patterns: ["single generic collect todo"],
      notes: ["parallel fan-out with merge works well"],
      confidence: 0.8,
      usage_count: 0,
      updated_at: new Date().toISOString(),
    });

    let capturedPrompt = "";
    await planInitialTodos(
      "Find 20 papers about agent frameworks with two parallel research agents",
      {
        project_context: {
          project_id: projectState.project_id,
          successful_todo_skeletons: projectState.successful_todo_skeletons.map((item) => ({
            goal_hint: item.goal_hint,
            todo_titles: item.todo_titles,
            capability_flow: item.capability_flow,
          })),
          reusable_workspace_refs: projectState.reusable_workspace_refs.map((item) => ({
            kind: item.kind,
            summary: item.summary,
            topic_hint: item.topic_hint,
          })),
          planner_memories: memoryState.planner_memories.map((item) => ({
            goal_pattern: item.goal_pattern,
            recommended_capability_flow: item.recommended_capability_flow,
            suggested_acceptance_patterns: item.suggested_acceptance_patterns,
            notes: item.notes,
          })),
          recurring_failure_patterns: [{ type: "verifiability_low", signal: "generic acceptance criteria" }],
        },
      },
      {
        invokeLlm: async (messages) => {
          capturedPrompt = messages[1]?.content ?? "";
          return JSON.stringify({
            todos: [
              {
                id: "todo_scope",
                title: "Define scope",
                description: "Clarify paper search scope",
                priority: "critical",
                capability_type: "planning",
                assignee: "single_executor",
                depends_on: [],
                acceptance_criteria: ["scope clear", "parallel plan defined"],
                input_refs: [],
              },
              {
                id: "todo_collect_1",
                title: "Parallel search batch 1",
                description: "Search first 10 papers",
                priority: "high",
                capability_type: "research",
                assignee: "single_executor",
                depends_on: ["todo_scope"],
                acceptance_criteria: ["10 papers found", "relevance noted"],
                input_refs: [],
              },
              {
                id: "todo_collect_2",
                title: "Parallel search batch 2",
                description: "Search second 10 papers",
                priority: "high",
                capability_type: "research",
                assignee: "single_executor",
                depends_on: ["todo_scope"],
                acceptance_criteria: ["10 papers found", "relevance noted"],
                input_refs: [],
              },
            ],
          });
        },
      },
    );

    expect(capturedPrompt).toContain("Project memory context");
    expect(capturedPrompt).toContain("Successful todo skeletons");
    expect(capturedPrompt).toContain("Reusable workspace refs");
    expect(capturedPrompt).toContain("Planner memories");
  });

  it("uses routing memory to steer delegation target", () => {
    const state = createRunState("analysis routing", { projectId: "proj_route" });
    addTodo(state, {
      id: "todo_analysis",
      title: "Analyze the retrieved evidence",
      description: "Analyze evidence and surface patterns",
      status: "ready",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["patterns extracted", "recommendations listed"],
      depends_on: [],
    });
    const todo = state.todos[0];
    const memoryState: MemoryState = createMemoryState("proj_route");
    memoryState.routing_memories.push({
      memory_id: "rm_1",
      source_run_id: "run_old",
      capability_type: "analysis",
      preferred_mode: "delegate",
      preferred_agent_id: "research_agent",
      avoid_agent_ids: [],
      reason: "analysis in this project needs evidence-first synthesis",
      confidence: 0.8,
      usage_count: 0,
      updated_at: new Date().toISOString(),
    });

    const decision = decideTodoExecutionMode(state, todo, memoryState);
    expect(decision.mode).toBe("delegate");
    expect(decision.target_agent_id).toBe("research_agent");
  });

  it("uses review memory to make heuristic review stricter on known weak criteria", async () => {
    const todo: TodoItem = {
      id: "todo_review",
      title: "Write structured paper summary",
      description: "Produce structured paper metadata",
      status: "reviewing",
      priority: "high",
      assignee: "writer_agent",
      capability_type: "writing",
      depends_on: [],
      acceptance_criteria: ["include title author year abstract"],
      input_refs: [],
      retry_count: 0,
      delegation_status: "returned",
      assignee_history: ["writer_agent"],
      notes: [],
    };
    const memoryState = createMemoryState("proj_review");
    memoryState.review_memories.push({
      memory_id: "rev_1",
      source_run_id: "run_old",
      capability_type: "writing",
      weak_criteria_patterns: [],
      frequent_missing_criteria: ["include title author year abstract"],
      reason: "this metadata criterion is often only partially satisfied",
      confidence: 0.8,
      usage_count: 0,
      updated_at: new Date().toISOString(),
    });

    const withoutMemory = await reviewTodoExecution(
      todo,
      {
        status: "success",
        output: "title author year",
        summary: "title author year",
      },
      buildContext(todo),
      { forceHeuristic: true },
    );
    const withMemory = await reviewTodoExecution(
      todo,
      {
        status: "success",
        output: "title author year",
        summary: "title author year",
      },
      buildContext(todo),
      { memoryState, forceHeuristic: true },
    );

    expect(withoutMemory.status).toBe("pass");
    expect(withMemory.status).not.toBe("pass");
  });

  it("uses recovery memory to prefer reroute for known mismatched agent failures", () => {
    const state = createRunState("recovery routing", { projectId: "proj_recovery" });
    addTodo(state, {
      id: "todo_research",
      title: "Collect papers",
      description: "Research papers and evidence",
      status: "reviewing",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["sources found", "evidence extracted"],
      depends_on: [],
      assignee: "writer_agent",
      assignee_history: ["writer_agent"],
      retry_count: 0,
      reroute_count: 0,
      notes: [],
    });
    const todo = state.todos[0];
    const memoryState = createMemoryState("proj_recovery");
    memoryState.recovery_memories.push({
      memory_id: "rec_1",
      source_run_id: "run_old",
      capability_type: "research",
      preferred_action: "reroute",
      preferred_target_agent_id: "research_agent",
      trigger_pattern: "wrong agent focus",
      outcome: "helpful",
      reason: "research tasks recovered well after reroute to research_agent",
      confidence: 0.8,
      usage_count: 0,
      updated_at: new Date().toISOString(),
    });

    const decision = decideRecoveryAction(
      {
        state,
        todo,
        execution_mode: "delegate",
        delegated_agent_id: "writer_agent",
        review_result: {
          status: "fail",
          reason: "wrong agent focus",
          missing_criteria: ["sources found", "evidence extracted"],
        },
        in_wave: false,
      },
      { max_retry_per_todo: 1, max_reroute_per_todo: 2 },
      memoryState,
    );

    expect(decision.action).toBe("reroute");
    expect(decision.target_agent_id).toBe("research_agent");
  });
});
