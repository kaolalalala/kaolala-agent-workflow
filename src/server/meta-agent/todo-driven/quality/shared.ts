import type { QualityCaseResult } from "./types";

export function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateDimensionScores(results: QualityCaseResult[]) {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const result of results) {
    for (const [dimension, score] of Object.entries(result.per_dimension_scores)) {
      sums.set(dimension, (sums.get(dimension) ?? 0) + score);
      counts.set(dimension, (counts.get(dimension) ?? 0) + 1);
    }
  }

  const aggregate: Record<string, number> = {};
  for (const [dimension, total] of sums.entries()) {
    const count = counts.get(dimension) ?? 1;
    aggregate[dimension] = clamp01(total / count);
  }

  aggregate.overall = clamp01(average(results.map((result) => result.overall_score)));
  return aggregate;
}

export function summarizeFailurePatterns(results: QualityCaseResult[]) {
  const counter = new Map<string, number>();
  for (const result of results) {
    for (const issue of result.issues) {
      counter.set(issue, (counter.get(issue) ?? 0) + 1);
    }
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([issue, count]) => `${issue} (${count})`);
}

export function pickCasesById<T extends { id: string }>(cases: T[], caseIds?: string[]) {
  if (!caseIds || caseIds.length === 0) return cases;
  const idSet = new Set(caseIds);
  return cases.filter((item) => idSet.has(item.id));
}
