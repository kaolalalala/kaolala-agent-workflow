export interface ShowcaseSurfaceLink {
  title: string;
  href: string;
  summary: string;
  focus: string;
}

export interface ShowcaseScriptStep {
  title: string;
  description: string;
}

export interface ShowcaseProofPoint {
  title: string;
  detail: string;
}

export interface ShowcaseCapabilityScore {
  label: string;
  score: number;
}

export interface InterviewShowcaseScenario {
  id: string;
  title: string;
  shortTitle: string;
  tag: string;
  elevatorPitch: string;
  interviewerPrompt: string;
  focusSummary: string;
  pain: string;
  systemMechanism: string;
  improvement: string;
  whyThisWins: string;
  strengths: string[];
  surfaces: ShowcaseSurfaceLink[];
  script: ShowcaseScriptStep[];
  proofPoints: ShowcaseProofPoint[];
  capabilityScores: ShowcaseCapabilityScore[];
}

export const INTERVIEW_SHOWCASE_SCENARIOS: InterviewShowcaseScenario[] = [
  {
    id: "durable-runtime",
    title: "全链路起点：工作流到运行中心",
    shortTitle: "全链路起点",
    tag: "Workflow / Runs",
    elevatorPitch:
      "先从一个真实工作流开始，进入项目与运行中心，再落到运行详情，快速建立这不是单页 Demo，而是一套完整平台的第一印象。",
    interviewerPrompt:
      "如果让我在几分钟内理解这套平台怎么被真正使用，你会先带我看哪条链路？",
    focusSummary:
      "这条场景重点展示“资源准备之后，如何配置工作流、挂到项目、启动运行，并在运行中心观察全过程”。它最适合作为面试开场。",
    pain:
      "很多 Agent 项目能展示单次对话，却很难说明从编排到落地运行再到回看结果的整条链路。",
    systemMechanism:
      "平台把工作流、项目、运行中心和运行详情统一到同一套运行模型里，运行不是孤立页面，而是可以追踪、回看和继续操作的实体。",
    improvement:
      "讲解时不需要铺太多概念，直接按使用者路径走：工作流配置、项目承接、启动运行、查看状态与产物。",
    whyThisWins:
      "它能最快让面试官理解这是一套平台，而不是某个页面上临时堆出来的能力。",
    strengths: ["工作流编排", "项目承接", "运行中心", "运行详情", "产物回看"],
    surfaces: [
      {
        title: "资源中心",
        href: "/assets",
        summary: "先说明平台里的模型、脚本、技能和工具是被治理过的资源，而不是散落配置。",
        focus: "强调资源资产化和后续工作流复用能力。",
      },
      {
        title: "项目页",
        href: "/projects",
        summary: "展示工作流如何进入项目语境，项目负责聚合运行、历史与后续操作。",
        focus: "强调项目是业务入口，不是只放文件的容器。",
      },
      {
        title: "运行中心",
        href: "/runs",
        summary: "从运行中心看全局状态、最近运行和失败情况，说明平台有统一调度与观测入口。",
        focus: "强调 run 是一等对象，能被追踪和比较。",
      },
    ],
    script: [
      {
        title: "先讲使用路径",
        description: "告诉面试官这套平台不是从聊天框开始，而是先准备资源，再编排工作流，再落到项目与运行中心。",
      },
      {
        title: "再讲统一运行模型",
        description: "切到运行中心，说明不同工作流与任务最终都回到统一的运行对象和状态流上。",
      },
      {
        title: "最后讲可回看",
        description: "打开某次运行详情，强调结果、轨迹和产物都能被继续观察，而不是一次性消失。",
      },
    ],
    proofPoints: [
      {
        title: "平台入口是连通的",
        detail: "资源、工作流、项目和运行中心不是四个独立页面，而是能组成完整使用路径。",
      },
      {
        title: "运行可持续观察",
        detail: "结果不是只显示在最后一句话里，而是能回到运行详情里继续复盘。",
      },
      {
        title: "资产可复用",
        detail: "工作流不是临时脚本，能挂到项目里持续复用和迭代。",
      },
    ],
    capabilityScores: [
      { label: "平台完整度", score: 5 },
      { label: "可演示性", score: 5 },
      { label: "使用链路清晰度", score: 5 },
      { label: "工程感", score: 4 },
    ],
  },
  {
    id: "adaptive-reflection",
    title: "Meta-Agent：Todo、反思与重规划",
    shortTitle: "Meta-Agent",
    tag: "Meta-Agent",
    elevatorPitch:
      "这一段不再只是展示能跑，而是展示 Meta-Agent 如何拆 todo、保留 step 历史、在失败后做反思和重规划。",
    interviewerPrompt:
      "当目标变复杂、执行出错或外部环境变化时，这个系统怎么继续推进，而不是直接卡死？",
    focusSummary:
      "这条场景从 Meta-Agent 页面切入，重点讲 todo-driven、run history、reflection、recovery 和 reroute。",
    pain:
      "很多 Agent 展示到多步骤任务时就会变成一段不可回看的长文本，出了问题也无法解释中间决策。",
    systemMechanism:
      "这里的 Meta-Agent 不是一次性输出答案，而是维护 todo 状态、执行步骤、恢复决策和历史会话。",
    improvement:
      "讲解时少谈抽象智能，多展示任务是怎么被拆开、怎么失败、怎么恢复、怎么回看。",
    whyThisWins:
      "它能直接证明平台在做控制，而不只是让模型自由发挥。",
    strengths: ["Todo-Driven", "运行历史", "反思恢复", "重规划", "多入口回看"],
    surfaces: [
      {
        title: "Meta-Agent",
        href: "/meta-agent",
        summary: "主舞台就在这里，直接展示会话历史、步骤轨迹和当前控制面板。",
        focus: "强调任务拆解、过程保留和可恢复性。",
      },
      {
        title: "资源中心",
        href: "/assets",
        summary: "说明 Meta-Agent 并不是硬编码业务流，而是通过技能、脚本和工具去调用能力。",
        focus: "强调资源中心与 Meta-Agent 的连接关系。",
      },
      {
        title: "项目页",
        href: "/projects",
        summary: "补充说明 Meta-Agent 会话不是孤立实验，也能回到项目维度继续追踪。",
        focus: "强调平台内不同入口能看到同一类任务结果。",
      },
    ],
    script: [
      {
        title: "先看 run history",
        description: "先证明 Meta-Agent 的过程不会因为切页丢失，历史会话可以重新打开复盘。",
      },
      {
        title: "再看 todo 与 step",
        description: "说明任务是如何被拆成待办、如何串成步骤，以及失败后如何进入 recovery。",
      },
      {
        title: "最后看技能调用",
        description: "指出具体任务不是写死在核心里，而是通过资源中心里的技能和脚本完成。",
      },
    ],
    proofPoints: [
      {
        title: "过程被保留下来",
        detail: "不是只保留最后答案，而是保留 step、todo、恢复过程和结果。",
      },
      {
        title: "反思会影响后续执行",
        detail: "反思不是一句提示词，它会影响后续 todo 走向和恢复策略。",
      },
      {
        title: "能力来自资源中心",
        detail: "业务能力以 skill / script 的形式挂接，Meta-Agent 负责选择和编排。",
      },
    ],
    capabilityScores: [
      { label: "多步骤控制", score: 5 },
      { label: "过程可回看", score: 5 },
      { label: "通用性", score: 4 },
      { label: "平台整合度", score: 5 },
    ],
  },
  {
    id: "parallel-wave",
    title: "并行子任务：波次调度与收口",
    shortTitle: "并行执行",
    tag: "Parallel",
    elevatorPitch:
      "重点展示两个或多个子任务如何并行启动、如何被同一轮波次管理，以及失败后如何不拖垮整条链路。",
    interviewerPrompt:
      "如果任务天然可以拆并行，你们怎么保证不是表面并发，最后还是手工收口？",
    focusSummary:
      "这条场景最适合展示 Meta-Agent 的并行波次、任务边界、收口逻辑，以及失败后的恢复隔离。",
    pain:
      "很多系统只能串行跑任务，或者虽然并发了，但过程不可见、失败难收口。",
    systemMechanism:
      "平台通过 wave 选择、scope 边界、review 与 recovery 组合出受控并行，而不是简单 Promise.all。",
    improvement:
      "讲解时直接指出并行批次的启动证据、收口节点和后续结果，不要只说“支持并行”。",
    whyThisWins:
      "它很适合证明 Meta-Agent 有编排能力，而不是单线程地一项项执行。",
    strengths: ["并行波次", "任务边界", "失败隔离", "收口节点", "真实运行证据"],
    surfaces: [
      {
        title: "Meta-Agent",
        href: "/meta-agent",
        summary: "展示同一轮 wave 下多个 todo 同时启动的过程，以及后续 review / recovery。",
        focus: "强调并行是可见、可解释的。",
      },
      {
        title: "运行中心",
        href: "/runs",
        summary: "说明这些并行任务最终仍会落入统一运行中心，而不是页面私有状态。",
        focus: "强调全局观测和统一治理。",
      },
      {
        title: "项目页",
        href: "/projects",
        summary: "从项目视角补充看最近运行、相关产物和串联关系。",
        focus: "强调并行结果最终可回到业务容器中归档。",
      },
    ],
    script: [
      {
        title: "先点出拆分目标",
        description: "说明为什么这个任务天然适合拆成两个或多个子任务并行推进。",
      },
      {
        title: "再展示启动证据",
        description: "在 Meta-Agent 页面里指出同一轮 wave 的多个 item 同时启动。",
      },
      {
        title: "最后讲失败不阻塞",
        description: "强调某个 todo 出错后，系统如何恢复或降级，而不是整条链路一起挂住。",
      },
    ],
    proofPoints: [
      {
        title: "并行不是口头支持",
        detail: "有波次、历史和状态变化可以直接证明多个子任务同时被管理。",
      },
      {
        title: "失败有隔离",
        detail: "单个子任务失败不会自动让整个并行批次不可收拾。",
      },
      {
        title: "结果能收口",
        detail: "并行任务最终仍会汇总成平台可继续处理的统一结果。",
      },
    ],
    capabilityScores: [
      { label: "并行能力", score: 5 },
      { label: "过程透明度", score: 4 },
      { label: "恢复能力", score: 4 },
      { label: "工程可信度", score: 5 },
    ],
  },
  {
    id: "whitebox-trace",
    title: "运行详情：Trace、Artifact 与根因定位",
    shortTitle: "白盒诊断",
    tag: "Trace",
    elevatorPitch:
      "当结果不对时，不是停留在“模型幻觉”这类泛化解释，而是顺着运行详情、trace 和 artifact 把问题定位清楚。",
    interviewerPrompt:
      "如果线上结果出了问题，这个平台怎么帮助你快速判断到底是模型、工具、数据还是流程策略的问题？",
    focusSummary:
      "这一段强调白盒诊断能力，从运行详情切入，讲 trace、artifact、issue、对比和根因归属。",
    pain:
      "没有白盒轨迹时，问题只能靠猜，团队会在模型、工具和数据之间来回甩锅。",
    systemMechanism:
      "平台保留了运行轨迹、工具调用和产物信息，使问题可以按执行链条回放和归因。",
    improvement:
      "讲解时不要只展示最终答案错误，而要顺着轨迹把定位过程讲完整。",
    whyThisWins:
      "它能体现平台的调试价值，这类能力通常比“会不会回答”更能打动工程型面试官。",
    strengths: ["运行详情", "Trace", "Artifact", "问题定位", "回放验证"],
    surfaces: [
      {
        title: "运行中心",
        href: "/runs",
        summary: "先在运行中心找到问题运行，再进入详情页做白盒诊断。",
        focus: "强调先找到样本，再展开证据。",
      },
      {
        title: "项目页",
        href: "/projects",
        summary: "从项目维度补充相关运行和上下文，说明这不是孤立一次异常。",
        focus: "强调问题定位也依赖业务上下文。",
      },
      {
        title: "评测中心",
        href: "/evaluations",
        summary: "如果已经做了 replay / compare，就顺势把问题定位接到验证闭环上。",
        focus: "强调定位之后还能继续验证修复。",
      },
    ],
    script: [
      {
        title: "先定问题样本",
        description: "先带面试官看到一次有代表性的运行结果异常，不要一上来就跳诊断细节。",
      },
      {
        title: "再顺轨迹往回拆",
        description: "从输出往上游看 trace、artifact 和中间环节，讲清楚污染或失败发生在何处。",
      },
      {
        title: "最后接回验证",
        description: "如果有 replay 或 compare，说明这类问题不是一次性复盘，而是能变成可重复验证的检查。",
      },
    ],
    proofPoints: [
      {
        title: "问题能被归因",
        detail: "平台不仅告诉你错了，还帮助你判断错在什么环节。",
      },
      {
        title: "证据是结构化的",
        detail: "trace 和 artifact 能直接作为证据，而不是依赖口头解释。",
      },
      {
        title: "诊断可接回归",
        detail: "定位后还能通过评测与回放继续验证修复效果。",
      },
    ],
    capabilityScores: [
      { label: "可观测性", score: 5 },
      { label: "调试能力", score: 5 },
      { label: "闭环能力", score: 4 },
      { label: "演示说服力", score: 4 },
    ],
  },
  {
    id: "budget-guardrails",
    title: "运行治理：预算、防护与恢复边界",
    shortTitle: "运行治理",
    tag: "Guardrails",
    elevatorPitch:
      "这条场景强调系统不是一味往前跑，而是知道何时停、何时退、何时恢复，避免成本和风险无上限扩大。",
    interviewerPrompt:
      "如果外部工具持续失败、模型不断重试，这套平台怎么止损？",
    focusSummary:
      "适合展示 runtime/controller 层的治理能力，重点讲预算、熔断、允许动作和恢复边界。",
    pain:
      "没有治理时，Agent 系统最常见的问题不是不会做，而是一直做错、越错越贵。",
    systemMechanism:
      "平台通过预算与控制平面决定何时继续、何时终止、何时走恢复路径，不把止损权完全交给模型。",
    improvement:
      "讲解时不要陷入太多成本指标细节，重点讲控制权和边界在哪里。",
    whyThisWins:
      "它能体现平台对真实生产问题的理解，而不仅是功能展示。",
    strengths: ["预算控制", "熔断止损", "恢复边界", "控制平面", "运行治理"],
    surfaces: [
      {
        title: "运行中心",
        href: "/runs",
        summary: "从运行层看失败、终止和恢复，不把治理只讲成一段配置说明。",
        focus: "强调运行治理有实体化展示。",
      },
      {
        title: "Meta-Agent",
        href: "/meta-agent",
        summary: "如果是多步骤任务，可以补充看 recovery 与 routing 决策。",
        focus: "强调治理不是单点逻辑，而是贯穿调度过程。",
      },
      {
        title: "项目页",
        href: "/projects",
        summary: "补充说明治理结果最终也会沉淀到项目视角中，被业务方感知。",
        focus: "强调治理不是技术自嗨，而是影响交付结果。",
      },
    ],
    script: [
      {
        title: "先讲风险",
        description: "指出真实系统里最贵的往往不是一次失败，而是无限重试和不断扩大的副作用。",
      },
      {
        title: "再讲控制权",
        description: "解释哪些决策属于 runtime/controller，而不是由模型自由决定。",
      },
      {
        title: "最后讲后续路径",
        description: "说明终止不代表任务彻底消失，后面还可以回放、恢复或人工接手。",
      },
    ],
    proofPoints: [
      {
        title: "平台知道何时停",
        detail: "预算与熔断不是文案，而是能影响真实运行走向。",
      },
      {
        title: "失败不是失控",
        detail: "平台会把失败导向恢复、回放或人工处理路径。",
      },
      {
        title: "治理有可视入口",
        detail: "这些能力不是藏在代码里，而是在运行界面里可以被观察到。",
      },
    ],
    capabilityScores: [
      { label: "生产治理", score: 5 },
      { label: "可靠性", score: 5 },
      { label: "平台控制力", score: 5 },
      { label: "展示直观度", score: 4 },
    ],
  },
  {
    id: "evaluation-gate",
    title: "评测闭环：回放、对比与发布门禁",
    shortTitle: "评测闭环",
    tag: "Evaluations",
    elevatorPitch:
      "最后用评测把整个平台收住，说明修改之后不是凭感觉上线，而是能 replay、compare、给出结构化结论。",
    interviewerPrompt:
      "你们怎么确认工作流或 Meta-Agent 的修改没有把原来能跑的场景改坏？",
    focusSummary:
      "这条场景重点连接评测中心、运行中心和资源中心，讲平台如何形成可持续迭代的质量闭环。",
    pain:
      "如果每次修改都只能人工看结果，系统很快会积累大量不可见回归。",
    systemMechanism:
      "平台通过 suite、case、baseline、replay 和 compare 把变更纳入统一评测流程。",
    improvement:
      "讲解时要强调评测不是旁路脚本，而是复用平台本身的运行链路。",
    whyThisWins:
      "它能把平台从“能用”拉到“能持续迭代并守住质量”。",
    strengths: ["评测套件", "回放重跑", "对比报告", "质量闭环", "发布门禁"],
    surfaces: [
      {
        title: "评测中心",
        href: "/evaluations",
        summary: "主舞台就在这里，展示套件、用例、最近运行和 compare 报告。",
        focus: "强调结构化评测，而不是人工截图比对。",
      },
      {
        title: "运行中心",
        href: "/runs",
        summary: "补充说明 baseline / replay 最终仍然是统一运行模型中的真实运行。",
        focus: "强调评测和正式运行不是两套体系。",
      },
      {
        title: "资源中心",
        href: "/assets",
        summary: "再回到资源中心，说明 Prompt、技能和脚本被治理后，评测门禁才有持续意义。",
        focus: "强调资产化与评测闭环的关系。",
      },
    ],
    script: [
      {
        title: "先讲为什么要评测",
        description: "先把问题抛清楚：系统越复杂，越不能靠人工判断“看起来没问题”。",
      },
      {
        title: "再看 replay / compare",
        description: "展示如何从一条用例出发，生成 baseline、replay 和结构化对比结论。",
      },
      {
        title: "最后接回平台迭代",
        description: "说明工作流、技能和 Meta-Agent 的修改都可以被纳入这套评测闭环中。",
      },
    ],
    proofPoints: [
      {
        title: "改动能被验证",
        detail: "修改之后可以通过 replay 和 compare 快速判断是否退化。",
      },
      {
        title: "评测复用真实链路",
        detail: "不是离线脚本模拟，而是复用平台自己的运行模型。",
      },
      {
        title: "质量闭环成立",
        detail: "资源治理、运行结果和评测报告能够串成完整闭环。",
      },
    ],
    capabilityScores: [
      { label: "评测能力", score: 5 },
      { label: "工程闭环", score: 5 },
      { label: "平台化成熟度", score: 5 },
      { label: "演示收束力", score: 5 },
    ],
  },
];

export function getInterviewShowcaseScenario(id?: string | null) {
  if (!id) return INTERVIEW_SHOWCASE_SCENARIOS[0];
  return INTERVIEW_SHOWCASE_SCENARIOS.find((item) => item.id === id) ?? INTERVIEW_SHOWCASE_SCENARIOS[0];
}

export const INTERVIEW_SHOWCASE_SUMMARY = {
  scenarioCount: INTERVIEW_SHOWCASE_SCENARIOS.length,
  platformSurfaces: ["资源中心", "工作流", "项目", "运行中心", "Meta-Agent", "评测中心"],
  strongestSignals: [
    "完整使用链路",
    "Meta-Agent Todo 编排",
    "并行执行与恢复",
    "运行详情与 Trace",
    "评测闭环",
  ],
};
