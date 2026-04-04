import { describe, expect, it } from "vitest";

import {
  evaluateRoutingQuality,
  routingBenchmarkCases,
  runRoutingBenchmark,
} from "@/server/meta-agent/todo-driven/quality";

describe("supervisor quality benchmark - routing", () => {
  it("runs routing benchmark and returns stable aggregate output", () => {
    const result = runRoutingBenchmark();
    expect(result.total_cases).toBeGreaterThanOrEqual(8);
    expect(result.per_case_results.length).toBe(result.total_cases);
    expect(result.aggregate_scores.overall).toBeGreaterThanOrEqual(0);
  });

  it("routes research todo to research_agent", () => {
    const benchmarkCase = routingBenchmarkCases.find((item) => item.id === "routing_research_delegate");
    if (!benchmarkCase) throw new Error("routing benchmark case not found");
    const result = evaluateRoutingQuality(benchmarkCase);
    expect(result.actual_mode).toBe("delegate");
    expect(result.actual_agent).toBe("research_agent");
    expect(result.pass).toBe(true);
  });

  it("routes mixed capability todo to split branch", () => {
    const benchmarkCase = routingBenchmarkCases.find((item) => item.id === "routing_mixed_split");
    if (!benchmarkCase) throw new Error("routing benchmark case not found");
    const result = evaluateRoutingQuality(benchmarkCase);
    expect(result.actual_mode).toBe("split");
    expect(result.pass).toBe(true);
  });
});
