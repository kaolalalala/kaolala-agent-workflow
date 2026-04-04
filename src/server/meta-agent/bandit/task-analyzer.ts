/**
 * Task Analyzer: convert natural-language goals into structured TaskAnalysis
 * for the bandit planner. LLM output is mandatory; invalid responses fail fast.
 */
import { callLLM } from "../llm-helper";
import { analysisToFeatures } from "./strategy-bandit";
import type { FeatureVector, TaskAnalysis } from "./types";

const ANALYSIS_PROMPT = `Analyze the following goal and return JSON only.

Goal: "{goal}"

Output schema:
{
  "taskType": "research|creation|analysis|coding|translation|planning|other",
  "complexity": 1,
  "subtaskCount": 1,
  "parallelizable": false,
  "needsReview": false,
  "needsTools": false,
  "domains": ["domain"],
  "toolsNeeded": ["web_search"|"code_exec"|"file_io"|"api_call"]
}

Scoring guidance:
- complexity 1: trivial single-turn task
- complexity 2: simple focused task
- complexity 3: multi-step moderate task
- complexity 4: complex multi-aspect task
- complexity 5: highly complex task requiring deep decomposition`;

export async function analyzeTask(goal: string): Promise<{
  taskAnalysis: TaskAnalysis;
  features: FeatureVector;
  source: "llm";
}> {
  const response = await callLLM([
    {
      role: "system",
      content: "You are a task analysis assistant. Return JSON only.",
    },
    {
      role: "user",
      content: ANALYSIS_PROMPT.replace("{goal}", goal),
    },
  ]);

  const taskAnalysis = parseLLMAnalysis(response);
  return {
    taskAnalysis,
    features: analysisToFeatures(taskAnalysis),
    source: "llm",
  };
}

function parseLLMAnalysis(response: string): TaskAnalysis {
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(`Task analyzer returned unparseable LLM response: ${response.slice(0, 200)}`);
  }

  const validTypes = ["research", "creation", "analysis", "coding", "translation", "planning", "other"] as const;
  const taskType = validTypes.includes(parsed.taskType as typeof validTypes[number])
    ? parsed.taskType as TaskAnalysis["taskType"]
    : "other";

  return {
    taskType,
    complexity: Math.max(1, Math.min(5, Math.round(Number(parsed.complexity) || 3))),
    subtaskCount: Math.max(1, Math.min(10, Math.round(Number(parsed.subtaskCount) || 1))),
    parallelizable: parsed.parallelizable === true,
    needsReview: parsed.needsReview === true,
    needsTools: parsed.needsTools === true,
    domains: Array.isArray(parsed.domains)
      ? parsed.domains.filter((d): d is string => typeof d === "string")
      : [],
    toolsNeeded: Array.isArray(parsed.toolsNeeded)
      ? parsed.toolsNeeded.filter((t): t is string => typeof t === "string")
      : [],
  };
}
