import { createHash } from "node:crypto";

import JSZip from "jszip";

import type { StoredWorkflowEdge, StoredWorkflowNode, StoredWorkflowTask } from "@/server/domain";
import { configService } from "@/server/config/config-service";

type RuntimeNodeRole =
  | "planner"
  | "worker"
  | "research"
  | "reviewer"
  | "summarizer"
  | "router"
  | "tool"
  | "input"
  | "output";

interface MutableSkillSections {
  roleName: string[];
  positioning: string[];
  responsibilities: string[];
  domain: string[];
  strengths: string[];
  inputType: string[];
  outputType: string[];
  collaboration: string[];
  scenarios: string[];
  constraints: string[];
}

export interface SkillPackUploadFile {
  name: string;
  bytes: Uint8Array;
}

export interface SkillPackSourceMarkdown {
  name: string;
  content: string;
}

export interface SkillPackRoleSummary {
  id: string;
  sourceFile: string;
  roleName: string;
  positioning: string;
  responsibilities: string[];
  domain: string[];
  strengths: string[];
  inputType: string[];
  outputType: string[];
  collaboration: string[];
  scenarios: string[];
  constraints: string[];
  warnings: string[];
}

export interface SkillPackDraftNode extends StoredWorkflowNode {
  rolePrompt?: string;
  sourceRoleId?: string;
}

export interface SkillPackWorkflowDraft {
  name: string;
  description?: string;
  rootTaskInput?: string;
  nodes: SkillPackDraftNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
}

export interface SkillPackPlanResult {
  planner: "llm" | "heuristic";
  warnings: string[];
  roleSummaries: SkillPackRoleSummary[];
  draft: SkillPackWorkflowDraft;
}

const ALLOWED_ROLE = new Set<RuntimeNodeRole>([
  "planner",
  "worker",
  "research",
  "reviewer",
  "summarizer",
  "router",
  "tool",
  "input",
  "output",
]);

const LIST_KEYS: Array<keyof MutableSkillSections> = [
  "responsibilities",
  "domain",
  "strengths",
  "inputType",
  "outputType",
  "collaboration",
  "scenarios",
  "constraints",
];

const FORBIDDEN_LINE_PATTERNS: RegExp[] = [
  /(^|\s)(script|bash|shell|python|javascript|powershell|cmd|npm|pnpm|yarn|node|curl)(\s|$)/i,
  /执行脚本|脚本路径|命令|调用脚本|工具实现|sourceconfig|authrequirements|api细节|api调用/i,
  /\b(import|require)\s*\(/i,
];

const ALLOWED_KEY_MAP: Array<{ pattern: RegExp; key: keyof MutableSkillSections }> = [
  { pattern: /^(角色|角色名称|role|role\s*name)$/i, key: "roleName" },
  { pattern: /^(角色定位|定位|positioning)$/i, key: "positioning" },
  { pattern: /^(职责|responsibilit(y|ies)|核心职责)$/i, key: "responsibilities" },
  { pattern: /^(专业领域|领域|domain)$/i, key: "domain" },
  { pattern: /^(擅长|擅长任务|strengths?)$/i, key: "strengths" },
  { pattern: /^(输入|输入类型|input|input\s*type)$/i, key: "inputType" },
  { pattern: /^(输出|输出类型|output|output\s*type)$/i, key: "outputType" },
  { pattern: /^(协作关系|协作对象|collaboration)$/i, key: "collaboration" },
  { pattern: /^(适用场景|使用场景|scenario|scenarios)$/i, key: "scenarios" },
  { pattern: /^(边界|限制|约束|constraints?)$/i, key: "constraints" },
];

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_MARKDOWN_FILES = 80;

function normalizeLine(raw: string) {
  return raw
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdownDangerousBlocks(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
    .replace(/`[^`\n]+`/g, " ");
}

function toSectionKey(rawKey: string): keyof MutableSkillSections | undefined {
  const key = normalizeLine(rawKey).replace(/[：:]/g, "").replace(/\s+/g, "");
  for (const item of ALLOWED_KEY_MAP) {
    if (item.pattern.test(key)) {
      return item.key;
    }
  }
  return undefined;
}

function pushUnique(target: string[], value: string) {
  const normalized = normalizeLine(value).replace(/^[-*]\s*/, "");
  if (!normalized) {
    return;
  }
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}

function pushByDelimiters(target: string[], value: string) {
  const segments = value
    .split(/[、,，；;|]/)
    .map((item) => normalizeLine(item))
    .filter(Boolean);
  if (segments.length <= 1) {
    pushUnique(target, value);
    return;
  }
  for (const segment of segments) {
    pushUnique(target, segment);
  }
}

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function toRoleId(sourceFile: string, roleName: string) {
  return `skill_${hashId(`${sourceFile}::${roleName}`)}`;
}

function inferRoleNameFromFile(fileName: string) {
  const pure = fileName.replace(/^.*[\\/]/, "").replace(/\.(md|markdown)$/i, "");
  const cleaned = pure.replace(/[_-]+/g, " ").trim();
  return cleaned || "未命名角色";
}

function parseMarkdownRoleSummary(file: SkillPackSourceMarkdown): SkillPackRoleSummary {
  const warnings: string[] = [];
  const sections: MutableSkillSections = {
    roleName: [],
    positioning: [],
    responsibilities: [],
    domain: [],
    strengths: [],
    inputType: [],
    outputType: [],
    collaboration: [],
    scenarios: [],
    constraints: [],
  };

  const cleaned = stripMarkdownDangerousBlocks(file.content);
  const lines = cleaned.split(/\r?\n/);
  let currentSection: keyof MutableSkillSections | undefined;
  let ignoredUnsafeLineCount = 0;
  let firstHeading = "";

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s*(.+)$/);
    if (headingMatch) {
      const heading = normalizeLine(headingMatch[1]).replace(/[：:]\s*$/, "");
      const mapped = toSectionKey(heading);
      currentSection = mapped;
      if (!mapped && !firstHeading) {
        firstHeading = heading;
      }
      continue;
    }

    if (FORBIDDEN_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      ignoredUnsafeLineCount += 1;
      continue;
    }

    const inlineKeyMatch = line.match(/^[-*]?\s*([^:：]{1,32})[:：]\s*(.+)$/);
    if (inlineKeyMatch) {
      const mapped = toSectionKey(inlineKeyMatch[1] ?? "");
      if (mapped) {
        const value = inlineKeyMatch[2] ?? "";
        if (LIST_KEYS.includes(mapped)) {
          pushByDelimiters(sections[mapped], value);
        } else {
          pushUnique(sections[mapped], value);
        }
      }
      continue;
    }

    if (!currentSection) {
      continue;
    }

    if (LIST_KEYS.includes(currentSection)) {
      pushByDelimiters(sections[currentSection], line);
      continue;
    }
    pushUnique(sections[currentSection], line);
  }

  const roleName = sections.roleName[0] || firstHeading || inferRoleNameFromFile(file.name);
  const positioning = sections.positioning[0] || "";
  const responsibilities = dedupeStringArray(sections.responsibilities);
  const domain = dedupeStringArray(sections.domain);
  const strengths = dedupeStringArray(sections.strengths);
  const inputType = dedupeStringArray(sections.inputType);
  const outputType = dedupeStringArray(sections.outputType);
  const collaboration = dedupeStringArray(sections.collaboration);
  const scenarios = dedupeStringArray(sections.scenarios);
  const constraints = dedupeStringArray(sections.constraints);

  if (ignoredUnsafeLineCount > 0) {
    warnings.push(`已忽略 ${ignoredUnsafeLineCount} 行不安全内容。`);
  }
  if (!positioning) {
    warnings.push("未检测到角色定位信息，已使用默认值。");
  }
  if (responsibilities.length === 0) {
    warnings.push("未检测到职责列表，已使用默认值。");
  }

  return {
    id: toRoleId(file.name, roleName),
    sourceFile: file.name,
    roleName,
    positioning: positioning || "通用执行角色，负责完成指定任务。",
    responsibilities:
      responsibilities.length > 0 ? responsibilities : ["完成指定任务", "输出执行结果", "及时反馈异常"],
    domain,
    strengths,
    inputType,
    outputType,
    collaboration,
    scenarios,
    constraints,
    warnings,
  };
}

function dedupeStringArray(items: string[]) {
  const values: string[] = [];
  for (const item of items) {
    const normalized = normalizeLine(item);
    if (!normalized) {
      continue;
    }
    if (!values.includes(normalized)) {
      values.push(normalized);
    }
  }
  return values.slice(0, 20);
}

function inferRuntimeRole(summary: SkillPackRoleSummary): RuntimeNodeRole {
  const haystack = [
    summary.roleName,
    summary.positioning,
    summary.responsibilities.join(" "),
    summary.domain.join(" "),
    summary.strengths.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (/planner|规划|计划|编排|规划代理/.test(haystack)) {
    return "planner";
  }
  if (/research|研究|调研|信息收集|数据采集/.test(haystack)) {
    return "research";
  }
  if (/review|审查|评审|校验|审核/.test(haystack)) {
    return "reviewer";
  }
  if (/summary|summar|总结|汇总|归纳/.test(haystack)) {
    return "summarizer";
  }
  if (/router|路由|分发|调度/.test(haystack)) {
    return "router";
  }
  if (/tool|工具|执行工具/.test(haystack)) {
    return "tool";
  }
  return "worker";
}

function buildRolePrompt(summary: SkillPackRoleSummary) {
  const lines = [
    `你是一个名为「${summary.roleName}」的角色。`,
    `角色定位：${summary.positioning}`,
    `核心职责：${summary.responsibilities.join("；") || "完成指定任务并输出执行结果。"}`,
  ];
  if (summary.inputType.length > 0) {
    lines.push(`输入类型：${summary.inputType.join("；")}`);
  }
  if (summary.outputType.length > 0) {
    lines.push(`输出类型：${summary.outputType.join("；")}`);
  }
  if (summary.collaboration.length > 0) {
    lines.push(`协作对象：${summary.collaboration.join("；")}`);
  }
  if (summary.constraints.length > 0) {
    lines.push(`约束条件：${summary.constraints.join("；")}`);
  }
  lines.push("请严格按照以上角色设定执行任务，确保输出质量和准确性。");
  return lines.join("\n");
}

function buildHeuristicDraft(
  summaries: SkillPackRoleSummary[],
  options?: { workflowName?: string; workflowDescription?: string },
): SkillPackWorkflowDraft {
  const sorted = [...summaries].sort((a, b) => {
    const weight = (role: RuntimeNodeRole) => {
      switch (role) {
        case "planner":
          return 1;
        case "research":
          return 2;
        case "worker":
          return 3;
        case "router":
          return 4;
        case "reviewer":
          return 5;
        case "summarizer":
          return 6;
        case "tool":
          return 7;
        default:
          return 8;
      }
    };
    return weight(inferRuntimeRole(a)) - weight(inferRuntimeRole(b));
  });

  const COL_STRIDE = 260; // 200px node width + 60px gap
  const ROW_STRIDE = 180; // 140px node height + 40px gap
  const PAD_X = 60;
  const PAD_Y = 60;

  const roleNodes: SkillPackDraftNode[] = sorted.map((item, index) => {
    const role = inferRuntimeRole(item);
    const rolePrompt = buildRolePrompt(item);
    return {
      id: `node_role_${index + 1}`,
      name: item.roleName,
      role,
      taskSummary: item.responsibilities[0] || "完成该角色的核心任务。",
      responsibilitySummary: item.positioning,
      rolePrompt,
      sourceRoleId: item.id,
      position: { x: PAD_X + (index + 1) * COL_STRIDE, y: PAD_Y },
    };
  });

  const inputNode: SkillPackDraftNode = {
    id: "node_input",
    name: "任务输入",
    role: "input",
    taskSummary: "接收用户输入的任务描述和上下文信息。",
    responsibilitySummary: "作为工作流的入口，接收并分发任务。",
    position: { x: PAD_X, y: PAD_Y },
  };

  const outputNode: SkillPackDraftNode = {
    id: "node_output",
    name: "结果输出",
    role: "output",
    taskSummary: "汇总并输出最终结果。",
    responsibilitySummary: "作为工作流的出口，整合各节点产出。",
    position: { x: PAD_X + (roleNodes.length + 1) * COL_STRIDE, y: PAD_Y },
  };

  const nodes = [inputNode, ...roleNodes, outputNode];
  const edges: StoredWorkflowEdge[] = [];

  const addEdge = (sourceNodeId: string, targetNodeId: string) => {
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
      return;
    }
    const key = `${sourceNodeId}->${targetNodeId}`;
    if (edges.some((item) => `${item.sourceNodeId}->${item.targetNodeId}` === key)) {
      return;
    }
    edges.push({
      id: `edge_${edges.length + 1}`,
      sourceNodeId,
      targetNodeId,
      type: "task_flow",
    });
  };

  if (roleNodes.length === 0) {
    addEdge(inputNode.id, outputNode.id);
  } else if (roleNodes.length >= 5) {
    // 有分支的拓扑：输入 -> 节点1 -> 节点2/节点3 -> 节点4 -> ... -> 输出
    const first = roleNodes[0];
    const branchA = roleNodes[1];
    const branchB = roleNodes[2];
    const mergeNode = roleNodes[3];

    first.position = { x: PAD_X + COL_STRIDE, y: PAD_Y };
    branchA.position = { x: PAD_X + 2 * COL_STRIDE, y: PAD_Y };
    branchB.position = { x: PAD_X + 2 * COL_STRIDE, y: PAD_Y + ROW_STRIDE };
    mergeNode.position = { x: PAD_X + 3 * COL_STRIDE, y: PAD_Y };

    addEdge(inputNode.id, first.id);
    addEdge(first.id, branchA.id);
    addEdge(first.id, branchB.id);
    addEdge(branchA.id, mergeNode.id);
    addEdge(branchB.id, mergeNode.id);

    for (let index = 4; index < roleNodes.length; index += 1) {
      const prev = roleNodes[index - 1];
      const next = roleNodes[index];
      next.position = { x: PAD_X + (index) * COL_STRIDE, y: PAD_Y };
      addEdge(prev.id, next.id);
    }

    const lastNode = roleNodes[roleNodes.length - 1];
    outputNode.position = {
      x: (lastNode.position?.x ?? PAD_X + 3 * COL_STRIDE) + COL_STRIDE,
      y: PAD_Y,
    };
    addEdge(lastNode.id, outputNode.id);
  } else {
    addEdge(inputNode.id, roleNodes[0].id);
    for (let index = 1; index < roleNodes.length; index += 1) {
      addEdge(roleNodes[index - 1].id, roleNodes[index].id);
    }
    addEdge(roleNodes[roleNodes.length - 1].id, outputNode.id);
  }

  const tasks: StoredWorkflowTask[] = [
    {
      id: "task_root",
      title: "按技能包角色规划执行任务",
      status: "ready",
      summary: "根任务",
    },
    ...roleNodes.map((node, index) => ({
      id: `task_role_${index + 1}`,
      title: `${node.name}执行`,
      status: "ready",
      parentTaskId: "task_root",
      assignedNodeId: node.id,
      summary: node.taskSummary,
    })),
    {
      id: "task_output",
      title: "汇总输出最终结果",
      status: "ready",
      parentTaskId: "task_root",
      assignedNodeId: outputNode.id,
      summary: outputNode.taskSummary,
    },
  ];

  const workflowName =
    options?.workflowName?.trim()
    || `Skill Pack 工作流-${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}`;

  const workflowDescription =
    options?.workflowDescription?.trim()
    || "基于 Skill/Role Markdown 文件自动生成的工作流。";

  return {
    name: workflowName,
    description: workflowDescription,
    rootTaskInput: "请描述需要完成的任务目标，各角色将协作完成。",
    nodes,
    edges,
    tasks,
  };
}

function normalizeRole(role: string | undefined): RuntimeNodeRole {
  const value = (role || "").trim().toLowerCase() as RuntimeNodeRole;
  if (ALLOWED_ROLE.has(value)) {
    return value;
  }
  return "worker";
}

function tryExtractJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("LLM 返回内容为空。");
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // 尝试提取 ```json ... ``` 代码块
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("LLM 返回内容无法解析为 JSON。");
  }
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? normalizeLine(item) : ""))
    .filter(Boolean);
}

function sanitizeLLMDraft(raw: Record<string, unknown>, fallback: SkillPackWorkflowDraft): SkillPackWorkflowDraft {
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (steps.length === 0) {
    return fallback;
  }

  const workflowName =
    (typeof raw.workflowName === "string" && raw.workflowName.trim())
    || fallback.name;
  const workflowDescription =
    (typeof raw.workflowDescription === "string" && raw.workflowDescription.trim())
    || fallback.description;
  const rootTaskInput =
    (typeof raw.rootTaskInput === "string" && raw.rootTaskInput.trim())
    || fallback.rootTaskInput;

  const LLM_COL = 260;
  const LLM_PAD_X = 60;
  const LLM_PAD_Y = 60;

  const nodes: SkillPackDraftNode[] = [
    {
      id: "node_input",
      name: "任务输入",
      role: "input",
      taskSummary: "接收用户输入的任务描述和上下文信息。",
      responsibilitySummary: "作为工作流的入口，接收并分发任务。",
      position: { x: LLM_PAD_X, y: LLM_PAD_Y },
    },
  ];

  type StepRef = {
    nodeId: string;
    upstreamRoleIds: string[];
  };
  const stepRefs: StepRef[] = [];
  const roleIdToNodeId = new Map<string, string>();

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] as Record<string, unknown>;
    const roleId = typeof step.roleId === "string" && step.roleId.trim() ? step.roleId.trim() : `step_${index + 1}`;
    const nodeId = `node_role_${index + 1}`;
    roleIdToNodeId.set(roleId, nodeId);
    nodes.push({
      id: nodeId,
      name:
        (typeof step.nodeName === "string" && step.nodeName.trim())
        || `执行节点${index + 1}`,
      role: normalizeRole(typeof step.runtimeRole === "string" ? step.runtimeRole : undefined),
      taskSummary:
        (typeof step.taskBrief === "string" && step.taskBrief.trim())
        || "完成该角色的核心任务。",
      responsibilitySummary:
        (typeof step.responsibility === "string" && step.responsibility.trim())
        || "按照角色定位完成任务并输出结果。",
      rolePrompt:
        (typeof step.prompt === "string" && step.prompt.trim())
        || undefined,
      sourceRoleId: roleId,
      position: { x: LLM_PAD_X + (index + 1) * LLM_COL, y: LLM_PAD_Y },
    });
    stepRefs.push({
      nodeId,
      upstreamRoleIds: toStringArray(step.upstreamRoleIds),
    });
  }

  const outputNode: SkillPackDraftNode = {
    id: "node_output",
    name: "结果输出",
    role: "output",
    taskSummary: "汇总并输出最终结果。",
    responsibilitySummary: "作为工作流的出口，整合各节点产出。",
    position: { x: LLM_PAD_X + (stepRefs.length + 1) * LLM_COL, y: LLM_PAD_Y },
  };
  nodes.push(outputNode);

  const edges: StoredWorkflowEdge[] = [];
  const addEdge = (sourceNodeId: string, targetNodeId: string) => {
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
    if (edges.some((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId)) return;
    edges.push({
      id: `edge_${edges.length + 1}`,
      sourceNodeId,
      targetNodeId,
      type: "task_flow",
    });
  };

  // 下面根据 LLM 返回的上游依赖关系来构建边，无上游时按顺序串联
  for (let index = 0; index < stepRefs.length; index += 1) {
    const current = stepRefs[index];
    const upstreamIds = current.upstreamRoleIds
      .map((roleId) => roleIdToNodeId.get(roleId))
      .filter((item): item is string => Boolean(item));

    if (upstreamIds.length === 0) {
      if (index === 0) {
        addEdge("node_input", current.nodeId);
      } else {
        addEdge(stepRefs[index - 1].nodeId, current.nodeId);
      }
      continue;
    }

    for (const sourceNodeId of upstreamIds) {
      addEdge(sourceNodeId, current.nodeId);
    }
  }

  if (stepRefs.length > 0) {
    const nonTerminal = new Set(edges.map((edge) => edge.sourceNodeId));
    const terminals = stepRefs
      .map((step) => step.nodeId)
      .filter((nodeId) => !nonTerminal.has(nodeId));
    if (terminals.length === 0) {
      addEdge(stepRefs[stepRefs.length - 1].nodeId, outputNode.id);
    } else {
      for (const nodeId of terminals) {
        addEdge(nodeId, outputNode.id);
      }
    }
  } else {
    addEdge("node_input", outputNode.id);
  }

  const tasks: StoredWorkflowTask[] = [
    {
      id: "task_root",
      title: "根据技能包生成的工作流总任务",
      status: "ready",
      summary: "总任务入口",
    },
    ...nodes
      .filter((node) => node.role !== "input")
      .map((node, index) => ({
        id: `task_from_llm_${index + 1}`,
        title: `${node.name}子任务`,
        status: "ready",
        parentTaskId: "task_root",
        assignedNodeId: node.id,
        summary: node.taskSummary,
      })),
  ];

  return {
    name: workflowName,
    description: workflowDescription,
    rootTaskInput,
    nodes,
    edges: edges.length > 0 ? edges : fallback.edges,
    tasks,
  };
}

async function planWithLLM(
  summaries: SkillPackRoleSummary[],
  fallback: SkillPackWorkflowDraft,
): Promise<SkillPackWorkflowDraft> {
  const workspace = configService.ensureWorkspaceConfig();
  const provider = (workspace.defaultProvider || "mock").trim().toLowerCase();
  const baseURL = (workspace.defaultBaseUrl || "").trim();
  const model = (workspace.defaultModel || "").trim();
  const apiKey = configService.resolveCredentialApiKey(workspace.defaultCredentialId);
  if (!baseURL || !model || !apiKey || provider === "mock") {
    throw new Error("未配置有效的大模型服务，请先在设置中配置提供商信息。");
  }

  const systemPrompt = [
    "你是 Workflow Planner。",
    "根据用户提供的角色摘要信息，生成一个合理的多代理工作流编排方案。",
    "直接输出纯 JSON，不要包裹 Markdown。",
    "JSON 格式如下：",
    "{",
    '  "workflowName": "string",',
    '  "workflowDescription": "string",',
    '  "rootTaskInput": "string",',
    '  "steps": [',
    "    {",
    '      "roleId": "string",',
    '      "nodeName": "string",',
    '      "runtimeRole": "planner|worker|research|reviewer|summarizer|router|tool",',
    '      "taskBrief": "string",',
    '      "responsibility": "string",',
    '      "prompt": "string",',
    '      "upstreamRoleIds": ["roleId"]',
    "    }",
    "  ]",
    "}",
    "请确保步骤之间的上下游依赖关系合理且无环。",
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      goal: "根据以下角色摘要生成多代理协作工作流",
      constraints: [
        "每个步骤必须对应一个角色",
        "上下游依赖关系必须合理且无环",
        "输出纯净的 JSON",
      ],
      roleSummaries: summaries.map((item) => ({
        id: item.id,
        roleName: item.roleName,
        positioning: item.positioning,
        responsibilities: item.responsibilities,
        domain: item.domain,
        strengths: item.strengths,
        inputType: item.inputType,
        outputType: item.outputType,
        collaboration: item.collaboration,
        scenarios: item.scenarios,
        constraints: item.constraints,
      })),
      fallback: {
        workflowName: fallback.name,
        workflowDescription: fallback.description,
      },
    },
    null,
    2,
  );

  const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: workspace.defaultTemperature ?? 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`LLM 请求失败（HTTP ${response.status}）。`);
  }

  const raw = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  const content = raw.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((item) => item.text || "").join("\n")
      : "";

  const parsed = tryExtractJson(text);
  return sanitizeLLMDraft(parsed, fallback);
}

export async function extractMarkdownFilesFromUploads(
  files: SkillPackUploadFile[],
): Promise<SkillPackSourceMarkdown[]> {
  if (files.length === 0) {
    throw new Error("未选择任何文件上传。");
  }

  const output: SkillPackSourceMarkdown[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`单个文件「${file.name}」超出大小限制 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 。`);
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
      throw new Error("所有文件累计大小超出限制，请减少上传文件数量。");
    }

    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file.bytes);
      const entries = Object.values(zip.files)
        .filter((item) => !item.dir)
        .filter((item) => /\.(md|markdown)$/i.test(item.name))
        .slice(0, MAX_MARKDOWN_FILES);

      for (const entry of entries) {
        const text = await entry.async("string");
        output.push({
          name: `${file.name}:${entry.name}`,
          content: text,
        });
      }
      continue;
    }

    if (/\.(md|markdown)$/i.test(lower)) {
      output.push({
        name: file.name,
        content: Buffer.from(file.bytes).toString("utf8"),
      });
    }
  }

  if (output.length === 0) {
    throw new Error("未找到有效的 markdown 文件，请上传 .md / .markdown / .zip 格式。");
  }

  if (output.length > MAX_MARKDOWN_FILES) {
    return output.slice(0, MAX_MARKDOWN_FILES);
  }

  return output;
}

export async function planWorkflowFromSkillPack(options: {
  markdownFiles: SkillPackSourceMarkdown[];
  workflowName?: string;
  workflowDescription?: string;
  preferLlm?: boolean;
}): Promise<SkillPackPlanResult> {
  const roleSummaries = options.markdownFiles.map(parseMarkdownRoleSummary);
  if (roleSummaries.length === 0) {
    throw new Error("未能从文件中解析出有效的角色摘要。");
  }

  const warnings = roleSummaries.flatMap((item) =>
    item.warnings.map((warning) => `【${item.sourceFile}】${warning}`),
  );

  const heuristicDraft = buildHeuristicDraft(roleSummaries, {
    workflowName: options.workflowName,
    workflowDescription: options.workflowDescription,
  });

  let draft = heuristicDraft;
  let planner: "llm" | "heuristic" = "heuristic";

  if (options.preferLlm !== false) {
    try {
      draft = await planWithLLM(roleSummaries, heuristicDraft);
      planner = "llm";
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "LLM 规划失败，已回退至启发式方案。");
    }
  }

  return {
    planner,
    warnings,
    roleSummaries,
    draft,
  };
}
