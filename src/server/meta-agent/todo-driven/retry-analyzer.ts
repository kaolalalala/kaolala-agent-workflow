/**
 * Retry Analyzer: uses LLM to analyze failure reasons and generate
 * structured improvement directives before retrying a failed todo.
 */
import { callLLMWithUsage, type LLMTokenUsage } from "../llm-helper";
import { sanitizeJsonLikeText } from "../text-cleaner";
import type { TodoItem } from "../supervisor-runtime-state";

export interface RetryAnalysis {
  /** Root cause analysis of the failure */
  failure_diagnosis: string;
  /** Specific, actionable improvement instructions for the retry agent */
  improvement_directives: string[];
  /** Per-criterion guidance: what to fix for each unsatisfied criterion */
  criterion_fixes: Array<{
    criterion: string;
    what_went_wrong: string;
    how_to_fix: string;
  }>;
  /** Overall improvement directive as a single string for prompt injection */
  directive_text: string;
  /** Token usage for the analysis LLM call */
  token_usage?: LLMTokenUsage;
}

function buildAnalysisPrompt(todo: TodoItem): string {
  const judgments = (todo.last_review_judgments ?? [])
    .map((j, i) => [
      `  ${i + 1}. Criterion: "${j.criterion}"`,
      `     Satisfied: ${j.satisfied}`,
      `     Confidence: ${j.confidence}`,
      `     Reviewer reason: ${j.reason}`,
    ].join("\n"))
    .join("\n");

  const missingCriteria = (todo.last_missing_criteria ?? [])
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  return [
    "You are a failure analysis agent for a task retry system.",
    "Analyze why the previous execution failed and produce concrete improvement instructions.",
    "",
    "## Failed Todo",
    `Title: ${todo.title}`,
    `Description: ${todo.description}`,
    `Attempt: ${(todo.retry_count ?? 0) + 1}`,
    `Last failure reason: ${todo.last_failure_reason ?? "unknown"}`,
    "",
    "## Acceptance Criteria",
    todo.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n"),
    "",
    missingCriteria ? `## Missing/Unsatisfied Criteria\n${missingCriteria}` : "",
    "",
    judgments ? `## LLM Reviewer Per-Criterion Judgments\n${judgments}` : "",
    "",
    "## Instructions",
    "1. Diagnose the root cause: WHY did the agent fail to satisfy each criterion?",
    "2. For each unsatisfied criterion, specify WHAT went wrong and HOW to fix it.",
    "3. Produce 2-5 concrete, actionable improvement directives.",
    "4. Be specific — avoid vague advice like 'try harder' or 'be more thorough'.",
    "",
    "Return ONLY valid JSON:",
    "{",
    '  "failure_diagnosis": "brief root cause analysis",',
    '  "improvement_directives": ["specific action 1", "specific action 2"],',
    '  "criterion_fixes": [',
    "    {",
    '      "criterion": "the criterion text",',
    '      "what_went_wrong": "specific problem",',
    '      "how_to_fix": "specific solution"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

function tryParseAnalysis(raw: string): Omit<RetryAnalysis, "directive_text" | "token_usage"> | null {
  try {
    const clean = sanitizeJsonLikeText(raw);
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    const diagnosis = typeof parsed.failure_diagnosis === "string"
      ? parsed.failure_diagnosis : "";
    const directives = Array.isArray(parsed.improvement_directives)
      ? (parsed.improvement_directives as unknown[]).filter((d): d is string => typeof d === "string")
      : [];
    const fixes = Array.isArray(parsed.criterion_fixes)
      ? (parsed.criterion_fixes as unknown[])
          .filter((f): f is Record<string, unknown> => f !== null && typeof f === "object")
          .map((f) => ({
            criterion: typeof f.criterion === "string" ? f.criterion : "",
            what_went_wrong: typeof f.what_went_wrong === "string" ? f.what_went_wrong : "",
            how_to_fix: typeof f.how_to_fix === "string" ? f.how_to_fix : "",
          }))
      : [];

    if (!diagnosis && directives.length === 0 && fixes.length === 0) return null;

    return { failure_diagnosis: diagnosis, improvement_directives: directives, criterion_fixes: fixes };
  } catch {
    return null;
  }
}

function buildDirectiveText(analysis: Omit<RetryAnalysis, "directive_text" | "token_usage">): string {
  const lines: string[] = [];

  if (analysis.failure_diagnosis) {
    lines.push(`FAILURE DIAGNOSIS: ${analysis.failure_diagnosis}`);
  }

  if (analysis.improvement_directives.length > 0) {
    lines.push("");
    lines.push("IMPROVEMENT DIRECTIVES:");
    for (const directive of analysis.improvement_directives) {
      lines.push(`- ${directive}`);
    }
  }

  if (analysis.criterion_fixes.length > 0) {
    lines.push("");
    lines.push("PER-CRITERION FIXES:");
    for (const fix of analysis.criterion_fixes) {
      lines.push(`- [${fix.criterion}]`);
      lines.push(`  Problem: ${fix.what_went_wrong}`);
      lines.push(`  Fix: ${fix.how_to_fix}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build a heuristic improvement directive from available review data.
 * This is only used when there is not enough review evidence to run a meaningful LLM analysis.
 */
function buildHeuristicDirective(todo: TodoItem): string {
  const lines: string[] = [];

  if (todo.last_failure_reason) {
    lines.push(`PREVIOUS FAILURE: ${todo.last_failure_reason}`);
  }

  const judgments = todo.last_review_judgments ?? [];
  const failed = judgments.filter((j) => !j.satisfied);
  if (failed.length > 0) {
    lines.push("");
    lines.push("UNSATISFIED CRITERIA (from reviewer):");
    for (const j of failed) {
      lines.push(`- "${j.criterion}" — ${j.reason}`);
    }
  }

  const missing = todo.last_missing_criteria ?? [];
  if (missing.length > 0 && failed.length === 0) {
    lines.push("");
    lines.push("MISSING CRITERIA:");
    for (const c of missing) {
      lines.push(`- ${c}`);
    }
  }

  lines.push("");
  lines.push("You MUST address all listed issues in this retry attempt.");

  return lines.join("\n");
}

/**
 * Analyze a failed todo and generate improvement directives for retry.
 * Uses LLM for deep analysis. If the LLM call fails, the error is propagated.
 */
export async function analyzeFailureForRetry(todo: TodoItem): Promise<RetryAnalysis> {
  // If no review detail available, use heuristic only
  if (!todo.last_review_judgments?.length && !todo.last_missing_criteria?.length) {
    return {
      failure_diagnosis: todo.last_failure_reason ?? "Unknown failure",
      improvement_directives: ["Address the failure reason and ensure all acceptance criteria are met."],
      criterion_fixes: [],
      directive_text: buildHeuristicDirective(todo),
    };
  }

  const prompt = buildAnalysisPrompt(todo);
  const llmResult = await callLLMWithUsage([
    { role: "system", content: "You are a strict JSON-only failure analysis agent." },
    { role: "user", content: prompt },
  ]);

  const parsed = tryParseAnalysis(llmResult.content);
  if (!parsed) {
    throw new Error("Retry analysis returned an unparseable LLM response.");
  }

  return {
    ...parsed,
    directive_text: buildDirectiveText(parsed),
    token_usage: llmResult.usage,
  };
}
