import { callLLMWithUsage, type LLMTokenUsage } from "../llm-helper";
import type { MemoryState } from "../memory-state";
import { selectReviewMemories } from "../memory-state";
import { sanitizeJsonLikeText } from "../text-cleaner";
import type { TodoItem } from "../supervisor-runtime-state";
import type { TodoExecutionContext, TodoExecutorResult, TodoReviewResult } from "./types";

/* ------------------------------------------------------------------ */
/*  Word-frequency fallback (original heuristic)                      */
/* ------------------------------------------------------------------ */

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function criterionWords(criterion: string) {
  return normalizeText(criterion)
    .split(" ")
    .filter((word) => word.length >= 2);
}

function criterionSatisfiedHeuristic(criterion: string, content: string, evidence: string[]) {
  const normalized = normalizeText(content);
  const evidenceText = normalizeText(evidence.join(" "));
  const words = criterionWords(criterion);
  if (words.length === 0) return normalized.length > 0;

  const hitCount = words.filter((word) => normalized.includes(word) || evidenceText.includes(word)).length;
  return hitCount >= Math.max(1, Math.ceil(words.length * 0.5));
}

function criterionNeedsStricterReview(
  criterion: string,
  reviewMemories: ReturnType<typeof selectReviewMemories>,
) {
  return reviewMemories.some((memory) =>
    [...memory.frequent_missing_criteria, ...memory.weak_criteria_patterns].some(
      (pattern) =>
        pattern.length > 0 &&
        (criterion.toLowerCase().includes(pattern.toLowerCase()) ||
          pattern.toLowerCase().includes(criterion.toLowerCase())),
    ),
  );
}

function heuristicReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  memoryState?: MemoryState,
): TodoReviewResult {
  const outputText = [executorResult.summary ?? "", executorResult.output ?? ""].join("\n");
  const evidence = executorResult.criteria_evidence ?? [];
  const reviewMemories = memoryState ? selectReviewMemories(memoryState, todo, 2) : [];

  const missing = todo.acceptance_criteria.filter(
    (criterion) => {
      const satisfied = criterionSatisfiedHeuristic(criterion, outputText, evidence);
      if (!satisfied) return true;
      if (!criterionNeedsStricterReview(criterion, reviewMemories)) return false;
      const normalized = normalizeText(outputText);
      const criterionTokenCount = criterionWords(criterion).length;
      const strongerHitCount = criterionWords(criterion).filter((word) => normalized.includes(word)).length;
      return strongerHitCount < Math.max(2, Math.ceil(criterionTokenCount * 0.7));
    },
  );

  if (missing.length === 0) {
    return {
      status: "pass",
      reason: "All acceptance criteria are satisfied (heuristic).",
      missing_criteria: [],
    };
  }

  const missingRatio = missing.length / Math.max(1, todo.acceptance_criteria.length);
  const openQuestions = executorResult.open_questions ?? [];
  if (openQuestions.length >= 3 && missingRatio > 0.3) {
    return {
      status: "split",
      reason: "Execution raised multiple open questions; splitting todo is recommended.",
      missing_criteria: missing,
    };
  }
  if (missingRatio >= 0.6) {
    return {
      status: "fail",
      reason: "Most acceptance criteria are not satisfied (heuristic).",
      missing_criteria: missing,
    };
  }

  return {
    status: "revise",
    reason: "Partially satisfied; revision required (heuristic).",
    missing_criteria: missing,
  };
}

/* ------------------------------------------------------------------ */
/*  LLM-as-Judge review                                               */
/* ------------------------------------------------------------------ */

interface LLMCriterionJudgment {
  criterion: string;
  satisfied: boolean;
  confidence: number;
  reason: string;
}

interface LLMReviewJudgment {
  criteria_judgments: LLMCriterionJudgment[];
  overall_verdict: "pass" | "revise" | "split" | "fail";
  overall_reason: string;
  should_split: boolean;
  split_reason?: string;
}

function buildReviewPrompt(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  context: TodoExecutionContext,
  memoryState?: MemoryState,
): string {
  const criteria = todo.acceptance_criteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  const evidence = (executorResult.criteria_evidence ?? [])
    .map((e, i) => `  ${i + 1}. ${e}`)
    .join("\n");

  const openQuestions = (executorResult.open_questions ?? [])
    .map((q, i) => `  ${i + 1}. ${q}`)
    .join("\n");
  const memoryHints = (
    context.memory_hints?.review?.length
      ? context.memory_hints.review
      : memoryState
        ? selectReviewMemories(memoryState, todo, 2).map((memory) => ({
            reason: memory.reason,
            weak_criteria_patterns: memory.weak_criteria_patterns,
            frequent_missing_criteria: memory.frequent_missing_criteria,
          }))
        : []
  )
    .slice(0, 2)
    .map(
      (item, index) =>
        `  ${index + 1}. reason=${item.reason}; weak=${item.weak_criteria_patterns.join(" | ") || "none"}; missing=${item.frequent_missing_criteria.join(" | ") || "none"}`,
    )
    .join("\n");

  return [
    "You are a strict quality reviewer for a todo execution system.",
    "Judge whether the executor's output satisfies each acceptance criterion.",
    "",
    "## Todo",
    `Title: ${todo.title}`,
    `Description: ${todo.description}`,
    "",
    "## Acceptance Criteria",
    criteria,
    "",
    "## Executor Output",
    `Summary: ${executorResult.summary ?? "(none)"}`,
    `Full Output (truncated to 3000 chars):`,
    (executorResult.output ?? "").slice(0, 3000),
    "",
    evidence ? `## Criteria Evidence Provided by Executor\n${evidence}` : "",
    openQuestions ? `## Open Questions from Executor\n${openQuestions}` : "",
    memoryHints ? `## Project Review Memory Hints\n${memoryHints}` : "",
    "",
    "## Instructions",
    "For EACH acceptance criterion, judge whether it is satisfied by the output.",
    "Be strict but fair: the output must substantively address the criterion, not just mention keywords.",
    "Consider semantic meaning, not just word overlap.",
    "",
    "Then decide the overall verdict:",
    "- \"pass\": ALL criteria satisfied",
    "- \"revise\": some criteria missing but fixable with another attempt",
    "- \"split\": the todo is too broad and should be broken into subtasks",
    "- \"fail\": most criteria unsatisfied or output is fundamentally off-track",
    "",
    "Return ONLY valid JSON in this exact schema:",
    "{",
    "  \"criteria_judgments\": [",
    "    {",
    "      \"criterion\": \"the criterion text\",",
    "      \"satisfied\": true/false,",
    "      \"confidence\": 0.0-1.0,",
    "      \"reason\": \"brief explanation\"",
    "    }",
    "  ],",
    "  \"overall_verdict\": \"pass|revise|split|fail\",",
    "  \"overall_reason\": \"brief explanation of overall judgment\",",
    "  \"should_split\": false,",
    "  \"split_reason\": \"only if should_split is true\"",
    "}",
  ].join("\n");
}

function tryParseReviewJson(raw: string): LLMReviewJudgment | null {
  const clean = sanitizeJsonLikeText(raw);
  const candidates = [clean];
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(clean.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!Array.isArray(parsed.criteria_judgments)) continue;
      if (typeof parsed.overall_verdict !== "string") continue;

      const validVerdicts = ["pass", "revise", "split", "fail"] as const;
      const verdict = validVerdicts.includes(parsed.overall_verdict as typeof validVerdicts[number])
        ? (parsed.overall_verdict as LLMReviewJudgment["overall_verdict"])
        : null;
      if (!verdict) continue;

      const judgments: LLMCriterionJudgment[] = [];
      for (const item of parsed.criteria_judgments as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const j = item as Record<string, unknown>;
        judgments.push({
          criterion: typeof j.criterion === "string" ? j.criterion : "",
          satisfied: j.satisfied === true,
          confidence: typeof j.confidence === "number" && j.confidence >= 0 && j.confidence <= 1
            ? j.confidence
            : 0.5,
          reason: typeof j.reason === "string" ? j.reason : "",
        });
      }

      return {
        criteria_judgments: judgments,
        overall_verdict: verdict,
        overall_reason: typeof parsed.overall_reason === "string" ? parsed.overall_reason : "",
        should_split: parsed.should_split === true,
        split_reason: typeof parsed.split_reason === "string" ? parsed.split_reason : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function llmJudgmentToReviewResult(
  judgment: LLMReviewJudgment,
  todo: TodoItem,
  usage: LLMTokenUsage,
): TodoReviewResult {
  const missingCriteria = judgment.criteria_judgments
    .filter((j) => !j.satisfied)
    .map((j) => j.criterion || "unknown criterion");

  // Reconcile: if LLM says pass but has unsatisfied criteria, downgrade.
  // Use absolute count thresholds instead of ratio so single-criterion todos are
  // handled correctly: 1 missing out of 1 total must be "fail", not "revise".
  let status = judgment.overall_verdict;
  if (status === "pass" && missingCriteria.length > 0) {
    const totalCriteria = Math.max(1, todo.acceptance_criteria.length);
    const missingRatio = missingCriteria.length / totalCriteria;
    // Fail when all or nearly all criteria are missing, or when the single criterion failed.
    status = (missingCriteria.length >= totalCriteria || missingRatio >= 0.6) ? "fail" : "revise";
  }

  // If LLM says split, honor it
  if (judgment.should_split && status !== "pass") {
    status = "split";
  }

  const reason = judgment.overall_reason || `LLM review: ${status}`;

  return {
    status,
    reason,
    missing_criteria: status === "pass" ? [] : missingCriteria,
    review_token_usage: usage,
    llm_review_detail: {
      criteria_judgments: judgment.criteria_judgments.map((j) => ({
        criterion: j.criterion,
        satisfied: j.satisfied,
        confidence: j.confidence,
        reason: j.reason,
      })),
    },
  };
}

async function llmReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  context: TodoExecutionContext,
  memoryState?: MemoryState,
): Promise<TodoReviewResult> {
  const prompt = buildReviewPrompt(todo, executorResult, context, memoryState);

  const llmResult = await callLLMWithUsage([
    { role: "system", content: "You are a strict JSON-only quality reviewer. Return only valid JSON." },
    { role: "user", content: prompt },
  ]);

  const judgment = tryParseReviewJson(llmResult.content);
  if (!judgment) {
    throw new Error(`LLM review returned unparseable response: ${llmResult.content.slice(0, 200)}`);
  }

  return llmJudgmentToReviewResult(judgment, todo, llmResult.usage);
}

/* ------------------------------------------------------------------ */
/*  Public API: strict LLM review; heuristic only when explicitly forced */
/* ------------------------------------------------------------------ */

/**
 * Review executor output against acceptance criteria.
 *
 * Strategy: use LLM-as-Judge by default.
 * Heuristic review is only allowed when tests or diagnostics explicitly force it.
 *
 * `pass`: all criteria satisfied
 * `revise`: partially satisfied
 * `fail`: mostly unsatisfied or executor hard error
 * `split`: too broad, should be broken into subtasks
 */
export async function reviewTodoExecution(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  context: TodoExecutionContext,
  options?: { memoryState?: MemoryState; forceHeuristic?: boolean },
): Promise<TodoReviewResult> {
  // Fast path: force_split from executor
  if (executorResult.force_split) {
    return {
      status: "split",
      reason: executorResult.split_reason || "Todo should be split into smaller steps.",
      missing_criteria: [],
    };
  }

  // Fast path: executor error
  if (executorResult.status === "error") {
    return {
      status: "fail",
      reason: executorResult.error_message || "Executor returned error status.",
      missing_criteria: [...todo.acceptance_criteria],
    };
  }

  // No criteria to check → pass
  if (todo.acceptance_criteria.length === 0) {
    return {
      status: "pass",
      reason: "No acceptance criteria defined; auto-pass.",
      missing_criteria: [],
    };
  }

  const allowForcedHeuristic = options?.forceHeuristic && process.env.VITEST === "true";
  if (allowForcedHeuristic) {
    const fallback = heuristicReview(todo, executorResult, options?.memoryState);
    fallback.reason = `[forced heuristic review] ${fallback.reason}`;
    return fallback;
  }

  return llmReview(todo, executorResult, context, options?.memoryState);
}
