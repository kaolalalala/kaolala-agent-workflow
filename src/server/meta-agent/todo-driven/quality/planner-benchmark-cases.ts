import type { PlannerBenchmarkCase } from "./types";

interface PlannerTodoDraft {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  capability_type: "planning" | "research" | "writing" | "analysis" | "review";
  assignee: string;
  depends_on: string[];
  acceptance_criteria: string[];
  input_refs: string[];
}

function responseFromTodos(todos: PlannerTodoDraft[]) {
  return JSON.stringify({ todos });
}

function standardChain(prefix: string, goalLabel: string): PlannerTodoDraft[] {
  return [
    {
      id: `${prefix}_scope`,
      title: "明确范围与产出标准",
      description: `定义 ${goalLabel} 的目标边界、输入限制和交付标准，确保后续步骤可执行。`,
      priority: "critical",
      capability_type: "planning",
      assignee: "single_executor",
      depends_on: [],
      acceptance_criteria: [
        "给出明确的范围与非范围清单",
        "给出至少两条可验收的交付标准",
      ],
      input_refs: [],
    },
    {
      id: `${prefix}_collect`,
      title: "收集关键资料与证据",
      description: `围绕 ${goalLabel} 收集关键资料、数据或上下文输入，并形成结构化素材。`,
      priority: "high",
      capability_type: "research",
      assignee: "single_executor",
      depends_on: [`${prefix}_scope`],
      acceptance_criteria: [
        "资料来源可追溯且不少于三类",
        "整理后的素材可直接支撑后续分析",
      ],
      input_refs: [],
    },
    {
      id: `${prefix}_analyze`,
      title: "分析与形成结论",
      description: `对收集结果进行分析归纳，形成用于输出的结论与权衡依据。`,
      priority: "high",
      capability_type: "analysis",
      assignee: "single_executor",
      depends_on: [`${prefix}_collect`],
      acceptance_criteria: [
        "给出结构化分析结论与依据",
        "至少识别两个关键风险或取舍点",
      ],
      input_refs: [],
    },
    {
      id: `${prefix}_deliver`,
      title: "产出结果并完成复核",
      description: `输出 ${goalLabel} 的最终版本，并进行一致性复核与修订。`,
      priority: "high",
      capability_type: "writing",
      assignee: "single_executor",
      depends_on: [`${prefix}_analyze`],
      acceptance_criteria: [
        "输出结果结构完整并含可执行建议",
        "完成复核并修复关键不一致问题",
      ],
      input_refs: [],
    },
  ];
}

const badThenFixed = [
  JSON.stringify({
    todos: [
      {
        id: "repair_1",
        title: "做一下",
        description: "do work",
        priority: "high",
        assignee: "single_executor",
        depends_on: ["repair_1"],
        acceptance_criteria: ["ok"],
      },
    ],
  }),
  responseFromTodos(standardChain("repair", "需求调研与方案草案")),
];

export const plannerBenchmarkCases: PlannerBenchmarkCase[] = [
  {
    id: "planner_research_report",
    goal: "调研 AI Agent Infra 最新实践并输出落地建议报告",
    category: "research",
    expected_capabilities: ["planning", "research", "analysis", "writing"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver"],
    llm_responses: [responseFromTodos(standardChain("research", "调研报告"))],
  },
  {
    id: "planner_summary_docs",
    goal: "总结 12 份技术设计文档并形成共识版本",
    category: "summary",
    expected_capabilities: ["planning", "research", "analysis", "writing", "review"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver", "review"],
    llm_responses: [responseFromTodos([
      ...standardChain("summary", "技术文档总结"),
      {
        id: "summary_review",
        title: "复核一致性与遗漏",
        description: "检查结论与原文是否一致，识别遗漏并进行一次修订。",
        priority: "medium",
        capability_type: "review",
        assignee: "single_executor",
        depends_on: ["summary_deliver"],
        acceptance_criteria: [
          "列出关键遗漏并完成修订",
          "结论与输入文档的一致性可说明",
        ],
        input_refs: [],
      },
    ])],
  },
  {
    id: "planner_writing_blog",
    goal: "撰写一篇关于 Todo-Driven Supervisor 的技术文章",
    category: "writing",
    expected_capabilities: ["planning", "research", "writing", "review"],
    expected_todo_skeleton: ["scope", "collect", "deliver", "review"],
    llm_responses: [responseFromTodos(standardChain("blog", "技术文章"))],
  },
  {
    id: "planner_code_refactor",
    goal: "重构 todo-driven orchestrator 的终态判定逻辑并补测试",
    category: "coding",
    expected_capabilities: ["planning", "analysis", "writing", "review"],
    expected_todo_skeleton: ["scope", "analyze", "deliver", "review"],
    llm_responses: [responseFromTodos([
      {
        id: "refactor_scope",
        title: "明确重构边界与风险",
        description: "定义终态判定改造边界、兼容要求和不可破坏行为。",
        priority: "critical",
        capability_type: "planning",
        assignee: "single_executor",
        depends_on: [],
        acceptance_criteria: [
          "列出影响模块和兼容性要求",
          "定义可验证的重构完成标准",
        ],
        input_refs: [],
      },
      {
        id: "refactor_analysis",
        title: "分析现有判定路径",
        description: "梳理现有状态机与终态判断分支，识别语义冲突点。",
        priority: "high",
        capability_type: "analysis",
        assignee: "single_executor",
        depends_on: ["refactor_scope"],
        acceptance_criteria: [
          "列出旧逻辑冲突点与风险点",
          "形成新判定规则草案",
        ],
        input_refs: [],
      },
      {
        id: "refactor_impl",
        title: "实现与单测补齐",
        description: "按新判定规则实现改造并补齐核心测试用例。",
        priority: "high",
        capability_type: "writing",
        assignee: "single_executor",
        depends_on: ["refactor_analysis"],
        acceptance_criteria: [
          "代码实现覆盖新终态规则",
          "新增测试覆盖关键异常路径",
        ],
        input_refs: [],
      },
      {
        id: "refactor_review",
        title: "回归验证与复核",
        description: "执行回归并复核行为一致性，形成改造总结。",
        priority: "medium",
        capability_type: "review",
        assignee: "single_executor",
        depends_on: ["refactor_impl"],
        acceptance_criteria: [
          "回归结果通过且无主线回退",
          "输出重构结果与残留风险说明",
        ],
        input_refs: [],
      },
    ])],
  },
  {
    id: "planner_analysis_incident",
    goal: "分析一次生产故障并形成 RCA 报告和修复计划",
    category: "analysis",
    expected_capabilities: ["planning", "research", "analysis", "writing", "review"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver", "review"],
    llm_responses: [responseFromTodos([
      ...standardChain("incident", "故障 RCA"),
      {
        id: "incident_review",
        title: "复核修复计划可执行性",
        description: "校验修复计划优先级、负责人和时间线是否可执行。",
        priority: "medium",
        capability_type: "review",
        assignee: "single_executor",
        depends_on: ["incident_deliver"],
        acceptance_criteria: [
          "修复计划包含明确 owner 与截止时间",
          "高风险项具备可执行缓解方案",
        ],
        input_refs: [],
      },
    ])],
  },
  {
    id: "planner_market_analysis",
    goal: "完成 Agent 平台竞品分析并给出产品定位建议",
    category: "analysis",
    expected_capabilities: ["planning", "research", "analysis", "writing"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver"],
    llm_responses: [responseFromTodos(standardChain("market", "竞品分析"))],
  },
  {
    id: "planner_test_strategy",
    goal: "为 todo-driven orchestrator 设计一套分层测试策略",
    category: "coding",
    expected_capabilities: ["planning", "analysis", "writing", "review"],
    expected_todo_skeleton: ["scope", "analyze", "deliver", "review"],
    llm_responses: [responseFromTodos(standardChain("testplan", "测试策略"))],
  },
  {
    id: "planner_architecture_design",
    goal: "设计一个可扩展的 supervisor quality evaluation 架构",
    category: "analysis",
    expected_capabilities: ["planning", "analysis", "writing", "review"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver", "review"],
    llm_responses: [responseFromTodos([
      ...standardChain("arch", "评测架构设计"),
      {
        id: "arch_review",
        title: "评审架构取舍",
        description: "评审扩展性与复杂度取舍，给出可演进建议。",
        priority: "medium",
        capability_type: "review",
        assignee: "single_executor",
        depends_on: ["arch_deliver"],
        acceptance_criteria: [
          "说明关键取舍和后续演进路径",
          "给出至少两项可落地优化建议",
        ],
        input_refs: [],
      },
    ])],
  },
  {
    id: "planner_dataset_pipeline",
    goal: "搭建后训练数据清洗与导出流程",
    category: "coding",
    expected_capabilities: ["planning", "analysis", "writing", "review"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver", "review"],
    llm_responses: [responseFromTodos([
      ...standardChain("dataset", "数据流水线"),
      {
        id: "dataset_review",
        title: "验证数据格式与一致性",
        description: "校验导出结果字段完整性、格式一致性与可追溯性。",
        priority: "medium",
        capability_type: "review",
        assignee: "single_executor",
        depends_on: ["dataset_deliver"],
        acceptance_criteria: [
          "导出格式字段满足训练需求",
          "数据链路具备可追踪元信息",
        ],
        input_refs: [],
      },
    ])],
  },
  {
    id: "planner_multilingual_docs",
    goal: "将平台操作手册扩展为中英文双语版本",
    category: "writing",
    expected_capabilities: ["planning", "research", "writing", "review"],
    expected_todo_skeleton: ["scope", "collect", "deliver", "review"],
    llm_responses: [responseFromTodos(standardChain("bilingual", "双语手册"))],
  },
  {
    id: "planner_feedback_analysis",
    goal: "分析 500 条用户反馈并提出三项产品改进建议",
    category: "analysis",
    expected_capabilities: ["planning", "research", "analysis", "writing"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver"],
    llm_responses: [responseFromTodos(standardChain("feedback", "反馈分析"))],
  },
  {
    id: "planner_invalid_then_repair",
    goal: "产出需求调研与方案草案",
    category: "analysis",
    expected_capabilities: ["planning", "research", "analysis", "writing"],
    expected_todo_skeleton: ["scope", "collect", "analyze", "deliver"],
    notes: "验证混合策略下的失败反馈重试链路。",
    llm_responses: badThenFixed,
  },
];
