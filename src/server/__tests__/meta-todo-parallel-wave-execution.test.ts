import { describe, expect, it } from "vitest";

import { addArtifact, addTodo, createRunState } from "@/server/meta-agent/supervisor-runtime-state";
import { runTodoDrivenStep } from "@/server/meta-agent/todo-driven/loop";
import type { DelegationBrief, SubagentDefinition, SubagentExecutionResult, TodoExecutor } from "@/server/meta-agent/todo-driven";

describe("parallel wave execution", () => {
  it("executes independent self/delegate todos in one wave", async () => {
    const state = createRunState("parallel execute success");
    addTodo(state, {
      id: "todo_research",
      title: "调研资料",
      description: "收集可追溯资料并形成证据。",
      status: "ready",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["collect_sources", "produce_evidence"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_write",
      title: "撰写文档",
      description: "根据已有材料撰写文档输出。",
      status: "ready",
      capability_type: "writing",
      priority: "high",
      acceptance_criteria: ["write_output", "structure_complete"],
      depends_on: [],
      input_refs: ["material_1"],
    });
    addArtifact(state, {
      id: "material_1",
      path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\wave_material_1.md",
      type: "seed",
      producer: "seed",
      related_todo: "todo_research",
      summary: "可用于写作的材料",
    });

    const selfExecutor: TodoExecutor = async (_context, _s, todo) => ({
      status: "success",
      output: todo.acceptance_criteria.join(" "),
      summary: `self ok: ${todo.id}`,
      criteria_evidence: [...todo.acceptance_criteria],
      artifact: {
        path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\wave_${todo.id}.md`,
        type: "todo_result",
        summary: `artifact ${todo.id}`,
      },
    });

    const result = await runTodoDrivenStep(state, selfExecutor, {
      parallel: { enabled: true, max_parallel_todos: 2 },
      subagentRunner: async (
        _agent: SubagentDefinition,
        brief: DelegationBrief,
      ): Promise<SubagentExecutionResult> => ({
        status: "success",
        summary: `delegate ok: ${brief.todo_title}`,
        artifacts: [
          {
            path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\wave_delegate_research.md",
            type: "research_result",
            summary: "delegated artifact",
          },
        ],
        open_questions: [],
        completion_notes: [],
        criteria_evidence: [...brief.acceptance_criteria],
      }),
    });

    expect(result.wave_id).toBeTruthy();
    expect(result.selected_todo_ids?.length).toBe(2);
    expect(state.todos.find((todo) => todo.id === "todo_research")?.status).toBe("done");
    expect(state.todos.find((todo) => todo.id === "todo_write")?.status).toBe("done");
    expect(state.current_wave_id).toBeNull();
    expect(state.execution_log.some((log) => log.action === "wave_created")).toBe(true);
    expect(state.execution_log.some((log) => log.action === "wave_item_started")).toBe(true);
    expect(state.execution_log.some((log) => log.action === "wave_review_completed")).toBe(true);
    const waveStarted = state.execution_log.filter((log) => log.action === "wave_item_started");
    expect(
      waveStarted.every((log) => {
        try {
          const payload = JSON.parse(log.message) as { wave_id?: string };
          return typeof payload.wave_id === "string" && payload.wave_id.length > 0;
        } catch {
          return false;
        }
      }),
    ).toBe(true);
  });

  it("isolates failures inside wave and preserves successful writeback", async () => {
    const state = createRunState("parallel execute isolation");
    addTodo(state, {
      id: "todo_research_fail",
      title: "调研失败项",
      description: "收集资料但本项会失败。",
      status: "ready",
      capability_type: "research",
      priority: "high",
      acceptance_criteria: ["collect_sources", "produce_evidence"],
      depends_on: [],
    });
    addTodo(state, {
      id: "todo_analysis_ok",
      title: "分析成功项",
      description: "分析已有信息并给出结论。",
      status: "ready",
      capability_type: "analysis",
      priority: "high",
      acceptance_criteria: ["analysis_conclusion", "risk_notes"],
      depends_on: [],
    });

    const selfExecutor: TodoExecutor = async (_context, _s, todo) => ({
      status: "success",
      output: todo.acceptance_criteria.join(" "),
      summary: `self ok: ${todo.id}`,
      criteria_evidence: [...todo.acceptance_criteria],
      artifact: {
        path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\wave_${todo.id}.md`,
        type: "todo_result",
        summary: `artifact ${todo.id}`,
      },
    });

    await runTodoDrivenStep(state, selfExecutor, {
      parallel: { enabled: true, max_parallel_todos: 2 },
      subagentRunner: async (
        agent: SubagentDefinition,
      ): Promise<SubagentExecutionResult> => {
        if (agent.id === "research_agent") {
          return {
            status: "error",
            summary: "delegate failed",
            artifacts: [],
            open_questions: [],
            completion_notes: [],
            criteria_evidence: [],
            error_message: "simulated delegate failure",
          };
        }
        return {
          status: "success",
          summary: "ok",
          artifacts: [],
          open_questions: [],
          completion_notes: [],
          criteria_evidence: [],
        };
      },
    });

    const recovered = state.todos.find((todo) => todo.id === "todo_research_fail");
    expect(recovered?.status).toBe("ready");
    expect(recovered?.serial_only).toBe(true);
    expect(recovered?.downgraded_from_wave).toBe(true);
    expect(state.todos.find((todo) => todo.id === "todo_analysis_ok")?.status).toBe("done");
    expect(state.execution_log.some((log) => log.action === "downgrade_to_serial" && log.todo_id === "todo_research_fail")).toBe(true);
    expect(state.artifacts.some((artifact) => artifact.related_todo === "todo_analysis_ok")).toBe(true);
  });
});
