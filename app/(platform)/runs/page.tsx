"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  runtimeClient,
  type ProjectSummaryView,
  type RunAnalyticsView,
  type RunListResponseView,
  type RunRecordView,
} from "@/features/workflow/adapters/runtime-client";
import {
  ChartCard,
  NodeDurationRankingChart,
  NodeFailureRankingChart,
  RunsStatusPieChart,
  RunsTrendChart,
  WorkflowTokenBarChart,
} from "./components/runs-analytics-charts";

type RunScope = "workflow_run" | "dev_run";
type RunFilter = "all" | "running" | "success" | "failed";
type RunSort = "time_desc" | "time_asc" | "duration_desc" | "duration_asc" | "tokens_desc" | "tokens_asc";
type TrendRange = 7 | 30;

export default function RunsCenterPage() {
  const [scope, setScope] = useState<RunScope>("workflow_run");

  const [runs, setRuns] = useState<RunRecordView[]>([]);
  const [summary, setSummary] = useState<RunListResponseView["summary"]>();
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runError, setRunError] = useState("");
  const [filter, setFilter] = useState<RunFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<RunSort>("time_desc");

  const [trendRange, setTrendRange] = useState<TrendRange>(7);
  const [analytics, setAnalytics] = useState<RunAnalyticsView>();
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");

  // Load projects once
  useEffect(() => {
    let active = true;
    runtimeClient.listProjects({ includeArchived: true })
      .then((payload) => { if (active) setProjects(payload.projects); })
      .catch(() => { if (active) setProjects([]); });
    return () => { active = false; };
  }, []);

  // Load runs whenever scope/filter/keyword/sort changes
  useEffect(() => {
    let active = true;
    setLoadingRuns(true);
    setRunError("");
    runtimeClient.listRuns({
      limit: 300,
      status: filter === "all" ? undefined : filter,
      q: keyword.trim() || undefined,
      sort,
      runType: scope,
    })
      .then((payload) => {
        if (!active) return;
        setRuns(payload.runs);
        setSummary(payload.summary);
      })
      .catch((error) => {
        if (!active) return;
        setRunError(error instanceof Error ? error.message : "加载运行记录失败");
      })
      .finally(() => { if (active) setLoadingRuns(false); });
    return () => { active = false; };
  }, [filter, keyword, sort, scope]);

  // Load analytics whenever scope/trendRange changes
  useEffect(() => {
    let active = true;
    setLoadingAnalytics(true);
    setAnalyticsError("");
    runtimeClient.getRunsAnalytics(trendRange, scope)
      .then((payload) => {
        if (!active) return;
        setAnalytics(payload.analytics);
      })
      .catch((error) => {
        if (!active) return;
        setAnalyticsError(error instanceof Error ? error.message : "加载运行分析失败");
      })
      .finally(() => { if (active) setLoadingAnalytics(false); });
    return () => { active = false; };
  }, [trendRange, scope]);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectSummaryView>();
    for (const item of projects) map.set(item.id, item);
    return map;
  }, [projects]);

  const overview = analytics?.overview;
  const totalRuns = overview?.totalRuns ?? summary?.totalRuns ?? runs.length;
  const successRate = overview?.successRate
    ?? (() => {
      const success = summary?.successCount ?? 0;
      const failed = summary?.failedCount ?? 0;
      const finished = success + failed;
      if (finished <= 0) return undefined;
      return Math.round((success / finished) * 100);
    })();

  const isWorkflow = scope === "workflow_run";

  return (
    <div className="space-y-5">
      {/* ── Top-level scope tabs ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">运行中心</h1>
            <p className="mt-1 text-sm text-slate-500">
              {isWorkflow
                ? "工作流运行分析，快速定位性能瓶颈和失败热点。"
                : "开发运行分析，追踪脚本执行历史和成功率。"
              }
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            <ScopeTab
              active={scope === "workflow_run"}
              onClick={() => scope !== "workflow_run" && setScope("workflow_run")}
              label="工作流运行"
            />
            <ScopeTab
              active={scope === "dev_run"}
              onClick={() => scope !== "dev_run" && setScope("dev_run")}
              label="开发运行"
            />
          </div>
        </div>

        {/* Metrics */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="总运行数" value={formatNumber(totalRuns)} />
          <MetricCard title="成功率" value={typeof successRate === "number" ? `${successRate}%` : "--"} />
          <MetricCard
            title="平均耗时"
            value={typeof overview?.avgDurationMs === "number" ? formatDuration(overview.avgDurationMs) : "--"}
          />
          <MetricCard
            title={isWorkflow ? "Token 总消耗" : "运行次数"}
            value={isWorkflow
              ? (overview?.tokenUsageAvailable ? formatNumber(overview.totalTokens ?? 0) : "--")
              : formatNumber(totalRuns)
            }
            hint={isWorkflow
              ? (overview?.tokenUsageAvailable ? "来自真实 LLM 返回统计" : "当前区间暂无可用 Token 数据")
              : undefined
            }
          />
        </div>
      </section>

      {/* ── Charts ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isWorkflow ? "工作流运行分析" : "开发运行分析"}
            </h2>
            <p className="text-sm text-slate-500">
              {isWorkflow
                ? "按时间范围查看运行趋势、稳定性、Token 消耗与节点表现。"
                : "按时间范围查看脚本运行趋势与成功率分布。"
              }
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <RangeButton active={trendRange === 7} onClick={() => trendRange !== 7 && setTrendRange(7)} label="最近 7 天" />
            <RangeButton active={trendRange === 30} onClick={() => trendRange !== 30 && setTrendRange(30)} label="最近 30 天" />
          </div>
        </div>

        {analyticsError ? <p className="text-sm text-rose-600">{analyticsError}</p> : null}
        {loadingAnalytics ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载运行分析...
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="运行趋势（折线图）" subtitle={`最近 ${trendRange} 天运行/成功/失败数量`}>
              <RunsTrendChart data={analytics?.trend ?? []} />
            </ChartCard>
            <ChartCard title="成功率分布（饼图）" subtitle="成功 / 失败 / 运行中">
              <RunsStatusPieChart data={analytics?.statusDistribution ?? []} />
            </ChartCard>
            {isWorkflow && (
              <>
                <ChartCard title="工作流 Token 使用（柱状图）" subtitle="按工作流汇总 Token 总量">
                  <WorkflowTokenBarChart data={analytics?.workflowTokenUsage ?? []} />
                </ChartCard>
                <ChartCard title="节点耗时排行（横向柱状图）" subtitle="按节点平均耗时排序">
                  <NodeDurationRankingChart data={analytics?.nodeDurationRanking ?? []} />
                </ChartCard>
                <div className="xl:col-span-2">
                  <ChartCard title="节点失败率排行（柱状图）" subtitle="按节点失败率排序，快速定位不稳定节点">
                    <NodeFailureRankingChart data={analytics?.nodeFailureRanking ?? []} />
                  </ChartCard>
                </div>
              </>
            )}
            {!isWorkflow && (
              <ChartCard title="脚本运行耗时分布" subtitle="按脚本名称汇总运行次数与耗时">
                <WorkflowTokenBarChart data={analytics?.workflowTokenUsage ?? []} />
              </ChartCard>
            )}
          </div>
        )}
      </section>

      {/* ── Run list ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
        <h2 className="text-base font-semibold text-slate-900">
          {isWorkflow ? "工作流运行列表" : "开发运行列表"}
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip active={filter === "all"} onClick={() => filter !== "all" && setFilter("all")} label="全部" />
          <FilterChip active={filter === "running"} onClick={() => filter !== "running" && setFilter("running")} label="运行中" />
          <FilterChip active={filter === "success"} onClick={() => filter !== "success" && setFilter("success")} label="成功" />
          <FilterChip active={filter === "failed"} onClick={() => filter !== "failed" && setFilter("failed")} label="失败" />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as RunSort)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none ring-indigo-200 transition focus:ring-2"
          >
            <option value="time_desc">按时间（最新）</option>
            <option value="time_asc">按时间（最早）</option>
            <option value="duration_desc">按耗时（最长）</option>
            <option value="duration_asc">按耗时（最短）</option>
            {isWorkflow && <option value="tokens_desc">按 Token（最多）</option>}
            {isWorkflow && <option value="tokens_asc">按 Token（最少）</option>}
          </select>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="ml-auto h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
            placeholder={isWorkflow ? "按工作流名 / runId 搜索" : "按命令 / runId 搜索"}
          />
        </div>
        {runError ? <p className="mt-2 text-xs text-rose-600">{runError}</p> : null}

        <div className="mt-4">
          {loadingRuns ? (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载运行记录...
            </div>
          ) : null}

          {!loadingRuns && runs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-700">暂无匹配的运行记录</p>
              <p className="mt-1 text-sm text-slate-500">
                {isWorkflow ? "可调整筛选条件，或先在工作流编辑器里发起一次运行。" : "可在开发台中运行脚本，记录会自动出现在这里。"}
              </p>
            </div>
          ) : null}

          {!loadingRuns && runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map((run) => {
                const project = run.projectId ? projectMap.get(run.projectId) : undefined;
                return (
                  <article
                    key={run.id}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{run.workflowName}</p>
                          <StatusPill status={run.status} />
                        </div>
                        <p className="text-xs text-slate-500">
                          来源：{run.runType === "dev_run" ? "开发台" : (project?.name ?? (run.projectId ? `项目 ${run.projectId}` : "工作区"))}
                          {run.workflowId ? ` / ${run.workflowId}` : ""}
                        </p>
                        <p className="text-xs text-slate-400">
                          开始：{new Date(run.startedAt).toLocaleString("zh-CN")}
                          {" / "}
                          耗时：{typeof run.durationMs === "number" ? formatDuration(run.durationMs) : "--"}
                          {isWorkflow ? ` / Token：${run.tokenUsageAvailable ? formatNumber(run.totalTokens ?? 0) : "--"}` : ""}
                        </p>
                        <p className="text-[11px] text-slate-400">runId：{run.id}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {run.runType === "dev_run" ? (
                          <Link
                            href="/agent-dev"
                            className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            打开开发台
                          </Link>
                        ) : run.projectId && run.workflowId ? (
                          <Link
                            href={`/projects/${run.projectId}/workflows/${run.workflowId}`}
                            className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            打开工作流
                          </Link>
                        ) : null}
                        {run.projectId ? (
                          <Link
                            href={`/projects/${run.projectId}/runs/${run.id}`}
                            className="inline-flex h-9 items-center rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600"
                          >
                            运行详情
                          </Link>
                        ) : run.runType !== "dev_run" ? (
                          <span className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-xs text-slate-400">
                            无项目上下文
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ScopeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? "bg-indigo-500 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

function MetricCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </article>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-sm transition ${
        active ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function RangeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition ${
        active ? "bg-indigo-500 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: RunRecordView["status"] }) {
  if (status === "success") {
    return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">成功</span>;
  }
  if (status === "failed") {
    return <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">失败</span>;
  }
  return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">运行中</span>;
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "--";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
