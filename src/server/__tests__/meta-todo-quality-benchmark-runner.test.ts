import { describe, expect, it } from "vitest";

import { runSupervisorQualityBenchmark } from "@/server/meta-agent/todo-driven/quality";

describe("supervisor quality benchmark - runner", () => {
  it("runs combined planner/routing/review/e2e benchmark with stable output schema", async () => {
    const result = await runSupervisorQualityBenchmark({
      planner: {
        case_ids: ["planner_research_report", "planner_invalid_then_repair"],
      },
      routing: {
        case_ids: ["routing_research_delegate", "routing_mixed_split"],
      },
      review: {
        case_ids: ["review_pass_complete", "review_revise_partial", "review_fail_executor_error"],
      },
      e2e: {
        case_ids: ["e2e_research_write_review"],
      },
    });

    expect(result.planner.total_cases).toBe(2);
    expect(result.routing.total_cases).toBe(2);
    expect(result.review.total_cases).toBe(3);
    expect(result.e2e.total_cases).toBe(1);
    expect(result.summary.total_cases).toBe(8);
    expect(result.summary.overall_score).toBeGreaterThanOrEqual(0);
    expect(result.summary.overall_score).toBeLessThanOrEqual(1);
  });
});
