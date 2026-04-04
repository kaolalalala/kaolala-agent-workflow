import { addTodo, createRunState } from "../../supervisor-runtime-state";
import { buildTodoExecutionContext } from "../execution-context-builder";
import { reviewTodoExecution } from "../review";
import { aggregateDimensionScores, average, clamp01, pickCasesById, summarizeFailurePatterns } from "./shared";
import { reviewBenchmarkCases } from "./review-benchmark-cases";
import type {
  ReviewBenchmarkCase,
  ReviewBenchmarkOptions,
  ReviewBenchmarkResult,
  ReviewCaseResult,
} from "./types";

function setSimilarity(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  const intersection = Array.from(leftSet).filter((item) => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return clamp01(intersection / Math.max(1, union));
}

function evaluateReasonQuality(reason: string) {
  const length = reason.trim().length;
  if (length >= 30) return 1;
  if (length >= 16) return 0.7;
  if (length >= 8) return 0.4;
  return 0.1;
}

function evaluateFeedbackUsefulness(
  status: "pass" | "revise" | "split" | "fail",
  missingCriteria: string[],
  reason: string,
) {
  if (status === "pass") {
    return missingCriteria.length === 0 ? 1 : 0.3;
  }
  if (status === "split") {
    return reason.trim().length >= 12 ? 1 : 0.5;
  }
  return missingCriteria.length > 0 && reason.trim().length >= 8 ? 1 : 0.4;
}

export async function evaluateReviewQuality(benchmarkCase: ReviewBenchmarkCase): Promise<ReviewCaseResult> {
  const state = createRunState(`review_case:${benchmarkCase.id}`);
  const todo = addTodo(state, {
    id: `${benchmarkCase.id}_todo`,
    title: benchmarkCase.todo_title,
    description: benchmarkCase.todo_description,
    status: "ready",
    capability_type: "analysis",
    priority: "high",
    acceptance_criteria: benchmarkCase.acceptance_criteria,
    depends_on: [],
  });
  const context = buildTodoExecutionContext(state, todo);
  const review = await reviewTodoExecution(todo, benchmarkCase.execution_result_sample, context);

  const expectedMissing = benchmarkCase.expected_missing_criteria ?? (
    benchmarkCase.expected_review_status === "pass" ? [] : undefined
  );
  const missingAccuracy = expectedMissing
    ? setSimilarity(review.missing_criteria, expectedMissing)
    : review.status === "fail" || review.status === "revise" || review.status === "split"
      ? review.missing_criteria.length > 0 || review.status === "split" ? 1 : 0
      : 1;

  const perDimensionScores = {
    status_accuracy: review.status === benchmarkCase.expected_review_status ? 1 : 0,
    missing_criteria_accuracy: missingAccuracy,
    reason_quality: evaluateReasonQuality(review.reason),
    feedback_usefulness: evaluateFeedbackUsefulness(review.status, review.missing_criteria, review.reason),
  };
  const overall = clamp01(average(Object.values(perDimensionScores)));

  const issues: string[] = [];
  if (perDimensionScores.status_accuracy < 1) issues.push("review_status_mismatch");
  if (perDimensionScores.missing_criteria_accuracy < 0.6) issues.push("missing_criteria_mismatch");
  if (perDimensionScores.reason_quality < 0.6) issues.push("review_reason_weak");
  if (perDimensionScores.feedback_usefulness < 0.6) issues.push("review_feedback_weak");

  return {
    case_id: benchmarkCase.id,
    pass: perDimensionScores.status_accuracy === 1 && perDimensionScores.missing_criteria_accuracy >= 0.6,
    overall_score: overall,
    per_dimension_scores: perDimensionScores,
    issues,
    suggestions: [
      ...(perDimensionScores.status_accuracy < 1 ? ["校准 review 状态判定规则。"] : []),
      ...(perDimensionScores.missing_criteria_accuracy < 0.6 ? ["增强 missing_criteria 提取准确性。"] : []),
      ...(perDimensionScores.feedback_usefulness < 0.6 ? ["提升 review 反馈可执行性。"] : []),
    ],
    actual_status: review.status,
    actual_missing_criteria: review.missing_criteria,
    details: {
      expected_status: benchmarkCase.expected_review_status,
      reason: review.reason,
    },
  };
}

export async function runReviewBenchmark(options: ReviewBenchmarkOptions = {}): Promise<ReviewBenchmarkResult> {
  const selectedCases = pickCasesById(options.review_cases ?? reviewBenchmarkCases, options.case_ids);
  const results = await Promise.all(selectedCases.map((benchmarkCase) => evaluateReviewQuality(benchmarkCase)));
  const passed = results.filter((result) => result.pass).length;

  return {
    suite: "review",
    total_cases: results.length,
    passed_cases: passed,
    failed_cases: results.length - passed,
    aggregate_scores: aggregateDimensionScores(results),
    per_case_results: results,
    major_failure_patterns: summarizeFailurePatterns(results),
  };
}
