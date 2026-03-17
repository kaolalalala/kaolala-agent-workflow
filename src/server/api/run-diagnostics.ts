import { configService } from "@/server/config/config-service";
import { Event, EventType } from "@/server/domain";
import { RunSnapshot } from "@/server/store/memory-store";

type DiagnosticSeverity = "info" | "warn" | "error";

interface DiagnosticCheck {
  id: string;
  severity: DiagnosticSeverity;
  pass: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface NodeDiagnostic {
  nodeId: string;
  name: string;
  role: string;
  status: string;
  executionOrder: number;
  durationMs?: number;
  error?: string;
  blockedReason?: string;
  latestInputPreview?: string;
  latestOutputPreview?: string;
  resolvedInputPreview?: string;
  context: {
    inboundCount: number;
    outboundCount: number;
    humanCount: number;
    recentOutputCount: number;
  };
  execution: {
    provider: string;
    model: string;
    startedAt?: string;
    completedAt?: string;
    failedAt?: string;
    firstTokenAt?: string;
    lastTokenAt?: string;
    contextResolvedCount: number;
    llmRequestCount: number;
    llmResponseCount: number;
    tokenStreamCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    tokenUsageAvailable: boolean;
    toolInvocationStartedCount: number;
    toolInvocationFailedCount: number;
    toolInvocationSucceededCount: number;
  };
}

interface TokenUsageAggregate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokenUsageAvailable: boolean;
}

function previewText(value: unknown, limit = 1000) {
  const text = String(value ?? "");
  return text ? text.slice(0, limit) : "";
}

function summarizePayload(payload: unknown, limit = 320) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  try {
    return JSON.stringify(payload).slice(0, limit);
  } catch {
    return "[payload_unserializable]";
  }
}

function findEventTimestamp(events: Event[], type: EventType) {
  return events.find((item) => item.type === type)?.timestamp;
}

function findLastEventTimestamp(events: Event[], type: EventType) {
  return [...events].reverse().find((item) => item.type === type)?.timestamp;
}

function diffMs(start?: string, end?: string) {
  if (!start || !end) {
    return undefined;
  }
  const value = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeTokenValue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value >= 0 ? value : undefined;
}

function getTokenUsageFromPayload(payload: Record<string, unknown> | undefined): TokenUsageAggregate {
  if (!payload) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokenUsageAvailable: false,
    };
  }
  const nested = (payload.tokenUsage && typeof payload.tokenUsage === "object")
    ? (payload.tokenUsage as Record<string, unknown>)
    : undefined;
  const promptTokens = normalizeTokenValue(
    payload.promptTokens
    ?? payload.prompt_tokens
    ?? nested?.promptTokens
    ?? nested?.prompt_tokens,
  );
  const completionTokens = normalizeTokenValue(
    payload.completionTokens
    ?? payload.completion_tokens
    ?? nested?.completionTokens
    ?? nested?.completion_tokens,
  );
  const totalTokens = normalizeTokenValue(
    payload.totalTokens
    ?? payload.total_tokens
    ?? nested?.totalTokens
    ?? nested?.total_tokens,
  );
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? 0,
    tokenUsageAvailable:
      typeof promptTokens === "number"
      || typeof completionTokens === "number"
      || typeof totalTokens === "number",
  };
}

function accumulateTokenUsage(events: Event[]): TokenUsageAggregate {
  return events.reduce<TokenUsageAggregate>(
    (acc, event) => {
      if (event.type !== "llm_response_received") {
        return acc;
      }
      const usage = getTokenUsageFromPayload(event.payload);
      return {
        promptTokens: acc.promptTokens + usage.promptTokens,
        completionTokens: acc.completionTokens + usage.completionTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        tokenUsageAvailable: acc.tokenUsageAvailable || usage.tokenUsageAvailable,
      };
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokenUsageAvailable: false,
    },
  );
}

function classifyRootCause(snapshot: RunSnapshot, checks: DiagnosticCheck[], nodeDiagnostics: NodeDiagnostic[]) {
  const failedNodes = nodeDiagnostics.filter((item) => item.status === "failed");
  const failedText = [snapshot.run.error ?? "", ...failedNodes.map((item) => item.error ?? item.blockedReason ?? "")]
    .join(" | ")
    .toLowerCase();

  if (failedText.includes("timed out") || failedText.includes("timeout")) {
    return "request_timeout";
  }
  if (
    failedText.includes("401")
    || failedText.includes("403")
    || failedText.includes("unauthorized")
    || failedText.includes("api key")
    || failedText.includes("credential")
  ) {
    return "configuration_or_auth_error";
  }
  if (failedText.includes("parse failed") || failedText.includes("invalid json")) {
    return "response_parse_error";
  }
  if (checks.some((item) => item.id === "planner_input_non_empty" && !item.pass)) {
    return "upstream_message_missing";
  }
  if (snapshot.run.status === "failed" && !snapshot.events.some((item) => item.type === "node_failed")) {
    return "state_machine_orchestration_error";
  }
  if (snapshot.run.status === "completed") {
    return "none";
  }
  return "unknown";
}

function buildChecks(snapshot: RunSnapshot, nodeDiagnostics: NodeDiagnostic[]) {
  const checks: DiagnosticCheck[] = [];
  const eventsWithSeq = snapshot.events.filter((item) => typeof item.runEventSeq === "number");
  const seqSorted = [...eventsWithSeq].sort((a, b) => (a.runEventSeq ?? 0) - (b.runEventSeq ?? 0));

  let seqContinuous = true;
  for (let index = 1; index < seqSorted.length; index += 1) {
    if ((seqSorted[index].runEventSeq ?? 0) !== (seqSorted[index - 1].runEventSeq ?? 0) + 1) {
      seqContinuous = false;
      break;
    }
  }

  checks.push({
    id: "event_seq_continuous",
    severity: "warn",
    pass: seqContinuous,
    message: seqContinuous ? "runEventSeq 连续" : "runEventSeq 存在断档或乱序",
    details: { eventsWithSeq: eventsWithSeq.length },
  });

  const hasTerminalEvent =
    snapshot.events.some((item) => item.type === "run_completed")
    || snapshot.events.some((item) => item.type === "run_failed");
  checks.push({
    id: "terminal_event_present",
    severity: "warn",
    pass: hasTerminalEvent,
    message: hasTerminalEvent ? "存在运行终态事件" : "缺少 run_completed 或 run_failed 终态事件",
  });

  const plannerNodes = nodeDiagnostics.filter((item) => item.role === "planner");
  const plannerOk =
    plannerNodes.length === 0
    || plannerNodes.every((item) => item.context.inboundCount > 0 || (item.resolvedInputPreview ?? "").trim().length > 0);
  checks.push({
    id: "planner_input_non_empty",
    severity: "error",
    pass: plannerOk,
    message: plannerOk ? "规划节点输入非空" : "规划节点存在空输入或未解析上下文",
    details: {
      plannerNodes: plannerNodes.map((item) => ({
        nodeId: item.nodeId,
        inboundCount: item.context.inboundCount,
        resolvedInputPreview: item.resolvedInputPreview,
      })),
    },
  });

  const failedNodes = nodeDiagnostics.filter((item) => item.status === "failed");
  const failedWithReason = failedNodes.every((item) => Boolean((item.error ?? item.blockedReason ?? "").trim()));
  checks.push({
    id: "failed_nodes_have_reason",
    severity: "error",
    pass: failedWithReason,
    message: failedWithReason ? "失败节点都有明确原因" : "存在失败节点但缺少明确错误信息",
    details: {
      failedNodes: failedNodes.map((item) => ({
        nodeId: item.nodeId,
        error: item.error,
        blockedReason: item.blockedReason,
      })),
    },
  });

  const workspace = configService.ensureWorkspaceConfig();
  const provider = (workspace.defaultProvider ?? "mock").toLowerCase();
  const hasBaseUrl = Boolean((workspace.defaultBaseUrl ?? "").trim());
  const hasModel = Boolean((workspace.defaultModel ?? "").trim());
  const hasApiKey = Boolean(configService.resolveCredentialApiKey(workspace.defaultCredentialId)?.trim());
  const configReady = provider === "mock" || (hasBaseUrl && hasModel && hasApiKey);
  checks.push({
    id: "workspace_llm_config_ready",
    severity: provider === "mock" ? "info" : "error",
    pass: configReady,
    message: configReady ? "工作区 LLM 配置可用" : "工作区 LLM 配置不完整（baseURL/model/key）",
    details: {
      provider,
      hasBaseUrl,
      hasModel,
      hasApiKey,
    },
  });

  return checks;
}

export function buildRunDiagnosticsReport(snapshot: RunSnapshot) {
  const exportedAt = new Date().toISOString();
  const workspace = configService.ensureWorkspaceConfig();
  const workspaceApiKey = configService.resolveCredentialApiKey(workspace.defaultCredentialId);
  const nodeContexts = new Map(snapshot.agentContexts.map((item) => [item.nodeId, item]));
  const nodeDefinitions = new Map(snapshot.agentDefinitions.map((item) => [item.id, item]));
  const nodeEvents = new Map<string, Event[]>();

  for (const event of snapshot.events) {
    if (!event.relatedNodeId) {
      continue;
    }
    const current = nodeEvents.get(event.relatedNodeId) ?? [];
    current.push(event);
    nodeEvents.set(event.relatedNodeId, current);
  }

  const nodeDiagnostics = snapshot.nodes
    .map((node) => {
      const context = nodeContexts.get(node.id);
      const definition = nodeDefinitions.get(node.agentDefinitionId);
      const events = nodeEvents.get(node.id) ?? [];
      const startedAt = findEventTimestamp(events, "node_started");
      const completedAt = findEventTimestamp(events, "node_completed");
      const failedAt = findEventTimestamp(events, "node_failed");
      const tokenStreamCount = events.filter((item) => item.type === "token_stream").length;
      const toolInvocationStartedCount = events.filter((item) => item.type === "tool_invocation_started").length;
      const toolInvocationFailedCount = events.filter((item) => item.type === "tool_invocation_failed").length;
      const toolInvocationSucceededCount = events.filter((item) => item.type === "tool_invocation_succeeded").length;
      const llmRequestCount = events.filter((item) => item.type === "llm_request_sent").length;
      const llmResponseCount = events.filter((item) => item.type === "llm_response_received").length;
      const tokenUsage = accumulateTokenUsage(events);

      return {
        nodeId: node.id,
        name: node.name,
        role: node.role,
        status: node.status,
        executionOrder: node.executionOrder ?? Number.MAX_SAFE_INTEGER,
        durationMs: diffMs(startedAt, completedAt ?? failedAt),
        error: node.error,
        blockedReason: node.blockedReason,
        latestInputPreview: previewText(node.latestInput),
        latestOutputPreview: previewText(node.latestOutput),
        resolvedInputPreview: previewText(context?.resolvedInput ?? node.resolvedInput),
        context: {
          inboundCount: context?.inboundMessages.length ?? node.inboundMessages.length ?? 0,
          outboundCount: context?.outboundMessages.length ?? node.outboundMessages.length ?? 0,
          humanCount: context?.humanMessages.length ?? 0,
          recentOutputCount: context?.recentOutputs.length ?? 0,
        },
        execution: {
          provider: definition?.provider ?? "mock",
          model: definition?.model ?? "mock-agent-v1",
          startedAt,
          completedAt,
          failedAt,
          firstTokenAt: findEventTimestamp(events, "token_stream"),
          lastTokenAt: findLastEventTimestamp(events, "token_stream"),
          contextResolvedCount: events.filter((item) => item.type === "context_resolved").length,
          llmRequestCount,
          llmResponseCount,
          tokenStreamCount,
          promptTokens: tokenUsage.promptTokens,
          completionTokens: tokenUsage.completionTokens,
          totalTokens: tokenUsage.totalTokens,
          tokenUsageAvailable: tokenUsage.tokenUsageAvailable,
          toolInvocationStartedCount,
          toolInvocationFailedCount,
          toolInvocationSucceededCount,
        },
      } satisfies NodeDiagnostic;
    })
    .sort((a, b) => a.executionOrder - b.executionOrder);

  const checks = buildChecks(snapshot, nodeDiagnostics);
  const rootCause = classifyRootCause(snapshot, checks, nodeDiagnostics);
  const eventTypeStats = snapshot.events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1;
    return acc;
  }, {});

  const runStartedAt = findEventTimestamp(snapshot.events, "run_started") ?? snapshot.run.startedAt;
  const runEndedAt =
    findEventTimestamp(snapshot.events, "run_completed")
    ?? findEventTimestamp(snapshot.events, "run_failed")
    ?? snapshot.run.finishedAt;
  const runTokenUsage = accumulateTokenUsage(snapshot.events);

  const observability = {
    durationMs: diffMs(runStartedAt, runEndedAt),
    llmRequestCount: eventTypeStats.llm_request_sent ?? 0,
    llmResponseCount: eventTypeStats.llm_response_received ?? 0,
    tokenStreamCount: eventTypeStats.token_stream ?? 0,
    promptTokens: runTokenUsage.promptTokens,
    completionTokens: runTokenUsage.completionTokens,
    totalTokens: runTokenUsage.totalTokens,
    tokenUsageAvailable: runTokenUsage.tokenUsageAvailable,
    toolInvocationCount:
      (eventTypeStats.tool_invocation_started ?? 0)
      + (eventTypeStats.tool_invocation_succeeded ?? 0)
      + (eventTypeStats.tool_invocation_failed ?? 0),
    toolSuccessCount: eventTypeStats.tool_invocation_succeeded ?? 0,
    toolFailureCount: eventTypeStats.tool_invocation_failed ?? 0,
    messageCount: snapshot.messages.length,
    eventCount: snapshot.events.length,
    nodeStatusCounts: snapshot.nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.status] = (acc[node.status] ?? 0) + 1;
      return acc;
    }, {}),
    slowestNodes: nodeDiagnostics
      .filter((item) => typeof item.durationMs === "number")
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 5)
      .map((item) => ({
        nodeId: item.nodeId,
        name: item.name,
        durationMs: item.durationMs,
        role: item.role,
        status: item.status,
      })),
  };

  return {
    runId: snapshot.run.id,
    exportedAt,
    run: {
      ...snapshot.run,
      taskCount: snapshot.tasks.length,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      messageCount: snapshot.messages.length,
      eventCount: snapshot.events.length,
    },
    workflow: {
      workflowId: snapshot.run.workflowId ?? null,
      workflowVersionId: snapshot.run.workflowVersionId ?? null,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      defaultProvider: workspace.defaultProvider ?? "mock",
      defaultModel: workspace.defaultModel ?? "mock-agent-v1",
      defaultBaseUrl: workspace.defaultBaseUrl ?? "",
      defaultCredentialId: workspace.defaultCredentialId ?? "",
      hasCredentialApiKey: Boolean(workspaceApiKey?.trim()),
      defaultTemperature: workspace.defaultTemperature,
      updatedAt: workspace.updatedAt,
    },
    summary: {
      rootCause,
      checks,
      eventTypeStats,
      observability,
      timeline: {
        runStartedAt,
        runCompletedAt: findEventTimestamp(snapshot.events, "run_completed"),
        runFailedAt: findEventTimestamp(snapshot.events, "run_failed"),
      },
    },
    nodes: nodeDiagnostics,
    timeline: snapshot.events.map((event) => ({
      seq: event.runEventSeq ?? null,
      type: event.type,
      timestamp: event.timestamp,
      relatedNodeId: event.relatedNodeId ?? null,
      relatedTaskId: event.relatedTaskId ?? null,
      message: event.message,
      payloadSummary: summarizePayload(event.payload),
    })),
  };
}
