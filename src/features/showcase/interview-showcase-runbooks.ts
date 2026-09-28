export interface ShowcaseRunbookStep {
  title: string;
  action: string;
  expected: string;
}

export interface ShowcaseRunbook {
  duration: string;
  objective: string;
  setupChecklist: string[];
  executionSteps: ShowcaseRunbookStep[];
  successSignals: string[];
  fallbackPlan: string;
}

export const INTERVIEW_SHOWCASE_RUNBOOKS: Record<string, ShowcaseRunbook> = {
  "durable-runtime": {
    duration: "3-5 分钟",
    objective:
      "从资源中心、项目、运行中心到运行详情，快速讲清整个平台的基础使用链路和统一运行模型。",
    setupChecklist: [
      "提前准备好一个可直接运行的工作流或项目样例。",
      "确认运行中心里有最近运行，方便现场直接打开详情。",
      "如果现场网络不稳，准备一条最近完成的运行作为保底样本。",
    ],
    executionSteps: [
      {
        title: "从资源中心起步",
        action: "说明模型、技能、脚本和工具先被沉淀成资源，再进入工作流与项目。",
        expected: "面试官先建立“平台入口不是聊天框”的认知。",
      },
      {
        title: "切到项目与运行中心",
        action: "展示项目如何承接工作流，再从运行中心看最近运行和状态。",
        expected: "面试官能看到项目和运行是连在一起的。",
      },
      {
        title: "打开一次运行详情",
        action: "进入运行详情页，讲状态、结果与产物如何被回看。",
        expected: "面试官能感知平台的全过程不是一次性页面输出。",
      },
    ],
    successSignals: [
      "能顺着资源 -> 项目 -> 运行中心 -> 运行详情讲完一条完整路径。",
      "运行中心里能看到真实运行记录，而不是静态示意。",
      "面试官能快速理解这是平台，不是单页功能。",
    ],
    fallbackPlan:
      "如果现场不适合重新发起任务，就直接打开最近一次已完成运行，按同样顺序讲完整条链路。",
  },
  "adaptive-reflection": {
    duration: "4-6 分钟",
    objective:
      "展示 Meta-Agent 的 todo-driven、step history、反思恢复和 run history，说明过程被完整保留下来。",
    setupChecklist: [
      "准备一条已经保留历史的 Meta-Agent 会话。",
      "确保资源中心里有至少一个可调用 skill，便于解释能力接入方式。",
      "如果想演示恢复，优先准备一条曾经发生过失败和恢复的会话。",
    ],
    executionSteps: [
      {
        title: "先打开会话历史",
        action: "证明切换页面之后，Meta-Agent 运行过程不会丢失，历史会话可以重新进入。",
        expected: "面试官看到 session history 是真实存在的。",
      },
      {
        title: "再看 todo 与 step",
        action: "展开当前会话，解释任务如何被拆解成 todo，如何形成步骤与状态变化。",
        expected: "面试官能明确感知过程控制，而不是自由生成。",
      },
      {
        title: "补充反思与技能调用",
        action: "说明失败后如何 recovery / reroute，以及实际能力如何通过资源中心 skill 被调用。",
        expected: "面试官理解 Meta-Agent 控制的是流程，能力来自资源中心。",
      },
    ],
    successSignals: [
      "历史会话可回看，切页不丢过程。",
      "todo、step、recovery 至少能展示其中两类真实信号。",
      "可以明确说清 Meta-Agent 与资源中心的关系。",
    ],
    fallbackPlan:
      "如果现场没有合适的新会话，就用最近一条真实 session 做静态回放式讲解，重点仍然放在 history、todo 和 recovery。",
  },
  "parallel-wave": {
    duration: "4-5 分钟",
    objective:
      "展示并行子任务如何进入同一轮 wave，被统一管理、观察和收口。",
    setupChecklist: [
      "准备一条天然可并行拆分的 Meta-Agent 任务样例。",
      "确认 Meta-Agent 页面里能看到波次、todo 状态或相关历史。",
      "最好有一条包含恢复或降级的样例，方便解释失败隔离。",
    ],
    executionSteps: [
      {
        title: "先解释为什么要并行",
        action: "从任务本身说明为什么它适合拆成多个子任务并行推进。",
        expected: "面试官理解并行不是为了炫技，而是任务结构天然支持。",
      },
      {
        title: "再展示波次证据",
        action: "指出同一轮 wave 下多个 todo 的启动或执行记录。",
        expected: "面试官能看到平台是真的在管理并行，而不是口头宣称。",
      },
      {
        title: "最后讲收口与恢复",
        action: "说明并行结果如何汇总，以及某个子任务失败时如何恢复或隔离。",
        expected: "面试官理解并行执行仍然可治理、可收口。",
      },
    ],
    successSignals: [
      "同一轮 wave 的多个 item 有明确证据。",
      "并行结果能回到统一结果或后续 todo 上。",
      "失败处理不是整条链路一起阻塞。",
    ],
    fallbackPlan:
      "如果现场并行拆分不明显，就打开最近一条带 wave history 的会话，用历史记录讲并行机制。",
  },
  "whitebox-trace": {
    duration: "3-5 分钟",
    objective:
      "通过运行详情、trace 和 artifact 把一次异常结果定位清楚，强调平台的白盒诊断能力。",
    setupChecklist: [
      "准备一条有代表性的异常运行或质量波动样例。",
      "确认运行详情里能看到 trace、artifact 或相关诊断信息。",
      "如有评测结果，可准备对应 replay / compare 作为补充。",
    ],
    executionSteps: [
      {
        title: "先看结果异常",
        action: "从最终结果的不符合预期切入，让面试官先理解问题表象。",
        expected: "问题场景被建立，后续诊断更容易理解。",
      },
      {
        title: "顺着轨迹往回拆",
        action: "打开运行详情，沿着 trace、artifact 和中间信号做回溯。",
        expected: "面试官能看到问题并不是只能靠猜。",
      },
      {
        title: "明确归因并接回评测",
        action: "说清问题落在哪一层，并说明如何通过 replay / compare 验证修复。",
        expected: "形成诊断到验证的完整闭环。",
      },
    ],
    successSignals: [
      "能够明确指出至少一个可用的白盒证据。",
      "归因不再停留在“模型不稳定”这类泛化结论。",
      "定位后能自然接回评测或回放。",
    ],
    fallbackPlan:
      "如果现场没有新鲜故障，就用历史样例做白盒回放，重点仍然是证据链而不是问题是否实时发生。",
  },
  "budget-guardrails": {
    duration: "3-4 分钟",
    objective:
      "展示平台如何通过预算、熔断和恢复边界来控制成本与风险。",
    setupChecklist: [
      "准备一条预算或失败恢复相关的真实运行样例。",
      "确认运行详情或 Meta-Agent 页面里能看到终止、恢复或控制信号。",
      "避免使用有破坏性的真实副作用任务做现场演示。",
    ],
    executionSteps: [
      {
        title: "先讲为什么需要止损",
        action: "从真实 Agent 场景里最常见的无限重试和高成本失败讲起。",
        expected: "面试官理解治理能力的重要性。",
      },
      {
        title: "再讲控制权归属",
        action: "说明哪些决策由 runtime/controller 掌握，而不是交给模型自己判断。",
        expected: "面试官感知平台在做运行时治理。",
      },
      {
        title: "最后讲后续路径",
        action: "展示终止之后还能如何恢复、回放或人工接手。",
        expected: "面试官理解系统知道何时停，也知道停后怎么办。",
      },
    ],
    successSignals: [
      "能看到至少一个真实的预算、终止或恢复信号。",
      "能说清止损权为什么不该完全交给模型。",
      "能补充后续 recovery / replay 路径。",
    ],
    fallbackPlan:
      "如果现场不适合重新触发预算边界，就用一条已经终止或恢复过的历史运行来讲运行治理。",
  },
  "evaluation-gate": {
    duration: "4-5 分钟",
    objective:
      "用 suite、case、replay 和 compare 说明平台具备真实的回归验证与发布门禁能力。",
    setupChecklist: [
      "至少准备一个 suite 和一个可执行 case。",
      "如果有 baseline / replay 历史结果，提前打开一条更稳妥。",
      "准备好一条能说明资源治理与评测闭环关系的补充话术。",
    ],
    executionSteps: [
      {
        title: "先打开评测中心",
        action: "展示 suite、case 和最近评测运行，让面试官理解评测并不是旁路工具。",
        expected: "面试官看到结构化评测入口。",
      },
      {
        title: "再看 compare 报告",
        action: "打开一条评测结果，解释 baseline、replay 和差异项。",
        expected: "面试官理解平台能对修改做结构化验证。",
      },
      {
        title: "最后接回资源与运行",
        action: "说明这些评测复用的是平台自己的运行链路，并服务于资源和流程的持续迭代。",
        expected: "面试官理解评测是整个平台的闭环收束点。",
      },
    ],
    successSignals: [
      "能看到真实 suite、case 和至少一条评测运行。",
      "compare 报告能讲清楚差异，而不是只看最终一句话。",
      "评测、运行和资源三者之间的关系被讲明白。",
    ],
    fallbackPlan:
      "如果现场不适合重跑评测，就直接打开最近一次 compare 报告，把评测闭环讲完整。",
  },
};

export function getInterviewShowcaseRunbook(id?: string | null) {
  if (!id || !INTERVIEW_SHOWCASE_RUNBOOKS[id]) {
    return INTERVIEW_SHOWCASE_RUNBOOKS["durable-runtime"];
  }
  return INTERVIEW_SHOWCASE_RUNBOOKS[id];
}
