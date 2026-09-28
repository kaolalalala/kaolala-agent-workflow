"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  Boxes,
  Bot,
  FileCog,
  FolderKanban,
  PlayCircle,
  Radar,
  ScrollText,
  Archive,
  ChevronDown,
  GitBranch,
  Layers,
  ListTodo,
  Zap,
  RotateCcw,
  Flag,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  Brain,
  Database,
  BookOpen,
  Merge,
  MemoryStick,
  ArrowUpLeft,
  RefreshCcw,
  BrainCircuit,
} from "lucide-react";

type FlowNode = {
  step: string;
  title: string;
  description: string;
  dataOut: string;
  href: string;
  icon: typeof Boxes;
  stage: "准备" | "编排" | "承载" | "执行" | "沉淀";
  isExecCluster?: boolean;
};

// 执行阶段三步：04/05/06 作为内部子视图，在渲染层合并为一个 ExecCluster
const FLOW_NODES: FlowNode[] = [
  {
    step: "01",
    title: "资源中心",
    description: "模型、Prompt、Tool、Skill 统一管理",
    dataOut: "Skill / Prompt / Tool 资产",
    href: "/assets",
    icon: Boxes,
    stage: "准备",
  },
  {
    step: "02",
    title: "工作流编排",
    description: "在项目下创建工作流，节点化组织流程与 Agent 协作",
    dataOut: "workflow_id + 节点配置",
    href: "/projects",
    icon: FileCog,
    stage: "编排",
  },
  {
    step: "03",
    title: "绑定项目",
    description: "为工作流绑定项目语境，形成可追溯的历史与资产归属",
    dataOut: "project_id + goal 上下文",
    href: "/projects",
    icon: FolderKanban,
    stage: "承载",
  },
  {
    step: "04–06",
    title: "执行阶段",
    description: "创建 Run · 运行中心 · 运行详情",
    dataOut: "artifacts + run summaries",
    href: "/runs",
    icon: PlayCircle,
    stage: "执行",
    isExecCluster: true,
  },
  {
    step: "07",
    title: "结果沉淀",
    description: "产物回流项目，可复盘、复用、继续迭代",
    dataOut: "迭代输入 → 下一轮工作流",
    href: "/projects",
    icon: Archive,
    stage: "沉淀",
  },
];

// 5 列对应 5 个流程节点（执行阶段合并为 1 列）
const STAGE_LANES = [
  { title: "准备", detail: "统一能力与资产", span: "col-span-1" },
  { title: "编排", detail: "把能力编成流程", span: "col-span-1" },
  { title: "承载", detail: "进入项目语境", span: "col-span-1" },
  { title: "执行", detail: "实例化 · 观测 · 产物", span: "col-span-1" },
  { title: "沉淀", detail: "结果回流并复用", span: "col-span-1" },
] as const;

const SUPPORT_MODULES = [
  {
    title: "Meta-Agent",
    description: "复杂任务控制层，负责 todo 拆解、并行波次与恢复。",
    triggeredAt: "步骤 04：创建 Run 时可选接入，接管执行控制权",
    href: "/meta-agent",
    icon: Bot,
    lane: "复杂任务控制回路",
    // 对齐执行阶段（第 4 列）
    columnClass: "col-span-1 col-start-4",
    tone: "sky" as const,
  },
  {
    title: "评测中心",
    description: "质量验证回路，承接 replay / compare 并把结论回流到流程迭代。",
    triggeredAt: "步骤 06/07：产物产生后触发，结论写回工作流迭代",
    href: "/evaluations",
    icon: Radar,
    lane: "质量验证回路",
    // 对齐沉淀阶段（第 5 列）
    columnClass: "col-span-1 col-start-5",
    tone: "emerald" as const,
  },
];

type MetaAgentModule = {
  id: string;
  layer: "入口" | "规划" | "调度" | "执行" | "状态" | "记忆";
  title: string;
  subtitle: string;
  icon: typeof Bot;
  tone: "sky" | "violet" | "amber" | "emerald" | "slate";
  oneLiner: string;
  flow: string;
  responsibilities: string[];
  notResponsible: string[];
  calledBy: string[];
  calls: string[];
};

const META_AGENT_MODULES: MetaAgentModule[] = [
  {
    id: "orchestrator",
    layer: "调度",
    title: "Orchestrator",
    subtitle: "主循环控制器",
    icon: GitBranch,
    tone: "sky",
    oneLiner: "贯穿整个 run 生命周期，驱动状态机流转，协调所有子模块。",
    flow: "run 开始 → 调 Planner → [循环: Selector → Wave → Review → Replanner → TerminalState] → buildFinalOutput",
    responsibilities: [
      "持有主执行循环，每个 step 推进一次",
      "在循环开始前调用 Planner 生成初始 todo 列表",
      "每轮选择下一批可执行 todo，交给 Wave 并行执行",
      "收到执行结果后触发 Review，再决定是否 Replan",
      "每步检查 TerminalState，满足终止条件时结束 run",
    ],
    notResponsible: [
      "不自己执行任何 todo 内容",
      "不直接调用 LLM 完成业务任务",
      "不决定 todo 的具体分工（那是 Planner/Replanner 的事）",
    ],
    calledBy: ["meta-agent-service（run 入口）"],
    calls: ["Planner", "Selector", "ParallelWave", "Review", "Replanner", "TerminalState"],
  },
  {
    id: "planner",
    layer: "规划",
    title: "Planner",
    subtitle: "初始计划生成器",
    icon: ListTodo,
    tone: "violet",
    oneLiner: "run 开始时被调用一次，根据 goal 生成结构化 todo 列表。",
    flow: "goal → LLM 生成 todo 草稿 → 验证器校验 → 返回 TodoItem[]",
    responsibilities: [
      "分析 goal 中的并行意图（支持中文关键词：并行/同时/并发）",
      "向 LLM 发送带约束的 prompt，要求输出严格 JSON",
      "校验 LLM 输出：DAG 无环、depends_on 合法、3~5 个 todo",
      "校验失败时带错误反馈重试，最多 3 次",
      "根据 goal 类型选择合适的 flow pattern（具体收集 vs 探索性）",
    ],
    notResponsible: [
      "不执行 todo，只生成计划",
      "不在 run 中途调整计划（那是 Replanner 的事）",
      "不感知执行状态或已完成结果",
    ],
    calledBy: ["Orchestrator（run 开始时一次）"],
    calls: ["LLM（callLLM）", "validateAndNormalizeTodoDrafts"],
  },
  {
    id: "replanner",
    layer: "规划",
    title: "Replanner",
    subtitle: "动态重规划器",
    icon: RotateCcw,
    tone: "violet",
    oneLiner: "在执行中途检测到失败/发现/问题时，决定是否调整 todo 计划。",
    flow: "checkReplanTrigger → evaluateReplan（LLM）→ applyReplanDecision → 更新 replan_recovery_map",
    responsibilities: [
      "检查触发条件：review fail + terminal fail、新发现信号、open issue 数量超阈值",
      "构建 ReplanContext（已完成/失败/待办 todo 摘要）送给 LLM 决策",
      "支持 4 种动作：no_change / add_todos / prune_todos / replace_plan",
      "修复 LLM 返回的 todo 草稿（补 depends_on、acceptance_criteria 等缺失字段）",
      "记录 replan_recovery_map：failed todo → 新 replan todo，供 TerminalState 判断是否已闭环",
    ],
    notResponsible: [
      "不执行新增的 todo，只把它们加入状态",
      "不决定何时 replan（触发判断在 Orchestrator）",
    ],
    calledBy: ["Orchestrator（满足触发条件时）"],
    calls: ["LLM（callLLMWithUsage）", "addTodo", "updateTodoStatus（prune）"],
  },
  {
    id: "parallel-wave",
    layer: "调度",
    title: "ParallelWave",
    subtitle: "并行波次调度器",
    icon: Zap,
    tone: "amber",
    oneLiner: "把一批 ready todo 并行分发给 subagent，收集结果，逐个 review，处理 recovery。",
    flow: "选出 ready todo → 为每个 todo 确定执行模式（delegate/self/split）→ Promise.all 并行执行 → wave review → wave recovery",
    responsibilities: [
      "一次最多并行 2 个 todo（可配置 maxParallel）",
      "为每个 todo 选择执行模式：delegate 给 subagent / self 执行 / split 拆分",
      "并行执行后逐个调用 wave review，判断是否通过验收标准",
      "review fail 时进入 wave recovery：retry / reroute / split / fail",
      "记录 WaveRecord 到 state.wave_history，供后续追溯",
    ],
    notResponsible: [
      "不决定执行哪些 todo（那是 Selector 的事）",
      "不做整体 run 的终止判断",
    ],
    calledBy: ["Orchestrator（每个 step）"],
    calls: ["SubagentExecutor", "Review（wave reviewer）", "RecoveryPolicy", "addWaveRecord"],
  },
  {
    id: "selector",
    layer: "调度",
    title: "Selector",
    subtitle: "Todo 选择器",
    icon: Search,
    tone: "amber",
    oneLiner: "每个 step 选出下一批可以执行的 todo，考虑优先级、依赖和并行限制。",
    flow: "过滤 ready todo → 按优先级排序 → 考虑 serial_only 限制 → 返回候选列表",
    responsibilities: [
      "只选 status=ready 的 todo（depends_on 全部 done）",
      "按 priority（critical > high > medium > low）排序",
      "serial_only=true 的 todo 不能加入并行波次",
      "返回候选列表交给 Wave 做最终分配",
    ],
    notResponsible: [
      "不修改任何 todo 状态",
      "不决定如何执行（那是 Wave 的事）",
    ],
    calledBy: ["Orchestrator", "ParallelWave"],
    calls: ["state.todos（只读）"],
  },
  {
    id: "review",
    layer: "调度",
    title: "Review",
    subtitle: "验收评审器",
    icon: ShieldCheck,
    tone: "emerald",
    oneLiner: "根据 todo 的 acceptance_criteria，用 LLM 判断执行结果是否通过。",
    flow: "构建 review prompt（criteria + 执行摘要）→ LLM 逐条判断 → pass / revise / split / fail",
    responsibilities: [
      "逐条评估 acceptance_criteria，计算通过率",
      "通过率 ≥ 阈值 → pass；部分缺失 → revise；严重缺失 → fail",
      "单条 criterion 的 todo：用绝对数量而非比例判断，防止 1/1 全部失败被降级为 revise",
      "生成 retry_improvement_directive，告知下次重试应改进哪里",
      "记录 last_review_judgments，供执行上下文构建器（isRetry）参考",
    ],
    notResponsible: [
      "不执行 todo，不调用 skill",
      "不决定 review fail 后的恢复策略（那是 RecoveryPolicy 的事）",
    ],
    calledBy: ["ParallelWave（wave reviewer）", "Orchestrator（step reviewer）"],
    calls: ["LLM（callLLMWithUsage）"],
  },
  {
    id: "terminal-state",
    layer: "调度",
    title: "TerminalState",
    subtitle: "终止条件判断器",
    icon: Flag,
    tone: "emerald",
    oneLiner: "每个 step 结束后判断整个 run 是否应该终止，以及终止原因。",
    flow: "检查 todos 状态分布 → 检查 replan_recovery_map → 检查 idle/step 上限 → 返回 shouldTerminate + resultStatus",
    responsibilities: [
      "所有 todo done/pruned → success",
      "有 failed todo 但 replan_recovery_map 显示已被新 todo 覆盖且该 todo done → 也算 success",
      "超过 maxSteps 或 idleStepLimit → max_steps_reached",
      "存在无法恢复的 failed todo → failed",
    ],
    notResponsible: [
      "不修改任何 todo 状态",
      "不触发 replan（只读状态做判断）",
    ],
    calledBy: ["Orchestrator（每 step 结尾）"],
    calls: ["state（只读）"],
  },
  {
    id: "subagent-executor",
    layer: "执行",
    title: "SubagentExecutor",
    subtitle: "子 Agent 执行器",
    icon: Bot,
    tone: "sky",
    oneLiner: "把单个 todo 分配给对应类型的 subagent，构建执行上下文，调用 LLM 工具循环完成任务。",
    flow: "buildExecutionContext → 选择 agent 类型 → callLLMWithTools（多轮工具调用）→ 注册产出 artifacts",
    responsibilities: [
      "根据 capability_type 选择对应 subagent（research_agent / writing_agent / analysis_agent 等）",
      "isRetry=true 时压缩上下文（skill 数 8→4，去除 guide_content，缩小 budget）",
      "多轮 LLM-tool 循环：LLM 选工具 → 执行工具 → 把结果喂回 LLM → 直到完成",
      "merge 类型 todo 注入 MERGE DIRECTIVE，防止 agent 只处理第一个输入就停止",
      "执行完成后把产出注册为 ArtifactRecord 到 state",
    ],
    notResponsible: [
      "不决定 todo 是否通过验收（那是 Review 的事）",
      "不决定失败后如何恢复",
    ],
    calledBy: ["ParallelWave"],
    calls: ["ExecutionContextBuilder", "DelegationBriefBuilder", "callLLMWithTools", "SkillResourceCenter"],
  },
  {
    id: "todo-splitter",
    layer: "执行",
    title: "TodoSplitter",
    subtitle: "Todo 拆分器",
    icon: SplitSquareHorizontal,
    tone: "amber",
    oneLiner: "把一个过于庞大或多次失败的 todo 拆成 3 步串行子链：scope → execute → validate。",
    flow: "原 todo → sub1（planning: scope clarification）→ sub2（原 capability: focused execution）→ sub3（review: validation）",
    responsibilities: [
      "生成 3 个子 todo，依赖链 sub1 → sub2 → sub3",
      "重置所有恢复状态字段（retry_count、reroute_count、recovery_history 等）",
      "重新连接下游 todo 的 depends_on 指向 sub3（原 todo 的尾节点）",
      "所有子 todo 的 input_refs 显式置空，由 depends_on 在运行时解析输入",
    ],
    notResponsible: [
      "不执行子 todo",
      "不决定何时触发拆分（RecoveryPolicy 决定）",
    ],
    calledBy: ["RecoveryPolicy", "ParallelWave（wave recovery）"],
    calls: ["state.todos（修改 depends_on）"],
  },
  {
    id: "supervisor-runtime-state",
    layer: "状态",
    title: "SupervisorRuntimeState",
    subtitle: "核心状态层",
    icon: Database,
    tone: "slate",
    oneLiner: "RunState 是整个 Meta-Agent 的单一数据源，所有模块都通过它的 API 读写状态。",
    flow: "createRunState → addTodo → updateTodoStatus（含合法性校验）→ refreshTodoReadiness → recomputeRunStatus",
    responsibilities: [
      "RunState 包含：todos / artifacts / workspace_files / execution_log / issues / wave_history / metadata",
      "TodoItem 状态机：todo → ready → in_progress → reviewing → done（+blocked/failed/pruned）",
      "ALLOWED_TODO_TRANSITIONS 强制状态流转合法性，非法转换直接 throw",
      "refreshTodoReadiness：depends_on 全部 done 时自动把 todo 升为 ready",
      "addArtifact / addWorkspaceFile 强制要求 related_todo 存在，防止孤立产物",
    ],
    notResponsible: [
      "不包含任何业务逻辑",
      "不调用 LLM",
      "不决定任何执行策略",
    ],
    calledBy: ["所有模块（通过导出函数读写）"],
    calls: ["无外部依赖"],
  },
  {
    id: "long-term-memory",
    layer: "记忆",
    title: "LongTermMemoryService",
    subtitle: "跨 Run 语义记忆库",
    icon: BookOpen,
    tone: "violet",
    oneLiner: "以 SQLite 为底层存储，为所有 Agent 提供 remember / search 两个核心接口，支持嵌入向量语义检索与 TF-IDF 降级回退。",
    flow: "remember(content) → 去重检查 → 写库 → 后台生成 embedding；search(query) → embedding 向量检索（or TF-IDF fallback）→ 返回带 score 的 MemorySearchResult[]",
    responsibilities: [
      "记忆类型分 4 种：fact / experience / preference / insight，按类型控制召回策略",
      "写入前去重：新内容与已有记忆做相似度比较，超过阈值则跳过或合并",
      "decay 衰减机制：记忆随时间降分，长期未访问的记忆会在 consolidation 中被清除",
      "embedding 异步生成：写入不阻塞调用方，后台 enrichment 完成后自动更新向量",
      "TF-IDF fallback：embedding 服务不可用时自动降级为关键词权重检索，保持可用性",
    ],
    notResponsible: [
      "不决定何时触发记忆写入（由各调用方判断）",
      "不主动推送记忆给 Agent（由 WorkingMemory 负责组装）",
      "不执行记忆合并（由 MemoryConsolidation 负责）",
    ],
    calledBy: ["WorkingMemory（检索记忆注入上下文）", "Planner（写入成功 todo skeleton）", "meta-agent-service（run 结束后写回记忆）"],
    calls: ["SQLite (db)", "EmbeddingService（异步向量生成）"],
  },
  {
    id: "memory-consolidation",
    layer: "记忆",
    title: "MemoryConsolidation",
    subtitle: "记忆压缩与衰减器",
    icon: Merge,
    tone: "violet",
    oneLiner: "定期合并相似记忆、降低旧记忆分数、清除低质量条目，防止记忆库膨胀失控。",
    flow: "consolidateScope() → findSimilarPairs（embedding 余弦相似度 > 0.88）→ 合并内容（取更长者为主体）→ decay（所有活跃记忆 × 0.95）→ purge（decayScore < 阈值）",
    responsibilities: [
      "相似对合并：找出 embedding 余弦相似度 > 0.88 的记忆对，合并为一条，原条目标记 mergedInto",
      "合并策略：无 LLM，纯确定性——取更长内容为主体，合并关键词，保留较高 importance",
      "每次合并上限 maxMergesPerRun=10，防止单次运行时间过长",
      "decay 乘数默认 0.95，每次 consolidation 后所有记忆得分 × 0.95",
      "purge：decayScore < 下限的记忆直接从库中删除",
    ],
    notResponsible: [
      "不读取或执行任何业务任务",
      "不决定合并后的记忆内容（取已有内容，不做 LLM 改写）",
      "不触发自身——需由外部调用（如 run 结束后、定时任务）",
    ],
    calledBy: ["meta-agent-service（run 完成后触发）", "可接入定时任务（周期性清理）"],
    calls: ["LongTermMemoryService.findSimilarPairs()", "SQLite (db)", "EmbeddingService"],
  },
  {
    id: "working-memory",
    layer: "记忆",
    title: "WorkingMemory",
    subtitle: "动态上下文组装器",
    icon: MemoryStick,
    tone: "sky",
    oneLiner: "替代固定 5 条记忆 + 12 条上游消息的硬编码拼接，用 token-budget 感知的优先级分配器动态构建每次 Agent 执行的上下文。",
    flow: "assembleContext(options) → 按优先级排列来源（任务描述 > 人类消息 > 上游节点消息 > 长期记忆命中 > 系统 prompt）→ token 估算（中文 1.5 chars/token，英文 4 chars/token）→ 裁剪至 budget → 输出 AssembledContext",
    responsibilities: [
      "5 个上下文来源按优先级装填：任务描述（必须）→ 人类消息 → 上游节点数据 → 长期记忆 → 系统 prompt（必须）",
      "token 估算启发式：中文 1.5 字符/token，英文 4 字符/token，整体 budget 默认 6000",
      "低优先级来源在 budget 不足时被裁剪或跳过，高优先级来源不被裁减",
      "返回 AssembledContext 包含：prompt 字符串、估算 token 数、实际纳入的记忆条数、纳入的上游消息数",
    ],
    notResponsible: [
      "不调用 LLM，只做上下文拼装",
      "不写入任何记忆（只读取 LongTermMemoryService 结果）",
      "不决定记忆检索的 query（由调用方传入 memoryHits）",
    ],
    calledBy: ["Agent 节点执行器（每次执行前调用）"],
    calls: ["ContextSource 优先级队列（纯内存计算，无外部 IO）"],
  },
  {
    id: "skill-resource-center",
    layer: "执行",
    title: "SkillResourceCenter",
    subtitle: "技能资源中心",
    icon: Brain,
    tone: "emerald",
    oneLiner: "为 Planner/Subagent 提供可用 skill 列表，并负责执行 skill（调用对应 script）。",
    flow: "listMetaAgentSkillResources → selectMetaAgentSkillResources（语义搜索）→ executeMetaAgentSkillResource（运行 script）",
    responsibilities: [
      "从 configService 读取已启用的 skill + script 资产",
      "CJK 感知的语义搜索：单字=1分、bigram=4分、trigram=7分，英文短词按长度加权",
      "执行 skill 时通过 executeDevAgent 运行对应 script，传入参数和输出目录",
      "skill script 规范（SKILL_CONTRACT）：只执行原子操作，不自主扩展工作范围，不调用另一个 skill",
    ],
    notResponsible: [
      "不决定用哪个 skill（LLM/Subagent 决定）",
      "不在 skill 内部做业务判断（由 script 合约约束）",
    ],
    calledBy: ["SubagentExecutor（工具调用时）", "Planner（获取 skill 列表注入 prompt）"],
    calls: ["configService", "executeDevAgent", "script files（scripts/skills/*.mjs）"],
  },
];

const LAYER_ORDER = ["入口", "规划", "调度", "执行", "状态", "记忆"] as const;
const LAYER_META: Record<string, { color: string; bg: string; border: string }> = {
  入口: { color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" },
  规划: { color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
  调度: { color: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200" },
  执行: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  状态: { color: "text-slate-700", bg: "bg-slate-100", border: "border-slate-300" },
  记忆: { color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200" },
};

// 执行阶段三个子视图（04/05/06）的详细信息，在 ExecCluster 内渲染
const EXEC_SUB_NODES = [
  {
    step: "04",
    title: "创建 Run",
    description: "把配置变成一次真实执行实例",
    icon: PlayCircle,
  },
  {
    step: "05",
    title: "运行中心",
    description: "统一观察状态、进度与最近运行",
    icon: Radar,
  },
  {
    step: "06",
    title: "运行详情",
    description: "节点日志、输入输出、报错与产物",
    icon: ScrollText,
  },
];

// 三条回路：触发点、终点、说明
const FEEDBACK_LOOPS = [
  {
    id: "replan",
    label: "replan 回路",
    from: "步骤 04 执行中",
    to: "重新规划 → 当前 Run 内",
    description: "Todo 失败 / Review 不通过 → RecoveryPolicy → retry / reroute / split / Replanner 重规划",
    icon: RefreshCcw,
    tone: "sky" as const,
  },
  {
    id: "eval",
    label: "评测回流回路",
    from: "步骤 06/07 产物",
    to: "步骤 02 工作流编排",
    description: "评测中心对产物做 replay / compare → 结论写回工作流，驱动下一轮迭代",
    icon: ArrowUpLeft,
    tone: "emerald" as const,
  },
  {
    id: "memory",
    label: "记忆写回回路",
    from: "步骤 07 Run 结束",
    to: "步骤 04 下一次 Run",
    description: "meta-agent-service 将 run summary / artifacts 写入 LongTermMemoryService，下次 Run 由 WorkingMemory 注入上下文",
    icon: BrainCircuit,
    tone: "violet" as const,
  },
] as const;

const SYSTEM_DESIGN_HIGHLIGHTS = [
  "Run 是统一执行对象，把编排、执行、观测串成同一模型。",
  "资源与执行解耦，能力先沉淀为资产，再进入工作流和项目。",
  "运行中心与运行详情组成可观测执行链路，而不是黑盒结果页。",
  "复杂任务通过 Meta-Agent 接入控制回路，而不污染主执行链。",
  "结果最终回流项目，形成可复盘、可复用、可继续迭代的沉淀层。",
];

const PLATFORM_CAPABILITY_LOOP = [
  "资源中心负责配置能力，把模型、Prompt、Tool、Skill 收敛成统一入口。",
  "工作流编排负责组织能力，把离散资源装配成可执行流程。",
  "项目负责承载能力，让工作流进入业务语境并形成归属。",
  "Run 负责实例化执行，把配置变成真实、可追踪的一次运行。",
  "运行与评测共同负责观测和回流，让结果持续进入复盘与下一轮迭代。",
];

/* ─────────────────────────────────────────────────────────────────
   平台流程图：竖向主链 + SVG 连线 + 侧边分支 + 回路虚线
   ───────────────────────────────────────────────────────────────── */

// 主链节点定义（纯展示，不复用 FLOW_NODES 以便独立控制布局）
const DIAGRAM_MAIN_NODES = [
  {
    id: "assets",
    step: "01",
    title: "资源中心",
    sub: "模型 · Prompt · Tool · Skill",
    color: "border-slate-300 bg-white",
    stepColor: "bg-slate-100 text-slate-600",
    icon: Boxes,
    iconColor: "text-slate-500",
  },
  {
    id: "workflow",
    step: "02",
    title: "工作流编排",
    sub: "节点化组织业务流程",
    color: "border-violet-200 bg-violet-50/40",
    stepColor: "bg-violet-100 text-violet-700",
    icon: FileCog,
    iconColor: "text-violet-500",
  },
  {
    id: "project",
    step: "03",
    title: "绑定项目",
    sub: "进入业务语境，形成归属",
    color: "border-indigo-200 bg-indigo-50/40",
    stepColor: "bg-indigo-100 text-indigo-700",
    icon: FolderKanban,
    iconColor: "text-indigo-500",
  },
  {
    id: "run-create",
    step: "04",
    title: "创建 Run",
    sub: "配置实例化为真实执行",
    color: "border-sky-200 bg-sky-50/40",
    stepColor: "bg-sky-100 text-sky-700",
    icon: PlayCircle,
    iconColor: "text-sky-500",
  },
  {
    id: "run-center",
    step: "05",
    title: "运行中心",
    sub: "状态 · 进度 · 失败观测",
    color: "border-sky-200 bg-sky-50/40",
    stepColor: "bg-sky-100 text-sky-700",
    icon: Radar,
    iconColor: "text-sky-500",
  },
  {
    id: "run-detail",
    step: "06",
    title: "运行详情",
    sub: "日志 · 输入输出 · 产物",
    color: "border-sky-200 bg-sky-50/40",
    stepColor: "bg-sky-100 text-sky-700",
    icon: ScrollText,
    iconColor: "text-sky-500",
  },
  {
    id: "result",
    step: "07",
    title: "结果沉淀",
    sub: "产物回流，可复盘复用",
    color: "border-emerald-200 bg-emerald-50/40",
    stepColor: "bg-emerald-100 text-emerald-700",
    icon: Archive,
    iconColor: "text-emerald-500",
  },
] as const;

// 侧边分支模块
const DIAGRAM_SIDE_NODES = [
  {
    id: "meta-agent",
    title: "Meta-Agent",
    sub: "todo 拆解 · 并行波次 · 恢复",
    attachTo: "run-create", // 从哪个主链节点引出
    color: "border-sky-300 bg-sky-50",
    iconColor: "text-sky-600",
    icon: Bot,
    side: "right" as const,
  },
  {
    id: "eval",
    title: "评测中心",
    sub: "replay · compare · 回流",
    attachTo: "run-detail",
    color: "border-emerald-300 bg-emerald-50",
    iconColor: "text-emerald-600",
    icon: Radar,
    side: "right" as const,
  },
] as const;


function PlatformFlowDiagram() {
  // 节点高度与间距（px，用于计算 SVG 坐标）
  const NODE_H = 64;
  const GAP = 20;
  const STRIDE = NODE_H + GAP; // 每个主链节点占用的总高度
  const N = DIAGRAM_MAIN_NODES.length;
  const SVG_H = N * STRIDE - GAP;
  const MAIN_X = 200; // 主链节点左边缘 x（SVG 坐标）
  const NODE_W = 220; // 主链节点宽度
  const SIDE_X = MAIN_X + NODE_W + 48; // 侧边分支 x
  const SIDE_W = 180;
  const LEFT_LOOP_X = MAIN_X - 36; // 左侧回路折线 x
  const RIGHT_LOOP_X = SIDE_X + SIDE_W + 16; // 右侧回路折线 x
  const CX = MAIN_X + NODE_W / 2; // 主链中心 x

  // 计算每个主链节点的垂直中心 y
  const nodeY = (idx: number) => idx * STRIDE + NODE_H / 2;
  const mainIdx = (id: string) => DIAGRAM_MAIN_NODES.findIndex((n) => n.id === id);

  // 侧边节点的 y（对齐到对应主链节点）
  const sideNodeH = 56;
  const sideY = (attachId: string) => nodeY(mainIdx(attachId)) - sideNodeH / 2;

  return (
    <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(160deg,_#f8faff_0%,_#ffffff_60%,_#f0fdf4_100%)] px-6 py-6 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.35)]">
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50">
          <Layers className="h-4 w-4 text-indigo-600" />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-slate-400">PLATFORM FLOW</p>
          <h2 className="text-base font-semibold text-slate-950">平台完整使用链路 · 带连线流程图</h2>
        </div>
        {/* 图例 */}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="inline-block h-0.5 w-5 bg-slate-400" />主链路
          </span>
          <span className="flex items-center gap-1.5 text-sky-500">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-sky-400" />replan 回路
          </span>
          <span className="flex items-center gap-1.5 text-emerald-500">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-emerald-400" />评测回流
          </span>
          <span className="flex items-center gap-1.5 text-violet-500">
            <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-violet-400" />记忆写回
          </span>
        </div>
      </div>

      {/* 桌面版：相对容器，SVG 覆盖连线，节点绝对定位 */}
      <div className="hidden lg:block">
        <div className="relative mx-auto" style={{ width: RIGHT_LOOP_X + 20, height: SVG_H }}>

          {/* ── SVG 连线层 ── */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={RIGHT_LOOP_X + 20}
            height={SVG_H}
            viewBox={`0 0 ${RIGHT_LOOP_X + 20} ${SVG_H}`}
          >
            <defs>
              {/* 主链箭头 */}
              <marker id="arr-main" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M1,1 L7,4 L1,7 Z" fill="#94a3b8" />
              </marker>
              {/* sky 箭头（回路/分支） */}
              <marker id="arr-sky" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M1,1 L7,4 L1,7 Z" fill="#7dd3fc" />
              </marker>
              {/* emerald 箭头 */}
              <marker id="arr-emerald" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M1,1 L7,4 L1,7 Z" fill="#6ee7b7" />
              </marker>
              {/* violet 箭头 */}
              <marker id="arr-violet" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M1,1 L7,4 L1,7 Z" fill="#c4b5fd" />
              </marker>
            </defs>

            {/* 主链连线：逐段 */}
            {DIAGRAM_MAIN_NODES.slice(0, -1).map((node, i) => {
              const y1 = nodeY(i) + NODE_H / 2;
              const y2 = nodeY(i + 1) - NODE_H / 2;
              const isSameGroup = (
                (node.id === "run-create" && DIAGRAM_MAIN_NODES[i + 1].id === "run-center") ||
                (node.id === "run-center" && DIAGRAM_MAIN_NODES[i + 1].id === "run-detail")
              );
              return (
                <line
                  key={node.id}
                  x1={CX} y1={y1}
                  x2={CX} y2={y2 + 6}
                  stroke={isSameGroup ? "#bae6fd" : "#cbd5e1"}
                  strokeWidth={isSameGroup ? 1.5 : 2}
                  strokeDasharray={isSameGroup ? "4 3" : undefined}
                  markerEnd={isSameGroup ? undefined : "url(#arr-main)"}
                />
              );
            })}

            {/* 执行阶段括号（左侧竖线标注） */}
            {(() => {
              const y1 = nodeY(mainIdx("run-create")) - NODE_H / 2 + 4;
              const y2 = nodeY(mainIdx("run-detail")) + NODE_H / 2 - 4;
              const bx = MAIN_X - 14;
              return (
                <g>
                  <line x1={bx} y1={y1} x2={bx} y2={y2} stroke="#bae6fd" strokeWidth={2} />
                  <line x1={bx} y1={y1} x2={bx + 6} y2={y1} stroke="#bae6fd" strokeWidth={2} />
                  <line x1={bx} y1={y2} x2={bx + 6} y2={y2} stroke="#bae6fd" strokeWidth={2} />
                  <text x={bx - 4} y={(y1 + y2) / 2 + 4} fontSize="9" fill="#7dd3fc" textAnchor="middle" transform={`rotate(-90, ${bx - 4}, ${(y1 + y2) / 2})`}>
                    执行阶段
                  </text>
                </g>
              );
            })()}

            {/* 分支线：主链 → 侧边节点 */}
            {DIAGRAM_SIDE_NODES.map((side) => {
              const aidx = mainIdx(side.attachTo);
              const my = nodeY(aidx);
              const sy = sideY(side.attachTo) + sideNodeH / 2;
              const x1 = MAIN_X + NODE_W;
              const x2 = SIDE_X;
              const stroke = side.id === "meta-agent" ? "#7dd3fc" : "#6ee7b7";
              const arrId = side.id === "meta-agent" ? "arr-sky" : "arr-emerald";
              return (
                <path
                  key={side.id}
                  d={`M${x1},${my} C${x1 + 24},${my} ${x2 - 24},${sy} ${x2},${sy}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  markerEnd={`url(#${arrId})`}
                />
              );
            })}

            {/* 左侧回路：replan (run-detail → run-create) */}
            {(() => {
              const fromY = nodeY(mainIdx("run-detail"));
              const toY = nodeY(mainIdx("run-create"));
              const lx = LEFT_LOOP_X;
              return (
                <g>
                  <path
                    d={`M${MAIN_X},${fromY} H${lx} V${toY} H${MAIN_X + 6}`}
                    fill="none"
                    stroke="#7dd3fc"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    markerEnd="url(#arr-sky)"
                  />
                  <text x={lx - 2} y={(fromY + toY) / 2} fontSize="9" fill="#7dd3fc" textAnchor="end">replan</text>
                </g>
              );
            })()}

            {/* 左侧回路：记忆写回 (result → run-create) */}
            {(() => {
              const fromY = nodeY(mainIdx("result"));
              const toY = nodeY(mainIdx("run-create"));
              const lx = LEFT_LOOP_X - 18;
              return (
                <g>
                  <path
                    d={`M${MAIN_X},${fromY} H${lx} V${toY} H${MAIN_X + 6}`}
                    fill="none"
                    stroke="#c4b5fd"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    markerEnd="url(#arr-violet)"
                  />
                  <text x={lx - 2} y={(fromY + toY) / 2 + 10} fontSize="9" fill="#c4b5fd" textAnchor="end">记忆写回</text>
                </g>
              );
            })()}

            {/* 右侧回路：评测回流 (eval侧边 → workflow) */}
            {(() => {
              const evalY = sideY("run-detail") + sideNodeH / 2;
              const toY = nodeY(mainIdx("workflow"));
              const rx = RIGHT_LOOP_X;
              return (
                <g>
                  <path
                    d={`M${SIDE_X + SIDE_W},${evalY} H${rx} V${toY} H${MAIN_X + NODE_W + 6}`}
                    fill="none"
                    stroke="#6ee7b7"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    markerEnd="url(#arr-emerald)"
                  />
                  <text x={rx + 2} y={(evalY + toY) / 2} fontSize="9" fill="#6ee7b7" textAnchor="start">评测回流</text>
                </g>
              );
            })()}
          </svg>

          {/* ── 主链节点（绝对定位） ── */}
          {DIAGRAM_MAIN_NODES.map((node, i) => {
            const Icon = node.icon;
            const y = i * STRIDE;
            return (
              <div
                key={node.id}
                className={`absolute flex items-center gap-3 rounded-2xl border px-4 ${NODE_H === 64 ? "py-3" : "py-2"} ${node.color} shadow-sm`}
                style={{ left: MAIN_X, top: y, width: NODE_W, height: NODE_H }}
              >
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${node.stepColor}`}>
                  {node.step}
                </span>
                <Icon className={`h-4 w-4 shrink-0 ${node.iconColor}`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{node.title}</p>
                  <p className="truncate text-[11px] text-slate-500">{node.sub}</p>
                </div>
              </div>
            );
          })}

          {/* ── 侧边分支节点（绝对定位） ── */}
          {DIAGRAM_SIDE_NODES.map((side) => {
            const Icon = side.icon;
            const y = sideY(side.attachTo);
            return (
              <div
                key={side.id}
                className={`absolute flex items-center gap-2.5 rounded-2xl border border-dashed px-3 py-2 ${side.color} shadow-sm`}
                style={{ left: SIDE_X, top: y, width: SIDE_W, height: sideNodeH }}
              >
                <Icon className={`h-4 w-4 shrink-0 ${side.iconColor}`} />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-slate-800">{side.title}</p>
                  <p className="truncate text-[10px] text-slate-500">{side.sub}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 移动端：纯竖向列表 */}
      <div className="space-y-2 lg:hidden">
        {DIAGRAM_MAIN_NODES.map((node) => {
          const Icon = node.icon;
          return (
            <div key={node.id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${node.color}`}>
              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${node.stepColor}`}>
                {node.step}
              </span>
              <Icon className={`h-4 w-4 shrink-0 ${node.iconColor}`} />
              <div>
                <p className="text-sm font-semibold text-slate-900">{node.title}</p>
                <p className="text-[11px] text-slate-500">{node.sub}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function InterviewShowcaseConsole(_: { initialScenarioId?: string }) {
  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] px-6 py-6 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.45)]">
        <p className="text-xs font-medium tracking-[0.18em] text-slate-500">INTERVIEW FLOW</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 lg:text-3xl">
          平台完整使用链路：资源 → 工作流编排 → 绑定项目 → Run → 运行中心 → 运行详情 → 结果沉淀
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          面试时先用这张图讲清平台从配置到执行再到复盘的完整闭环，再按节点跳转到真实页面展开。
        </p>
      </section>

      <PlatformFlowDiagram />

      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-6 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.45)]">
        {/* ── Desktop ── */}
        <div className="hidden overflow-x-auto lg:block">
          <div className="min-w-[900px]">
            {/* Stage Lane Headers */}
            <div className="grid grid-cols-5 gap-3">
              {STAGE_LANES.map((lane) => (
                <div key={lane.title} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-500">{lane.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{lane.detail}</p>
                </div>
              ))}
            </div>

            {/* Main flow row */}
            <div className="mt-4">
              <div className="flex items-stretch gap-2">
                {FLOW_NODES.map((node, index) => (
                  <FlowDesktopSegment
                    key={node.step}
                    node={node}
                    showConnector={index < FLOW_NODES.length - 1}
                  />
                ))}
              </div>
            </div>

            {/* Support modules row — aligned under exec & 沉淀 columns */}
            <div className="mt-8 grid grid-cols-5 gap-3">
              {SUPPORT_MODULES.map((mod) => (
                <div key={mod.title} className={mod.columnClass}>
                  <div className="mb-1.5 flex items-center justify-center">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-0.5 text-[10px] font-medium tracking-[0.12em] text-slate-500">
                      {mod.lane}
                    </span>
                  </div>
                  <VerticalConnector tone={mod.tone} />
                  <SupportModuleCard
                    title={mod.title}
                    description={mod.description}
                    triggeredAt={mod.triggeredAt}
                    href={mod.href}
                    icon={mod.icon}
                    tone={mod.tone}
                  />
                </div>
              ))}
            </div>

            {/* Feedback Loops layer */}
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[10px] font-semibold tracking-[0.16em] text-slate-400">FEEDBACK LOOPS</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {FEEDBACK_LOOPS.map((loop) => (
                  <FeedbackLoopCard key={loop.id} loop={loop} />
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-center gap-4 text-[11px] font-medium">
                <LegendChip label="主执行链" tone="slate" />
                <LegendChip label="控制回路" tone="sky" />
                <LegendChip label="验证回流" tone="emerald" />
                <LegendChip label="记忆写回" tone="violet" />
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">
                主链路从配置到执行再到沉淀；复杂任务由 Meta-Agent 接管（replan 回路）；产物经评测回流工作流（验证回流）；run 结束后记忆写回供下次注入（记忆写回）。
              </p>
            </div>
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="space-y-3 lg:hidden">
          {FLOW_NODES.map((node, index) => (
            <div key={node.step} className="space-y-3">
              <FlowMobileNode node={node} />
              {index < FLOW_NODES.length - 1 ? (
                <VerticalConnector tone="slate" compact />
              ) : null}
            </div>
          ))}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SUPPORT_MODULES.map((mod) => (
              <div key={mod.title} className="space-y-2">
                <VerticalConnector tone={mod.tone} compact />
                <SupportModuleCard
                  title={mod.title}
                  description={mod.description}
                  triggeredAt={mod.triggeredAt}
                  href={mod.href}
                  icon={mod.icon}
                  tone={mod.tone}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {FEEDBACK_LOOPS.map((loop) => (
              <FeedbackLoopCard key={loop.id} loop={loop} />
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CompactPanel title="系统设计亮点">
          {SYSTEM_DESIGN_HIGHLIGHTS.map((item) => (
            <li key={item} className="text-sm leading-6 text-slate-700">
              {item}
            </li>
          ))}
        </CompactPanel>

        <CompactPanel title="平台能力闭环">
          {PLATFORM_CAPABILITY_LOOP.map((item) => (
            <li key={item} className="text-sm leading-6 text-slate-700">
              {item}
            </li>
          ))}
        </CompactPanel>
      </section>

      <MetaAgentArchitectureSection />
    </div>
  );
}

type InteractionLine = {
  from: string;
  to: string;
  action: string;
  detail: string;
};

type ExampleStep = {
  stepIndex: number;
  phase: string;
  phaseColor: string;
  title: string;
  module: string;
  moduleTone: "sky" | "violet" | "amber" | "emerald" | "slate" | "rose";
  what: string;
  interactions: InteractionLine[];
  detail: string[];
  stateAfter: string[];
  output?: string;
  warningNote?: string;
};

// ─── 以下数据用于对外展示，按修复后的标准成功路径整理 ───
// 真实 todo：4 个（无独立 todo_verify，verify 内置于 todo_delivery）
// 展示 loop step：4 步（step=1 规划+wave并行batch1+batch2均pass, step=2 merge, step=3 delivery pass, step=4 终止）
// 真实 review：两层（wave_reviewer 波次内快速, supervisor_reviewer 波次外正式）
// 展示重点：并行下载、去重合并、一次交付成功
const PAPER_DOWNLOAD_EXAMPLE: ExampleStep[] = [
  {
    stepIndex: 1,
    phase: "启动",
    phaseColor: "slate",
    title: "meta-agent-service 接收 goal，Orchestrator 初始化",
    module: "meta-agent-service → Orchestrator",
    moduleTone: "slate",
    what: "用户提交 goal，meta-agent-service 创建 RunState、启动 Orchestrator 主循环，广播 bootstrapping 事件。",
    interactions: [
      { from: "前端 / API 调用方", to: "meta-agent-service", action: "POST goal", detail: "传入 goal 字符串与 maxStepLimit 参数" },
      { from: "meta-agent-service", to: "createRunState(goal)", action: "初始化状态", detail: "生成 run_id、status=pending、todos/artifacts/execution_log 全部为空" },
      { from: "meta-agent-service", to: "runTodoDrivenOrchestrator()", action: "启动主循环", detail: "传入 goal + options（maxSteps、subagentRunner、parallel 配置）" },
      { from: "Orchestrator", to: "onProgress(bootstrapping)", action: "广播 step=0", detail: "前端收到事件，显示「初始化中」状态" },
    ],
    detail: [
      "maxSteps = max(12, maxPlanningRounds * 4)，本例取默认值 12",
      "idleStepLimit=2：连续 2 个 step 无 todo 被选中则视为空转，触发终止",
      "state.metadata 初始化 Token 计数器：llm_total_tokens=0, llm_call_count=0",
      "todos[] 为空，下一 step 将自动触发 Planner",
    ],
    stateAfter: [
      "run_id = sup_run_xxxxxx",
      "status = pending",
      "todos = [], artifacts = [], execution_log = []",
      "metadata.phase = supervisor_runtime_state_initialized",
    ],
    output: "RunState 就绪，Orchestrator 进入 for(step=1..maxSteps) 主循环",
  },
  {
    stepIndex: 2,
    phase: "规划",
    phaseColor: "violet",
    title: "Planner：goal 分析 → LLM 生成 todo 草稿 → 校验写入 RunState",
    module: "loop.ts → planInitialTodos → LLM → validateAndNormalizeTodoDrafts",
    moduleTone: "violet",
    what: "loop step=1 时 todos[] 为空，自动触发 Planner。分析 goal 中的并行意图，向 LLM 请求结构化 todo 列表（4 个），校验后写入 RunState。",
    interactions: [
      { from: "loop.ts (runTodoDrivenStep)", to: "planInitialTodos()", action: "触发规划", detail: "仅在 state.todos.length === 0 时触发，整个 run 只执行一次" },
      { from: "planInitialTodos()", to: "analyzeGoal(goal)", action: "意图分析", detail: "检测「并行/同时/并发」关键词，「十」→10，设 parallelIntent=true" },
      { from: "planInitialTodos()", to: "LLM (callLLM)", action: "发送 prompt", detail: "注入 goal + skill 列表 + flow pattern 约束 + JSON schema 要求" },
      { from: "LLM", to: "planInitialTodos()", action: "返回 TodoDraft[]", detail: "JSON：id, title, description, depends_on, acceptance_criteria, capability_type" },
      { from: "planInitialTodos()", to: "validateAndNormalizeTodoDrafts()", action: "校验 + 修复", detail: "检查 DAG 无环、depends_on 引用存在、字段补全；失败带错误反馈重试最多 3 次" },
      { from: "loop.ts", to: "addTodo() × 4", action: "写入 RunState", detail: "每个 todo 写入后自动调 refreshTodoReadiness()，无依赖的 todo 升为 ready" },
    ],
    detail: [
      "analyzeGoal()：检测到「并行」→ parallelIntent=true，「十」→ requiredCount=10",
      "flow pattern 选择：「具体收集 + 显式并行」→ 直接扇出，不生成 todo_scope 步骤",
      "真实执行：LLM 生成 4 个 todo（不是 5 个）：batch1_download、batch2_download、merge_manifests、delivery",
      "注意：verify（完整性验证）不是独立 todo，而是内置于 todo_delivery 的 acceptance_criteria 中",
      "batch1_download.depends_on=[]，batch2_download.depends_on=[] → 两者无依赖，可并行",
      "merge_manifests.depends_on=[batch1, batch2]，形成 DAG：batch1/2 → merge → delivery",
      "validateAndNormalizeTodoDrafts() 校验通过，execution_log 写入 action=plan_initial_todos",
      "refreshTodoReadiness()：batch1 / batch2 无依赖 → status 从 todo 升为 ready",
    ],
    stateAfter: [
      "todos[0]: todo_batch1_download { status: ready, capability_type: research }",
      "todos[1]: todo_batch2_download { status: ready, capability_type: research }",
      "todos[2]: todo_merge_manifests { status: todo, depends_on: [batch1, batch2] }",
      "todos[3]: todo_delivery { status: todo, depends_on: [todo_merge_manifests] }",
      "execution_log: actor=supervisor_planner, action=plan_initial_todos",
    ],
    output: "4 个 todo 写入 RunState，batch1 / batch2 自动升为 ready，Planner 完成退出",
  },
  {
    stepIndex: 3,
    phase: "调度",
    phaseColor: "sky",
    title: "Selector 选出并行候选 → ParallelWave 创建 wave_001",
    module: "loop.ts → Selector → ParallelWave → DelegationPolicy",
    moduleTone: "sky",
    what: "Planner 完成后 loop.ts 立即进入调度，Selector 找到 2 个 ready todo（batch1/batch2），ParallelWave 决定执行模式并创建并行波次。",
    interactions: [
      { from: "loop.ts", to: "refreshTodoReadiness()", action: "刷新就绪", detail: "确保 depends_on 已全部 done 的 todo 升为 ready" },
      { from: "loop.ts", to: "runParallelTodoWave()", action: "尝试并行波次", detail: "优先于串行 selectNextTodo()，并行可用时走 Wave 路径" },
      { from: "runParallelTodoWave()", to: "selectCandidates()", action: "选候选 todo", detail: "过滤 status=ready 且 serial_only=false 的 todo，按 priority 排序" },
      { from: "runParallelTodoWave()", to: "decideTodoExecutionMode() × 2", action: "决定执行模式", detail: "DelegationPolicy：capability_type=research → mode=delegate，target=research_agent" },
      { from: "ParallelWave", to: "addWaveRecord()", action: "记录波次", detail: "写入 wave_history[0]：wave_id=wave_001, todo_ids=[todo_batch1, todo_batch2]" },
      { from: "ParallelWave", to: "addExecutionLog(wave_created)", action: "写执行日志", detail: "action=wave_created，这是 E2E 健康检查「Parallel wave occurred」的关键信号" },
      { from: "ParallelWave", to: "Promise.all([exec(batch_a), exec(batch_b)])", action: "并行发出", detail: "两个 SubagentExecutor 同时启动，互不阻塞" },
    ],
    detail: [
      "Selector：[todo_batch1(high), todo_batch2(high)] 均入选，maxParallel=2 满足",
      "DelegationPolicy.decideTodoExecutionMode()：research 类型 → mode=delegate，target=research_agent",
      "serial_only=false，两个 todo 均允许进入并行波次",
      "wave_id = makeId('wave') → wave_001，state.current_wave_id = wave_001",
      "todo_batch1 / todo_batch2 状态流转：ready → in_progress，delegation_status = delegated",
      "execution_log 写入：actor=ParallelWave, action=wave_created, todo_ids=[todo_batch1, todo_batch2]",
      "此条 execution_log 是 E2E 健康检查「Parallel wave occurred」的数据来源",
    ],
    stateAfter: [
      "wave_history[0]: { wave_id: wave_001, todo_ids: [todo_batch1, todo_batch2] }",
      "current_wave_id = wave_001",
      "todo_batch1.status = in_progress, delegation_status = delegated",
      "todo_batch2.status = in_progress, delegation_status = delegated",
      "execution_log: action=wave_created",
    ],
    output: "Promise.all([executor(todo_batch1), executor(todo_batch2)]) 同时发出，两个 subagent 并行执行",
  },
  {
    stepIndex: 4,
    phase: "执行",
    phaseColor: "amber",
    title: "SubagentExecutor × 2 并行：构建上下文 → LLM 工具循环 → arxiv-fetch-skill 下载",
    module: "SubagentExecutor → ExecutionContextBuilder → LLM Tools → SkillResourceCenter",
    moduleTone: "amber",
    what: "以 todo_batch1 为例，ExecutionContextBuilder 组装执行上下文（含 planning_hint 分片约束），LLM 决定调用不同 query 的 arxiv-fetch-skill，SkillResourceCenter 启动脚本进程并行下载，结果超阈值 offload 到磁盘。todo_batch2 同步并行完成。",
    interactions: [
      { from: "ParallelWave", to: "runSubagentTodo(todo_batch1)", action: "启动子执行", detail: "传入 DelegationBrief（todo 描述、acceptance_criteria、可用 skill 列表 + planning_hint）" },
      { from: "runSubagentTodo()", to: "buildTodoExecutionContext()", action: "构建上下文", detail: "组装 goal + current_todo + input_artifacts + skill_resources + parallel_partitioning_hint" },
      { from: "buildTodoExecutionContext()", to: "selectMetaAgentSkillResources()", action: "语义匹配 skill", detail: "CJK bigram 匹配「arxiv」「论文」「收集」→ arxiv-fetch-skill 得分最高，带 planning_hint" },
      { from: "runSubagentTodo()", to: "callLLMWithTools(messages, tools)", action: "LLM 工具循环", detail: "tools 包含 arxiv-fetch-skill，LLM 按 planning_hint 决定使用不同 query 分片" },
      { from: "LLM", to: "executeMetaAgentSkillResource(arxiv-fetch-skill)", action: "调用 skill（batch1）", detail: "参数：{query:'agent memory 2025', count:5}，启动子进程" },
      { from: "LLM（todo_batch2）", to: "executeMetaAgentSkillResource(arxiv-fetch-skill)", action: "调用 skill（batch2）", detail: "参数：{query:'agent memory 2026', count:5}，不同 query 分片避免重叠" },
      { from: "skill 进程 stdout", to: "SkillResourceCenter", action: "返回 JSON 结果", detail: "{ papers[5], manifestPath, downloadedCount:5, ok:true }（batch1/batch2 各自返回）" },
      { from: "loop.ts", to: "decideOffload(content)", action: "Offloading 决策", detail: "content > 2800 chars → should_offload=true，writeWorkspaceFileForArtifact() 写磁盘" },
    ],
    detail: [
      "planning_hint 注入 prompt：「并行分片规则：必须按不同 query 关键词区分各 sibling todo」",
      "batch1 LLM 选择 query='agent memory 2025'；batch2 LLM 选择 query='agent memory 2026'",
      "两个 subagent 完全独立的进程，使用不同 query → 不同 arXiv 结果集，无重叠",
      "skill 脚本顺序下载（已修复并发竞争）：for..of 循环，count 满足则 break，不足则抛 Error",
      "LLM 收到 tool_result：downloadedCount=5，三条 acceptance_criteria 均满足，输出 summary",
      "结果 content > inlineMaxChars(1400)*2=2800 → offloading: should_offload=true",
      "writeWorkspaceFileForArtifact() 写磁盘，artifacts[].storage_mode=workspace，inline_preview=前 900 chars",
      "真实产出：batch1 arXiv IDs: 2603.04428, 2203.08975, 2601.05960, 2512.15790, 2409.01907",
    ],
    stateAfter: [
      "artifacts[0]: { related_todo: todo_batch1, storage_mode: workspace, workspace_file_id: wsf_001 }",
      "artifacts[1]: { related_todo: todo_batch2, storage_mode: workspace, workspace_file_id: wsf_002 }",
      "todo_batch1.status = reviewing, todo_batch2.status = reviewing",
      "workspace_files[0/1]: batch1/batch2 manifest.json 写磁盘",
      "metadata.llm_total_tokens += ~4800（两个 subagent 各自工具循环）",
    ],
    output: "5+5 篇 PDF 并行下载完成，各自 manifest.json 写磁盘，RunState 存路径与摘要",
  },
  {
    stepIndex: 5,
    phase: "波次验收",
    phaseColor: "emerald",
    title: "wave_reviewer：batch1 pass / batch2 pass → 两者 done，todo_merge 升 ready",
    module: "ParallelWave → wave_reviewer(LLM) × 2 → supervisor_reviewer → updateTodoStatus",
    moduleTone: "emerald",
    what: "两个 subagent 返回后，wave_reviewer（波次内快速审核层）对 todo_batch1 / todo_batch2 逐个评分。两者均通过（score=1.00），状态升为 done。todo_merge 依赖满足后自动升为 ready，在同一 loop step=1 内继续串行执行。",
    interactions: [
      { from: "ParallelWave (Promise.all 完成后)", to: "wave_reviewer(todo_batch1, result)", action: "波次内快速审核", detail: "wave_reviewer：轻量 LLM 审核，3 条 criteria 均 satisfied → review_pass=true" },
      { from: "wave_reviewer", to: "loop.ts", action: "返回 pass", detail: "todo_batch1 → done，execution_log: wave_review_completed(batch1, result=pass)" },
      { from: "ParallelWave", to: "wave_reviewer(todo_batch2, result)", action: "波次内快速审核", detail: "todo_batch2：同样 3 条 criteria 全部满足 → review_pass=true" },
      { from: "wave_reviewer", to: "loop.ts", action: "返回 pass", detail: "execution_log: wave_review_completed(batch2, result=pass)" },
      { from: "loop.ts", to: "updateTodoStatus(todo_batch1, done)", action: "batch1 状态完成", detail: "reviewing → done，refreshTodoReadiness() 检查 todo_merge.depends_on=[batch1✓, batch2?]" },
      { from: "loop.ts", to: "updateTodoStatus(todo_batch2, done)", action: "batch2 状态完成", detail: "reviewing → done，refreshTodoReadiness()：batch1✓ + batch2✓ → todo_merge 升 ready" },
      { from: "loop.ts", to: "selectNextTodo(todo_merge)", action: "串行选择 merge", detail: "wave 结束后仍在 step=1 内，串行路径继续执行 todo_merge" },
    ],
    detail: [
      "标准成功路径：batch1 wave_reviewer → pass；batch2 wave_reviewer → pass",
      "两个 batch 使用不同 query（planning_hint 效果）：结果集不重叠，wave_reviewer 全部通过",
      "wave_reviewer 是波次内专属审核：轻量、快速，直接决定 todo 状态，不走 supervisor_reviewer",
      "execution_log 顺序：wave_created → wave_item_completed(batch1) → wave_review_completed(batch1=pass) → wave_item_completed(batch2) → wave_review_completed(batch2=pass)",
      "context_compacted（actor=context_builder）在每个 subagent 返回后触发，压缩执行上下文，释放 token",
      "wave_history[0].outcome = success（两个 todo 均 done，无降级）",
      "batch1/batch2 均 done → todo_merge.depends_on 满足 → refreshTodoReadiness() 升 ready",
      "真实 score 统计：step=1 score=1.00（E2E 输出），wave pass 比率 2/2",
    ],
    stateAfter: [
      "todo_batch1.status = done, review_result = pass（wave_reviewer）",
      "todo_batch2.status = done, review_result = pass（wave_reviewer）",
      "wave_history[0].outcome = success（所有 todo 均 pass）",
      "todo_merge.status = ready（两个依赖全部 done，自动升级）",
      "execution_log: wave_review_completed(batch1=pass), wave_review_completed(batch2=pass)",
    ],
    output: "loop step=1：并行下载全部成功，wave_history[0] 记录 outcome=success，todo_merge 升 ready",
  },
  {
    stepIndex: 6,
    phase: "合并",
    phaseColor: "sky",
    title: "loop step=2：todo_merge 串行执行 → 去重合并 → supervisor_reviewer → done",
    module: "ExecutionContextBuilder → readWorkspaceFileContent × 2 → merge-skill → supervisor_reviewer",
    moduleTone: "sky",
    what: "loop step=2，todo_merge 唯一 ready，Orchestrator 串行执行。ExecutionContextBuilder 从磁盘读回两个 batch 的 manifest（wsf_001/wsf_002），LLM 调用 paper-manifest-merge-skill 去重合并，supervisor_reviewer 正式审核通过后 todo_delivery 升为 ready。",
    interactions: [
      { from: "Orchestrator (loop step=2)", to: "selectNextTodo(todo_merge)", action: "串行选择", detail: "todo_merge: status=ready，唯一候选，被选中" },
      { from: "loop.ts", to: "buildTodoExecutionContext(todo_merge)", action: "构建上下文", detail: "depends_on=[todo_batch1, todo_batch2]，pickInputArtifacts() 定位两个上游 workspace artifacts" },
      { from: "buildTodoExecutionContext()", to: "readWorkspaceFileContent(wsf_001, 2200)", action: "读磁盘 batch1", detail: "shouldReadWorkspaceFull=true（capability_type=merge），截断到 2200 chars" },
      { from: "buildTodoExecutionContext()", to: "readWorkspaceFileContent(wsf_002, 2200)", action: "读磁盘 batch2", detail: "fullReadCount=2 达上限，两个 manifest 都读入上下文" },
      { from: "SubagentExecutor", to: "paper-manifest-merge-skill", action: "执行合并", detail: "传入 manifestPaths=[manifest_batch1.json, manifest_batch2.json], requiredCount=10" },
      { from: "skill stdout", to: "SkillResourceCenter", action: "返回合并结果", detail: "{ mergedCount:10, duplicateCount:0, missingCount:0, ok:true }" },
      { from: "loop.ts", to: "supervisor_reviewer(todo_merge, result)", action: "正式审核", detail: "LLM 验证：合并记录数=10，无重复无遗漏 → pass" },
      { from: "loop.ts", to: "updateTodoStatus(todo_merge, done)", action: "状态转换", detail: "reviewing → done，refreshTodoReadiness() 检查 todo_delivery.depends_on=[merge✓] → 升 ready" },
    ],
    detail: [
      "step=2 score=1.00（E2E 输出），supervisor_reviewer 直接通过",
      "pickInputArtifacts()：按 depends_on 建 latestByDep Map，batch1/batch2 各取最新 artifact",
      "shouldReadWorkspaceFull(todo_merge)=true（capability_type=merge），允许全量读取",
      "readWorkspaceFileContent：readFileSync → sanitizeModelText → slice(0,2200)，写 workspace_readback",
      "batch1/batch2 使用不同 query 下载 → duplicateCount=0，合并质量高",
      "paper-manifest-merge-skill 遵守 SKILL_CONTRACT：只合并，不自主补充下载",
      "supervisor_reviewer（主循环正式审核层）：review_pass 写入 execution_log",
      "todo_delivery.depends_on=[todo_merge] → todo_merge done → refreshTodoReadiness() 升 ready",
    ],
    stateAfter: [
      "todo_merge.status = done, review_result = pass（supervisor_reviewer）",
      "artifacts[2]: merged_manifest, storage_mode=workspace, workspace_file_id=wsf_003",
      "todo_delivery.status = ready（depends_on 全 done，自动升级）",
      "execution_log: select_todo(merge), decide_mode, delegate, subagent_return, offload_decided, review_pass(merge)",
    ],
    output: "merged_paper_manifest.json：10 条记录（batch1 5 + batch2 5，无重复），todo_delivery 升 ready",
  },
  {
    stepIndex: 7,
    phase: "交付",
    phaseColor: "sky",
    title: "loop step=3：todo_delivery 打包 → pass（一次通过）",
    module: "Orchestrator → SubagentExecutor → delivery-skill → supervisor_reviewer",
    moduleTone: "sky",
    what: "todo_delivery 在 loop step=3 串行执行一次完成：SubagentExecutor 调用 delivery-skill 直接生成 final_delivery_manifest 与 delivery_report，supervisor_reviewer 当轮 pass，retry_count=0。",
    interactions: [
      { from: "Orchestrator (loop step=3)", to: "selectNextTodo(todo_delivery)", action: "串行选择", detail: "todo_delivery: status=ready，唯一候选，被选中" },
      { from: "SubagentExecutor", to: "paper-delivery-package-skill", action: "执行交付", detail: "传入 merged_paper_manifest.json，直接生成 final_delivery_manifest.json 与 final_delivery_report.md" },
      { from: "paper-delivery-package-skill", to: "workspace", action: "写入交付产物", detail: "交付清单引用 10 篇 PDF，missingFileCount=0，可直接用于最终展示" },
      { from: "loop.ts", to: "supervisor_reviewer(todo_delivery, result)", action: "正式审核", detail: "score=1.00，verdict=pass → acceptance_criteria 全部满足" },
      { from: "loop.ts", to: "updateTodoStatus(todo_delivery, done)", action: "状态转换", detail: "reviewing → done，retry_count=0，refreshTodoReadiness() 确认 4/4 todos done" },
    ],
    detail: [
      "对外展示版采用标准成功路径：loop step=3 直接 pass，无 fail / revise / retry 支路。",
      "delivery-skill 直接消费 merged_paper_manifest.json，并输出 final_delivery_manifest.json 与 final_delivery_report.md。",
      "verify（完整性验证）已内置于 todo_delivery 的 acceptance_criteria 中，因此不需要独立 todo_verify。",
      "supervisor_reviewer 在主循环内做正式验收：score=1.00 → pass。",
      "execution_log 主链路收敛为：delegate → subagent_return → review → done。",
    ],
    stateAfter: [
      "todo_delivery.status = done, review_result = pass（supervisor_reviewer），retry_count=0",
      "artifacts: final_delivery_manifest, storage_mode=workspace",
      "workspace_files: delivery_report.md",
      "todos: 4 个全部 done（todo_batch1 / todo_batch2 / todo_merge / todo_delivery）",
      "execution_log: [×1] delegate → subagent_return → review",
    ],
    output: "10 篇论文一次交付成功，Orchestrator 进入 loop step=4（终止）",
  },
  {
    stepIndex: 8,
    phase: "终止",
    phaseColor: "slate",
    title: "loop step=4：TerminalState 检查全部 done → success，buildFinalOutput 汇总",
    module: "Orchestrator → determineRunTerminalState → buildFinalOutput → meta-agent-service",
    moduleTone: "slate",
    what: "loop step=4，Orchestrator 检查 todos：4 个全部 done，无 ready 候选，TerminalState 判断 shouldTerminate=true → resultStatus=success。buildFinalOutput 读取 final_delivery_manifest 合成最终输出，写入 session store，前端展示结果。",
    interactions: [
      { from: "Orchestrator (loop step=4)", to: "runParallelTodoWave()", action: "尝试并行", detail: "无 ready todo → 跳过" },
      { from: "Orchestrator", to: "selectNextTodo()", action: "尝试串行", detail: "无 ready todo → 返回 null" },
      { from: "Orchestrator", to: "determineRunTerminalState()", action: "终止检查", detail: "todos.every(done|pruned)=true（4/4），replan_recovery_map 为空 → shouldTerminate=true" },
      { from: "TerminalState", to: "Orchestrator", action: "返回终止决策", detail: "{ shouldTerminate: true, resultStatus: success, runStatus: completed }" },
      { from: "Orchestrator", to: "buildFinalOutput(state)", action: "合成最终输出", detail: "readLatestFinalDeliveryOutput()：path 含 final_delivery → 直接读取，跳过 LLM 合成（节省 token）" },
      { from: "buildFinalOutput()", to: "readWorkspaceFileContent(wsf_delivery, 40000)", action: "读取交付产物", detail: "maxChars=40000（最终输出不截断），合成 finalOutput 字符串" },
      { from: "buildFinalOutput()", to: "final_summary_generated", action: "生成摘要", detail: "execution_log: final_summary_generated，写入最终运行摘要与交付结果" },
      { from: "Orchestrator", to: "meta-agent-service", action: "返回 MetaAgentResult", detail: "{ status: success, finalOutput, final delivery artifacts attached }" },
      { from: "meta-agent-service", to: "session-store", action: "持久化快照", detail: "前端轮询 /api/meta-agent 读取 session（status=done），显示最终结果" },
    ],
    detail: [
      "展示版按标准成功路径呈现：并行下载 → 合并去重 → 一次交付 → 终止汇总",
      "4 个 todo 全部 done（todo_batch1, todo_batch2, todo_merge, todo_delivery），无 todo_verify",
      "verify（完整性验证）已内置于 todo_delivery 的 acceptance_criteria，不需要独立 todo",
      "idleStep 未触发（step=4 有终止决策，不算空转）",
      "TerminalState：todos.every(t.status === 'done' || t.status === 'pruned') → true（4/4）",
      "replan_recovery_map 为空：全程未触发 Replan、Retry 或降级路径，主链路一次完成",
      "buildFinalOutput()：collectTodoOutputs() 收集 4 个 done todo 的 artifact summaries",
      "execution_log 最后两条：terminal_state_determined → final_summary_generated",
    ],
    stateAfter: [
      "run.status = completed（resultStatus=success）",
      "todos: 4 个全部 done（todo_batch1 / todo_batch2 / todo_merge / todo_delivery）",
      "artifacts: batch1×1 + batch2×1 + merged_manifest×1 + delivery_manifest×1 + delivery_report×1（共 85 个 artifacts）",
      "execution_log 最后两条：terminal_state_determined, final_summary_generated",
      "session.status = done，前端轮询结束，显示最终结果",
    ],
    output: "用户在运行详情页看到：10 篇 PDF + merged_manifest + final_delivery_manifest + delivery_report，共 85 个 artifacts",
  },
  {
    stepIndex: 9,
    phase: "小结",
    phaseColor: "emerald",
    title: "本次展示：标准成功路径",
    module: "正常路径说明（RecoveryPolicy 未触发）",
    moduleTone: "emerald",
    what: "本次对外展示采用标准成功路径：两个 batch 并行下载后直接进入 merge，todo_delivery 一次通过。RecoveryPolicy、wave 重试与 downgrade_to_serial 仍作为后台兜底机制保留，但不在本次主链上触发。",
    interactions: [
      { from: "正常路径（本次）", to: "wave_reviewer × 2", action: "两个 batch 均 pass", detail: "不同 query 分片，wave_reviewer 全通过，直接进入 merge" },
      { from: "正常路径（本次）", to: "todo_delivery", action: "交付一次通过", detail: "delivery-skill 直接生成最终产物，supervisor_reviewer 当轮 pass" },
      { from: "系统兜底机制", to: "RecoveryPolicy", action: "保留但未触发", detail: "wave 重试、serial downgrade、analyzeFailureForRetry 作为后台保障继续存在" },
    ],
    detail: [
      "planning_hint 修复了 query 重复问题：batch1/batch2 使用不同关键词，避免结果集重叠",
      "wave_reviewer 解析失败修复：REVIEW_SYSTEM_PROMPT 禁止 <think> 前缀 + retry-on-parse-failure 机制",
      "arxiv-fetch-skill 修复：顺序下载（for..of）替代并发（runWithConcurrency），不足篇数抛 Error",
      "两层审核机制仍然存在：wave_reviewer（波次内快速）+ supervisor_reviewer（主循环正式）",
      "downgrade_to_serial 路径仍然有效，future batch 下载失败仍能自动降级串行重试",
      "E2E 健康检查全部通过：Parallel wave occurred ✓，4/4 todos done ✓，status=success ✓",
      "对外展示聚焦标准成功路径：突出并行下载、合并去重、一次交付成功的完整闭环",
    ],
    stateAfter: [
      "全程 4 个 todo（无 todo_verify），4 个主 loop step，主链路无 retry",
      "todo_delivery 一次通过：score=1.00，retry_count=0",
      "batch1/batch2 query 分片：无重复，duplicateCount=0",
      "wave_reviewer 稳定性：2/2 pass，无 parse failure，无 downgrade",
    ],
    output: "整体执行：并行成功 + merge 去重 + 一次交付完成，页面展示标准成功路径闭环",
  },
];

const PHASE_COLOR_MAP: Record<string, { badge: string; dot: string; border: string }> = {
  violet: { badge: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-violet-400", border: "border-violet-100" },
  sky: { badge: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-400", border: "border-sky-100" },
  amber: { badge: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-400", border: "border-amber-100" },
  emerald: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-400", border: "border-emerald-100" },
  slate: { badge: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400", border: "border-slate-100" },
  rose: { badge: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-400", border: "border-rose-100" },
};

const MODULE_TONE_MAP: Record<string, string> = {
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  slate: "border-slate-200 bg-slate-100 text-slate-600",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
};

/* ─────────────────────────────────────────────────────────────
   调用链流程图：竖向主链 + 并行分叉 + 条件分支 + Todo DAG
   ───────────────────────────────────────────────────────────── */
function CallChainFlowDiagram() {
  // 布局常量（px，全部用于 SVG viewBox 坐标）
  const W = 700;          // 总宽
  const CX = W / 2;       // 主链中心 x
  const NW = 160;         // 普通节点宽
  const NH = 48;          // 普通节点高
  const GAP = 28;         // 节点间距
  const STRIDE = NH + GAP;

  // 主链节点 y 坐标（按位置索引）
  // nodes: 0=启动 1=规划 2=调度 3=执行(并行fork) 4=波次验收 5=合并 6=交付(retry) 7=终止
  // loop step=0:启动 / step=1:规划+调度+执行+波次验收(含merge) / step=2:merge / step=3:delivery+retry / step=4:终止
  const nodes = [
    { id: "start",   label: "① 启动",   sub: "初始化 RunState · loop step=0",              color: "#e2e8f0", text: "#475569" },
    { id: "plan",    label: "② 规划",   sub: "Planner → 4 个 todo · loop step=1",          color: "#ede9fe", text: "#6d28d9" },
    { id: "sched",   label: "③ 调度",   sub: "Selector → ParallelWave · step=1",            color: "#e0f2fe", text: "#0369a1" },
    { id: "exec",    label: "④ 执行",   sub: "SubagentExecutor × 2 并行 · step=1",          color: "#fef3c7", text: "#b45309" },
    { id: "review",  label: "⑤ 波次验收", sub: "wave_reviewer: batch1=pass / batch2=pass",   color: "#d1fae5", text: "#065f46" },
    { id: "merge",   label: "⑥ 合并",   sub: "todo_merge 去重合并 · loop step=2",           color: "#e0f2fe", text: "#0369a1" },
    { id: "deliver", label: "⑦ 交付",   sub: "todo_delivery · 一次通过 · step=3",            color: "#bfdbfe", text: "#1d4ed8" },
    { id: "done",    label: "⑧ 终止",   sub: "TerminalState(success) · step=4",             color: "#e2e8f0", text: "#475569" },
  ] as const;

  const NY = (i: number) => i * STRIDE;
  const totalH = nodes.length * STRIDE - GAP + 120; // 额外空间放 todo DAG

  // 并行分支节点（挂在④执行两侧）
  const batchY = NY(3) + NH / 2;
  const batchAX = CX - 120;
  const batchBX = CX + 120;
  const batchW = 100;
  const batchH = 38;

  // todo DAG y 起点（在主链下方）
  const dagY = NY(nodes.length) + 16;
  const dagNodeW = 120;
  const dagNodeH = 36;
  const dagGap = 16;
  // todo 节点 x 位置（4个横排：batch_a, batch_b, merge, delivery）
  // verify 不是独立 todo，内置于 delivery 的 acceptance_criteria
  const dagTotalW = dagNodeW * 4 + dagGap * 3;
  const dagStartX = CX - dagTotalW / 2 + dagNodeW / 2;
  const dagNodes = [
    { id: "batch1",   label: "todo_batch1", sub: "query A·1-5",       x: dagStartX,                           color: "#d1fae5", text: "#065f46" },
    { id: "batch2",   label: "todo_batch2", sub: "query B·6-10",      x: dagStartX + dagNodeW + dagGap,        color: "#d1fae5", text: "#065f46" },
    { id: "merge",    label: "todo_merge",  sub: "去重合并·0重复",      x: dagStartX + (dagNodeW + dagGap) * 2,  color: "#e0f2fe", text: "#0369a1" },
    { id: "delivery", label: "todo_delivery", sub: "交付+一次通过",     x: dagStartX + (dagNodeW + dagGap) * 3,  color: "#bfdbfe", text: "#1d4ed8" },
  ] as const;
  const dagNodeY = dagY + 28;
  const dagTotalH = dagY + dagNodeH + 60;

  const svgH = totalH + dagTotalH - totalH + 20;

  return (
    <div className="mb-4 overflow-x-auto rounded-2xl border border-indigo-100 bg-white p-3">
      <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-indigo-600">完整执行流程图</p>
      <svg
        viewBox={`0 0 ${W} ${svgH}`}
        width="100%"
        style={{ maxHeight: 820, minWidth: 560 }}
        className="block"
      >
        <defs>
          <marker id="cc-arr" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0.5,0.5 L6.5,3.5 L0.5,6.5 Z" fill="#94a3b8" />
          </marker>
          <marker id="cc-arr-sky" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0.5,0.5 L6.5,3.5 L0.5,6.5 Z" fill="#7dd3fc" />
          </marker>
          <marker id="cc-arr-amber" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0.5,0.5 L6.5,3.5 L0.5,6.5 Z" fill="#fcd34d" />
          </marker>
          <marker id="cc-arr-rose" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0.5,0.5 L6.5,3.5 L0.5,6.5 Z" fill="#fda4af" />
          </marker>
          <marker id="cc-arr-emerald" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0.5,0.5 L6.5,3.5 L0.5,6.5 Z" fill="#6ee7b7" />
          </marker>
        </defs>

        {/* ── loop step 分组背景框 ── */}
        {/* nodes: 0=启动 1=规划 2=调度 3=执行 4=波次验收 5=合并 6=交付 7=终止 */}
        {/* loop step=0: 节点0(启动) */}
        <rect x={CX - NW / 2 - 6} y={NY(0) - 4} width={NW + 12} height={NH + 8} rx={16}
          fill="none" stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 3" />
        <text x={CX - NW / 2 - 10} y={NY(0) + NH / 2 + 4} fontSize={8} fill="#94a3b8" textAnchor="end">step=0</text>
        {/* loop step=1: 节点1-4(规划/调度/执行/波次验收)，含并行分支 */}
        {(() => {
          const y1 = NY(1) - 4;
          const y2 = NY(4) + NH + 4;
          return <>
            <rect x={CX - NW / 2 - 6} y={y1} width={NW + 12} height={y2 - y1} rx={16}
              fill="#f0f9ff" fillOpacity={0.6} stroke="#bae6fd" strokeWidth={1} strokeDasharray="5 3" />
            <text x={CX - NW / 2 - 10} y={(y1 + y2) / 2 + 4} fontSize={8} fill="#7dd3fc" textAnchor="end">step=1</text>
          </>;
        })()}
        {/* loop step=2: 节点5(合并) */}
        <rect x={CX - NW / 2 - 6} y={NY(5) - 4} width={NW + 12} height={NH + 8} rx={16}
          fill="none" stroke="#e0f2fe" strokeWidth={1} strokeDasharray="4 3" />
        <text x={CX - NW / 2 - 10} y={NY(5) + NH / 2 + 4} fontSize={8} fill="#7dd3fc" textAnchor="end">step=2</text>
        {/* loop step=3: 节点6(交付+retry) */}
        <rect x={CX - NW / 2 - 6} y={NY(6) - 4} width={NW + 12} height={NH + 8} rx={16}
          fill="none" stroke="#bfdbfe" strokeWidth={1} strokeDasharray="4 3" />
        <text x={CX - NW / 2 - 10} y={NY(6) + NH / 2 + 4} fontSize={8} fill="#60a5fa" textAnchor="end">step=3</text>
        {/* loop step=4: 节点7(终止) */}
        <rect x={CX - NW / 2 - 6} y={NY(7) - 4} width={NW + 12} height={NH + 8} rx={16}
          fill="none" stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 3" />
        <text x={CX - NW / 2 - 10} y={NY(7) + NH / 2 + 4} fontSize={8} fill="#94a3b8" textAnchor="end">step=4</text>

        {/* ── 主链连线 ── */}
        {nodes.slice(0, -1).map((node, i) => {
          // exec(i=3) → wave_review(i=4): join 替代（不直连，用 batch join 线）
          if (i === 2) return null; // sched→exec 用 fork 替代
          if (i === 3) return null; // exec→wave_review 用 join 替代
          const y1 = NY(i) + NH;
          const y2 = NY(i + 1);
          return (
            <line key={node.id}
              x1={CX} y1={y1} x2={CX} y2={y2 - 6}
              stroke="#cbd5e1" strokeWidth={2}
              markerEnd="url(#cc-arr)"
            />
          );
        })}

        {/* sched(i=2) → fork 点 */}
        <line x1={CX} y1={NY(2) + NH} x2={CX} y2={batchY - batchH / 2 - 8}
          stroke="#7dd3fc" strokeWidth={1.5} markerEnd="url(#cc-arr-sky)" />

        {/* fork → batch_a */}
        <path d={`M${CX},${batchY - batchH / 2} C${CX},${batchY - batchH / 2 - 12} ${batchAX},${batchY - batchH / 2 - 12} ${batchAX},${batchY - batchH / 2}`}
          fill="none" stroke="#fcd34d" strokeWidth={1.5} markerEnd="url(#cc-arr-amber)" />
        {/* fork → batch_b */}
        <path d={`M${CX},${batchY - batchH / 2} C${CX},${batchY - batchH / 2 - 12} ${batchBX},${batchY - batchH / 2 - 12} ${batchBX},${batchY - batchH / 2}`}
          fill="none" stroke="#fcd34d" strokeWidth={1.5} markerEnd="url(#cc-arr-amber)" />

        {/* batch1 → join → wave_review(i=4) */}
        <path d={`M${batchAX},${batchY + batchH / 2} C${batchAX},${batchY + batchH / 2 + 12} ${CX},${batchY + batchH / 2 + 12} ${CX},${NY(4) - 6}`}
          fill="none" stroke="#6ee7b7" strokeWidth={1.5} markerEnd="url(#cc-arr-emerald)" />
        {/* batch2 → join → wave_review(i=4) */}
        <path d={`M${batchBX},${batchY + batchH / 2} C${batchBX},${batchY + batchH / 2 + 12} ${CX},${batchY + batchH / 2 + 12} ${CX},${NY(4) - 6}`}
          fill="none" stroke="#6ee7b7" strokeWidth={1.5} />

        {/* wave_review → 标注 both pass */}
        <text x={CX + NW / 2 + 6} y={NY(4) + NH / 2 + 4} fontSize={8} fill="#10b981">✓ both pass</text>

        {/* ── 主链节点 ── */}
        {nodes.map((node, i) => {
          const y = NY(i);
          const x = CX - NW / 2;
          return (
            <g key={node.id}>
              <rect x={x} y={y} width={NW} height={NH} rx={12}
                fill={node.color} stroke="#e2e8f0" strokeWidth={1} />
              <text x={CX} y={y + 17} fontSize={11.5} fontWeight="600" fill={node.text} textAnchor="middle">{node.label}</text>
              <text x={CX} y={y + 33} fontSize={9} fill={node.text} textAnchor="middle" opacity={0.75}>{node.sub}</text>
            </g>
          );
        })}

        {/* ── 并行分支节点：batch1 / batch2（两者均 pass）── */}
        {[
          { x: batchAX, label: "batch1", sub: "query A · 1-5", color: "#d1fae5", text: "#065f46" },
          { x: batchBX, label: "batch2", sub: "query B · 6-10", color: "#d1fae5", text: "#065f46" },
        ].map(({ x, label, sub, color, text }) => (
          <g key={label}>
            <rect x={x - batchW / 2} y={batchY - batchH / 2} width={batchW} height={batchH} rx={9}
              fill={color} stroke="#fde68a" strokeWidth={1} />
            <text x={x} y={batchY - 4} fontSize={10.5} fontWeight="600" fill={text} textAnchor="middle">{label}</text>
            <text x={x} y={batchY + 11} fontSize={9} fill={text} textAnchor="middle" opacity={0.8}>{sub}</text>
          </g>
        ))}

        {/* ── 并行标注 ── */}
        <text x={CX} y={batchY - batchH / 2 - 14} fontSize={9} fill="#7dd3fc" textAnchor="middle" fontStyle="italic">Promise.all 并行</text>

        {/* ── 分隔线：主链 / Todo DAG ── */}
        <line x1={20} y1={dagY - 8} x2={W - 20} y2={dagY - 8} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 3" />
        <text x={CX} y={dagY + 4} fontSize={9} fill="#94a3b8" textAnchor="middle" fontWeight="600" letterSpacing="1">TODO DAG（Planner 生成的依赖图）</text>

        {/* ── Todo DAG 节点 ── */}
        {dagNodes.map((dn) => (
          <g key={dn.id}>
            <rect x={dn.x - dagNodeW / 2} y={dagNodeY} width={dagNodeW} height={dagNodeH} rx={8}
              fill={dn.color} stroke="#e2e8f0" strokeWidth={1} />
            <text x={dn.x} y={dagNodeY + 15} fontSize={9.5} fontWeight="600" fill={dn.text} textAnchor="middle">{dn.label}</text>
            <text x={dn.x} y={dagNodeY + 28} fontSize={8.5} fill={dn.text} textAnchor="middle" opacity={0.75}>{dn.sub}</text>
          </g>
        ))}

        {/* Todo DAG 连线：batch_a → merge，batch_b → merge，merge → delivery */}
        {/* batch_a → merge */}
        <path d={`M${dagNodes[0].x + dagNodeW / 2},${dagNodeY + dagNodeH / 2} C${dagNodes[0].x + dagNodeW},${dagNodeY + dagNodeH / 2} ${dagNodes[2].x - dagNodeW},${dagNodeY + dagNodeH / 2} ${dagNodes[2].x - dagNodeW / 2 - 5},${dagNodeY + dagNodeH / 2}`}
          fill="none" stroke="#94a3b8" strokeWidth={1.2} markerEnd="url(#cc-arr)" />
        {/* batch_b → merge */}
        <path d={`M${dagNodes[1].x + dagNodeW / 2},${dagNodeY + dagNodeH / 2} C${dagNodes[1].x + dagNodeW / 2 + 10},${dagNodeY + dagNodeH / 2} ${dagNodes[2].x - dagNodeW / 2 - 10},${dagNodeY + dagNodeH / 2} ${dagNodes[2].x - dagNodeW / 2 - 5},${dagNodeY + dagNodeH / 2}`}
          fill="none" stroke="#94a3b8" strokeWidth={1.2} markerEnd="url(#cc-arr)" />
        {/* merge → deliver */}
        <line x1={dagNodes[2].x + dagNodeW / 2} y1={dagNodeY + dagNodeH / 2}
          x2={dagNodes[3].x - dagNodeW / 2 - 5} y2={dagNodeY + dagNodeH / 2}
          stroke="#94a3b8" strokeWidth={1.2} markerEnd="url(#cc-arr)" />
        {/* depends_on 标注 */}
        <text x={(dagNodes[0].x + dagNodes[2].x) / 2} y={dagNodeY + dagNodeH / 2 - 5} fontSize={8} fill="#94a3b8" textAnchor="middle">depends_on</text>
      </svg>
    </div>
  );
}

function CallChainExample() {
  const [open, setOpen] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());
  const allStepIndices = PAPER_DOWNLOAD_EXAMPLE.map((s) => s.stepIndex);
  const allStepsExpanded = openSteps.size === allStepIndices.length;

  const toggleStep = (idx: number) => {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAllSteps = () => {
    setOpenSteps(allStepsExpanded ? new Set() : new Set(allStepIndices));
  };

  return (
    <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <PlayCircle className="h-4 w-4 text-indigo-500" />
          <p className="text-xs font-semibold text-indigo-800">范例：「并行下载 10 篇 arxiv 论文」完整调用链（9 个执行阶段 · 5 个 loop step · 真实执行）</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-indigo-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-indigo-100 px-4 pb-4 pt-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">
                用户 goal：「并行下载 10 篇关于 agent memory 的 arxiv 论文」。这里展示对外版本的标准成功路径，从接收 goal 到产物交付的完整调用链，突出模块交互、状态变化与最终产物闭环。
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-400">
                goal → Orchestrator → Planner(4 todos) → [step=1: Wave(batch1‖batch2, planning_hint分片) → wave_reviewer: both=pass] → [step=2: todo_merge] → [step=3: todo_delivery pass] → [step=4: TerminalState(success)]
              </p>
            </div>
            <button
              type="button"
              onClick={toggleAllSteps}
              className="shrink-0 rounded-full border border-indigo-200 bg-white px-3 py-1 text-[11px] font-medium text-indigo-600 transition hover:bg-indigo-50"
            >
              {allStepsExpanded ? "全部收起" : "全部展开"}
            </button>
          </div>

          <CallChainFlowDiagram />

          <div className="space-y-2">
            {PAPER_DOWNLOAD_EXAMPLE.map((step) => {
              const phaseStyle = PHASE_COLOR_MAP[step.phaseColor] ?? PHASE_COLOR_MAP.slate;
              const moduleStyle = MODULE_TONE_MAP[step.moduleTone] ?? MODULE_TONE_MAP.slate;
              const isOpen = openSteps.has(step.stepIndex);

              return (
                <div key={step.stepIndex} className={`rounded-xl border overflow-hidden bg-white ${step.warningNote ? "border-amber-200" : "border-slate-200"}`}>
                  <button
                    type="button"
                    onClick={() => toggleStep(step.stepIndex)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                  >
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600">
                      {step.stepIndex}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${phaseStyle.badge}`}>
                          {step.phase}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${moduleStyle}`}>
                          {step.module}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-800">{step.title}</p>
                      <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{step.what}</p>
                    </div>
                    <ChevronDown className={`mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className={`border-t px-4 pb-4 pt-3 space-y-3 ${phaseStyle.border}`}>
                      {step.warningNote && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                          <p className="text-[10px] font-semibold text-amber-700">⚠ 演示场景说明</p>
                          <p className="mt-0.5 text-[11px] text-amber-700">{step.warningNote}</p>
                        </div>
                      )}

                      <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                        <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-slate-500">模块交互序列</p>
                        <div className="space-y-2">
                          {step.interactions.map((line, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="mt-[3px] shrink-0 font-mono text-[9px] text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                              <div className="min-w-0 text-[11px] leading-5">
                                <span className="font-semibold text-slate-700">{line.from}</span>
                                <span className="mx-1 text-slate-400">→</span>
                                <span className="font-semibold text-slate-700">{line.to}</span>
                                <span className="mx-1.5 inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{line.action}</span>
                                <span className="text-slate-500">{line.detail}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                        <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-slate-500">执行细节</p>
                        <ul className="space-y-1.5">
                          {step.detail.map((line) => (
                            <li key={line} className="flex items-start gap-2 text-[11px] leading-5 text-slate-600">
                              <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${phaseStyle.dot}`} />
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <p className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-slate-500">执行后 RunState 变化</p>
                        <ul className="space-y-0.5">
                          {step.stateAfter.map((line) => (
                            <li key={line} className="font-mono text-[10px] leading-5 text-slate-500">{line}</li>
                          ))}
                        </ul>
                      </div>

                      {step.output && (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                          <p className="text-[10px] font-semibold tracking-[0.12em] text-emerald-700">阶段产出</p>
                          <p className="mt-1 text-[11px] leading-5 text-emerald-700">{step.output}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaAgentArchitectureSection() {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const allIds = META_AGENT_MODULES.map((m) => m.id);
  const allExpanded = expandedModules.size === allIds.length;

  const toggleModule = (id: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedModules(allExpanded ? new Set() : new Set(allIds));
  };

  const grouped = LAYER_ORDER.map((layer) => ({
    layer,
    modules: META_AGENT_MODULES.filter((m) => m.layer === layer),
  })).filter((g) => g.modules.length > 0);

  return (
    <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] px-6 py-6 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.45)]">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 bg-sky-50">
          <Layers className="h-4 w-4 text-sky-600" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium tracking-[0.18em] text-slate-500">META-AGENT ARCHITECTURE</p>
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">模块分工拆解</h2>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
        >
          {allExpanded ? "全部收起" : "全部展开"}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Meta-Agent 是平台最复杂的单体模块，由 {allIds.length} 个协作组件组成（含长期记忆层）。点开每张卡片查看职责边界、调用关系与禁止越权项。
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {LAYER_ORDER.map((layer) => {
          const meta = LAYER_META[layer];
          return (
            <span key={layer} className={`rounded-full border px-3 py-0.5 text-xs font-medium ${meta.color} ${meta.bg} ${meta.border}`}>
              {layer}
            </span>
          );
        })}
      </div>

      <div className="mt-6 space-y-8">
        {grouped.map(({ layer, modules }) => {
          const meta = LAYER_META[layer];
          return (
            <div key={layer}>
              <div className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${meta.color} ${meta.bg} ${meta.border}`}>
                <span>{layer}层</span>
                <span className="opacity-60">·</span>
                <span className="font-normal opacity-80">{modules.length} 个模块</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {modules.map((mod) => (
                  <MetaAgentModuleCard
                    key={mod.id}
                    module={mod}
                    open={expandedModules.has(mod.id)}
                    onToggle={() => toggleModule(mod.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-xs font-semibold text-slate-600">调用链总览</p>
        <p className="mt-2 font-mono text-xs leading-6 text-slate-500">
          meta-agent-service<br />
          {"  "}→ Orchestrator（主循环）<br />
          {"      "}→ Planner（run 开始，一次）<br />
          {"      "}→ Selector → ParallelWave → SubagentExecutor → SkillResourceCenter<br />
          {"                              "}→ Review（wave reviewer）<br />
          {"                              "}→ RecoveryPolicy → TodoSplitter<br />
          {"      "}→ Replanner（条件触发）<br />
          {"      "}→ TerminalState（每 step 检查）<br />
          {"  "}→ SupervisorRuntimeState（所有模块的数据源）<br />
          {"  "}→ LongTermMemoryService ← WorkingMemory ← MemoryConsolidation（跨 run 记忆层）
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-0.5 text-[11px] font-medium text-indigo-600">
          完整调用链范例 ↓
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <CallChainExample />
    </section>
  );
}

function MetaAgentModuleCard({ module: mod, open, onToggle }: { module: MetaAgentModule; open: boolean; onToggle: () => void }) {
  const Icon = mod.icon;

  const toneClasses = {
    sky: { badge: "border-sky-200 bg-sky-50 text-sky-700", icon: "text-sky-500", header: "border-sky-100" },
    violet: { badge: "border-violet-200 bg-violet-50 text-violet-700", icon: "text-violet-500", header: "border-violet-100" },
    amber: { badge: "border-amber-200 bg-amber-50 text-amber-700", icon: "text-amber-500", header: "border-amber-100" },
    emerald: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: "text-emerald-500", header: "border-emerald-100" },
    slate: { badge: "border-slate-200 bg-slate-100 text-slate-700", icon: "text-slate-500", header: "border-slate-200" },
  }[mod.tone];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_4px_16px_-8px_rgba(15,23,42,0.12)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-4 text-left"
      >
        <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${toneClasses.badge}`}>
          <Icon className={`h-3.5 w-3.5 ${toneClasses.icon}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-950">{mod.title}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
          <p className="text-xs text-slate-500">{mod.subtitle}</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-600">{mod.oneLiner}</p>
        </div>
      </button>

      {open && (
        <div className={`border-t px-4 pb-4 pt-3 ${toneClasses.header}`}>
          <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="mb-1 text-[10px] font-semibold tracking-[0.12em] text-slate-500">执行流</p>
            <p className="font-mono text-[11px] leading-5 text-slate-600">{mod.flow}</p>
          </div>

          <div className="space-y-3">
            <ModuleDetailBlock
              label="✅ 负责"
              items={mod.responsibilities}
              itemColor="text-slate-700"
            />
            <ModuleDetailBlock
              label="🚫 不负责"
              items={mod.notResponsible}
              itemColor="text-slate-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-slate-500">被谁调用</p>
                <div className="space-y-1">
                  {mod.calledBy.map((item) => (
                    <span key={item} className="block rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-slate-500">调用谁</p>
                <div className="space-y-1">
                  {mod.calls.map((item) => (
                    <span key={item} className="block rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleDetailBlock({
  label,
  items,
  itemColor,
}: {
  label: string;
  items: string[];
  itemColor: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-slate-500">{label}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className={`flex items-start gap-1.5 text-[11px] leading-5 ${itemColor}`}>
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlowDesktopSegment({ node, showConnector }: { node: FlowNode; showConnector: boolean }) {
  return (
    <>
      <div className="min-w-[160px] flex-1">
        {node.isExecCluster ? <ExecCluster node={node} /> : <FlowDesktopNode node={node} />}
      </div>
      {showConnector ? <HorizontalConnector label={node.dataOut} /> : null}
    </>
  );
}

function FlowDesktopNode({ node }: { node: FlowNode }) {
  const Icon = node.icon;
  return (
    <Link
      href={node.href}
      className="relative z-10 flex h-full min-w-0 flex-col rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:border-slate-300"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
          {node.step}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
          {node.stage}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-sm font-semibold text-slate-950">{node.title}</p>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-600">{node.description}</p>
      {/* 输出标注 */}
      <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5">
        <p className="text-[10px] font-medium text-slate-400">输出</p>
        <p className="text-[11px] text-slate-600">{node.dataOut}</p>
      </div>
    </Link>
  );
}

// 执行阶段聚合块：04/05/06 三个子视图合并为一个视觉单元
function ExecCluster({ node }: { node: FlowNode }) {
  return (
    <Link
      href={node.href}
      className="relative z-10 flex h-full min-w-0 flex-col rounded-[24px] border-2 border-indigo-100 bg-gradient-to-b from-indigo-50/60 to-white px-4 py-4 shadow-[0_14px_32px_-28px_rgba(99,102,241,0.25)] transition hover:-translate-y-0.5 hover:border-indigo-200"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-indigo-600">
          {node.step}
        </span>
        <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-500">
          {node.stage}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-950">{node.title}</p>
      {/* 三个子视角 */}
      <div className="mt-3 space-y-1.5">
        {EXEC_SUB_NODES.map((sub) => {
          const SubIcon = sub.icon;
          return (
            <div key={sub.step} className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-white px-2.5 py-2">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-indigo-100 bg-indigo-50 text-[9px] font-bold text-indigo-600">
                {sub.step}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <SubIcon className="h-3 w-3 shrink-0 text-indigo-400" />
                  <p className="text-[11px] font-semibold text-slate-800">{sub.title}</p>
                </div>
                <p className="text-[10px] leading-4 text-slate-500">{sub.description}</p>
              </div>
            </div>
          );
        })}
      </div>
      {/* 输出标注 */}
      <div className="mt-3 rounded-lg border border-dashed border-indigo-100 bg-indigo-50/40 px-2 py-1.5">
        <p className="text-[10px] font-medium text-indigo-400">输出</p>
        <p className="text-[11px] text-indigo-700">{node.dataOut}</p>
      </div>
    </Link>
  );
}

function FlowMobileNode({ node }: { node: FlowNode }) {
  const Icon = node.icon;
  const isExec = node.isExecCluster;
  return (
    <Link
      href={node.href}
      className={`block rounded-[24px] border px-4 py-4 shadow-[0_14px_32px_-28px_rgba(15,23,42,0.45)] ${isExec ? "border-2 border-indigo-100 bg-indigo-50/30" : "border-slate-200 bg-white"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${isExec ? "border-indigo-200 bg-white text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          {node.step}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${isExec ? "border-indigo-100 bg-indigo-50 text-indigo-500" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          {node.stage}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${isExec ? "text-indigo-400" : "text-slate-500"}`} />
        <p className="text-sm font-semibold text-slate-950">{node.title}</p>
      </div>
      {isExec ? (
        <div className="mt-2 space-y-1">
          {EXEC_SUB_NODES.map((sub) => {
            const SubIcon = sub.icon;
            return (
              <div key={sub.step} className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5">
                <span className="text-[9px] font-bold text-indigo-500">{sub.step}</span>
                <SubIcon className="h-3 w-3 text-indigo-400" />
                <p className="text-[11px] font-medium text-slate-700">{sub.title}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-600">{node.description}</p>
      )}
      <div className={`mt-2 rounded-lg border border-dashed px-2 py-1 ${isExec ? "border-indigo-100 bg-indigo-50/30" : "border-slate-200 bg-slate-50"}`}>
        <p className={`text-[9px] font-medium ${isExec ? "text-indigo-400" : "text-slate-400"}`}>输出</p>
        <p className={`text-[10px] ${isExec ? "text-indigo-600" : "text-slate-500"}`}>{node.dataOut}</p>
      </div>
    </Link>
  );
}

function CompactPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.45)]">
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function SupportModuleCard({
  title,
  description,
  triggeredAt,
  href,
  icon: Icon,
  tone,
}: {
  title: string;
  description: string;
  triggeredAt: string;
  href: string;
  icon: typeof Boxes;
  tone: "sky" | "emerald";
}) {
  const toneClass =
    tone === "sky"
      ? "border-sky-200 bg-sky-50/60 hover:border-sky-300"
      : "border-emerald-200 bg-emerald-50/60 hover:border-emerald-300";
  const triggerClass =
    tone === "sky"
      ? "border-sky-100 bg-sky-50 text-sky-600"
      : "border-emerald-100 bg-emerald-50 text-emerald-600";
  return (
    <Link
      href={href}
      className={`flex flex-col gap-2 rounded-2xl border border-dashed px-4 py-3 transition hover:bg-white ${toneClass}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <p className="text-xs leading-5 text-slate-600">{description}</p>
      <div className={`rounded-lg border px-2 py-1 text-[10px] leading-4 ${triggerClass}`}>
        ↪ {triggeredAt}
      </div>
    </Link>
  );
}

function HorizontalConnector({ label }: { label?: string }) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center justify-center gap-1">
      <div className="relative h-px w-full bg-slate-300">
        <span className="absolute -right-0.5 -top-1 h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-slate-300" />
      </div>
      {label ? (
        <p className="max-w-[80px] text-center text-[9px] leading-3 text-slate-400">{label}</p>
      ) : null}
    </div>
  );
}

function VerticalConnector({
  tone,
  compact = false,
}: {
  tone: "slate" | "sky" | "emerald";
  compact?: boolean;
}) {
  const toneClass =
    tone === "sky"
      ? "border-sky-300 text-sky-300"
      : tone === "emerald"
        ? "border-emerald-300 text-emerald-300"
        : "border-slate-300 text-slate-300";

  return (
    <div className={`flex justify-center ${compact ? "py-1" : "pb-3"}`}>
      <div className={`relative ${compact ? "h-5" : "h-7"} border-l border-dashed ${toneClass}`}>
        <span className={`absolute -bottom-0.5 -left-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent ${tone === "sky" ? "border-t-sky-300" : tone === "emerald" ? "border-t-emerald-300" : "border-t-slate-300"}`} />
      </div>
    </div>
  );
}

function LegendChip({ label, tone }: { label: string; tone: "slate" | "sky" | "emerald" | "violet" }) {
  const toneClass =
    tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : tone === "violet"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-slate-200 bg-white text-slate-600";

  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] ${toneClass}`}>
      {label}
    </span>
  );
}

function FeedbackLoopCard({ loop }: { loop: typeof FEEDBACK_LOOPS[number] }) {
  const Icon = loop.icon;
  const toneClass =
    loop.tone === "sky"
      ? { card: "border-sky-200 bg-sky-50/40", icon: "border-sky-200 bg-sky-50 text-sky-600", label: "text-sky-700", badge: "border-sky-100 bg-sky-50 text-sky-600" }
      : loop.tone === "emerald"
        ? { card: "border-emerald-200 bg-emerald-50/40", icon: "border-emerald-200 bg-emerald-50 text-emerald-600", label: "text-emerald-700", badge: "border-emerald-100 bg-emerald-50 text-emerald-600" }
        : { card: "border-violet-200 bg-violet-50/40", icon: "border-violet-200 bg-violet-50 text-violet-600", label: "text-violet-700", badge: "border-violet-100 bg-violet-50 text-violet-600" };

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass.card}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${toneClass.icon}`}>
          <Icon className="h-3 w-3" />
        </span>
        <p className={`text-xs font-semibold ${toneClass.label}`}>{loop.label}</p>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px]">
        <span className={`rounded border px-1.5 py-0.5 font-medium ${toneClass.badge}`}>{loop.from}</span>
        <span className="text-slate-400">→</span>
        <span className={`rounded border px-1.5 py-0.5 font-medium ${toneClass.badge}`}>{loop.to}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-slate-600">{loop.description}</p>
    </div>
  );
}
