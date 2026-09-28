import { makeId, nowIso } from "@/lib/utils";
import { INTERVIEW_SHOWCASE_SCENARIOS } from "@/features/showcase/interview-showcases";
import { runService } from "@/server/api/run-service";
import { resolveStrictWorkspaceLLMConfig } from "@/server/config/strict-llm-config";
import { configService } from "@/server/config/config-service";
import type { StoredWorkflowEdge, StoredWorkflowNode, StoredWorkflowTask } from "@/server/domain";
import { evaluationService } from "@/server/evaluation/evaluation-service";
import { metaAgentService } from "@/server/meta-agent/meta-agent-service";
import { tokenBudgetTracker } from "@/server/runtime/token-budget";
import { toolResolver } from "@/server/tools/tool-resolver";
import { toolService } from "@/server/tools/tool-service";

export type ShowcaseDemoScenarioId =
  | "durable-runtime"
  | "adaptive-reflection"
  | "whitebox-trace"
  | "parallel-wave"
  | "budget-guardrails"
  | "evaluation-gate";

export type ShowcaseDemoAssetKind = "workflow_run" | "meta_agent_session" | "evaluation_run";

interface ShowcaseDemoLink {
  label: string;
  href: string;
}

interface ShowcaseLatestLaunch {
  kind: ShowcaseDemoAssetKind;
  status: string;
  startedAt: string;
  primaryId: string;
  primaryLink: ShowcaseDemoLink;
  secondaryLinks?: ShowcaseDemoLink[];
  summary: string;
}

interface ShowcaseScenarioAssetStatus {
  id: ShowcaseDemoScenarioId;
  title: string;
  assetKind: ShowcaseDemoAssetKind;
  integrationNeed: "high" | "medium";
  launchDeterminism: "high" | "medium";
  whyWorthIt: string;
  fitSummary: string;
  liveSignals: string[];
  riskNote: string;
  manualNote?: string;
  ready: boolean;
  project?: ShowcaseDemoLink;
  workflow?: ShowcaseDemoLink;
  evaluationSuite?: ShowcaseDemoLink;
  notes: string[];
  latestLaunch?: ShowcaseLatestLaunch;
}

interface ShowcaseDemoStatusPayload {
  llm: {
    ready: boolean;
    provider?: string;
    model?: string;
    baseUrl?: string;
    error?: string;
  };
  project?: ShowcaseDemoLink;
  scenarios: ShowcaseScenarioAssetStatus[];
}

interface ShowcaseLaunchResult {
  scenario: ShowcaseScenarioAssetStatus;
  latestLaunch?: ShowcaseLatestLaunch;
}

interface ScenarioAssetState {
  workflowId?: string;
  evaluationSuiteId?: string;
  evaluationCaseId?: string;
  latestLaunch?: ShowcaseLatestLaunch;
}

const SHOWCASE_PROJECT_NAME = "面试展示 · 真实演示项目";
const SHOWCASE_PROJECT_DESCRIPTION = "用于现场面试演示的真实运行资产集合。";

const registry: {
  projectId?: string;
  scenarios: Record<ShowcaseDemoScenarioId, ScenarioAssetState>;
} = {
  projectId: undefined,
  scenarios: {
    "durable-runtime": {},
    "adaptive-reflection": {},
    "whitebox-trace": {},
    "parallel-wave": {},
    "budget-guardrails": {},
    "evaluation-gate": {},
  },
};

const scenarioCatalog: Record<
  ShowcaseDemoScenarioId,
  Omit<ShowcaseScenarioAssetStatus, "title" | "ready" | "project" | "workflow" | "evaluationSuite" | "latestLaunch">
> = {
  "durable-runtime": {
    id: "durable-runtime",
    assetKind: "workflow_run",
    integrationNeed: "high",
    launchDeterminism: "high",
    whyWorthIt: "能直接证明平台具备 checkpoint、恢复策略与可回放执行边界，而不是失败后整条重跑。",
    fitSummary: "这套真实工作流资产会走真实 LLM 与工具链路，重点展示长链路运行、显式 control plane 与恢复观测能力。",
    liveSignals: ["运行状态迁移", "Runtime Control", "checkpoint / replay candidate", "恢复策略与 recent actions"],
    riskNote: "适合展示运行时治理，不建议在现场直接做破坏性故障注入。",
    manualNote: "如果现场不方便重启服务，可以直接打开最近一次真实运行来讲恢复语义。",
    notes: ["先预置资产再启动运行。", "优先从运行中心和运行详情讲 durable runtime。"],
  },
  "adaptive-reflection": {
    id: "adaptive-reflection",
    assetKind: "meta_agent_session",
    integrationNeed: "high",
    launchDeterminism: "medium",
    whyWorthIt: "能证明反思不是 prompt 花活，而是会改写 todo graph、ownership 与后续路径的 controller 机制。",
    fitSummary: "这套真实 Meta-Agent 场景会启动真正的 todo-driven orchestrator，用运行态 issue、reroute 和 replan 来支撑讲解。",
    liveSignals: ["Mission Control", "Recovery & Routing", "Execution Map", "todo graph 变化"],
    riskNote: "真实 Meta-Agent 的反思触发受任务复杂度影响，现场最好配合历史 session 一起讲。",
    manualNote: "如果当场没有触发明显重规划，可以切到最近一次已有 reroute 的 session。",
    notes: ["适合从 Meta-Agent 页面进入。", "重点讲触发条件、状态写回和拓扑变化。"],
  },
  "whitebox-trace": {
    id: "whitebox-trace",
    assetKind: "workflow_run",
    integrationNeed: "high",
    launchDeterminism: "high",
    whyWorthIt: "能把问题归因拆到 trace、tool、artifact 与 replay，而不是只给最终答案。",
    fitSummary: "这套真实工作流会调用参考数据工具并沉淀真实 trace，方便演示白盒诊断、根因定位与对照验证。",
    liveSignals: ["Execution Trace", "tool trace", "artifact 输出", "运行详情诊断"],
    riskNote: "重点在解释轨迹和归因，不需要现场造脏数据。",
    manualNote: "必要时可直接打开最近一次有代表性的历史运行做回放式讲解。",
    notes: ["优先打开运行详情。", "建议配合评测或对比结果一起讲。"],
  },
  "parallel-wave": {
    id: "parallel-wave",
    assetKind: "meta_agent_session",
    integrationNeed: "high",
    launchDeterminism: "medium",
    whyWorthIt: "能体现多 Agent 并行不是 Promise.all，而是带 wave 选择、review 与恢复语义的受控并发。",
    fitSummary: "这套真实 Meta-Agent 场景会创建一个可拆分目标，让平台展示并行 todo wave、scope boundary 与收敛过程。",
    liveSignals: ["wave history", "Execution Map", "并行 todo 状态", "routing / review 信号"],
    riskNote: "并行拆分质量取决于目标结构，建议优先使用预设目标。",
    manualNote: "现场如果并行拆分不够明显，可以切到已有多 wave 的历史 session。",
    notes: ["适合展示多 Agent 并行与收敛。", "可配合运行中心一起讲统一观测模型。"],
  },
  "budget-guardrails": {
    id: "budget-guardrails",
    assetKind: "workflow_run",
    integrationNeed: "high",
    launchDeterminism: "high",
    whyWorthIt: "能证明预算控制、熔断与恢复路径属于 runtime/controller，而不是模型自己决定何时停手。",
    fitSummary: "这套真实工作流会在启动前配置严格 token budget，通过真实运行链路展示预算、止损和后续恢复入口。",
    liveSignals: ["budget 使用量", "terminate / fallback 信号", "Runtime Control", "recent side effects"],
    riskNote: "预算值设得过低会快速失败，但这正是适合讲 guardrail 的地方。",
    manualNote: "如果现场想更稳定，可以用最近一次已触发预算边界的历史运行辅助说明。",
    notes: ["启动后直接去运行详情看控制平面。", "适合强调预算、熔断和恢复闭环。"],
  },
  "evaluation-gate": {
    id: "evaluation-gate",
    assetKind: "evaluation_run",
    integrationNeed: "medium",
    launchDeterminism: "high",
    whyWorthIt: "能证明平台不仅能跑，还能把工作流和回放对比纳入持续评测门禁。",
    fitSummary: "这套真实评测资产会调用统一 runtime 跑 baseline 与 replay，再生成可解释的 compare 结果和评测报告。",
    liveSignals: ["评测套件与用例", "compare report", "baseline / replay run", "评测结论"],
    riskNote: "评测启动需要等待 baseline 和 replay 完成，适合放在展示中后段。",
    manualNote: "如果现场时间紧，可以直接打开最近一次评测结果讲门禁语义。",
    notes: ["建议先预置全部资产。", "适合收尾阶段展示工程闭环。"],
  },
};

function makeLink(label: string, href: string): ShowcaseDemoLink {
  return { label, href };
}

function scenarioTitle(id: ShowcaseDemoScenarioId) {
  return INTERVIEW_SHOWCASE_SCENARIOS.find((item) => item.id === id)?.title ?? id;
}

function workflowNames(id: ShowcaseDemoScenarioId) {
  switch (id) {
    case "durable-runtime":
      return "面试展示 · 耐久化运行时恢复";
    case "whitebox-trace":
      return "面试展示 · 白盒轨迹与根因定位";
    case "budget-guardrails":
      return "面试展示 · 预算控制与熔断止损";
    case "evaluation-gate":
      return "面试展示 · 评测门禁与回放交付";
    default:
      return "面试展示 · 通用工作流";
  }
}

function assertWorkspaceLlm() {
  return resolveStrictWorkspaceLLMConfig();
}

function ensureCustomTools() {
  toolService.ensurePlatformBootstrap();
  ensureTool({
    toolId: "tool_showcase_delay_report",
    name: "Showcase Delay Report",
    description: "Write a delayed markdown artifact for runtime recovery showcase.",
    category: "automation",
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/showcase-delay-report.mjs",
    },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        delayMs: { type: "integer" },
        artifactName: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        path: { type: "string" },
        bytes: { type: "number" },
      },
    },
  });
  ensureTool({
    toolId: "tool_showcase_reference_bundle",
    name: "Showcase Reference Bundle",
    description: "Return a structured bundle for white-box trace and evaluation showcase.",
    category: "analysis",
    sourceType: "local_script",
    sourceConfig: {
      command: "node ./scripts/tools/showcase-reference-bundle.mjs",
    },
    inputSchema: {
      type: "object",
      properties: {
        bundleId: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        bundleId: { type: "string" },
        topic: { type: "string" },
        records: { type: "array" },
        notes: { type: "array" },
      },
    },
  });
}

function ensureTool(input: {
  toolId: string;
  name: string;
  description: string;
  category: "automation" | "analysis";
  sourceType: "local_script";
  sourceConfig: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}) {
  const existing = toolService.getTool(input.toolId);
  if (existing) {
    toolService.updateTool(input.toolId, {
      name: input.name,
      description: input.description,
      category: input.category,
      sourceType: input.sourceType,
      sourceConfig: input.sourceConfig,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      enabled: true,
    });
    return;
  }

  toolService.createTool({
    toolId: input.toolId,
    name: input.name,
    description: input.description,
    category: input.category,
    sourceType: input.sourceType,
    sourceConfig: input.sourceConfig,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    enabled: true,
  });
}

function buildWorkflowBlueprint(id: ShowcaseDemoScenarioId): {
  name: string;
  description: string;
  rootTaskInput: string;
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
} {
  if (id === "durable-runtime") {
    return {
      name: workflowNames(id),
      description: "真实演示耐久化运行、artifact 落盘与恢复观测。",
      rootTaskInput: "请生成一份关于运行时恢复机制的演示说明，并产出可追溯 artifact。",
      nodes: [
        { id: "planner", name: "Planner", role: "planner", taskSummary: "规划恢复演示流程", responsibilitySummary: "先拆分执行步骤与风险边界" },
        { id: "probe", name: "Recovery Probe", role: "worker", taskSummary: "调用延时报告工具写出恢复说明", responsibilitySummary: "必须输出带 artifact 的可恢复执行结果" },
        { id: "summarizer", name: "Summarizer", role: "summarizer", taskSummary: "总结 checkpoint、replay 与恢复策略", responsibilitySummary: "输出适合面试讲解的中文总结" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "planner", targetNodeId: "probe", type: "task_flow" },
        { id: "e2", sourceNodeId: "probe", targetNodeId: "summarizer", type: "output_flow" },
      ],
      tasks: [],
    };
  }

  if (id === "whitebox-trace") {
    return {
      name: workflowNames(id),
      description: "真实演示 trace、tool evidence 与根因定位。",
      rootTaskInput: "请分析一份存在脏证据的数据包，并解释为什么这是检索污染而不是模型幻觉。",
      nodes: [
        { id: "collector", name: "Collector", role: "worker", taskSummary: "获取结构化证据包", responsibilitySummary: "调用参考数据工具并返回原始 evidence" },
        { id: "analyst", name: "Analyst", role: "worker", taskSummary: "识别异常记录和污染来源", responsibilitySummary: "明确指出脏数据来自哪一层" },
        { id: "summarizer", name: "Summarizer", role: "summarizer", taskSummary: "给出根因定位总结", responsibilitySummary: "输出适合现场讲解的白盒诊断结论" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "collector", targetNodeId: "analyst", type: "task_flow" },
        { id: "e2", sourceNodeId: "analyst", targetNodeId: "summarizer", type: "output_flow" },
      ],
      tasks: [],
    };
  }

  if (id === "budget-guardrails") {
    return {
      name: workflowNames(id),
      description: "真实演示预算控制、熔断与恢复路径。",
      rootTaskInput: "请从运行治理角度长篇分析预算控制、熔断策略和恢复路径，并尽量给出详细展开。",
      nodes: [
        { id: "planner", name: "Planner", role: "planner", taskSummary: "规划预算控制分析", responsibilitySummary: "拆分说明预算、熔断、恢复三部分" },
        { id: "analyst", name: "Analyst", role: "worker", taskSummary: "详细展开预算与熔断机制", responsibilitySummary: "输出长文本并覆盖终止、fallback、reroute" },
        { id: "summarizer", name: "Summarizer", role: "summarizer", taskSummary: "压缩成适合展示的结论", responsibilitySummary: "总结预算止损为何属于 runtime/controller" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "planner", targetNodeId: "analyst", type: "task_flow" },
        { id: "e2", sourceNodeId: "analyst", targetNodeId: "summarizer", type: "output_flow" },
      ],
      tasks: [],
    };
  }

  return {
    name: workflowNames(id),
    description: "真实演示评测门禁与回放交付。",
    rootTaskInput: "请根据提供的数据包输出一份稳定的中文结论，便于后续 baseline / replay 对比。",
    nodes: [
      { id: "collector", name: "Collector", role: "worker", taskSummary: "获取评测基线数据", responsibilitySummary: "调用参考数据工具输出 evaluation bundle" },
      { id: "analyst", name: "Analyst", role: "worker", taskSummary: "分析并整理结构化结论", responsibilitySummary: "确保输出可稳定 replay" },
      { id: "summarizer", name: "Summarizer", role: "summarizer", taskSummary: "生成最终结论", responsibilitySummary: "输出简洁稳定的最终文本" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "collector", targetNodeId: "analyst", type: "task_flow" },
      { id: "e2", sourceNodeId: "analyst", targetNodeId: "summarizer", type: "output_flow" },
    ],
    tasks: [],
  };
}

function findProjectIdByName(name: string) {
  return configService.listProjects().find((item) => item.name === name)?.id;
}

function ensureShowcaseProject() {
  if (registry.projectId && configService.getProject(registry.projectId)) {
    return registry.projectId;
  }

  const existingId = findProjectIdByName(SHOWCASE_PROJECT_NAME);
  if (existingId) {
    registry.projectId = existingId;
    return existingId;
  }

  const created = runService.createProject({
    name: SHOWCASE_PROJECT_NAME,
    description: SHOWCASE_PROJECT_DESCRIPTION,
  }).project;
  registry.projectId = created.id;
  return created.id;
}

function findWorkflow(projectId: string, name: string) {
  return runService.listProjectWorkflows(projectId).workflows.find((item) => item.name === name);
}

function ensureWorkflowScenario(id: ShowcaseDemoScenarioId) {
  const state = registry.scenarios[id];
  const projectId = ensureShowcaseProject();
  const workflowId = state.workflowId;
  if (workflowId && configService.getProjectWorkflow(projectId, workflowId)) {
    return configService.getProjectWorkflow(projectId, workflowId) as NonNullable<ReturnType<typeof configService.getProjectWorkflow>>;
  }

  const existing = findWorkflow(projectId, workflowNames(id));
  if (existing) {
    state.workflowId = existing.id;
    return runService.getProjectWorkflow(projectId, existing.id).workflow;
  }

  const blueprint = buildWorkflowBlueprint(id);
  const created = runService.saveWorkflow({
    projectId,
    name: blueprint.name,
    description: blueprint.description,
    rootTaskInput: blueprint.rootTaskInput,
    nodes: blueprint.nodes,
    edges: blueprint.edges,
    tasks: blueprint.tasks,
    versionLabel: "showcase-v1",
    versionNotes: "面试展示预置资产",
  }).workflow;
  state.workflowId = created.id;
  return created;
}

function ensureEvaluationScenario() {
  const projectId = ensureShowcaseProject();
  const workflow = ensureWorkflowScenario("evaluation-gate");
  const state = registry.scenarios["evaluation-gate"];
  const suiteName = "面试展示 · 评测门禁套件";
  const caseName = "回放一致性验证";

  let suite =
    state.evaluationSuiteId
      ? evaluationService.listSuites().find((item) => item.id === state.evaluationSuiteId)
      : undefined;

  if (!suite) {
    suite = evaluationService.listSuites().find((item) => item.name === suiteName);
  }

  if (!suite) {
    suite = evaluationService.createSuite({
      name: suiteName,
      description: "用于展示 baseline、replay 与 compare report 的真实评测套件。",
      workflowId: workflow.id,
      workflowVersionId: workflow.currentVersionId,
      enabled: true,
    });
  }

  state.evaluationSuiteId = suite.id;

  let evaluationCase =
    state.evaluationCaseId
      ? evaluationService.listCases(suite.id).find((item) => item.id === state.evaluationCaseId)
      : undefined;

  if (!evaluationCase) {
    evaluationCase = evaluationService.listCases(suite.id).find((item) => item.name === caseName);
  }

  if (!evaluationCase) {
    evaluationCase = evaluationService.createCase({
      suiteId: suite.id,
      name: caseName,
      taskInput: buildWorkflowBlueprint("evaluation-gate").rootTaskInput,
      replayMode: "full",
      expectedOutputContains: "结论",
      enabled: true,
    });
  }

  state.evaluationCaseId = evaluationCase.id;
  return { projectId, workflow, suite, evaluationCase };
}

function setNodeBindings(runId: string, nodeId: string, toolIds: string[]) {
  runService.replaceToolBindings(
    "node_instance",
    toolResolver.makeNodeScopeId(runId, nodeId),
    toolIds.map((toolId, index) => ({
      toolId,
      enabled: true,
      priority: 100 - index,
    })),
  );
}

function configureWorkflowLaunch(id: ShowcaseDemoScenarioId, runId: string) {
  const snapshot = runService.getRunSnapshot(runId);
  const byName = new Map(snapshot.nodes.map((node) => [node.name, node.id]));

  if (id === "durable-runtime") {
    const probeId = byName.get("Recovery Probe");
    const summarizerId = byName.get("Summarizer");
    if (probeId) {
      runService.updateNodeConfig(runId, probeId, {
        toolPolicy: "required",
        additionalPrompt:
          "你必须优先调用 tool_showcase_delay_report，并写出一份关于 checkpoint、resume、replay candidate 与 recovery policy 的中文说明。artifactName 使用 durable-runtime-recovery.md。",
        maxToolRounds: 4,
      });
      setNodeBindings(runId, probeId, ["tool_showcase_delay_report"]);
    }
    if (summarizerId) {
      runService.updateNodeConfig(runId, summarizerId, {
        additionalPrompt:
          "请用中文总结这次运行为什么体现了 durable runtime、显式 control plane 与恢复能力，突出 checkpoint、recent actions 和 replay candidate。",
      });
    }
    return;
  }

  if (id === "whitebox-trace") {
    const collectorId = byName.get("Collector");
    const analystId = byName.get("Analyst");
    if (collectorId) {
      runService.updateNodeConfig(runId, collectorId, {
        toolPolicy: "required",
        additionalPrompt:
          "你必须调用 tool_showcase_reference_bundle，并使用 bundleId=trace_dirty_data 获取 evidence bundle，然后把原始结构化证据传给下游。",
        maxToolRounds: 4,
      });
      setNodeBindings(runId, collectorId, ["tool_showcase_reference_bundle"]);
    }
    if (analystId) {
      runService.updateNodeConfig(runId, analystId, {
        additionalPrompt:
          "请明确指出异常字段来自 retrieval/tool evidence 污染，而不是模型幻觉；输出中必须出现 trace、artifact、根因 这几个关键词。",
      });
    }
    return;
  }

  if (id === "budget-guardrails") {
    tokenBudgetTracker.configure(runId, {
      runBudget: 80,
      nodeBudget: 40,
    });
    for (const node of snapshot.nodes) {
      if (node.role === "planner" || node.role === "worker" || node.role === "summarizer") {
        runService.updateNodeConfig(runId, node.id, {
          additionalPrompt:
            "请尽量详细地展开预算控制、熔断止损、fallback、reroute、terminate 和 replay 恢复路径，输出不要过于简短。",
        });
      }
    }
    return;
  }

  const collectorId = byName.get("Collector");
  if (collectorId) {
    runService.updateNodeConfig(runId, collectorId, {
      toolPolicy: "required",
      additionalPrompt:
        "你必须调用 tool_showcase_reference_bundle，并使用 bundleId=evaluation_baseline 获取稳定的评测基线数据。",
      maxToolRounds: 4,
    });
    setNodeBindings(runId, collectorId, ["tool_showcase_reference_bundle"]);
  }
}

function mapMetaStatus(status: "running" | "done" | "error") {
  if (status === "done") return "success";
  if (status === "error") return "failed";
  return "running";
}

function mapEvaluationStatus(status: string) {
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  return "running";
}

function refreshLatestLaunches() {
  for (const [scenarioId, state] of Object.entries(registry.scenarios) as Array<[ShowcaseDemoScenarioId, ScenarioAssetState]>) {
    const latest = state.latestLaunch;
    if (!latest) {
      continue;
    }

    if (latest.kind === "workflow_run") {
      const run = configService.listRuns(200).find((item) => item.id === latest.primaryId);
      if (!run) {
        state.latestLaunch = undefined;
        continue;
      }
      const projectId = run.projectId ?? registry.projectId;
      state.latestLaunch = {
        ...latest,
        status: run.status,
        startedAt: run.startedAt,
        primaryLink: makeLink("打开最新运行", projectId ? `/projects/${projectId}/runs/${run.id}` : "/runs"),
        secondaryLinks: [
          ...(run.workflowId && projectId ? [makeLink("打开工作流", `/projects/${projectId}/workflows/${run.workflowId}`)] : []),
          ...(projectId ? [makeLink("项目总览", `/projects/${projectId}`)] : []),
          makeLink("运行中心", "/runs"),
        ],
        summary: `最近一次真实工作流运行当前状态为 ${run.status}，可直接进入运行详情查看控制平面、trace 与 artifact。`,
      };
      continue;
    }

    if (latest.kind === "meta_agent_session") {
      const session = metaAgentService.getSession(latest.primaryId);
      if (!session) {
        state.latestLaunch = undefined;
        continue;
      }
      const projectId = session.projectId || registry.projectId;
      state.latestLaunch = {
        ...latest,
        status: mapMetaStatus(session.status),
        startedAt: session.startedAt,
        primaryLink: makeLink("打开最新会话", `/meta-agent?sessionId=${latest.primaryId}`),
        secondaryLinks: [
          ...(projectId ? [makeLink("项目总览", `/projects/${projectId}`)] : []),
          ...(projectId ? [makeLink("运行中心", `/runs?scope=meta_agent_run&projectId=${projectId}`)] : [makeLink("运行中心", "/runs?scope=meta_agent_run")]),
        ],
        summary: `最近一次 Meta-Agent 会话当前阶段为 ${session.currentPhase ?? "已结束"}，可直接查看 todo、wave、routing 与恢复信号。`,
      };
      continue;
    }

    try {
      const evaluationRun = evaluationService.getEvaluationRun(latest.primaryId);
      const projectId = registry.projectId;
      const workflowId = registry.scenarios["evaluation-gate"].workflowId;
      state.latestLaunch = {
        ...latest,
        status: mapEvaluationStatus(evaluationRun.status),
        startedAt: evaluationRun.createdAt,
        primaryLink: makeLink("打开评测中心", "/evaluations"),
        secondaryLinks: [
          ...(evaluationRun.baselineRunId && projectId ? [makeLink("基线运行", `/projects/${projectId}/runs/${evaluationRun.baselineRunId}`)] : []),
          ...(evaluationRun.replayRunId && projectId ? [makeLink("回放运行", `/projects/${projectId}/runs/${evaluationRun.replayRunId}`)] : []),
          ...(workflowId && projectId ? [makeLink("打开工作流", `/projects/${projectId}/workflows/${workflowId}`)] : []),
        ],
        summary: `最近一次评测运行当前状态为 ${evaluationRun.status}，可在评测中心查看 baseline、replay 与 compare report。`,
      };
    } catch {
      state.latestLaunch = undefined;
    }

    if (scenarioId === "evaluation-gate") {
      continue;
    }
  }
}

function buildScenarioStatus(id: ShowcaseDemoScenarioId): ShowcaseScenarioAssetStatus {
  const projectId = registry.projectId && configService.getProject(registry.projectId) ? registry.projectId : undefined;
  const state = registry.scenarios[id];
  const meta = scenarioCatalog[id];
  const project = projectId ? makeLink("打开项目", `/projects/${projectId}`) : undefined;
  const workflow =
    state.workflowId && projectId && configService.getProjectWorkflow(projectId, state.workflowId)
      ? makeLink("打开工作流", `/projects/${projectId}/workflows/${state.workflowId}`)
      : undefined;
  const evaluationSuite =
    state.evaluationSuiteId
      ? makeLink("打开评测中心", "/evaluations")
      : undefined;

  const ready =
    id === "adaptive-reflection" || id === "parallel-wave"
      ? Boolean(projectId)
      : id === "evaluation-gate"
        ? Boolean(projectId && workflow && evaluationSuite && state.evaluationCaseId)
        : Boolean(projectId && workflow);

  return {
    ...meta,
    title: scenarioTitle(id),
    ready,
    project,
    workflow,
    evaluationSuite,
    latestLaunch: state.latestLaunch,
  };
}

function buildStatus(): ShowcaseDemoStatusPayload {
  if (registry.projectId && !configService.getProject(registry.projectId)) {
    registry.projectId = undefined;
    for (const state of Object.values(registry.scenarios)) {
      state.workflowId = undefined;
      state.evaluationSuiteId = undefined;
      state.evaluationCaseId = undefined;
      state.latestLaunch = undefined;
    }
  }

  refreshLatestLaunches();

  try {
    const llm = assertWorkspaceLlm();
    return {
      llm: {
        ready: true,
        provider: llm.provider,
        model: llm.model,
        baseUrl: llm.baseUrl,
      },
      project: registry.projectId ? makeLink("打开展示项目", `/projects/${registry.projectId}`) : undefined,
      scenarios: INTERVIEW_SHOWCASE_SCENARIOS.map((item) => buildScenarioStatus(item.id as ShowcaseDemoScenarioId)),
    };
  } catch (error) {
    return {
      llm: {
        ready: false,
        error: error instanceof Error ? error.message : "工作区 LLM 未配置",
      },
      project: registry.projectId ? makeLink("打开展示项目", `/projects/${registry.projectId}`) : undefined,
      scenarios: INTERVIEW_SHOWCASE_SCENARIOS.map((item) => buildScenarioStatus(item.id as ShowcaseDemoScenarioId)),
    };
  }
}

async function launchWorkflowScenario(id: ShowcaseDemoScenarioId): Promise<ShowcaseLaunchResult> {
  assertWorkspaceLlm();
  ensureCustomTools();
  const projectId = ensureShowcaseProject();
  const workflow = ensureWorkflowScenario(id);
  const run = runService.createRun({
    task: workflow.rootTaskInput ?? buildWorkflowBlueprint(id).rootTaskInput,
    workflowId: workflow.id,
    workflowVersionId: workflow.currentVersionId,
    workflow: {
      nodes: workflow.nodes,
      edges: workflow.edges,
      tasks: workflow.tasks,
    },
  });

  configureWorkflowLaunch(id, run.runId);
  await runService.startRun(run.runId);

  registry.scenarios[id].latestLaunch = {
    kind: "workflow_run",
    status: "running",
    startedAt: nowIso(),
    primaryId: run.runId,
    primaryLink: makeLink("打开最新运行", `/projects/${projectId}/runs/${run.runId}`),
    secondaryLinks: [
      makeLink("打开工作流", `/projects/${projectId}/workflows/${workflow.id}`),
      makeLink("项目总览", `/projects/${projectId}`),
      makeLink("运行中心", "/runs"),
    ],
    summary: `${scenarioTitle(id)}已通过真实工作流运行链路启动，可直接查看运行详情中的控制平面、trace 与输出产物。`,
  };

  const scenario = buildScenarioStatus(id);
  return {
    scenario,
    latestLaunch: registry.scenarios[id].latestLaunch,
  };
}

async function launchMetaScenario(id: ShowcaseDemoScenarioId): Promise<ShowcaseLaunchResult> {
  assertWorkspaceLlm();
  const projectId = ensureShowcaseProject();
  const session = metaAgentService.start({
    projectId,
    goal:
      id === "adaptive-reflection"
        ? "为一个关于多智能体并行研究的任务生成执行方案；如果信息不足、候选冲突或连续失败，就自动重规划并改写 todo 图，最后给出新的执行路径。"
        : "请并行拆解并整理三个相互独立的研究子任务，分别产出结论后再统一汇总，重点展示 wave 选择、并行执行和回收收敛过程。",
    maxPlanningRounds: id === "adaptive-reflection" ? 4 : 3,
    maxStepLimit: id === "adaptive-reflection" ? 12 : 10,
    qualityThreshold: 0.72,
  });

  registry.scenarios[id].latestLaunch = {
    kind: "meta_agent_session",
    status: "running",
    startedAt: session.startedAt,
    primaryId: session.sessionId,
    primaryLink: makeLink("打开最新会话", `/meta-agent?sessionId=${session.sessionId}`),
    secondaryLinks: [
      makeLink("项目总览", `/projects/${projectId}`),
      makeLink("运行中心", `/runs?scope=meta_agent_run&projectId=${projectId}`),
    ],
    summary: `${scenarioTitle(id)}已通过真实 Meta-Agent orchestrator 启动，可直接观察 todo、wave、routing 与恢复信号。`,
  };

  const scenario = buildScenarioStatus(id);
  return {
    scenario,
    latestLaunch: registry.scenarios[id].latestLaunch,
  };
}

async function launchEvaluationScenario(): Promise<ShowcaseLaunchResult> {
  assertWorkspaceLlm();
  ensureCustomTools();
  const { projectId, workflow, evaluationCase } = ensureEvaluationScenario();
  const report = await evaluationService.executeCase(evaluationCase.id);

  registry.scenarios["evaluation-gate"].latestLaunch = {
    kind: "evaluation_run",
    status: "success",
    startedAt: report.createdAt,
    primaryId: report.evaluationRunId,
    primaryLink: makeLink("打开评测中心", "/evaluations"),
    secondaryLinks: [
      makeLink("基线运行", `/projects/${projectId}/runs/${report.baselineRunId}`),
      makeLink("回放运行", `/projects/${projectId}/runs/${report.replayRunId}`),
      makeLink("打开工作流", `/projects/${projectId}/workflows/${workflow.id}`),
    ],
    summary: "真实评测运行已完成，可直接在评测中心讲 baseline、replay、compare report 与门禁语义。",
  };

  const scenario = buildScenarioStatus("evaluation-gate");
  return {
    scenario,
    latestLaunch: registry.scenarios["evaluation-gate"].latestLaunch,
  };
}

export const showcaseDemoService = {
  getStatus() {
    return buildStatus();
  },

  provisionScenario(id: ShowcaseDemoScenarioId) {
    ensureCustomTools();
    ensureShowcaseProject();

    if (id === "durable-runtime" || id === "whitebox-trace" || id === "budget-guardrails") {
      ensureWorkflowScenario(id);
    } else if (id === "evaluation-gate") {
      ensureEvaluationScenario();
    }

    return buildStatus();
  },

  provisionAll() {
    ensureCustomTools();
    ensureShowcaseProject();
    ensureWorkflowScenario("durable-runtime");
    ensureWorkflowScenario("whitebox-trace");
    ensureWorkflowScenario("budget-guardrails");
    ensureEvaluationScenario();
    return buildStatus();
  },

  async launchScenario(id: ShowcaseDemoScenarioId): Promise<ShowcaseLaunchResult> {
    if (id === "durable-runtime" || id === "whitebox-trace" || id === "budget-guardrails") {
      return launchWorkflowScenario(id);
    }
    if (id === "adaptive-reflection" || id === "parallel-wave") {
      return launchMetaScenario(id);
    }
    return launchEvaluationScenario();
  },
};
