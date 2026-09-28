import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../../app/api/showcases/demos/route";
import { configService } from "@/server/config/config-service";
import { memoryStore } from "@/server/store/memory-store";
import { installRuntimeTestLlm } from "./helpers/test-llm";

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("showcase demo API", () => {
  beforeEach(() => {
    vi.useRealTimers();
    memoryStore.reset();
    configService.resetForTests();
    installRuntimeTestLlm();
  });

  it("returns status and supports provisioning/launch for real demo assets", async () => {
    const initial = await GET();
    expect(initial.status).toBe(200);
    const initialPayload = await readJson(initial) as {
      llm: { ready: boolean };
      scenarios: Array<{ id: string; fitSummary?: string; liveSignals?: string[] }>;
    };
    expect(initialPayload.llm.ready).toBe(true);
    expect(initialPayload.scenarios).toHaveLength(6);
    expect(initialPayload.scenarios.find((item) => item.id === "durable-runtime")?.fitSummary).toContain("真实");
    expect(initialPayload.scenarios.find((item) => item.id === "budget-guardrails")?.liveSignals?.length).toBeGreaterThanOrEqual(3);

    const provisionResponse = await POST(
      new Request("http://localhost/api/showcases/demos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provision_scenario", scenarioId: "durable-runtime" }),
      }),
    );
    expect(provisionResponse.status).toBe(200);
    const provisionPayload = await readJson(provisionResponse) as {
      ok: boolean;
      scenarioId: string;
      status: { scenarios: Array<{ id: string; ready: boolean }> };
    };
    expect(provisionPayload.ok).toBe(true);
    expect(provisionPayload.scenarioId).toBe("durable-runtime");
    expect(provisionPayload.status.scenarios.find((item) => item.id === "durable-runtime")?.ready).toBe(true);

    const launchResponse = await POST(
      new Request("http://localhost/api/showcases/demos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "launch", scenarioId: "budget-guardrails" }),
      }),
    );
    expect(launchResponse.status).toBe(200);
    const launchPayload = await readJson(launchResponse) as {
      ok: boolean;
      scenarioId: string;
      launch: {
        scenario: {
          id: string;
          ready: boolean;
        };
      };
    };
    expect(launchPayload.ok).toBe(true);
    expect(launchPayload.scenarioId).toBe("budget-guardrails");
    expect(launchPayload.launch.scenario.id).toBe("budget-guardrails");
    expect(launchPayload.launch.scenario.ready).toBe(true);
  }, 12_000);
});
