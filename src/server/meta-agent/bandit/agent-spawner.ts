import { makeId } from "@/lib/utils";
import { toolService } from "@/server/tools/tool-service";
import { callLLM } from "../llm-helper";
import type { WorkflowBlueprint } from "../types";
import { getTemplate } from "./prompt-skeletons";
import type { BanditDecision, SpawnedAgent, StrategyTemplate, TaskAnalysis, TemplateSlot } from "./types";

interface VariableRequest {
  slotId: string;
  instanceIndex: number;
  variables: string[];
}

export async function spawnWorkflow(
  decision: BanditDecision,
  goal: string,
): Promise<{ blueprint: WorkflowBlueprint; agents: SpawnedAgent[] }> {
  const template = getTemplate(decision.templateId);
  if (!template) {
    throw new Error(`Strategy template '${decision.templateId}' not found`);
  }

  const replicaCounts = computeReplicaCounts(template, decision.taskAnalysis);
  const variableRequests = buildVariableRequests(template, replicaCounts);
  const filledVariables = await fillVariables(variableRequests, goal, decision.taskAnalysis);
  return buildBlueprint(template, replicaCounts, filledVariables, goal);
}

function computeReplicaCounts(
  template: StrategyTemplate,
  analysis: TaskAnalysis,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of template.slots) {
    if (slot.replicable) {
      counts.set(slot.slotId, Math.max(2, Math.min(5, analysis.subtaskCount)));
    } else {
      counts.set(slot.slotId, 1);
    }
  }
  return counts;
}

function buildVariableRequests(
  template: StrategyTemplate,
  replicaCounts: Map<string, number>,
): VariableRequest[] {
  const requests: VariableRequest[] = [];

  for (const slot of template.slots) {
    if (slot.variables.length === 0) continue;
    const count = replicaCounts.get(slot.slotId) ?? 1;
    for (let index = 0; index < count; index += 1) {
      requests.push({
        slotId: slot.slotId,
        instanceIndex: index,
        variables: slot.variables,
      });
    }
  }

  return requests;
}

async function fillVariables(
  requests: VariableRequest[],
  goal: string,
  analysis: TaskAnalysis,
): Promise<Map<string, Map<string, string>>> {
  const slotsDescription = requests
    .map((request) => {
      const label = request.instanceIndex > 0
        ? `${request.slotId}[${request.instanceIndex}]`
        : request.slotId;
      return `"${label}": { ${request.variables.map((variable) => `"${variable}": "..."`).join(", ")} }`;
    })
    .join(",\n    ");

  const prompt = [
    "You are a workflow variable filling agent.",
    "Given the user goal and a task analysis, fill all variable placeholders for a multi-agent workflow template.",
    "",
    `Goal: ${goal}`,
    "",
    "Task analysis:",
    `- taskType: ${analysis.taskType}`,
    `- complexity: ${analysis.complexity}/5`,
    `- subtaskCount: ${analysis.subtaskCount}`,
    `- parallelizable: ${analysis.parallelizable}`,
    `- domains: ${analysis.domains.join(", ") || "general"}`,
    "",
    "Return JSON only. The JSON must match this shape exactly:",
    "{",
    `    ${slotsDescription}`,
    "}",
    "",
    "Rules:",
    "- Fill every requested variable with specific, actionable text.",
    "- Parallel worker instances must cover different sub-areas instead of duplicating each other.",
    "- worker_name and expertise should reflect a distinct role identity.",
    "- task_description, subtask_description, and research_task must be directly executable.",
    "- output_format and final_format must be explicit deliverable formats.",
  ].join("\n");

  const response = await callLLM([
    { role: "system", content: "You are a strict JSON-only workflow variable filler." },
    { role: "user", content: prompt },
  ]);

  return parseFilledVariables(response, requests);
}

function parseFilledVariables(
  response: string,
  requests: VariableRequest[],
): Map<string, Map<string, string>> {
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  let parsed: Record<string, Record<string, unknown>>;
  try {
    parsed = JSON.parse(json) as Record<string, Record<string, unknown>>;
  } catch {
    throw new Error("Agent spawner returned invalid JSON for template variables.");
  }

  const result = new Map<string, Map<string, string>>();

  for (const request of requests) {
    const key = request.instanceIndex > 0
      ? `${request.slotId}[${request.instanceIndex}]`
      : request.slotId;
    const altKey = `${request.slotId}_${request.instanceIndex}`;
    const values = parsed[key] ?? parsed[altKey] ?? parsed[request.slotId];
    if (!values || typeof values !== "object") {
      throw new Error(`Agent spawner missing variable payload for slot '${key}'.`);
    }

    const variableMap = new Map<string, string>();
    for (const variable of request.variables) {
      const value = values[variable];
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Agent spawner missing variable '${variable}' for slot '${key}'.`);
      }
      variableMap.set(variable, value.trim());
    }

    result.set(`${request.slotId}:${request.instanceIndex}`, variableMap);
  }

  return result;
}

function buildBlueprint(
  template: StrategyTemplate,
  replicaCounts: Map<string, number>,
  filledVars: Map<string, Map<string, string>>,
  goal: string,
): { blueprint: WorkflowBlueprint; agents: SpawnedAgent[] } {
  const agents: SpawnedAgent[] = [];
  const nodeIdMap = new Map<string, string[]>();
  const enabledTools = toolService.listTools().filter((tool) => tool.enabled);

  for (const slot of template.slots) {
    const count = replicaCounts.get(slot.slotId) ?? 1;
    const nodeIds: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const nodeId = makeId("n");
      nodeIds.push(nodeId);

      const variableMap = filledVars.get(`${slot.slotId}:${index}`) ?? new Map<string, string>();
      const name = fillTemplate(slot.nameTemplate, variableMap) || slot.nameTemplate;
      const systemPrompt = slot.promptSkeleton
        ? fillTemplate(slot.promptSkeleton, variableMap)
        : "";
      const toolIds = resolveToolIds(slot, enabledTools);
      const taskSummary = variableMap.get("task_description")
        || variableMap.get("subtask_description")
        || variableMap.get("research_task")
        || slot.nameTemplate;

      agents.push({
        id: nodeId,
        slotId: slot.slotId,
        name,
        role: slot.role,
        systemPrompt,
        taskSummary,
        responsibilitySummary: slot.promptSkeleton ? name : "",
        toolIds,
      });
    }

    nodeIdMap.set(slot.slotId, nodeIds);
  }

  const edges: WorkflowBlueprint["edges"] = [];

  for (const pattern of template.edgePattern) {
    const fromIds = nodeIdMap.get(pattern.fromSlot) ?? [];
    const toIds = nodeIdMap.get(pattern.toSlot) ?? [];
    if (fromIds.length === 0 || toIds.length === 0) continue;

    if (fromIds.length === 1 && toIds.length > 1) {
      for (const toId of toIds) {
        edges.push({ id: makeId("e"), sourceNodeId: fromIds[0], targetNodeId: toId, type: pattern.type });
      }
      continue;
    }

    if (fromIds.length > 1 && toIds.length === 1) {
      for (const fromId of fromIds) {
        edges.push({ id: makeId("e"), sourceNodeId: fromId, targetNodeId: toIds[0], type: pattern.type });
      }
      continue;
    }

    if (fromIds.length === 1 && toIds.length === 1) {
      edges.push({ id: makeId("e"), sourceNodeId: fromIds[0], targetNodeId: toIds[0], type: pattern.type });
      continue;
    }

    const maxLength = Math.max(fromIds.length, toIds.length);
    for (let index = 0; index < maxLength; index += 1) {
      const fromId = fromIds[Math.min(index, fromIds.length - 1)];
      const toId = toIds[Math.min(index, toIds.length - 1)];
      edges.push({ id: makeId("e"), sourceNodeId: fromId, targetNodeId: toId, type: pattern.type });
    }
  }

  return {
    blueprint: {
      nodes: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        taskSummary: agent.taskSummary,
        responsibilitySummary: agent.responsibilitySummary,
        systemPrompt: agent.systemPrompt || undefined,
        toolIds: agent.toolIds.length > 0 ? agent.toolIds : undefined,
      })),
      edges,
      rootTask: goal,
    },
    agents,
  };
}

function fillTemplate(template: string, variables: Map<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => variables.get(key) ?? `{${key}}`);
}

function resolveToolIds(
  slot: TemplateSlot,
  enabledTools: Array<{ toolId: string; category: string }>,
): string[] {
  if (!slot.preferredToolCategories || slot.preferredToolCategories.length === 0) {
    return [];
  }

  const categories = new Set(slot.preferredToolCategories);
  return enabledTools
    .filter((tool) => categories.has(tool.category))
    .map((tool) => tool.toolId);
}
