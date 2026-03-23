/**
 * Reflection — self-evaluation and iterative improvement for agent outputs.
 *
 * After an agent node produces output, an optional reflection step evaluates
 * whether the output satisfies the task requirements. If not, the agent is
 * re-executed with improvement guidance, up to N rounds.
 *
 * Reflection uses the same LLM adapter but with a dedicated evaluator prompt.
 * It runs as a lightweight, non-streaming call.
 */

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface ReflectionConfig {
  enabled: boolean;
  maxRounds: number;
}

export interface ReflectionResult {
  satisfied: boolean;
  feedback?: string;
  confidence?: number;
}

// ──────────────────────────────────────────────────────────
// Default config
// ──────────────────────────────────────────────────────────

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  enabled: false,
  maxRounds: 2,
};

// ──────────────────────────────────────────────────────────
// Reflection prompt
// ──────────────────────────────────────────────────────────

export function buildReflectionPrompt(
  taskBrief: string,
  nodeResponsibility: string,
  output: string,
): string {
  return [
    "你是一个质量审核员。请评估以下 Agent 的执行结果是否充分完成了任务要求。",
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
    '{"satisfied": true/false, "feedback": "如果不满足，说明具体缺陷和改进方向", "confidence": 0.0-1.0}',
  ].join("\n");
}

// ──────────────────────────────────────────────────────────
// Parse reflection response
// ──────────────────────────────────────────────────────────

export function parseReflectionResponse(text: string): ReflectionResult {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        satisfied: Boolean(parsed.satisfied),
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : undefined,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      };
    } catch {
      // Fall through to heuristic
    }
  }

  // Heuristic fallback: look for positive/negative signals
  const lower = text.toLowerCase();
  if (/satisfied.*true|通过|满足|完成|adequate|sufficient/.test(lower)) {
    return { satisfied: true };
  }
  return { satisfied: false, feedback: text.slice(0, 500) };
}

// ──────────────────────────────────────────────────────────
// Build improvement prompt (for re-execution after failed reflection)
// ──────────────────────────────────────────────────────────

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
