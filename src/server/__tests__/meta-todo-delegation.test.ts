import { describe, expect, it } from "vitest";

import { addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { decideTodoExecutionMode } from "@/server/meta-agent/todo-driven/delegation-policy";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import { getSubagentById, listSubagents } from "@/server/meta-agent/todo-driven/subagent-registry";
import type { SubagentDefinition, SubagentExecutionResult, TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("todo-driven delegation phase3", () => {
  it("has minimal subagent registry entries", () => {
    const agents = listSubagents();
    const ids = new Set(agents.map((a) => a.id));
    expect(ids.has("research_agent")).toBe(true);
    expect(ids.has("writer_agent")).toBe(true);
    expect(ids.has("collector_agent")).toBe(true);
    expect(ids.has("merge_agent")).toBe(true);
    expect(ids.has("verification_agent")).toBe(true);
    expect(getSubagentById("research_agent")?.capability_types).toContain("research");
    expect(getSubagentById("writer_agent")?.capability_types).toContain("writing");
    expect(getSubagentById("collector_agent")?.capability_types).toContain("collection");
  });

  it("delegates research todo to research_agent", () => {
    const state = createRunState("collect evidence");
    const todo = addTodo(state, {
      id: "todo_research",
      title: "Research sources",
      description: "Collect and structure research materials for the goal.",
      status: "ready",
      capability_type: "research",
      acceptance_criteria: ["source list", "evidence summary"],
    });

    const decision = decideTodoExecutionMode(state, todo);
    expect(decision.mode).toBe("delegate");
    expect(decision.target_agent_id).toBe("research_agent");
  });

  it("delegates download-aware collection todo to collector_agent", () => {
    const state = createRunState("download papers");
    const todo = addTodo(state, {
      id: "todo_collect",
      title: "Parallel paper download batch 1",
      description: "Identify, download, and structure papers 1-10 for the goal.",
      status: "ready",
      capability_type: "collection",
      acceptance_criteria: ["10 PDFs downloaded", "local file paths returned"],
      extra_tools: ["tool_arxiv_search_download_batch"],
    });

    const decision = decideTodoExecutionMode(state, todo);
    expect(decision.mode).toBe("delegate");
    expect(decision.target_agent_id).toBe("collector_agent");
  });

  it("delegates merge todo to merge_agent", () => {
    const state = createRunState("merge downloaded paper batches");
    addTodo(state, {
      id: "todo_collect_1",
      title: "Collect batch 1",
      description: "download papers 1-10",
      status: "done",
      capability_type: "collection",
      acceptance_criteria: ["batch done", "manifest written"],
      notes: ["planner_parallel_batch:1-10"],
    });
    addTodo(state, {
      id: "todo_collect_2",
      title: "Collect batch 2",
      description: "download papers 11-20",
      status: "done",
      capability_type: "collection",
      acceptance_criteria: ["batch done", "manifest written"],
      notes: ["planner_parallel_batch:11-20"],
    });
    const todo = addTodo(state, {
      id: "todo_merge",
      title: "Merge downloaded paper batches",
      description: "Combine and deduplicate the downloaded paper manifests.",
      status: "ready",
      capability_type: "merge",
      depends_on: ["todo_collect_1", "todo_collect_2"],
      acceptance_criteria: ["one merged manifest", "duplicates removed"],
      notes: ["planner_strategy:fan_in_merge"],
    });

    const decision = decideTodoExecutionMode(state, todo);
    expect(decision.mode).toBe("delegate");
    expect(decision.target_agent_id).toBe("merge_agent");
  });

  it("routes final delivery by declared capability instead of hard-coded paper rules", () => {
    const state = createRunState("download and deliver papers");
    addTodo(state, {
      id: "todo_merge_results",
      title: "Merge downloaded paper batches",
      description: "Combine parallel download batches into one merged manifest.",
      status: "done",
      capability_type: "analysis",
      acceptance_criteria: ["merged manifest"],
    });
    const todo = addTodo(state, {
      id: "todo_deliver",
      title: "Deliver final downloaded paper package",
      description: "Return the 20-paper list with local file paths and a usable downloaded file inventory.",
      status: "ready",
      capability_type: "writing",
      acceptance_criteria: [
        "Final output contains 20 downloaded papers",
        "The result includes a usable local file inventory for the downloaded papers",
      ],
      depends_on: ["todo_merge_results"],
    });

    state.artifacts.push({
      id: "artifact_merge",
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\merge_manifest.json",
      type: "intermediate_summary",
      producer: "supervisor",
      related_todo: "todo_merge_results",
      summary: "merged paper manifest",
      storage_mode: "inline",
      inline_preview: "merged paper manifest",
    });

    const decision = decideTodoExecutionMode(state, todo);
    expect(decision.mode).toBe("delegate");
    expect(decision.target_agent_id).toBe("writer_agent");
  });

  it("runs delegated research todo and updates review/state", async () => {
    const state = createRunState("collect evidence");
    addTodo(state, {
      id: "todo_research",
      title: "Research sources",
      description: "Collect and structure research materials for the goal.",
      status: "ready",
      capability_type: "research",
      acceptance_criteria: [
        "collect_primary_sources",
        "produce_structured_evidence",
      ],
      depends_on: [],
    });

    const selfExecutor: TodoExecutor = async () => ({
      status: "error",
      output: "",
      error_message: "self executor should not be used for delegated research todo",
    });

    const result = await runTodoDrivenStep(state, selfExecutor, {
      subagentRunner: async (
        agent: SubagentDefinition,
      ): Promise<SubagentExecutionResult> => ({
        status: "success",
        summary: `done by ${agent.id}`,
        artifacts: [
          {
            path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\delegated_research.md",
            type: "research_notes",
            summary: "delegated research notes",
          },
        ],
        open_questions: [],
        completion_notes: ["delegation finished"],
        criteria_evidence: ["collect_primary_sources", "produce_structured_evidence"],
      }),
    });

    expect(result.delegated_agent_id).toBe("research_agent");
    expect(result.review?.status).toBe("pass");

    const todo = state.todos.find((item) => item.id === "todo_research");
    expect(todo?.status).toBe("done");
    expect(todo?.delegation_status).toBe("returned");
    expect(todo?.assignee_history).toContain("research_agent");
    expect(todo?.review_result).toBe("pass");

    const actions = state.execution_log.map((entry) => entry.action);
    expect(actions).toContain("delegate");
    expect(actions).toContain("subagent_return");
    expect(actions).toContain("review_pass");
  });

  it("does not force heuristic splitting for mixed-capability todos anymore", async () => {
    const state = createRunState("mixed task");
    addTodo(state, {
      id: "todo_mixed",
      title: "Research and write final report",
      description: "Collect evidence and write long-form final report in one task.",
      status: "ready",
      capability_type: "analysis",
      acceptance_criteria: ["collect_sources", "draft_report", "validate_output"],
      depends_on: [],
    });

    const selfExecutor: TodoExecutor = async () => ({
      status: "error",
      output: "",
      error_message: "self executor should not run for split path",
    });

    const result = await runTodoDrivenStep(state, selfExecutor);
    expect(result.review?.status).toBe("fail");

    const original = state.todos.find((item) => item.id === "todo_mixed");
    expect(original?.status).not.toBe("done");

    const subtodos = state.todos.filter((item) => item.id.startsWith("todo_mixed_sub_"));
    expect(subtodos.length).toBe(0);
  });
});
