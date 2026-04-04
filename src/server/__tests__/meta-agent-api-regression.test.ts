import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "../../../app/api/meta-agent/route";
import { metaAgentService } from "@/server/meta-agent/meta-agent-service";
import { installRuntimeTestLlm } from "./helpers/test-llm";

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

async function pollSessionUntilDone(sessionId: string, maxPoll = 80) {
  let last: Record<string, unknown> | null = null;
  for (let i = 0; i < maxPoll; i++) {
    const response = await GET(
      new Request(`http://localhost/api/meta-agent?sessionId=${encodeURIComponent(sessionId)}`),
    );
    last = await readJson(response);
    if ((last.status as string) === "done" || (last.status as string) === "error") {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return last;
}

describe("meta-agent API regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports async start -> poll lifecycle with todo-driven state", async () => {
    installRuntimeTestLlm();

    const startResponse = await POST(
      new Request("http://localhost/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "API regression async run",
          maxPlanningRounds: 1,
          maxStepLimit: 4,
          qualityThreshold: 0.7,
        }),
      }),
    );
    expect(startResponse.status).toBe(202);
    const startPayload = await readJson(startResponse);
    expect(startPayload.ok).toBe(true);
    expect(startPayload.mode).toBe("async");
    expect(typeof startPayload.sessionId).toBe("string");

    const sessionId = String(startPayload.sessionId);
    const finalSession = await pollSessionUntilDone(sessionId);
    expect(finalSession).toBeTruthy();
    expect(["done", "error"]).toContain(String(finalSession?.status));

    const runState = finalSession?.supervisorRunState as Record<string, unknown> | undefined;
    expect(runState).toBeTruthy();
    expect(
      ["pending", "running", "idle", "reviewing", "completed", "failed", "blocked"].includes(
        String(runState?.status),
      ),
    ).toBe(true);

    const logs = (runState?.execution_log as Array<{ action?: string }> | undefined) ?? [];
    expect(logs.some((entry) => entry.action === "legacy_guard_triggered")).toBe(false);
  });

  it("supports sync mode response and keeps todo-driven result contract", async () => {
    installRuntimeTestLlm();

    const response = await POST(
      new Request("http://localhost/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "API regression sync run",
          maxPlanningRounds: 1,
          maxStepLimit: 4,
          qualityThreshold: 0.7,
          mode: "sync",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(["success", "failed", "max_steps_reached", "max_iterations_reached"]).toContain(String(payload.status));
    expect(Array.isArray(payload.steps)).toBe(true);
    expect(Array.isArray(payload.iterations)).toBe(true);
  });

  it("supports project-scoped session listing for platform integration", async () => {
    installRuntimeTestLlm();

    const projectId = `integration_project_${Date.now()}`;
    const startResponse = await POST(
      new Request("http://localhost/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "Platform integration listing",
          projectId,
          maxPlanningRounds: 1,
          maxStepLimit: 4,
          qualityThreshold: 0.7,
        }),
      }),
    );
    expect(startResponse.status).toBe(202);
    const startPayload = await readJson(startResponse);
    const sessionId = String(startPayload.sessionId);
    await pollSessionUntilDone(sessionId);

    const response = await GET(
      new Request(`http://localhost/api/meta-agent?projectId=${encodeURIComponent(projectId)}&limit=5`),
    );
    const payload = await readJson(response) as {
      sessions: Array<{
        sessionId: string;
        projectId: string;
        resultStatus?: string;
        durationMs?: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.sessions.length).toBeGreaterThan(0);
    expect(payload.sessions.every((item) => item.projectId === projectId)).toBe(true);
    expect(payload.sessions.some((item) => item.sessionId === sessionId)).toBe(true);
  });

  it("reloads persisted session history even after in-memory sessions are cleared", async () => {
    installRuntimeTestLlm();

    const projectId = `history_project_${Date.now()}`;
    const startResponse = await POST(
      new Request("http://localhost/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "Persist my meta-agent history",
          projectId,
          maxPlanningRounds: 1,
          maxStepLimit: 4,
          qualityThreshold: 0.7,
        }),
      }),
    );
    expect(startResponse.status).toBe(202);
    const startPayload = await readJson(startResponse);
    const sessionId = String(startPayload.sessionId);
    await pollSessionUntilDone(sessionId);

    metaAgentService.__resetInMemorySessionsForTests();

    const detailResponse = await GET(
      new Request(`http://localhost/api/meta-agent?sessionId=${encodeURIComponent(sessionId)}`),
    );
    const detailPayload = await readJson(detailResponse);
    expect(detailResponse.status).toBe(200);
    expect(detailPayload.goal).toBe("Persist my meta-agent history");
    expect(["done", "error"]).toContain(String(detailPayload.status));
    expect(detailPayload.supervisorRunState).toBeTruthy();
    expect(Array.isArray(detailPayload.checkpoints)).toBe(true);

    const listResponse = await GET(
      new Request(`http://localhost/api/meta-agent?projectId=${encodeURIComponent(projectId)}&limit=10`),
    );
    const listPayload = await readJson(listResponse) as {
      sessions: Array<{ sessionId: string; projectId: string }>;
    };
    expect(listResponse.status).toBe(200);
    expect(listPayload.sessions.some((item) => item.sessionId === sessionId)).toBe(true);
  });

  it("supports deleting a persisted history session", async () => {
    installRuntimeTestLlm();

    const projectId = `delete_project_${Date.now()}`;
    const startResponse = await POST(
      new Request("http://localhost/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "Delete my persisted session",
          projectId,
          maxPlanningRounds: 1,
          maxStepLimit: 4,
          qualityThreshold: 0.7,
        }),
      }),
    );
    expect(startResponse.status).toBe(202);
    const startPayload = await readJson(startResponse);
    const sessionId = String(startPayload.sessionId);
    await pollSessionUntilDone(sessionId);

    metaAgentService.__resetInMemorySessionsForTests();

    const deleteResponse = await DELETE(
      new Request(`http://localhost/api/meta-agent?sessionId=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }),
    );
    expect(deleteResponse.status).toBe(200);

    const detailResponse = await GET(
      new Request(`http://localhost/api/meta-agent?sessionId=${encodeURIComponent(sessionId)}`),
    );
    expect(detailResponse.status).toBe(404);
  });
});
