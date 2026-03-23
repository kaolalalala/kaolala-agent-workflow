import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listRunsGet, POST as createRunPost } from "../../../app/api/runs/route";
import { GET as getRunsAnalyticsGet } from "../../../app/api/runs/analytics/route";
import { GET as getRunSnapshotGet } from "../../../app/api/runs/[runId]/route";
import { GET as getRunDiagnosticsGet } from "../../../app/api/runs/[runId]/diagnostics/route";
import { POST as startRunPost } from "../../../app/api/runs/[runId]/start/route";
import { POST as replayRunPost } from "../../../app/api/runs/[runId]/replay/route";
import { GET as compareRunsGet } from "../../../app/api/runs/[runId]/compare/[candidateRunId]/route";
import { GET as getNodeAgentGet } from "../../../app/api/runs/[runId]/nodes/[nodeId]/agent/route";
import { POST as sendHumanMessagePost } from "../../../app/api/runs/[runId]/nodes/[nodeId]/human-message/route";
import { POST as rerunNodePost } from "../../../app/api/runs/[runId]/nodes/[nodeId]/rerun/route";
import { GET as listWorkflowsGet, POST as saveWorkflowPost } from "../../../app/api/workflows/route";
import { GET as getWorkflowGet } from "../../../app/api/workflows/[workflowId]/route";
import { GET as listWorkflowVersionsGet } from "../../../app/api/workflows/[workflowId]/versions/route";
import { POST as publishWorkflowVersionPost } from "../../../app/api/workflows/[workflowId]/publish/route";
import { configService } from "@/server/config/config-service";
import { memoryStore } from "@/server/store/memory-store";

describe("run api routes", () => {
  beforeEach(() => {
    memoryStore.reset();
    configService.resetForTests();
    vi.useFakeTimers();
  });

  it("POST /api/runs returns runId", async () => {
    const request = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "调研多代理协作" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await createRunPost(request);
    const body = (await response.json()) as { runId: string };

    expect(response.status).toBe(200);
    expect(body.runId).toBeTruthy();
  });

  it("GET /api/runs supports summary and query filters", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "运行中心查询测试" }),
      headers: { "Content-Type": "application/json" },
    });
    await createRunPost(createRequest);

    const response = await listRunsGet(new Request("http://localhost/api/runs?limit=20&status=running&sort=time_desc"));
    const body = (await response.json()) as {
      runs: Array<{ id: string; status: string }>;
      summary: { totalRuns: number; runningCount: number };
      workflowSummaries: Array<{ workflowName: string; runCount: number }>;
    };

    expect(response.status).toBe(200);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.summary.totalRuns).toBeGreaterThanOrEqual(1);
    expect(body.summary.runningCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.workflowSummaries)).toBe(true);
  });

  it("GET /api/runs/analytics returns trend and overview stats", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "运行分析统计测试" }),
      headers: { "Content-Type": "application/json" },
    });
    await createRunPost(createRequest);

    const response = await getRunsAnalyticsGet(new Request("http://localhost/api/runs/analytics?days=7"));
    const body = (await response.json()) as {
      analytics: {
        rangeDays: number;
        overview: { totalRuns: number };
        trend: Array<{ date: string; runCount: number }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.analytics.rangeDays).toBe(7);
    expect(body.analytics.overview.totalRuns).toBeGreaterThanOrEqual(1);
    expect(body.analytics.trend).toHaveLength(7);
  });

  it("GET /api/runs/[id] returns snapshot", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "调研多代理协作", runMode: "safe" }),
      headers: { "Content-Type": "application/json" },
    });
    const createResponse = await createRunPost(createRequest);
    const created = (await createResponse.json()) as { runId: string };

    const response = await getRunSnapshotGet(new Request(`http://localhost/api/runs/${created.runId}`), {
      params: Promise.resolve({ runId: created.runId }),
    });
    const body = (await response.json()) as { run: { id: string; runMode: string }; nodes: Array<unknown> };

    expect(response.status).toBe(200);
    expect(body.run.id).toBe(created.runId);
    expect(body.run.runMode).toBe("safe");
    expect(body.nodes.length).toBe(3);
  });

  it("GET /api/runs/[id]/diagnostics exports run report", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "诊断导出测试" }),
      headers: { "Content-Type": "application/json" },
    });
    const createResponse = await createRunPost(createRequest);
    const created = (await createResponse.json()) as { runId: string };

    const response = await getRunDiagnosticsGet(
      new Request(`http://localhost/api/runs/${created.runId}/diagnostics`),
      { params: Promise.resolve({ runId: created.runId }) },
    );
    const body = (await response.json()) as {
      runId: string;
      summary: { checks: Array<{ id: string }> };
      nodes: Array<{ nodeId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.runId).toBe(created.runId);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.summary.checks.some((item) => item.id === "planner_input_non_empty")).toBe(true);
  });

  it("GET /api/runs/[id]/diagnostics?download=1 returns attachment", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "诊断下载测试" }),
      headers: { "Content-Type": "application/json" },
    });
    const createResponse = await createRunPost(createRequest);
    const created = (await createResponse.json()) as { runId: string };

    const response = await getRunDiagnosticsGet(
      new Request(`http://localhost/api/runs/${created.runId}/diagnostics?download=1`),
      { params: Promise.resolve({ runId: created.runId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(`run-${created.runId}-diagnostics.json`);
  });

  it("POST /api/runs/[id]/start starts run asynchronously", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "调研多代理协作" }),
      headers: { "Content-Type": "application/json" },
    });
    const createResponse = await createRunPost(createRequest);
    const created = (await createResponse.json()) as { runId: string };

    const response = await startRunPost(new Request(`http://localhost/api/runs/${created.runId}/start`, { method: "POST" }), {
      params: Promise.resolve({ runId: created.runId }),
    });
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("POST /api/runs/[id]/replay and GET /api/runs/[id]/compare/[candidateRunId] support replay evaluation", async () => {
    const createRequest = new Request("http://localhost/api/runs", {
      method: "POST",
      body: JSON.stringify({ task: "回放对比测试" }),
      headers: { "Content-Type": "application/json" },
    });
    const createResponse = await createRunPost(createRequest);
    const created = (await createResponse.json()) as { runId: string };

    const startResponse = await startRunPost(new Request(`http://localhost/api/runs/${created.runId}/start`, { method: "POST" }), {
      params: Promise.resolve({ runId: created.runId }),
    });
    expect(startResponse.status).toBe(200);
    await vi.runAllTimersAsync();

    const replayResponse = await replayRunPost(
      new Request(`http://localhost/api/runs/${created.runId}/replay`, {
        method: "POST",
        body: JSON.stringify({ autoStart: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ runId: created.runId }) },
    );
    const replayBody = (await replayResponse.json()) as { replayRunId: string };
    expect(replayResponse.status).toBe(200);
    expect(replayBody.replayRunId).toBeTruthy();

    const replayStartResponse = await startRunPost(
      new Request(`http://localhost/api/runs/${replayBody.replayRunId}/start`, { method: "POST" }),
      { params: Promise.resolve({ runId: replayBody.replayRunId }) },
    );
    expect(replayStartResponse.status).toBe(200);
    await vi.runAllTimersAsync();

    const compareResponse = await compareRunsGet(
      new Request(`http://localhost/api/runs/${created.runId}/compare/${replayBody.replayRunId}`),
      { params: Promise.resolve({ runId: created.runId, candidateRunId: replayBody.replayRunId }) },
    );
    const compareBody = (await compareResponse.json()) as {
      report: { baselineRunId: string; candidateRunId: string; nodeDiffs: Array<unknown> };
    };
    expect(compareResponse.status).toBe(200);
    expect(compareBody.report.baselineRunId).toBe(created.runId);
    expect(compareBody.report.candidateRunId).toBe(replayBody.replayRunId);
    expect(compareBody.report.nodeDiffs.length).toBeGreaterThan(0);
  });

  it("node-level APIs return agent/human-message/rerun payload", async () => {
    const createResponse = await createRunPost(
      new Request("http://localhost/api/runs", {
        method: "POST",
        body: JSON.stringify({ task: "调研多代理协作" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { runId } = (await createResponse.json()) as { runId: string };

    const snapshotResponse = await getRunSnapshotGet(new Request(`http://localhost/api/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    });
    const snapshot = (await snapshotResponse.json()) as { nodes: Array<{ id: string; role: string }> };
    const worker = snapshot.nodes.find((node) => node.role === "worker");
    expect(worker?.id).toBeTruthy();

    const agentResponse = await getNodeAgentGet(new Request(`http://localhost/api/runs/${runId}/nodes/${worker!.id}/agent`), {
      params: Promise.resolve({ runId, nodeId: worker!.id }),
    });
    const agentPayload = (await agentResponse.json()) as { definition: { id: string }; context: { id: string } };
    expect(agentResponse.status).toBe(200);
    expect(agentPayload.definition.id).toBeTruthy();
    expect(agentPayload.context.id).toBeTruthy();

    const messageResponse = await sendHumanMessagePost(
      new Request(`http://localhost/api/runs/${runId}/nodes/${worker!.id}/human-message`, {
        method: "POST",
        body: JSON.stringify({
          content: "请细化案例",
          attachments: [{ name: "需求.png", mimeType: "image/png", content: "data:image/png;base64,abc" }],
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ runId, nodeId: worker!.id }) },
    );
    const messagePayload = (await messageResponse.json()) as { ok: boolean; humanMessageId: string };
    expect(messageResponse.status).toBe(200);
    expect(messagePayload.ok).toBe(true);
    expect(messagePayload.humanMessageId).toBeTruthy();

    const rerunResponse = await rerunNodePost(
      new Request(`http://localhost/api/runs/${runId}/nodes/${worker!.id}/rerun`, {
        method: "POST",
        body: JSON.stringify({ includeDownstream: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ runId, nodeId: worker!.id }) },
    );
    const rerunPayload = (await rerunResponse.json()) as { ok: boolean };
    expect(rerunResponse.status).toBe(200);
    expect(rerunPayload.ok).toBe(true);
  });

  it("workflow APIs support list/save/get/version/publish", async () => {
    const listResponse = await listWorkflowsGet();
    const listBody = (await listResponse.json()) as { workflows: Array<{ id: string }> };
    expect(listResponse.status).toBe(200);
    expect(listBody.workflows).toHaveLength(0);

    const saveResponse = await saveWorkflowPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: "测试工作流",
          rootTaskInput: "测试输入",
          versionLabel: "基线版",
          nodes: [{ id: "n1", name: "节点1", role: "worker", taskSummary: "执行", responsibilitySummary: "执行任务" }],
          edges: [],
          tasks: [{ id: "t1", title: "任务1", status: "ready", assignedNodeId: "n1", summary: "执行任务1" }],
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const saveBody = (await saveResponse.json()) as { workflow: { id: string; name: string } };
    expect(saveResponse.status).toBe(200);
    expect(saveBody.workflow.id).toBeTruthy();
    expect(saveBody.workflow.name).toBe("测试工作流");

    const getResponse = await getWorkflowGet(new Request(`http://localhost/api/workflows/${saveBody.workflow.id}`), {
      params: Promise.resolve({ workflowId: saveBody.workflow.id }),
    });
    const getBody = (await getResponse.json()) as { workflow: { id: string; nodes: Array<{ id: string }> } };
    expect(getResponse.status).toBe(200);
    expect(getBody.workflow.id).toBe(saveBody.workflow.id);
    expect(getBody.workflow.nodes.length).toBe(1);

    const updateResponse = await saveWorkflowPost(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          workflowId: saveBody.workflow.id,
          name: "测试工作流",
          rootTaskInput: "第二版输入",
          versionLabel: "增强版",
          nodes: [{ id: "n1", name: "节点1", role: "worker", taskSummary: "执行", responsibilitySummary: "执行任务" }],
          edges: [],
          tasks: [{ id: "t1", title: "任务1", status: "ready", assignedNodeId: "n1", summary: "执行任务1" }],
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const updateBody = (await updateResponse.json()) as { workflow: { currentVersionNumber: number } };
    expect(updateBody.workflow.currentVersionNumber).toBe(2);

    const versionsResponse = await listWorkflowVersionsGet(new Request(`http://localhost/api/workflows/${saveBody.workflow.id}/versions`), {
      params: Promise.resolve({ workflowId: saveBody.workflow.id }),
    });
    const versionsBody = (await versionsResponse.json()) as { versions: Array<{ id: string; versionNumber: number }> };
    expect(versionsResponse.status).toBe(200);
    expect(versionsBody.versions).toHaveLength(2);

    const publishResponse = await publishWorkflowVersionPost(
      new Request(`http://localhost/api/workflows/${saveBody.workflow.id}/publish`, {
        method: "POST",
        body: JSON.stringify({ versionId: versionsBody.versions[1].id }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ workflowId: saveBody.workflow.id }) },
    );
    const publishBody = (await publishResponse.json()) as { workflow: { publishedVersionNumber: number } };
    expect(publishResponse.status).toBe(200);
    expect(publishBody.workflow.publishedVersionNumber).toBe(1);
  });
});

