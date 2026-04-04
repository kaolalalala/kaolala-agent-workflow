import { runE2EBenchmark } from "./e2e-quality";
import { runPlannerBenchmark } from "./planner-quality";
import { runReviewBenchmark } from "./review-quality";
import { runRoutingBenchmark } from "./routing-quality";
import { average, summarizeFailurePatterns } from "./shared";
import type {
  E2EBenchmarkOptions,
  PlannerBenchmarkOptions,
  QualityCaseResult,
  ReviewBenchmarkOptions,
  RoutingBenchmarkOptions,
  SupervisorQualityBenchmarkResult,
} from "./types";

export interface SupervisorQualityBenchmarkOptions {
  planner?: PlannerBenchmarkOptions;
  routing?: RoutingBenchmarkOptions;
  review?: ReviewBenchmarkOptions;
  e2e?: E2EBenchmarkOptions;
}

function collectAllCaseResults(suites: Array<{ per_case_results: QualityCaseResult[] }>) {
  const all: QualityCaseResult[] = [];
  for (const suite of suites) {
    all.push(...suite.per_case_results);
  }
  return all;
}

export async function runSupervisorQualityBenchmark(
  options: SupervisorQualityBenchmarkOptions = {},
): Promise<SupervisorQualityBenchmarkResult> {
  const [planner, routing, review, e2e] = await Promise.all([
    runPlannerBenchmark(options.planner),
    Promise.resolve(runRoutingBenchmark(options.routing)),
    Promise.resolve(runReviewBenchmark(options.review)),
    runE2EBenchmark(options.e2e),
  ]);

  const suiteScores = {
    planner: planner.aggregate_scores.overall ?? 0,
    routing: routing.aggregate_scores.overall ?? 0,
    review: review.aggregate_scores.overall ?? 0,
    e2e: e2e.aggregate_scores.overall ?? 0,
  };

  const allCaseResults = collectAllCaseResults([planner, routing, review, e2e]);
  const passed = allCaseResults.filter((item) => item.pass).length;

  return {
    planner,
    routing,
    review,
    e2e,
    summary: {
      total_cases: allCaseResults.length,
      passed_cases: passed,
      failed_cases: allCaseResults.length - passed,
      suite_scores: suiteScores,
      overall_score: average(Object.values(suiteScores)),
      major_failure_patterns: summarizeFailurePatterns(allCaseResults),
    },
  };
}
