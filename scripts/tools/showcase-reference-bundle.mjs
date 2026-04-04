function getInput() {
  try {
    return JSON.parse(process.env.TOOL_INPUT || "{}");
  } catch {
    return {};
  }
}

function bundleForId(bundleId) {
  if (bundleId === "evaluation_baseline") {
    return {
      bundleId,
      topic: "evaluation gate baseline",
      records: [
        { id: "eval-1", title: "Replay-first evaluation design", score: 0.91, verdict: "stable" },
        { id: "eval-2", title: "Trajectory diff regression checks", score: 0.88, verdict: "stable" },
        { id: "eval-3", title: "Artifact compare gate", score: 0.86, verdict: "watch" },
      ],
      notes: [
        "baseline suite covers replay, diff, and release gate",
        "candidate changes should be compared against deterministic structure",
      ],
    };
  }

  return {
    bundleId: "trace_dirty_data",
    topic: "white-box trace root cause demo",
    records: [
      { vendor: "Northstar AI", priceUsd: 49, source: "fresh_catalog", confidence: 0.94 },
      { vendor: "Acme Agents", priceUsd: 52, source: "fresh_catalog", confidence: 0.92 },
      { vendor: "Legacy Cache Vendor", priceUsd: 99999, source: "stale_cache_snapshot", confidence: 0.11 },
    ],
    anomaly: {
      field: "priceUsd",
      value: 99999,
      reason: "stale cached retrieval record should be treated as dirty evidence",
    },
    notes: [
      "use trace to prove the anomaly came from retrieval/tool output rather than model hallucination",
      "the stale cache record is intentionally included for root-cause walkthrough",
    ],
  };
}

function main() {
  const input = getInput();
  const bundleId = String(input.bundleId || "trace_dirty_data").trim();
  process.stdout.write(JSON.stringify(bundleForId(bundleId)));
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
}
