import type { StoredWorkflowEdge, StoredWorkflowNode, StoredWorkflowTask } from "@/server/domain";

export type WorkflowTemplateDifficulty = "简单" | "中等" | "复杂";
export type WorkflowTemplateCategory = "节点规模" | "任务类型";

export interface WorkflowTemplatePresetTask {
  id: string;
  title: string;
  difficulty: WorkflowTemplateDifficulty;
  input: string;
}

export interface BuiltinWorkflowTemplateMeta {
  isBuiltin: true;
  templateCategory: WorkflowTemplateCategory;
  scenario: string;
  presetTasks: WorkflowTemplatePresetTask[];
}

export interface BuiltinWorkflowTemplateSeed extends BuiltinWorkflowTemplateMeta {
  id: string;
  name: string;
  description: string;
  rootTaskInput: string;
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
  enabled: boolean;
}

function node(
  id: string,
  name: string,
  role: StoredWorkflowNode["role"],
  taskSummary: string,
  responsibilitySummary: string,
  x: number,
  y: number,
): StoredWorkflowNode {
  return { id, name, role, taskSummary, responsibilitySummary, position: { x, y } };
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  type: StoredWorkflowEdge["type"] = "task_flow",
): StoredWorkflowEdge {
  return { id, sourceNodeId, targetNodeId, type };
}

function task(
  id: string,
  title: string,
  assignedNodeId?: string,
  parentTaskId = "t_root",
  summary?: string,
): StoredWorkflowTask {
  return { id, title, status: "ready", assignedNodeId, parentTaskId, summary };
}

function rootTask(title: string): StoredWorkflowTask {
  return { id: "t_root", title, status: "ready", summary: title };
}

export const BUILTIN_WORKFLOW_TEMPLATE_SEEDS: BuiltinWorkflowTemplateSeed[] = [
  {
    id: "wf_tpl_builtin_5_summary",
    name: "五节点-基础总结模板",
    description: "用于验证基础链路、节点连接、运行详情与耗时统计的标准 5 节点模板。",
    rootTaskInput: "请总结一段文本并输出 5 个要点。",
    isBuiltin: true,
    templateCategory: "节点规模",
    scenario: "基础链路验证 / 总结任务",
    enabled: true,
    nodes: [
      node("n_input", "输入节点", "input", "接收任务输入", "注入用户任务与约束", 120, 200),
      node("n_analysis", "任务分析节点", "planner", "识别目标与关键信息", "明确任务边界", 370, 200),
      node("n_process", "信息处理节点", "worker", "处理文本并提炼信息", "形成中间结果", 620, 200),
      node("n_summary", "总结节点", "summarizer", "汇总并形成结构化要点", "输出可读总结", 870, 200),
      node("n_output", "输出节点", "output", "收敛最终结果", "输出最终答案", 1120, 200),
    ],
    edges: [
      edge("e1", "n_input", "n_analysis"),
      edge("e2", "n_analysis", "n_process"),
      edge("e3", "n_process", "n_summary"),
      edge("e4", "n_summary", "n_output", "output_flow"),
    ],
    tasks: [
      rootTask("完成文本总结任务"),
      task("t_input", "输入注入", "n_input"),
      task("t_analysis", "任务分析", "n_analysis"),
      task("t_process", "信息处理", "n_process"),
      task("t_summary", "总结输出", "n_summary"),
      task("t_output", "结果收敛", "n_output"),
    ],
    presetTasks: [
      {
        id: "summary_easy",
        title: "将产品介绍总结为 5 个要点",
        difficulty: "简单",
        input:
          "请把下面内容总结为 5 个要点，并保持每条不超过 25 字：\n“本平台支持项目管理、工作流编排、运行观测、文件沉淀和模板复用，目标是让团队可以快速构建并迭代 Agent 工作流。”",
      },
      {
        id: "summary_medium",
        title: "按目标/功能/优势三段式总结",
        difficulty: "中等",
        input:
          "请将下面文本整理成“目标、核心功能、优势”三部分，每部分不超过 3 条：\n“我们正在建设一个 Agent Workflow Platform，强调可观测、可调试、可复用，并通过模板体系降低搭建成本。”",
      },
      {
        id: "summary_hard",
        title: "压缩为 150 字执行摘要",
        difficulty: "复杂",
        input:
          "请将下面内容压缩为 150 字以内的执行摘要，并给出一句风险提示：\n“团队需要在两周内完成运行中心上线、模板体系可用化和调试链路打通，现阶段面临数据口径不一致、节点配置复杂、模板可维护性不足等问题。”",
      },
    ],
  },
  {
    id: "wf_tpl_builtin_5_analysis",
    name: "五节点-分析模板",
    description: "用于验证“提取-分类-对比-总结”的标准分析链路。",
    rootTaskInput: "先提取要点，再分类，再输出结论。",
    isBuiltin: true,
    templateCategory: "任务类型",
    scenario: "多步分析任务",
    enabled: true,
    nodes: [
      node("n_input", "输入节点", "input", "接收输入", "注入原始任务", 120, 340),
      node("n_extract", "要点提取节点", "worker", "提取核心观点", "提炼关键事实", 360, 340),
      node("n_classify", "分类节点", "research", "按主题分类", "组织信息结构", 600, 340),
      node("n_compare", "对比节点", "reviewer", "比较差异与风险", "形成判断依据", 840, 340),
      node("n_summary", "结论节点", "summarizer", "输出最终结论", "生成结构化结果", 1080, 340),
    ],
    edges: [
      edge("e1", "n_input", "n_extract"),
      edge("e2", "n_extract", "n_classify"),
      edge("e3", "n_classify", "n_compare"),
      edge("e4", "n_compare", "n_summary"),
    ],
    tasks: [
      rootTask("完成多步分析任务"),
      task("t_input", "输入注入", "n_input"),
      task("t_extract", "提取要点", "n_extract"),
      task("t_classify", "分类整理", "n_classify"),
      task("t_compare", "对比评估", "n_compare"),
      task("t_summary", "结论输出", "n_summary"),
    ],
    presetTasks: [
      {
        id: "analysis_easy",
        title: "观点提取与分类",
        difficulty: "简单",
        input:
          "请先提取下面文本中的核心观点，再按“产品、运营、技术”分类，最后给出 3 条总结建议。",
      },
      {
        id: "analysis_medium",
        title: "问题-原因-建议分析",
        difficulty: "中等",
        input:
          "请对“项目延期”主题做三步分析：1）找出主要问题；2）分析原因；3）给出可执行建议（按优先级排序）。",
      },
      {
        id: "analysis_hard",
        title: "双方案对比决策",
        difficulty: "复杂",
        input:
          "请对方案 A（快速上线）与方案 B（稳定优先）进行对比：先列评价维度，再逐项评分，最后输出推荐方案与理由。",
      },
    ],
  },
  {
    id: "wf_tpl_builtin_10_complex_analysis",
    name: "十节点-复杂分析模板",
    description: "用于验证 10 节点复杂链路的稳定性、中间结果传递和节点级调试。",
    rootTaskInput: "对复杂主题完成拆解、检索、推理、校验并输出最终结论。",
    isBuiltin: true,
    templateCategory: "节点规模",
    scenario: "复杂链路与性能验证",
    enabled: true,
    nodes: [
      node("n1", "输入节点", "input", "接收输入", "注入任务", 80, 180),
      node("n2", "任务拆解节点", "planner", "拆解问题", "生成子任务", 290, 180),
      node("n3", "规划节点", "planner", "规划执行路径", "定义执行顺序", 500, 180),
      node("n4", "检索节点", "research", "检索资料", "补充事实依据", 710, 180),
      node("n5", "整理节点", "worker", "整理信息", "统一中间格式", 920, 180),
      node("n6", "推理节点", "worker", "推理分析", "形成分析结果", 1130, 180),
      node("n7", "校验节点", "reviewer", "校验结论", "检查一致性与风险", 1340, 180),
      node("n8", "总结节点", "summarizer", "总结输出", "形成最终结论", 1550, 180),
      node("n9", "格式化输出节点", "worker", "格式化", "标准化结构输出", 1760, 180),
      node("n10", "输出节点", "output", "收敛结果", "输出最终结果", 1970, 180),
    ],
    edges: [
      edge("e1", "n1", "n2"),
      edge("e2", "n2", "n3"),
      edge("e3", "n3", "n4"),
      edge("e4", "n4", "n5"),
      edge("e5", "n5", "n6"),
      edge("e6", "n6", "n7"),
      edge("e7", "n7", "n8"),
      edge("e8", "n8", "n9"),
      edge("e9", "n9", "n10", "output_flow"),
    ],
    tasks: [
      rootTask("复杂分析主任务"),
      task("t1", "输入注入", "n1"),
      task("t2", "任务拆解", "n2"),
      task("t3", "执行规划", "n3"),
      task("t4", "信息检索", "n4"),
      task("t5", "信息整理", "n5"),
      task("t6", "推理分析", "n6"),
      task("t7", "结果校验", "n7"),
      task("t8", "总结汇总", "n8"),
      task("t9", "格式输出", "n9"),
      task("t10", "最终输出", "n10"),
    ],
    presetTasks: [
      {
        id: "complex_easy",
        title: "功能评估链路压测（简单）",
        difficulty: "简单",
        input:
          "请分析“客服 Agent 系统”方案：先拆解目标，再列功能，再给出上线优先级建议。",
      },
      {
        id: "complex_medium",
        title: "多维决策分析（中等）",
        difficulty: "中等",
        input:
          "请围绕“是否采用多 Agent 架构”做分析：成本、性能、稳定性、可维护性四个维度，最后给出推荐结论。",
      },
      {
        id: "complex_hard",
        title: "复杂约束下的方案决策（复杂）",
        difficulty: "复杂",
        input:
          "在“预算有限、交付周期 2 周、需要可观测性”的约束下，给出一个可落地的 Agent 平台建设方案，并说明阶段目标、风险和应对策略。",
      },
    ],
  },
  {
    id: "wf_tpl_builtin_10_plan_execute",
    name: "十节点-规划执行模板",
    description: "用于验证“先规划再执行”的长链路流程，适合执行阶段和调试阶段测试。",
    rootTaskInput: "先规划步骤，再逐步执行，最后合成结果。",
    isBuiltin: true,
    templateCategory: "节点规模",
    scenario: "规划 + 执行链路验证",
    enabled: true,
    nodes: [
      node("n1", "输入节点", "input", "注入任务", "接收用户输入", 80, 430),
      node("n2", "目标澄清节点", "planner", "澄清目标", "明确成功标准", 290, 430),
      node("n3", "步骤规划节点", "planner", "制定步骤", "产出执行计划", 500, 430),
      node("n4", "执行步骤一", "worker", "执行首步", "产出阶段结果", 710, 430),
      node("n5", "执行步骤二", "worker", "执行次步", "补全阶段结果", 920, 430),
      node("n6", "工具调用节点", "tool", "调用工具", "补充外部结果", 1130, 430),
      node("n7", "证据整理节点", "research", "整理证据", "整合执行信息", 1340, 430),
      node("n8", "风险检查节点", "reviewer", "检查风险", "识别问题点", 1550, 430),
      node("n9", "总结节点", "summarizer", "汇总结果", "输出结论", 1760, 430),
      node("n10", "输出节点", "output", "产出最终输出", "落地最终答案", 1970, 430),
    ],
    edges: [
      edge("e1", "n1", "n2"),
      edge("e2", "n2", "n3"),
      edge("e3", "n3", "n4"),
      edge("e4", "n4", "n5"),
      edge("e5", "n5", "n6"),
      edge("e6", "n6", "n7"),
      edge("e7", "n7", "n8"),
      edge("e8", "n8", "n9"),
      edge("e9", "n9", "n10", "output_flow"),
    ],
    tasks: [
      rootTask("规划执行主任务"),
      task("t1", "输入注入", "n1"),
      task("t2", "目标澄清", "n2"),
      task("t3", "步骤规划", "n3"),
      task("t4", "执行步骤一", "n4"),
      task("t5", "执行步骤二", "n5"),
      task("t6", "工具调用", "n6"),
      task("t7", "证据整理", "n7"),
      task("t8", "风险检查", "n8"),
      task("t9", "结论总结", "n9"),
      task("t10", "最终输出", "n10"),
    ],
    presetTasks: [
      {
        id: "plan_exec_easy",
        title: "文本处理流程规划与执行",
        difficulty: "简单",
        input:
          "请先规划“将一段产品文案改写为营销摘要”的步骤，然后逐步执行并输出最终结果。",
      },
      {
        id: "plan_exec_medium",
        title: "任务拆解与执行（中等）",
        difficulty: "中等",
        input:
          "请先拆解“调研一个行业工具”的任务，再执行每一步并给出结论，结论需包含优劣势与适用场景。",
      },
      {
        id: "plan_exec_hard",
        title: "流程设计与风险评估（复杂）",
        difficulty: "复杂",
        input:
          "请制定“上线一个内部 Agent 工作流”的执行流程，逐步给出产出，并在最后给出风险清单与缓解方案。",
      },
    ],
  },
  {
    id: "wf_tpl_builtin_retrieval_summary",
    name: "检索总结模板",
    description: "用于验证工具调用 + 信息整理 + 总结输出的链路（工具链不稳定时可作为占位流程）。",
    rootTaskInput: "先检索信息，再整理并输出摘要。",
    isBuiltin: true,
    templateCategory: "任务类型",
    scenario: "检索 + 总结",
    enabled: true,
    nodes: [
      node("n1", "输入节点", "input", "注入检索任务", "接收用户主题", 120, 620),
      node("n2", "检索规划节点", "planner", "制定检索关键词", "明确检索范围", 380, 620),
      node("n3", "工具检索节点", "tool", "执行检索", "调用检索工具", 640, 620),
      node("n4", "结果整理节点", "research", "去重与整理", "筛选可靠信息", 900, 620),
      node("n5", "摘要节点", "summarizer", "生成摘要", "形成结构化输出", 1160, 620),
      node("n6", "输出节点", "output", "收敛最终结果", "输出摘要结果", 1420, 620),
    ],
    edges: [
      edge("e1", "n1", "n2"),
      edge("e2", "n2", "n3"),
      edge("e3", "n3", "n4"),
      edge("e4", "n4", "n5"),
      edge("e5", "n5", "n6", "output_flow"),
    ],
    tasks: [
      rootTask("检索总结任务"),
      task("t1", "输入注入", "n1"),
      task("t2", "检索规划", "n2"),
      task("t3", "工具检索", "n3"),
      task("t4", "信息整理", "n4"),
      task("t5", "摘要输出", "n5"),
      task("t6", "最终输出", "n6"),
    ],
    presetTasks: [
      {
        id: "retrieval_easy",
        title: "检索单主题并总结",
        difficulty: "简单",
        input:
          "请检索“多 Agent 工作流平台”相关公开信息，并输出 5 条要点摘要。",
      },
      {
        id: "retrieval_medium",
        title: "双方案检索对比",
        difficulty: "中等",
        input:
          "请检索两种技术方案（A 与 B）的公开信息，整理成“共同点、差异点、适用场景”三部分。",
      },
      {
        id: "retrieval_hard",
        title: "检索 + 结构化建议",
        difficulty: "复杂",
        input:
          "请围绕“Agent Runtime 可观测性实践”进行检索，并输出结构化建议：指标、日志、追踪、告警、落地步骤。",
      },
    ],
  },
  // ─── Regression Test: Swarm Agent & New Features ──────
  {
    id: "wf_tpl_builtin_swarm_regression",
    name: "Swarm Agent 回归测试模板",
    description:
      "专用于验证 Swarm Agent 新功能的回归测试模板：Agent Handoff（任务转交）、Subtask Spawning（子任务委托）、" +
      "多轮工具调用、Reflection 反思循环、跨节点协作、记忆系统集成。包含 7 个节点覆盖全部角色。",
    rootTaskInput: "请执行一个完整的 Swarm Agent 功能回归测试。",
    isBuiltin: true,
    templateCategory: "任务类型",
    scenario: "Swarm Agent 功能回归验证",
    enabled: true,
    nodes: [
      node("n_input", "输入节点", "input", "接收测试输入", "注入测试任务与参数", 80, 300),
      node("n_planner", "规划节点", "planner", "拆解测试步骤", "分析任务并制定测试计划", 300, 300),
      node("n_researcher", "调研节点", "research", "检索相关资料", "搜索与整理背景信息", 520, 180),
      node("n_writer", "撰写节点", "worker", "执行核心任务", "根据调研结果撰写内容，可委托子任务或转交", 520, 420),
      node("n_reviewer", "审核节点", "reviewer", "质量审核", "检查输出质量，验证合规性", 740, 300),
      node("n_summarizer", "总结节点", "summarizer", "汇总结果", "汇总所有节点输出为最终报告", 960, 300),
      node("n_output", "输出节点", "output", "收敛最终结果", "输出测试报告", 1180, 300),
    ],
    edges: [
      edge("e1", "n_input", "n_planner"),
      edge("e2", "n_planner", "n_researcher"),
      edge("e3", "n_planner", "n_writer"),
      edge("e4", "n_researcher", "n_reviewer"),
      edge("e5", "n_writer", "n_reviewer"),
      edge("e6", "n_reviewer", "n_summarizer"),
      edge("e7", "n_summarizer", "n_output", "output_flow"),
    ],
    tasks: [
      rootTask("Swarm Agent 功能回归测试"),
      task("t_input", "输入注入", "n_input"),
      task("t_plan", "测试规划", "n_planner"),
      task("t_research", "资料调研", "n_researcher"),
      task("t_write", "内容撰写", "n_writer"),
      task("t_review", "质量审核", "n_reviewer"),
      task("t_summary", "结果汇总", "n_summarizer"),
      task("t_output", "最终输出", "n_output"),
    ],
    presetTasks: [
      {
        id: "swarm_basic",
        title: "基础链路验证",
        difficulty: "简单",
        input:
          "请验证基础的多 Agent 协作链路：规划节点分配任务，调研节点和撰写节点并行执行，审核节点汇聚结果，最终输出完整报告。",
      },
      {
        id: "swarm_handoff",
        title: "Agent Handoff 转交测试",
        difficulty: "中等",
        input:
          "请测试 Agent Handoff 功能：撰写节点在执行过程中发现需要额外调研，将任务转交给调研节点完成后返回结果。" +
          "验证转交消息传递、目标节点执行、结果回传三个步骤。",
      },
      {
        id: "swarm_full",
        title: "完整 Swarm 功能回归",
        difficulty: "复杂",
        input:
          "请执行完整的 Swarm Agent 回归测试：\n" +
          "1. 规划节点拆解任务并分发\n" +
          "2. 调研节点检索信息\n" +
          "3. 撰写节点使用 spawn_subtask 委托审核节点做前置检查\n" +
          "4. 审核节点进行质量审核\n" +
          "5. 总结节点汇总所有结果\n" +
          "验证：所有节点状态正确、事件序列完整、记忆系统正常写入。",
      },
    ],
  },
];

const BUILTIN_TEMPLATE_META = new Map(
  BUILTIN_WORKFLOW_TEMPLATE_SEEDS.map((item) => [
    item.id,
    {
      isBuiltin: true as const,
      templateCategory: item.templateCategory,
      scenario: item.scenario,
      presetTasks: item.presetTasks,
    },
  ]),
);

export function getBuiltinWorkflowTemplateMeta(templateId: string): BuiltinWorkflowTemplateMeta | undefined {
  return BUILTIN_TEMPLATE_META.get(templateId);
}
