/**
 * Reflection: self-evaluation and iterative improvement for agent outputs.
 *
 * Reflection uses a dedicated evaluator prompt and requires the evaluator
 * response to be valid JSON. Invalid or non-JSON responses are treated as
 * hard errors instead of being heuristically interpreted.
 */

export interface ReflectionConfig {
  enabled: boolean;
  maxRounds: number;
}

export interface ReflectionResult {
  satisfied: boolean;
  feedback?: string;
  confidence?: number;
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  enabled: false,
  maxRounds: 2,
};

export function buildReflectionPrompt(
  taskBrief: string,
  nodeResponsibility: string,
  output: string,
): string {
  return [
    "你是一个质量审查员。请评估以下 Agent 的执行结果是否充分完成了任务要求。",
    "",
    "## 任务要求",
    taskBrief || "未提供具体任务",
    "",
    "## Agent 职责",
    nodeResponsibility || "未指定",
    "",
    "## Agent 输出",
    output.slice(0, 4000),
    "",
    "## 请回答",
    "请严格按照以下 JSON 格式回答，不要包含其他内容：",
    '{"satisfied": true/false, "feedback": "如果不满足，请说明具体缺陷和改进方向", "confidence": 0.0-1.0}',
  ].join("\n");
}

export function parseReflectionResponse(text: string): ReflectionResult {
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error("Reflection response did not contain a JSON object.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    throw new Error(`Reflection response JSON parse failed: ${text.slice(0, 200)}`);
  }

  if (typeof parsed.satisfied !== "boolean") {
    throw new Error("Reflection response JSON must contain boolean field 'satisfied'.");
  }

  return {
    satisfied: parsed.satisfied,
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : undefined,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
  };
}

export function buildImprovementPrompt(
  originalInput: string,
  previousOutput: string,
  reflectionFeedback: string,
  round: number,
): string {
  return [
    originalInput,
    "",
    `## 改进要求 (第 ${round} 轮反思)`,
    "你之前的输出未能完全满足任务要求。请根据以下反馈进行改进：",
    "",
    "### 反馈",
    reflectionFeedback,
    "",
    "### 你之前的输出（参考）",
    previousOutput.slice(0, 2000),
    "",
    "请基于反馈重新完成任务，输出改进后的完整结果。",
  ].join("\n");
}
