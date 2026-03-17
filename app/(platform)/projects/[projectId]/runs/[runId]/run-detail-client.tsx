"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Bug, Cpu, MessageSquare, Wrench, GitCompare } from "lucide-react";

import type { RunDetailView, RunTracesView, NodeTraceView, PromptTraceView, ToolTraceView, StateTraceView } from "@/features/workflow/adapters/runtime-client";
import { runtimeClient } from "@/features/workflow/adapters/runtime-client";

type LogLevelFilter = "all" | "info" | "warn" | "error";
type DebugTab = "node" | "prompt" | "tool" | "state";

interface TimelineBarItem {
  nodeId: string;
  name: string;
  role: string;
  status: "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  leftPercent: number;
  widthPercent: number;
}

function toTimestamp(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function RunDetailClient({ projectId, run }: { projectId: string; run: RunDetailView }) {
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(run.nodeTraces[0]?.nodeId ?? null);
  const [debugTab, setDebugTab] = useState<DebugTab>("node");
  const [traces, setTraces] = useState<RunTracesView | null>(null);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [debugNodeFilter, setDebugNodeFilter] = useState<string>("all");

  const loadTraces = useCallback(async () => {
    setTracesLoading(true);
    try {
      const data = await runtimeClient.fetchRunTraces(run.id, debugNodeFilter === "all" ? undefined : debugNodeFilter);
      setTraces(data);
    } catch { /* ignore */ }
    setTracesLoading(false);
  }, [run.id, debugNodeFilter]);

  const filteredLogs = useMemo(() => {
    return run.logs.filter((item) => {
      if (level !== "all" && item.level !== level) {
        return false;
      }
      const key = keyword.trim().toLowerCase();
      if (!key) {
        return true;
      }
      return (
        item.message.toLowerCase().includes(key)
        || item.type.toLowerCase().includes(key)
        || item.nodeId?.toLowerCase().includes(key)
        || item.taskId?.toLowerCase().includes(key)
      );
    });
  }, [keyword, level, run.logs]);

  const timeline = useMemo(() => {
    const runStartedTs = toTimestamp(run.startedAt) ?? 0;
    const runDurationMs = typeof run.durationMs === "number" && run.durationMs >= 0 ? run.durationMs : 0;

    // 按 startedAt 排序，保证 input 在最前面
    const sorted = [...run.executionTimeline].sort((a, b) => {
      const aTs = toTimestamp(a.startedAt) ?? Number.MAX_SAFE_INTEGER;
      const bTs = toTimestamp(b.startedAt) ?? Number.MAX_SAFE_INTEGER;
      if (aTs !== bTs) return aTs - bTs;
      return a.name.localeCompare(b.name, "zh-CN");
    });

    // 计算每个节点的实际耗时
    const withDuration = sorted.map((item) => {
      let nodeDurationMs: number;
      if (typeof item.durationMs === "number" && item.durationMs >= 0) {
        nodeDurationMs = item.durationMs;
      } else {
        const startTs = toTimestamp(item.startedAt);
        const endTs = toTimestamp(item.finishedAt);
        if (startTs !== undefined && endTs !== undefined) {
          nodeDurationMs = Math.max(0, endTs - startTs);
        } else if (startTs !== undefined && item.status === "running") {
          // 运行中节点：用 run 总时长减去 startOffset 作为估算
          nodeDurationMs = Math.max(1, runDurationMs - Math.max(0, startTs - runStartedTs));
        } else {
          nodeDurationMs = 1;
        }
      }
      return { ...item, nodeDurationMs: Math.max(1, nodeDurationMs) };
    });

    // 总时长 = 所有节点耗时之和（用于比例计算），至少为 1ms
    const totalDurationMs = Math.max(1, withDuration.reduce((sum, item) => sum + item.nodeDurationMs, 0));

    const items: TimelineBarItem[] = withDuration.map((item) => {
      const rawWidth = (item.nodeDurationMs / totalDurationMs) * 100;
      const widthPercent = Math.max(0.5, rawWidth);
      return {
        nodeId: item.nodeId,
        name: item.name,
        role: item.role,
        status: item.status,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        durationMs: item.nodeDurationMs,
        leftPercent: 0,
        widthPercent,
      };
    });

    return { totalMs: runDurationMs || totalDurationMs, items };
  }, [run.durationMs, run.executionTimeline, run.startedAt]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.22)]">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回项目
        </Link>
        <h1 className="mt-1 text-base font-semibold text-slate-900">{run.workflowName}</h1>
        <p className="text-xs text-slate-500">运行 ID：{run.id}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <StatusPill status={run.status} />
          <span>开始：{formatDateTime(run.startedAt)}</span>
          <span>结束：{run.finishedAt ? formatDateTime(run.finishedAt) : "运行中"}</span>
          <span>耗时：{run.durationMs !== undefined ? formatDuration(run.durationMs) : "--"}</span>
          <span>Token：{run.tokenUsageAvailable ? formatNumber(run.totalTokens ?? 0) : "--"}</span>
          {run.workflowId ? (
            <Link
              href={`/projects/${projectId}/workflows/${run.workflowId}`}
              className="text-indigo-600 hover:text-indigo-700"
            >
              打开来源工作流
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Metric title="Prompt Tokens" value={run.tokenUsageAvailable ? formatNumber(run.promptTokens ?? 0) : "--"} />
        <Metric title="Completion Tokens" value={run.tokenUsageAvailable ? formatNumber(run.completionTokens ?? 0) : "--"} />
        <Metric title="Total Tokens" value={run.tokenUsageAvailable ? formatNumber(run.totalTokens ?? 0) : "--"} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">执行时间线</h2>
            <p className="text-xs text-slate-500">
              按节点查看开始时间、结束时间与耗时，快速定位慢节点和失败节点。
            </p>
          </div>
          <span className="text-xs text-slate-500">总时长：{formatDuration(timeline.totalMs)}</span>
        </div>
        {timeline.items.length === 0 ? (
          <EmptyState text="当前运行暂无可用时间线数据。" />
        ) : (
          <div className="space-y-3">
            {timeline.items.map((item) => (
              <article key={item.nodeId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-800">{item.name}</p>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">{item.role}</span>
                  <StatusPill status={item.status} />
                  <span className="text-[11px] text-slate-500">
                    {item.startedAt ? formatDateTime(item.startedAt) : "--"} →{" "}
                    {item.finishedAt ? formatDateTime(item.finishedAt) : "运行中"}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    耗时：{item.durationMs !== undefined ? formatDuration(item.durationMs) : "--"}
                  </span>
                </div>
                <div className="h-7 overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div
                    className={`h-full rounded-sm ${
                      item.status === "failed"
                        ? "bg-rose-400/80"
                        : item.status === "running"
                          ? "bg-amber-400/70"
                          : "bg-indigo-500/80"
                    }`}
                    style={{
                      width: `${item.widthPercent}%`,
                      minWidth: "4px",
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">节点输入输出与执行 Trace</h2>
        <p className="mt-1 text-xs text-slate-500">
          每个节点可查看输入、输出、Prompt Trace 和 Tool Call Trace。
        </p>
        {run.nodeTraces.length === 0 ? (
          <div className="mt-3">
            <EmptyState text="当前运行暂无节点调试数据。" />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {run.nodeTraces.map((node) => {
              const expanded = expandedNodeId === node.nodeId;
              return (
                <article key={node.nodeId} className="rounded-lg border border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setExpandedNodeId(expanded ? null : node.nodeId)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">{node.name}</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">{node.role}</span>
                        <StatusPill status={node.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        开始：{node.startedAt ? formatDateTime(node.startedAt) : "--"}
                        {" / "}
                        结束：{node.finishedAt ? formatDateTime(node.finishedAt) : "--"}
                        {" / "}
                        耗时：{node.durationMs !== undefined ? formatDuration(node.durationMs) : "--"}
                      </p>
                    </div>
                    {expanded
                      ? <ChevronUp className="h-4 w-4 text-slate-400" />
                      : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </button>

                  {expanded ? (
                    <div className="space-y-3 border-t border-slate-200 bg-white px-3 py-3">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <StructuredBlock title="Node Input" value={node.inputSnapshot} emptyText="无输入快照" />
                        <StructuredBlock title="Node Output" value={node.outputSnapshot} emptyText="无输出快照" />
                      </div>
                      {node.error ? <p className="text-xs text-rose-600">错误：{node.error}</p> : null}

                      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <h3 className="text-xs font-semibold text-slate-700">Prompt Trace</h3>
                        {node.promptTrace ? (
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-slate-500">
                              Provider：{node.promptTrace.provider ?? "--"}
                              {" / "}
                              Model：{node.promptTrace.model ?? "--"}
                              {" / "}
                              Path：{node.promptTrace.requestPath ?? "--"}
                            </p>
                            <StructuredBlock
                              title="System Prompt"
                              value={node.promptTrace.systemPrompt}
                              emptyText="无 System Prompt"
                              compact
                            />
                            <StructuredBlock
                              title="User Prompt"
                              value={node.promptTrace.userPrompt}
                              emptyText="无 User Prompt"
                              compact
                            />
                            <StructuredBlock
                              title="Message History"
                              value={node.promptTrace.messageHistory ?? []}
                              emptyText="无 message history"
                              compact
                            />
                            <StructuredBlock
                              title="Completion"
                              value={node.promptTrace.completion}
                              emptyText="无 completion"
                              compact
                            />
                            <p className="text-xs text-slate-500">
                              Token：
                              {node.promptTrace.tokenUsageAvailable
                                ? `${formatNumber(node.promptTrace.totalTokens ?? 0)} (P ${formatNumber(node.promptTrace.promptTokens ?? 0)} / C ${formatNumber(node.promptTrace.completionTokens ?? 0)})`
                                : "--"}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">该节点无 LLM Prompt Trace 数据。</p>
                        )}
                      </article>

                      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <h3 className="text-xs font-semibold text-slate-700">Tool Call Trace</h3>
                        {node.toolCalls.length === 0 ? (
                          <p className="mt-2 text-xs text-slate-500">该节点没有工具调用记录。</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {node.toolCalls.map((toolCall) => (
                              <div key={toolCall.id} className="rounded-md border border-slate-200 bg-white p-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-xs font-medium text-slate-700">
                                    {toolCall.toolName ?? toolCall.toolId ?? "未命名工具"}
                                  </p>
                                  <StatusPill status={toolCall.status} />
                                  <span className="text-[11px] text-slate-500">
                                    耗时：{toolCall.durationMs !== undefined ? formatDuration(toolCall.durationMs) : "--"}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  开始：{toolCall.startedAt ? formatDateTime(toolCall.startedAt) : "--"}
                                  {" / "}
                                  结束：{toolCall.finishedAt ? formatDateTime(toolCall.finishedAt) : "--"}
                                </p>
                                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                                  <StructuredBlock
                                    title="Input Parameters"
                                    value={toolCall.input}
                                    emptyText="无入参记录"
                                    compact
                                  />
                                  <StructuredBlock
                                    title="Output Result"
                                    value={toolCall.output}
                                    emptyText="无输出记录"
                                    compact
                                  />
                                </div>
                                {toolCall.error ? <p className="mt-1 text-xs text-rose-600">错误：{toolCall.error}</p> : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">运行日志</h2>
            <span className="text-xs text-slate-500">
              共 {run.logs.length} 条 / 匹配 {filteredLogs.length} 条
            </span>
          </div>

          <div className="mb-3 grid gap-2 md:grid-cols-[auto_minmax(0,1fr)]">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as LogLevelFilter)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none ring-indigo-200 transition focus:ring-2"
            >
              <option value="all">全部级别</option>
              <option value="info">仅信息</option>
              <option value="warn">仅警告</option>
              <option value="error">仅错误</option>
            </select>
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              placeholder="按消息 / 类型 / 节点 ID 搜索"
            />
          </div>

          {filteredLogs.length === 0 ? (
            <p className="text-sm text-slate-500">当前筛选条件下没有日志。</p>
          ) : (
            <div className="max-h-[360px] space-y-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {filteredLogs.map((log) => (
                <div key={log.id} className="rounded-md border border-slate-200 bg-white px-2 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={
                        log.level === "error"
                          ? "text-rose-600"
                          : log.level === "warn"
                            ? "text-amber-700"
                            : "text-slate-500"
                      }
                    >
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-slate-400">{formatDateTime(log.time)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{log.type}</span>
                    {log.seq !== undefined ? <span className="text-slate-400">#{log.seq}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{log.message}</p>
                  {(log.nodeId || log.taskId) ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {log.nodeId ? `节点: ${log.nodeId}` : ""} {log.taskId ? `任务: ${log.taskId}` : ""}
                    </p>
                  ) : null}
                  {log.payload ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">运行产物</h2>
          {run.artifacts.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">本次运行尚未产生产物文件。</p>
          ) : (
            <div className="mt-2 space-y-2">
              {run.artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <Link
                    href={`/projects/${projectId}/files/${artifact.id}`}
                    className="text-sm font-medium text-slate-800 hover:text-indigo-600"
                  >
                    {artifact.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    类型：{artifact.type}
                    {artifact.size ? ` / 大小：${formatFileSize(artifact.size)}` : ""}
                    {" / "}
                    创建：{formatDateTime(artifact.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-800">Execution Debug</h2>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={debugNodeFilter}
              onChange={(e) => setDebugNodeFilter(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none"
            >
              <option value="all">全部节点</option>
              {run.nodeTraces.map((n) => (
                <option key={n.nodeId} value={n.nodeId}>{n.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadTraces}
              disabled={tracesLoading}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
            >
              {tracesLoading ? "加载中…" : traces ? "刷新" : "加载调试数据"}
            </button>
          </div>
        </div>

        <div className="mb-3 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {([
            { key: "node" as DebugTab, label: "Node Trace", icon: Cpu },
            { key: "prompt" as DebugTab, label: "Prompt Trace", icon: MessageSquare },
            { key: "tool" as DebugTab, label: "Tool Trace", icon: Wrench },
            { key: "state" as DebugTab, label: "State Trace", icon: GitCompare },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setDebugTab(key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                debugTab === key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {traces ? (
                <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  {key === "node" ? traces.nodeTraces.length
                    : key === "prompt" ? traces.promptTraces.length
                    : key === "tool" ? traces.toolTraces.length
                    : traces.stateTraces.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {!traces ? (
          <EmptyState text="点击「加载调试数据」查看节点执行追踪、Prompt、Tool 和 State 的详细信息。" />
        ) : (
          <div className="space-y-2">
            {debugTab === "node" && <NodeTracePanel traces={traces.nodeTraces} />}
            {debugTab === "prompt" && <PromptTracePanel traces={traces.promptTraces} nodeTraces={traces.nodeTraces} />}
            {debugTab === "tool" && <ToolTracePanel traces={traces.toolTraces} nodeTraces={traces.nodeTraces} />}
            {debugTab === "state" && <StateTracePanel traces={traces.stateTraces} nodeTraces={traces.nodeTraces} />}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">调试能力预留</h2>
        <p className="mt-1 text-xs text-slate-500">{run.replayHints.notes}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <PlaceholderCapability title="Node Replay" enabled={run.replayHints.nodeReplayReady} />
          <PlaceholderCapability title="Step Rerun" enabled={run.replayHints.stepRerunReady} />
          <PlaceholderCapability title="Run Compare" enabled={run.replayHints.runCompareReady} />
        </div>
      </section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Execution Debug Sub-panels
   ══════════════════════════════════════════════════════════ */

function NodeTracePanel({ traces }: { traces: NodeTraceView[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(traces[0]?.id ?? null);
  if (traces.length === 0) return <EmptyState text="暂无节点执行追踪数据。" />;
  return (
    <div className="space-y-2">
      {traces.map((t) => {
        const expanded = expandedId === t.id;
        return (
          <article key={t.id} className="rounded-lg border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : t.id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{t.nodeId.slice(0, 12)}…</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">{t.role}</span>
                  <StatusPill status={t.status === "completed" ? "success" : t.status === "failed" ? "failed" : "running"} />
                  {t.provider ? <span className="text-[10px] text-slate-400">{t.provider}/{t.model}</span> : null}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  耗时：{t.durationMs != null ? formatDuration(t.durationMs) : "--"}
                  {" · "}LLM 轮次：{t.llmRoundCount}{" · "}工具调用：{t.toolCallCount}
                  {t.totalTokens ? ` · Token：${formatNumber(t.totalTokens)}` : ""}
                </p>
              </div>
              {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {expanded && (
              <div className="space-y-2 border-t border-slate-200 bg-white px-3 py-3">
                <div className="grid gap-2 text-xs text-slate-600">
                  <p><b>Execution ID:</b> {t.executionId}</p>
                  <p><b>开始:</b> {formatDateTime(t.startedAt)} <b>结束:</b> {t.finishedAt ? formatDateTime(t.finishedAt) : "运行中"}</p>
                  {t.promptTokens != null && <p><b>Tokens:</b> Prompt {formatNumber(t.promptTokens)} / Completion {formatNumber(t.completionTokens ?? 0)} / Total {formatNumber(t.totalTokens ?? 0)}</p>}
                  {t.error && <p className="text-rose-600"><b>错误:</b> {t.error}</p>}
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  <StructuredBlock title="Resolved Input" value={t.resolvedInput} emptyText="无输入" compact />
                  <StructuredBlock title="Latest Output" value={t.latestOutput} emptyText="无输出" compact />
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function PromptTracePanel({ traces, nodeTraces }: { traces: PromptTraceView[]; nodeTraces: NodeTraceView[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(traces[0]?.id ?? null);
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const nt of nodeTraces) map.set(nt.nodeId, nt.nodeId.slice(0, 8));
    return map;
  }, [nodeTraces]);

  if (traces.length === 0) return <EmptyState text="暂无 Prompt 追踪数据。" />;
  return (
    <div className="space-y-2">
      {traces.map((t) => {
        const expanded = expandedId === t.id;
        return (
          <article key={t.id} className="rounded-lg border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : t.id)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">Round {t.round}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">{nodeNameMap.get(t.nodeId) ?? t.nodeId.slice(0, 8)}</span>
                  {t.provider && <span className="text-[10px] text-slate-400">{t.provider}/{t.model}</span>}
                  {t.totalTokens ? <span className="text-[10px] text-slate-400">Token: {formatNumber(t.totalTokens)}</span> : null}
                  {t.error ? <span className="text-[10px] text-rose-500">错误</span> : null}
                </div>
              </div>
              {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {expanded && (
              <div className="space-y-2 border-t border-slate-200 bg-white px-3 py-3">
                <StructuredBlock title="System Prompt" value={t.systemPrompt} emptyText="无 System Prompt" compact />
                <StructuredBlock title="User Prompt" value={t.userPrompt} emptyText="无 User Prompt" compact />
                <StructuredBlock title="Message History" value={t.messageHistoryJson} emptyText="无 Message History" compact />
                <StructuredBlock title="Completion" value={t.completion} emptyText="无 Completion" compact />
                {t.error && <p className="text-xs text-rose-600">错误：{t.error}</p>}
                <p className="text-[11px] text-slate-500">
                  {t.promptTokens != null && `Prompt: ${formatNumber(t.promptTokens)} / `}
                  {t.completionTokens != null && `Completion: ${formatNumber(t.completionTokens)} / `}
                  {t.totalTokens != null && `Total: ${formatNumber(t.totalTokens)}`}
                  {t.statusCode != null && ` · Status: ${t.statusCode}`}
                </p>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ToolTracePanel({ traces, nodeTraces }: { traces: ToolTraceView[]; nodeTraces: NodeTraceView[] }) {
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const nt of nodeTraces) map.set(nt.nodeId, nt.nodeId.slice(0, 8));
    return map;
  }, [nodeTraces]);

  if (traces.length === 0) return <EmptyState text="暂无工具调用追踪数据。" />;
  return (
    <div className="space-y-2">
      {traces.map((t) => (
        <article key={t.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-800">{t.toolName ?? t.toolId ?? "未知工具"}</span>
            <StatusPill status={t.status === "success" ? "success" : t.status === "failed" ? "failed" : "running"} />
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
              {nodeNameMap.get(t.nodeId) ?? t.nodeId.slice(0, 8)} · Round {t.round}
            </span>
            <span className="text-[11px] text-slate-500">
              耗时：{t.durationMs != null ? formatDuration(t.durationMs) : "--"}
            </span>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <StructuredBlock title="Input" value={t.inputJson} emptyText="无入参" compact />
            <StructuredBlock title="Output" value={t.outputJson} emptyText="无输出" compact />
          </div>
          {t.errorJson && (
            <div className="mt-2">
              <StructuredBlock title="Error" value={t.errorJson} emptyText="" compact />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function StateTracePanel({ traces, nodeTraces }: { traces: StateTraceView[]; nodeTraces: NodeTraceView[] }) {
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const nt of nodeTraces) map.set(nt.nodeId, nt.nodeId.slice(0, 8));
    return map;
  }, [nodeTraces]);

  const checkpointLabels: Record<string, string> = {
    pre_execution: "执行前",
    post_input_resolve: "输入解析后",
    post_llm: "LLM 调用后",
    post_execution: "执行完成",
  };

  if (traces.length === 0) return <EmptyState text="暂无状态追踪数据。" />;

  // Group by executionId for diff view
  const grouped = new Map<string, StateTraceView[]>();
  for (const t of traces) {
    const list = grouped.get(t.executionId) ?? [];
    list.push(t);
    grouped.set(t.executionId, list);
  }

  return (
    <div className="space-y-3">
      {[...grouped.entries()].map(([execId, items]) => (
        <article key={execId} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <GitCompare className="h-3.5 w-3.5 text-indigo-500" />
            <span className="text-xs font-semibold text-slate-700">
              {nodeNameMap.get(items[0].nodeId) ?? items[0].nodeId.slice(0, 8)}
            </span>
            <span className="text-[10px] text-slate-400">exec: {execId.slice(0, 12)}…</span>
          </div>
          <div className="relative ml-2 space-y-2 border-l-2 border-indigo-200 pl-4">
            {items.map((item, idx) => (
              <div key={item.id} className="relative">
                <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-indigo-300 bg-white" />
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    item.checkpoint === "post_execution"
                      ? item.nodeStatus === "failed" ? "bg-rose-100 text-rose-700" : "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-600"
                  }`}>
                    {checkpointLabels[item.checkpoint] ?? item.checkpoint}
                  </span>
                  {item.nodeStatus && <span className="text-[10px] text-slate-400">状态: {item.nodeStatus}</span>}
                  <span className="text-[10px] text-slate-400">{formatDateTime(item.createdAt)}</span>
                </div>
                {item.contextSnapshotJson && (
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                    {(() => {
                      try { return JSON.stringify(JSON.parse(item.contextSnapshotJson), null, 2); }
                      catch { return item.contextSnapshotJson; }
                    })()}
                  </pre>
                )}
                {item.metadataJson && (
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-600">
                    {(() => {
                      try { return JSON.stringify(JSON.parse(item.metadataJson), null, 2); }
                      catch { return item.metadataJson; }
                    })()}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function StructuredBlock({
  title,
  value,
  emptyText,
  compact,
}: {
  title: string;
  value: unknown;
  emptyText: string;
  compact?: boolean;
}) {
  let resolvedText = "";
  if (value !== null && value !== undefined) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          resolvedText = JSON.stringify(parsed, null, 2);
        } catch {
          resolvedText = trimmed;
        }
      }
    } else {
      try {
        resolvedText = JSON.stringify(value, null, 2);
      } catch {
        resolvedText = String(value);
      }
    }
  }

  return (
    <article className={`rounded-lg border border-slate-200 bg-white ${compact ? "p-2" : "p-3"}`}>
      <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
      {resolvedText ? (
        <pre
          className={`mt-2 whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 ${
            compact ? "p-2 text-[11px]" : "p-3 text-xs"
          } text-slate-600`}
        >
          {resolvedText}
        </pre>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{emptyText}</p>
      )}
    </article>
  );
}

function PlaceholderCapability({ title, enabled }: { title: string; enabled: boolean }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">
        {enabled ? "已预留结构，后续可继续接入执行能力。" : "当前为预留能力。"}
      </p>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
    </article>
  );
}

function StatusPill({ status }: { status: "running" | "success" | "failed" }) {
  if (status === "success") {
    return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">成功</span>;
  }
  if (status === "failed") {
    return <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">失败</span>;
  }
  return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">运行中</span>;
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "--";
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)} 秒`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
