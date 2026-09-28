import { beforeEach, describe, expect, it, vi } from "vitest";

import { configService } from "@/server/config/config-service";
import { memoryStore } from "@/server/store/memory-store";
import { showcaseDemoService } from "@/server/showcase/showcase-demo-service";
import { installRuntimeTestLlm } from "./helpers/test-llm";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("showcase demo service", () => {
  beforeEach(() => {
    vi.useRealTimers();
    memoryStore.reset();
    configService.resetForTests();
    installRuntimeTestLlm();
  });

  it("provisions shared showcase assets with workflow and evaluation coverage", () => {
    const status = showcaseDemoService.provisionAll();

    expect(status.llm.ready).toBe(true);
    expect(status.project?.href).toContain("/projects/");
    expect(status.scenarios).toHaveLength(6);
    expect(status.scenarios.find((item) => item.id === "durable-runtime")?.ready).toBe(true);
    expect(status.scenarios.find((item) => item.id === "whitebox-trace")?.ready).toBe(true);
    expect(status.scenarios.find((item) => item.id === "budget-guardrails")?.ready).toBe(true);
    expect(status.scenarios.find((item) => item.id === "evaluation-gate")?.ready).toBe(true);
    expect(status.scenarios.find((item) => item.id === "parallel-wave")?.fitSummary.length).toBeGreaterThan(30);
    expect(status.scenarios.find((item) => item.id === "adaptive-reflection")?.liveSignals.length).toBeGreaterThanOrEqual(3);
  });

  it("launches a real workflow demo run through the main runtime chain", async () => {
    showcaseDemoService.provisionScenario("budget-guardrails");

    const launch = await showcaseDemoService.launchScenario("budget-guardrails");
    expect(launch.scenario.ready).toBe(true);

    await sleep(200);

    const refreshed = showcaseDemoService.getStatus();
    const scenario = refreshed.scenarios.find((item) => item.id === "budget-guardrails");
    expect(scenario?.latestLaunch?.primaryLink.href).toContain("/runs/");
    expect(["running", "success", "failed"]).toContain(String(scenario?.latestLaunch?.status));
  }, 10_000);
});
