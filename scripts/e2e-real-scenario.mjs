import { existsSync, readFileSync, statSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [k, ...rest] = item.replace(/^--/, "").split("=");
    return [k, rest.join("=") || "true"];
  }),
);

const baseUrl = String(args.baseUrl || "http://127.0.0.1:3010").replace(/\/$/, "");
const timeoutMs = Number(args.timeoutMs || 180000);
const pollMs = Number(args.pollMs || 1200);
const savePath = String(args.savePath || "./output/agent-os-latest.md");
const autoOnly = String(args.autoOnly || "false") === "true";

const instruction =
  "给我从网上找出最新的关于agent os的信息（新闻/论文），然后总结好存到本地 output 目录。";

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: HTTP ${response.status} ${payload?.error || ""}`.trim());
  }
  return payload;
}

function fileMtimeMs(path) {
  if (!existsSync(path)) {
    return 0;
  }
  return statSync(path).mtimeMs;
}

function workflowBlueprint() {
  return {
    nodes: [
      { id: "n_input", name: "Input-1", role: "input", taskSummary: "工作流入口" },
      { id: "n_planner", name: "Planner-1", role: "planner", taskSummary: "规划任务" },
      { id: "n_worker", name: "Worker-1", role: "worker", taskSummary: "检索并分析最新信息" },
      { id: "n_sum", name: "Summarizer-1", role: "summarizer", taskSummary: "汇总并产出最终内容" },
      { id: "n_output", name: "Output-1", role: "output", taskSummary: "最终结果出口" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "n_input", targetNodeId: "n_planner", type: "task_flow" },
      { id: "e2", sourceNodeId: "n_planner", targetNodeId: "n_worker", type: "task_flow" },
      { id: "e3", sourceNodeId: "n_worker", targetNodeId: "n_sum", type: "task_flow" },
      { id: "e4", sourceNodeId: "n_sum", targetNodeId: "n_output", type: "task_flow" },
    ],
    tasks: [],
  };
}

async function waitRunDone(runId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await requestJson(`/api/runs/${runId}`);
    const status = String(snapshot?.run?.status || "");
    if (status === "completed" || status === "failed" || status === "cancelled") {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`run timeout > ${timeoutMs}ms`);
}

function nodeByRole(snapshot, role) {
  return snapshot.nodes.find((item) => item.role === role);
}

function contextByNode(snapshot, nodeId) {
  return snapshot.agentContexts.find((item) => item.nodeId === nodeId);
}

function readWorkspaceMode(workspacePayload) {
  const provider = String(workspacePayload?.workspace?.defaultProvider || "mock").toLowerCase();
  const model = String(workspacePayload?.workspace?.defaultModel || "");
  return { provider, model, isMock: !provider || provider === "mock" };
}

function buildSummary(snapshot, mode, beforeFileMtimeMs) {
  const inputNode = nodeByRole(snapshot, "input");
  const plannerNode = nodeByRole(snapshot, "planner");
  const workerNode = nodeByRole(snapshot, "worker");
  const sumNode = nodeByRole(snapshot, "summarizer");
  const outputNode = nodeByRole(snapshot, "output");

  const plannerCtx = plannerNode ? contextByNode(snapshot, plannerNode.id) : null;
  const workerCtx = workerNode ? contextByNode(snapshot, workerNode.id) : null;
  const sumCtx = sumNode ? contextByNode(snapshot, sumNode.id) : null;
  const outputCtx = outputNode ? contextByNode(snapshot, outputNode.id) : null;

  const toolInvocations = snapshot.events.filter((event) =>
    String(event.type).startsWith("tool_invocation_"),
  );
  const deliveredEvents = snapshot.events.filter((event) => event.type === "message_delivered");
  const resolvedEvents = snapshot.events.filter((event) => event.type === "context_resolved");
  const runFailed = snapshot.events.find((event) => event.type === "run_failed");
  const afterMtime = fileMtimeMs(savePath);

  const report = {
    runId: snapshot.run.id,
    status: snapshot.run.status,
    mode,
    runFailedMessage: runFailed?.message || "",
    finalOutputPreview: String(snapshot.run.output || "").slice(0, 800),
    checks: {
      plannerHasInbound: Boolean(plannerCtx?.inboundMessages?.length),
      plannerResolvedContainsInstruction:
        String(plannerCtx?.resolvedInput || "").toLowerCase().includes("agent os"),
      workerHasInbound: Boolean(workerCtx?.inboundMessages?.length),
      summarizerHasInbound: Boolean(sumCtx?.inboundMessages?.length),
      outputHasInbound: Boolean(outputCtx?.inboundMessages?.length),
      outputHasResult:
        Boolean(outputCtx?.inboundMessages?.length) ||
        Boolean(String(outputCtx?.latestSummary || "").trim()) ||
        Boolean(String(snapshot.run.output || "").trim()),
      hasMessageDeliveredEvent: deliveredEvents.length > 0,
      hasContextResolvedEvent: resolvedEvents.length > 0,
      hasToolInvocationEvent: toolInvocations.length > 0,
      saveFileExists: existsSync(savePath),
      saveFileTouched: afterMtime > beforeFileMtimeMs,
    },
    nodeSnapshots: {
      input: inputNode ? { id: inputNode.id, latestOutput: inputNode.latestOutput } : null,
      planner: plannerCtx
        ? {
            id: plannerCtx.nodeId,
            inboundCount: plannerCtx.inboundMessages.length,
            resolvedPreview: String(plannerCtx.resolvedInput || "").slice(0, 600),
          }
        : null,
      worker: workerCtx
        ? {
            id: workerCtx.nodeId,
            inboundCount: workerCtx.inboundMessages.length,
            resolvedPreview: String(workerCtx.resolvedInput || "").slice(0, 600),
            latestSummary: workerCtx.latestSummary,
          }
        : null,
      summarizer: sumCtx
        ? {
            id: sumCtx.nodeId,
            inboundCount: sumCtx.inboundMessages.length,
            resolvedPreview: String(sumCtx.resolvedInput || "").slice(0, 600),
            latestSummary: sumCtx.latestSummary,
          }
        : null,
      output: outputCtx
        ? {
            id: outputCtx.nodeId,
            inboundCount: outputCtx.inboundMessages.length,
            latestSummary: outputCtx.latestSummary,
          }
        : null,
    },
    toolEvents: toolInvocations.slice(-20),
  };

  if (report.checks.saveFileExists) {
    report.savedFilePreview = readFileSync(savePath, "utf8").slice(0, 1000);
  }

  report.ok =
    report.status === "completed" &&
    report.checks.plannerHasInbound &&
    report.checks.workerHasInbound &&
    report.checks.summarizerHasInbound &&
    report.checks.outputHasResult &&
    report.checks.hasMessageDeliveredEvent &&
    report.checks.hasContextResolvedEvent &&
    report.checks.hasToolInvocationEvent &&
    report.checks.saveFileTouched;

  return report;
}

async function runScenario({ modeLabel, mockAssist }) {
  const beforeFileMtimeMs = fileMtimeMs(savePath);

  const created = await requestJson("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      task: instruction,
      workflow: workflowBlueprint(),
    }),
  });
  const runId = String(created.runId);
  const snapshotCreated = await requestJson(`/api/runs/${runId}`);

  const inputNode = nodeByRole(snapshotCreated, "input");
  const workerNode = nodeByRole(snapshotCreated, "worker");
  const sumNode = nodeByRole(snapshotCreated, "summarizer");
  if (!inputNode || !workerNode || !sumNode) {
    throw new Error("workflow node bootstrap failed");
  }

  await requestJson(`/api/runs/${runId}/nodes/${inputNode.id}/human-message`, {
    method: "POST",
    body: JSON.stringify({ content: instruction }),
  });

  if (mockAssist) {
    await requestJson(`/api/runs/${runId}/nodes/${workerNode.id}/human-message`, {
      method: "POST",
      body: JSON.stringify({
        content: '/tool tool_agent_os_latest_search {"query":"agent os latest news papers","maxNews":6,"maxPapers":6}',
      }),
    });
    await requestJson(`/api/runs/${runId}/nodes/${sumNode.id}/human-message`, {
      method: "POST",
      body: JSON.stringify({
        content: `/tool tool_save_local_report {"path":"${savePath.replace(/\\/g, "\\\\")}"}`,
      }),
    });
  }

  await requestJson(`/api/runs/${runId}/start`, { method: "POST" });
  const snapshotDone = await waitRunDone(runId);
  const mode = { label: modeLabel };
  return buildSummary(snapshotDone, mode, beforeFileMtimeMs);
}

async function setWorkspaceToMock() {
  return requestJson("/api/workspace/config", {
    method: "PUT",
    body: JSON.stringify({
      defaultProvider: "mock",
      defaultModel: "mock-agent-v1",
      defaultBaseUrl: "",
      defaultCredentialId: "",
      defaultTemperature: 0.2,
    }),
  });
}

async function restoreWorkspace(original) {
  await requestJson("/api/workspace/config", {
    method: "PUT",
    body: JSON.stringify({
      name: original.name,
      defaultProvider: original.defaultProvider,
      defaultModel: original.defaultModel,
      defaultBaseUrl: original.defaultBaseUrl,
      defaultCredentialId: original.defaultCredentialId,
      defaultTemperature: original.defaultTemperature,
    }),
  });
}

async function main() {
  const workspacePayload = await requestJson("/api/workspace/config");
  const originalWorkspace = workspacePayload.workspace;
  const mode = readWorkspaceMode(workspacePayload);

  const attempts = [];
  let restored = false;
  try {
    const attempt1 = await runScenario({
      modeLabel: `workspace:${mode.provider}/${mode.model || "-"}`,
      mockAssist: mode.isMock,
    });
    attempts.push(attempt1);

    if (attempt1.ok || autoOnly) {
      process.stdout.write(`${JSON.stringify({ ok: attempt1.ok, attempts }, null, 2)}\n`);
      if (!attempt1.ok) {
        process.exitCode = 2;
      }
      return;
    }

    await setWorkspaceToMock();
    const fallback = await runScenario({
      modeLabel: "fallback:mock+tool-assist",
      mockAssist: true,
    });
    attempts.push(fallback);

    process.stdout.write(`${JSON.stringify({ ok: fallback.ok, attempts }, null, 2)}\n`);
    if (!fallback.ok) {
      process.exitCode = 2;
    }
  } finally {
    if (!restored) {
      await restoreWorkspace(originalWorkspace).catch(() => {});
      restored = true;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(1);
});
