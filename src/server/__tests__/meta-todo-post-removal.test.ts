import { afterEach, describe, expect, it, vi } from "vitest";

import { metaAgentService } from "@/server/meta-agent/meta-agent-service";
import { installRuntimeTestLlm } from "./helpers/test-llm";

describe("todo-driven post legacy removal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always runs todo-driven mainline after legacy removal", async () => {
    installRuntimeTestLlm();

    const result = await metaAgentService.run({
      goal: "post removal regression",
      maxPlanningRounds: 1,
      maxStepLimit: 4,
      qualityThreshold: 0.7,
    });

    expect(["success", "failed", "max_steps_reached", "max_iterations_reached"]).toContain(result.status);
    expect(result.steps.every((step) => step.phase === "todo")).toBe(true);
  });

  it("session execution log no longer emits legacy guard events", async () => {
    installRuntimeTestLlm();

    const { sessionId } = metaAgentService.start({
      goal: "session-no-legacy-guard",
      maxPlanningRounds: 1,
      maxStepLimit: 4,
      qualityThreshold: 0.7,
    });

    let session = metaAgentService.getSession(sessionId);
    for (let i = 0; i < 50; i++) {
      if (!session) break;
      if (session.status === "done" || session.status === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 40));
      session = metaAgentService.getSession(sessionId);
    }

    expect(session).toBeTruthy();
    if (!session?.supervisorRunState) {
      throw new Error("Expected supervisorRunState in session.");
    }

    const hasLegacyGuard = session.supervisorRunState.execution_log.some(
      (log) => log.action === "legacy_guard_triggered",
    );
    expect(hasLegacyGuard).toBe(false);
  });
});
