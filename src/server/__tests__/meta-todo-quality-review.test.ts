import { describe, expect, it } from "vitest";

import {
  evaluateReviewQuality,
  reviewBenchmarkCases,
  runReviewBenchmark,
} from "@/server/meta-agent/todo-driven/quality";

describe("supervisor quality benchmark - review", () => {
  it("runs review benchmark and returns aggregate scores", async () => {
    const result = await runReviewBenchmark();
    expect(result.total_cases).toBeGreaterThanOrEqual(8);
    expect(result.per_case_results.length).toBe(result.total_cases);
    expect(result.aggregate_scores.overall).toBeGreaterThanOrEqual(0);
  });

  it("recognizes pass/revise/fail/split patterns", async () => {
    const passCase = reviewBenchmarkCases.find((item) => item.id === "review_pass_complete");
    const reviseCase = reviewBenchmarkCases.find((item) => item.id === "review_revise_partial");
    const failCase = reviewBenchmarkCases.find((item) => item.id === "review_fail_executor_error");
    const splitCase = reviewBenchmarkCases.find((item) => item.id === "review_split_force");
    if (!passCase || !reviseCase || !failCase || !splitCase) {
      throw new Error("review benchmark cases missing");
    }

    expect((await evaluateReviewQuality(passCase)).actual_status).toBe("pass");
    expect((await evaluateReviewQuality(reviseCase)).actual_status).toBe("revise");
    expect((await evaluateReviewQuality(failCase)).actual_status).toBe("fail");
    expect((await evaluateReviewQuality(splitCase)).actual_status).toBe("split");
  });
});
