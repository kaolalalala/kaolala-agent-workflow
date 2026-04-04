/**
 * Strict LLM-based quality evaluator for workflow and agent outputs.
 *
 * This module does not use heuristic scoring fallbacks. If the LLM call fails
 * or returns invalid JSON, the error is propagated to the caller.
 */
import { callLLM } from "../llm-helper";
import type {
  AgentOutputEvaluation,
  NodeQualityScore,
  WorkflowEvaluation,
} from "../types";

interface NodeOutput {
  nodeId: string;
  nodeName: string;
  nodeRole: string;
  output: string;
}

interface RoleCriteria {
  roleName: string;
  dimensions: Array<{ name: string; description: string; weight: number }>;
}

export async function evaluateWorkflow(
  goal: string,
  nodeOutputs: NodeOutput[],
  traceSummary: { totalNodes: number; successfulNodes: number; failedNodes: number; durationMs: number },
): Promise<WorkflowEvaluation> {
  const evaluableNodes = nodeOutputs.filter(
    (node) => node.nodeRole !== "input" && node.output && node.output.trim().length > 0,
  );

  if (evaluableNodes.length === 0) {
    return {
      nodeScores: [],
      aggregateScore: 0.1,
      overallFeedback: "No evaluable node outputs found.",
      topologyScore: 0.1,
      collaborationScore: 0.1,
    };
  }

  const response = await callLLM([
    {
      role: "system",
      content: "You are a strict workflow quality judge. Return valid JSON only.",
    },
    {
      role: "user",
      content: buildWorkflowEvalPrompt(goal, evaluableNodes, traceSummary),
    },
  ]);

  return parseWorkflowEvaluation(response, evaluableNodes);
}

export async function evaluateAgentOutput(
  nodeRole: string,
  systemPrompt: string,
  userPrompt: string,
  completion: string,
  goal: string,
): Promise<AgentOutputEvaluation> {
  const criteria = getRoleCriteria(nodeRole);
  const response = await callLLM([
    {
      role: "system",
      content: "You are a strict agent output quality judge. Return valid JSON only.",
    },
    {
      role: "user",
      content: buildAgentEvalPrompt(nodeRole, criteria, systemPrompt, userPrompt, completion, goal),
    },
  ]);

  return parseAgentEvaluation(response, criteria);
}

export async function batchEvaluateAgentSamples(
  samples: Array<{
    id: string;
    nodeRole: string;
    systemPrompt: string;
    userPrompt: string;
    completion: string;
    goal: string;
  }>,
): Promise<Map<string, AgentOutputEvaluation>> {
  const results = new Map<string, AgentOutputEvaluation>();

  for (const sample of samples) {
    const evaluation = await evaluateAgentOutput(
      sample.nodeRole,
      sample.systemPrompt,
      sample.userPrompt,
      sample.completion,
      sample.goal,
    );
    results.set(sample.id, evaluation);
  }

  return results;
}

function buildWorkflowEvalPrompt(
  goal: string,
  nodes: NodeOutput[],
  traceSummary: { totalNodes: number; successfulNodes: number; failedNodes: number; durationMs: number },
) {
  const nodeList = nodes.map((node, index) => {
    const output = node.output.length > 1500 ? `${node.output.slice(0, 1500)}...` : node.output;
    return [
      `[Node ${index + 1}] ${node.nodeName} (${node.nodeRole})`,
      `nodeId=${node.nodeId}`,
      "Output:",
      output,
    ].join("\n");
  }).join("\n\n---\n\n");

  return [
    "Evaluate the quality of this workflow execution.",
    `Goal: ${goal}`,
    `Total nodes: ${traceSummary.totalNodes}`,
    `Successful nodes: ${traceSummary.successfulNodes}`,
    `Failed nodes: ${traceSummary.failedNodes}`,
    `Duration ms: ${traceSummary.durationMs}`,
    "",
    nodeList,
    "",
    "Return JSON only:",
    "{",
    '  "nodeScores": [',
    "    {",
    '      "nodeId": "node id",',
    '      "nodeName": "node name",',
    '      "nodeRole": "role",',
    '      "relevance": 0.0,',
    '      "completeness": 0.0,',
    '      "accuracy": 0.0,',
    '      "coherence": 0.0,',
    '      "overallScore": 0.0,',
    '      "feedback": "brief feedback"',
    "    }",
    "  ],",
    '  "aggregateScore": 0.0,',
    '  "overallFeedback": "summary",',
    '  "topologyScore": 0.0,',
    '  "collaborationScore": 0.0',
    "}",
  ].join("\n");
}

function parseWorkflowEvaluation(response: string, nodes: NodeOutput[]): WorkflowEvaluation {
  const parsed = parseJsonObject(response, "Workflow quality evaluator");
  const rawNodeScores = Array.isArray(parsed.nodeScores) ? parsed.nodeScores : [];

  const nodeScores: NodeQualityScore[] = rawNodeScores.map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      nodeId: typeof row.nodeId === "string" && row.nodeId ? row.nodeId : nodes[index]?.nodeId || `node_${index}`,
      nodeName: typeof row.nodeName === "string" ? row.nodeName : nodes[index]?.nodeName || "",
      nodeRole: typeof row.nodeRole === "string" ? row.nodeRole : nodes[index]?.nodeRole || "",
      relevance: clamp01(row.relevance),
      completeness: clamp01(row.completeness),
      accuracy: clamp01(row.accuracy),
      coherence: clamp01(row.coherence),
      overallScore: clamp01(row.overallScore),
      feedback: typeof row.feedback === "string" ? row.feedback : "",
    };
  });

  return {
    nodeScores,
    aggregateScore: clamp01(parsed.aggregateScore),
    overallFeedback: typeof parsed.overallFeedback === "string" ? parsed.overallFeedback : "",
    topologyScore: clamp01(parsed.topologyScore),
    collaborationScore: clamp01(parsed.collaborationScore),
  };
}

function getRoleCriteria(role: string): RoleCriteria {
  switch (role) {
    case "research":
      return {
        roleName: "research",
        dimensions: [
          { name: "depth", description: "Depth of analysis", weight: 0.3 },
          { name: "coverage", description: "Coverage of important points", weight: 0.3 },
          { name: "sourcing", description: "Quality of evidence/support", weight: 0.2 },
          { name: "clarity", description: "Clarity of presentation", weight: 0.2 },
        ],
      };
    case "reviewer":
      return {
        roleName: "reviewer",
        dimensions: [
          { name: "thoroughness", description: "How complete the review is", weight: 0.35 },
          { name: "actionability", description: "How actionable the feedback is", weight: 0.3 },
          { name: "accuracy", description: "Accuracy of the review", weight: 0.25 },
          { name: "constructiveness", description: "Constructiveness of the review", weight: 0.1 },
        ],
      };
    case "planner":
      return {
        roleName: "planner",
        dimensions: [
          { name: "decomposition", description: "Quality of task decomposition", weight: 0.35 },
          { name: "completeness", description: "Coverage of important steps", weight: 0.3 },
          { name: "feasibility", description: "Feasibility of the plan", weight: 0.2 },
          { name: "clarity", description: "Clarity of the plan", weight: 0.15 },
        ],
      };
    case "summarizer":
    case "output":
      return {
        roleName: "summarizer",
        dimensions: [
          { name: "faithfulness", description: "Faithfulness to inputs", weight: 0.35 },
          { name: "completeness", description: "Coverage of key information", weight: 0.3 },
          { name: "conciseness", description: "Avoids unnecessary repetition", weight: 0.2 },
          { name: "readability", description: "Readable structure", weight: 0.15 },
        ],
      };
    default:
      return {
        roleName: role || "agent",
        dimensions: [
          { name: "relevance", description: "Relevance to task", weight: 0.3 },
          { name: "correctness", description: "Correctness", weight: 0.3 },
          { name: "completeness", description: "Completeness", weight: 0.25 },
          { name: "clarity", description: "Clarity", weight: 0.15 },
        ],
      };
  }
}

function buildAgentEvalPrompt(
  nodeRole: string,
  criteria: RoleCriteria,
  systemPrompt: string,
  userPrompt: string,
  completion: string,
  goal: string,
) {
  const truncatedCompletion = completion.length > 2000 ? `${completion.slice(0, 2000)}...` : completion;
  const truncatedUser = userPrompt.length > 1000 ? `${userPrompt.slice(0, 1000)}...` : userPrompt;
  const truncatedSystem = systemPrompt.length > 500 ? `${systemPrompt.slice(0, 500)}...` : systemPrompt;
  const dimensions = criteria.dimensions
    .map((dimension) => `- ${dimension.name}: ${dimension.description} (weight=${dimension.weight})`)
    .join("\n");

  return [
    `Evaluate this ${criteria.roleName} output.`,
    `Node role: ${nodeRole}`,
    `Goal: ${goal}`,
    "",
    "System prompt:",
    truncatedSystem,
    "",
    "User prompt:",
    truncatedUser,
    "",
    "Completion:",
    truncatedCompletion,
    "",
    "Dimensions:",
    dimensions,
    "",
    "Return JSON only:",
    "{",
    '  "dimensions": { "dimension_name": 0.0 },',
    '  "score": 0.0,',
    '  "rationale": "brief rationale"',
    "}",
  ].join("\n");
}

function parseAgentEvaluation(response: string, criteria: RoleCriteria): AgentOutputEvaluation {
  const parsed = parseJsonObject(response, "Agent quality evaluator");
  const parsedDimensions =
    parsed.dimensions && typeof parsed.dimensions === "object"
      ? parsed.dimensions as Record<string, unknown>
      : {};

  const dimensions: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const dimension of criteria.dimensions) {
    const value = clamp01(parsedDimensions[dimension.name]);
    dimensions[dimension.name] = value;
    weightedSum += value * dimension.weight;
    totalWeight += dimension.weight;
  }

  const computedScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  const llmScore = clamp01(parsed.score);
  const score = Math.abs(llmScore - computedScore) < 0.3 ? llmScore : computedScore;

  return {
    score,
    dimensions,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
  };
}

function parseJsonObject(response: string, label: string): Record<string, unknown> {
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} returned a non-object JSON payload.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `${label} returned unparseable LLM response: ${
        error instanceof Error ? error.message : response.slice(0, 200)
      }`,
    );
  }
}

function clamp01(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}
