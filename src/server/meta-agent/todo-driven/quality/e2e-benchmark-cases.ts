import { addArtifact, addTodo, createRunState } from "../../supervisor-runtime-state";
import type { E2EBenchmarkCase } from "./types";

export const e2eBenchmarkCases: E2EBenchmarkCase[] = [
  {
    id: "e2e_research_write_review",
    goal: "完成调研到写作的完整交付链路",
    expected_high_level_flow: ["select_todo", "decide_mode", "delegate", "subagent_return", "review_pass"],
    expected_key_todos: ["todo_scope", "todo_research", "todo_write"],
    expected_terminal_state: "completed",
    build_initial_state: () => {
      const state = createRunState("e2e_research_write_review");
      addTodo(state, {
        id: "todo_scope",
        title: "明确交付范围",
        description: "定义输出范围与验收标准。",
        status: "ready",
        capability_type: "planning",
        priority: "high",
        acceptance_criteria: ["范围定义完成", "验收标准清晰"],
        depends_on: [],
      });
      addTodo(state, {
        id: "todo_research",
        title: "调研关键资料",
        description: "收集并整理高质量资料。",
        status: "todo",
        capability_type: "research",
        priority: "high",
        acceptance_criteria: ["资料来源可追溯", "形成结构化证据"],
        depends_on: ["todo_scope"],
      });
      addTodo(state, {
        id: "todo_write",
        title: "撰写最终文档",
        description: "基于资料输出最终文档。",
        status: "todo",
        capability_type: "writing",
        priority: "high",
        acceptance_criteria: ["文档结构完整", "建议可执行"],
        input_refs: ["artifact_seed_material"],
        depends_on: ["todo_research"],
      });
      addArtifact(state, {
        id: "artifact_seed_material",
        path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\e2e_seed_material.md",
        type: "seed_material",
        producer: "seed",
        related_todo: "todo_research",
        summary: "可用于写作的核心素材",
      });
      return state;
    },
  },
  {
    id: "e2e_split_complex_task",
    goal: "复杂任务先 split 再串行完成",
    expected_high_level_flow: ["select_todo", "decide_mode", "review_split", "review_pass"],
    expected_key_todos: ["todo_complex", "_sub_1_", "_sub_2_", "_sub_3_"],
    expected_terminal_state: "completed",
    max_steps: 8,
    build_initial_state: () => {
      const state = createRunState("e2e_split_complex_task");
      addTodo(state, {
        id: "todo_complex",
        title: "Research and write production migration plan",
        description: "Collect evidence and write full migration document in one todo.",
        status: "ready",
        capability_type: "analysis",
        priority: "critical",
        acceptance_criteria: ["evidence_complete", "migration_plan_ready", "validation_complete"],
        depends_on: [],
      });
      return state;
    },
  },
  {
    id: "e2e_revise_then_pass",
    goal: "先 revise 再 pass 的质量闭环",
    expected_high_level_flow: ["select_todo", "self_execute", "review_revise", "review_pass"],
    expected_key_todos: ["todo_revision"],
    expected_terminal_state: "completed",
    max_steps: 5,
    build_initial_state: () => {
      const state = createRunState("e2e_revise_then_pass");
      addTodo(state, {
        id: "todo_revision",
        title: "形成执行建议",
        description: "输出完整建议并覆盖验收标准。",
        status: "ready",
        capability_type: "analysis",
        priority: "high",
        acceptance_criteria: ["包含建议结论", "包含风险提示", "包含执行步骤"],
        depends_on: [],
      });
      return state;
    },
    build_step_executor: () => {
      let attempts = 0;
      return async (_context, _state, todo) => {
        attempts += 1;
        if (todo.id === "todo_revision" && attempts === 1) {
          return {
            status: "success",
            output: "包含建议结论 和 风险提示",
            criteria_evidence: ["包含建议结论", "包含风险提示"],
            summary: "首轮输出缺少执行步骤。",
          };
        }
        return {
          status: "success",
          output: todo.acceptance_criteria.join(" "),
          criteria_evidence: [...todo.acceptance_criteria],
          artifact: {
            path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\${todo.id}_final.md`,
            type: "todo_result",
            summary: "revise 后完成",
          },
        };
      };
    },
  },
  {
    id: "e2e_resume_after_interrupt",
    goal: "从已有 run state 恢复并继续完成",
    expected_high_level_flow: ["select_todo", "decide_mode", "delegate", "review_pass"],
    expected_key_todos: ["todo_done_before_resume", "todo_remaining_after_resume"],
    expected_terminal_state: "completed",
    build_initial_state: () => {
      const state = createRunState("e2e_resume_after_interrupt");
      addTodo(state, {
        id: "todo_done_before_resume",
        title: "已完成阶段",
        description: "历史阶段已完成。",
        status: "done",
        capability_type: "planning",
        priority: "high",
        acceptance_criteria: ["done_ok", "trace_recorded"],
        review_result: "pass",
        depends_on: [],
      });
      addArtifact(state, {
        id: "artifact_done_before_resume",
        path: "D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\e2e_resume_previous.md",
        type: "resume_note",
        producer: "research_agent",
        related_todo: "todo_done_before_resume",
        summary: "历史阶段产物",
      });
      addTodo(state, {
        id: "todo_remaining_after_resume",
        title: "调研补充资料",
        description: "补充必要资料后完成最终说明。",
        status: "ready",
        capability_type: "research",
        priority: "high",
        acceptance_criteria: ["资料补充完成", "最终说明可交付"],
        depends_on: ["todo_done_before_resume"],
      });
      return state;
    },
  },
];
