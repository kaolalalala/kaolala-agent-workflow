/**
 * Prompt Skeletons — predefined strategy templates with prompt bone structures.
 *
 * Each template defines:
 * 1. A workflow topology (how nodes connect)
 * 2. Slot definitions with prompt skeletons (LLM fills the {variables})
 * 3. Edge patterns
 *
 * The Bandit model selects which template to use; the LLM fills the variables.
 * This keeps the Bandit's action space discrete and the LLM's freedom bounded.
 */
import type { StrategyTemplate } from "./types";

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [

  /* ── 1. Linear Simple: input → worker → output ────────────────────── */
  {
    id: "linear_simple",
    name: "简单直线型",
    description: "单节点执行，适合简单、明确的任务",
    topology: "linear",
    heuristic: "complexity <= 2, single subtask",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "worker",
        role: "worker",
        nameTemplate: "{worker_name}",
        promptSkeleton: `你是一名{expertise}专家。

你的任务是：{task_description}

要求：
1. {requirement_1}
2. {requirement_2}

输出格式：{output_format}`,
        variables: ["worker_name", "expertise", "task_description", "requirement_1", "requirement_2", "output_format"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "worker", type: "task_flow" },
      { fromSlot: "worker", toSlot: "output", type: "task_flow" },
    ],
  },

  /* ── 2. Linear with Review: input → worker → reviewer → output ──── */
  {
    id: "linear_review",
    name: "执行+审核型",
    description: "一个执行节点加一个审核节点，适合需要质量把关的任务",
    topology: "pipeline_review",
    heuristic: "needs_review, moderate complexity",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "worker",
        role: "worker",
        nameTemplate: "{worker_name}",
        promptSkeleton: `你是一名{expertise}专家。

你的任务是：{task_description}

要求：
1. 内容要{quality_standard}
2. {specific_requirement}
3. 输出需要结构清晰，便于后续审核

输出格式：{output_format}`,
        variables: ["worker_name", "expertise", "task_description", "quality_standard", "specific_requirement", "output_format"],
        replicable: false,
      },
      {
        slotId: "reviewer",
        role: "reviewer",
        nameTemplate: "质量审核员",
        promptSkeleton: `你是一名严格的质量审核专家。

你需要审核上游输出，重点检查：
1. {check_point_1}
2. {check_point_2}
3. 逻辑是否自洽，信息是否准确

如果发现问题，请指出并提供修正建议。
如果质量合格，直接输出经过润色后的最终版本。`,
        variables: ["check_point_1", "check_point_2"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "worker", type: "task_flow" },
      { fromSlot: "worker", toSlot: "reviewer", type: "task_flow" },
      { fromSlot: "reviewer", toSlot: "output", type: "task_flow" },
    ],
  },

  /* ── 3. Parallel Research: input → [researcher×N] → summarizer → output */
  {
    id: "parallel_research",
    name: "并行调研型",
    description: "多个调研员并行搜集信息，汇总后输出，适合多维度调研",
    topology: "fan_out_fan_in",
    heuristic: "parallelizable, research type, complexity >= 3",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "researcher",
        role: "research",
        nameTemplate: "调研专家 - {research_domain}",
        promptSkeleton: `你是一名{research_domain}领域的调研专家。

你的调研任务是：{research_task}

调研范围：{research_scope}

要求：
1. 提供具体的事实、数据或案例
2. 标注信息来源（如有）
3. 用结构化的方式组织调研结果

输出格式：Markdown 列表或表格`,
        variables: ["research_domain", "research_task", "research_scope"],
        replicable: true,
        preferredToolCategories: ["search", "retrieval"],
      },
      {
        slotId: "summarizer",
        role: "summarizer",
        nameTemplate: "综合分析师",
        promptSkeleton: `你是一名综合分析师，擅长整合多方信息。

你收到了来自多个调研专家的报告。你的任务是：
1. 整合所有调研结果，消除重复信息
2. 按照{structure_requirement}的结构组织内容
3. 提炼关键洞察和结论
4. 确保最终输出{quality_requirement}

输出格式：{final_format}`,
        variables: ["structure_requirement", "quality_requirement", "final_format"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "researcher", type: "task_flow" },
      { fromSlot: "researcher", toSlot: "summarizer", type: "task_flow" },
      { fromSlot: "summarizer", toSlot: "output", type: "task_flow" },
    ],
  },

  /* ── 4. Parallel Workers: input → [worker×N] → summarizer → output */
  {
    id: "parallel_workers",
    name: "并行执行型",
    description: "多个工作节点并行处理不同子任务，汇总后输出",
    topology: "fan_out_fan_in",
    heuristic: "parallelizable, creation/analysis type, subtaskCount >= 3",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "worker",
        role: "worker",
        nameTemplate: "{worker_name}",
        promptSkeleton: `你是一名{expertise}专家。

你负责的子任务是：{subtask_description}

具体要求：
1. {requirement_1}
2. {requirement_2}

注意：你只需完成你的子任务部分，其他子任务由其他专家并行处理。
输出格式：{output_format}`,
        variables: ["worker_name", "expertise", "subtask_description", "requirement_1", "requirement_2", "output_format"],
        replicable: true,
      },
      {
        slotId: "summarizer",
        role: "summarizer",
        nameTemplate: "汇总整合专家",
        promptSkeleton: `你是一名内容整合专家。

你收到了来自多个专家的并行输出。你的任务是：
1. 将所有子任务的输出整合为一个完整的{deliverable_type}
2. 确保内容连贯，消除重复和矛盾
3. {integration_requirement}

输出格式：{final_format}`,
        variables: ["deliverable_type", "integration_requirement", "final_format"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "worker", type: "task_flow" },
      { fromSlot: "worker", toSlot: "summarizer", type: "task_flow" },
      { fromSlot: "summarizer", toSlot: "output", type: "task_flow" },
    ],
  },

  /* ── 5. Plan-Execute-Review: input → planner → worker → reviewer → output */
  {
    id: "plan_execute_review",
    name: "规划-执行-审核型",
    description: "先规划再执行再审核，适合复杂、需要深思熟虑的任务",
    topology: "deep_chain",
    heuristic: "complexity >= 4, needs_review",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "planner",
        role: "planner",
        nameTemplate: "任务规划师",
        promptSkeleton: `你是一名资深任务规划师。

用户的目标是：{goal_summary}

请制定一份详细的执行计划，包括：
1. 任务分解：将目标拆解为 2-4 个具体步骤
2. 每个步骤的输入/输出要求
3. 质量标准：{quality_criteria}
4. 潜在风险和应对策略

输出格式：结构化的执行计划（Markdown）`,
        variables: ["goal_summary", "quality_criteria"],
        replicable: false,
      },
      {
        slotId: "worker",
        role: "worker",
        nameTemplate: "{worker_name}",
        promptSkeleton: `你是一名{expertise}专家。

按照上游规划师提供的执行计划，逐步完成以下工作：
{execution_instructions}

要求：
1. 严格按照计划执行
2. 每个步骤输出中间结果
3. 如遇到计划中未预见的问题，记录下来

输出格式：{output_format}`,
        variables: ["worker_name", "expertise", "execution_instructions", "output_format"],
        replicable: false,
      },
      {
        slotId: "reviewer",
        role: "reviewer",
        nameTemplate: "质量审核员",
        promptSkeleton: `你是一名严格的质量审核专家。

请对照最初的目标和执行计划，审核最终输出：
1. 目标达成度：是否完整回答了用户问题
2. {review_focus_1}
3. {review_focus_2}
4. 结构和表达质量

如有问题，提供修正后的完整版本。`,
        variables: ["review_focus_1", "review_focus_2"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "planner", type: "task_flow" },
      { fromSlot: "planner", toSlot: "worker", type: "task_flow" },
      { fromSlot: "worker", toSlot: "reviewer", type: "task_flow" },
      { fromSlot: "reviewer", toSlot: "output", type: "task_flow" },
    ],
  },

  /* ── 6. Parallel Research + Review: input → [researcher×N] → summarizer → reviewer → output */
  {
    id: "parallel_research_review",
    name: "并行调研+审核型",
    description: "并行调研后汇总并经过审核，适合高质量要求的多维度调研",
    topology: "fan_out_fan_in",
    heuristic: "parallelizable, needs_review, research type, complexity >= 4",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "researcher",
        role: "research",
        nameTemplate: "调研专家 - {research_domain}",
        promptSkeleton: `你是一名{research_domain}领域的调研专家。

调研任务：{research_task}
调研重点：{research_focus}

要求：
1. 提供具体事实和数据支撑
2. 区分已验证信息和推测
3. 用结构化方式组织结果`,
        variables: ["research_domain", "research_task", "research_focus"],
        replicable: true,
        preferredToolCategories: ["search", "retrieval"],
      },
      {
        slotId: "summarizer",
        role: "summarizer",
        nameTemplate: "综合分析师",
        promptSkeleton: `你是一名综合分析师。

整合所有调研报告，按照{structure}组织，提炼关键洞察。
重点关注：{analysis_focus}`,
        variables: ["structure", "analysis_focus"],
        replicable: false,
      },
      {
        slotId: "reviewer",
        role: "reviewer",
        nameTemplate: "质量审核员",
        promptSkeleton: `你是一名质量审核专家。

审核要点：
1. 信息准确性和完整性
2. {review_focus}
3. 逻辑一致性

如有问题，提供修正后的完整版本。`,
        variables: ["review_focus"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "researcher", type: "task_flow" },
      { fromSlot: "researcher", toSlot: "summarizer", type: "task_flow" },
      { fromSlot: "summarizer", toSlot: "reviewer", type: "task_flow" },
      { fromSlot: "reviewer", toSlot: "output", type: "task_flow" },
    ],
  },

  /* ── 7. Deep Pipeline: input → planner → [worker×N] → summarizer → reviewer → output */
  {
    id: "deep_pipeline",
    name: "深度流水线型",
    description: "规划后并行执行，汇总后审核，适合最复杂的综合任务",
    topology: "deep_chain",
    heuristic: "complexity >= 4, parallelizable, subtaskCount >= 3",
    slots: [
      {
        slotId: "input",
        role: "input",
        nameTemplate: "输入节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
      {
        slotId: "planner",
        role: "planner",
        nameTemplate: "战略规划师",
        promptSkeleton: `你是一名战略规划师。

目标：{goal_summary}

请输出一份执行计划，包括：
1. 并行子任务拆解（各子任务应独立可执行）
2. 每个子任务的具体范围和预期输出
3. 汇总策略：如何将并行结果整合
4. 质量标准：{quality_criteria}`,
        variables: ["goal_summary", "quality_criteria"],
        replicable: false,
      },
      {
        slotId: "worker",
        role: "worker",
        nameTemplate: "{worker_name}",
        promptSkeleton: `你是一名{expertise}专家。

根据上游规划师的执行计划，你负责：{subtask_description}

要求：
1. {requirement_1}
2. 输出要具体、可整合
输出格式：{output_format}`,
        variables: ["worker_name", "expertise", "subtask_description", "requirement_1", "output_format"],
        replicable: true,
      },
      {
        slotId: "summarizer",
        role: "summarizer",
        nameTemplate: "汇总整合专家",
        promptSkeleton: `整合所有并行专家的输出，生成完整的{deliverable_type}。
确保内容连贯、无重复，按照{structure}组织。`,
        variables: ["deliverable_type", "structure"],
        replicable: false,
      },
      {
        slotId: "reviewer",
        role: "reviewer",
        nameTemplate: "终审专家",
        promptSkeleton: `你是终审专家。审核最终输出：
1. 是否完整达成目标
2. {review_criteria}
3. 表达质量和结构

如有问题，输出修正后的完整版本。`,
        variables: ["review_criteria"],
        replicable: false,
      },
      {
        slotId: "output",
        role: "output",
        nameTemplate: "输出节点",
        promptSkeleton: "",
        variables: [],
        replicable: false,
      },
    ],
    edgePattern: [
      { fromSlot: "input", toSlot: "planner", type: "task_flow" },
      { fromSlot: "planner", toSlot: "worker", type: "task_flow" },
      { fromSlot: "worker", toSlot: "summarizer", type: "task_flow" },
      { fromSlot: "summarizer", toSlot: "reviewer", type: "task_flow" },
      { fromSlot: "reviewer", toSlot: "output", type: "task_flow" },
    ],
  },
];

/** Lookup template by id */
export function getTemplate(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}

/** Get all template ids (the Bandit's action space) */
export function getTemplateIds(): string[] {
  return STRATEGY_TEMPLATES.map((t) => t.id);
}
