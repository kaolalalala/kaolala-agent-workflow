"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  buildMetaAgentAnalytics,
  getMetaAgentDisplayStatus,
  metaAgentClient,
  type MetaAgentSessionSummaryView,
} from "@/features/meta-agent/adapters/meta-agent-client";
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

type RunScope = "workflow_run" | "dev_run" | "meta_agent_run";
type RunFilter = "all" | "running" | "success" | "failed";
type RunSort = "time_desc" | "time_asc" | "duration_desc" | "duration_asc" | "tokens_desc" | "tokens_asc";
type TrendRange = 7 | 30;

function normalizeRunScope(value: string | null): RunScope {
  return value === "dev_run" || value === "meta_agent_run" || value === "workflow_run"
    ? value
    : "workflow_run";
}

export default function RunsCenterPage() {
  return (
    <Suspense fallback={<RunsCenterFallback />}>
      <RunsCenterPageContent />
    </Suspense>
  );
}

function RunsCenterPageContent() {
  const searchParams = useSearchParams();
  const initialScope = normalizeRunScope(searchParams.get("scope"));
  const initialProjectFilter = searchParams.get("projectId") ?? "";
  return (
    <RunsCenterView
      key={`${initialScope}:${initialProjectFilter}`}
      initialScope={initialScope}
      initialProjectFilter={initialProjectFilter}
    />
  );
}

function RunsCenterFallback() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
      正在加载运行中心...
    </div>
  );
}

function RunsCenterView({
  initialScope,
  initialProjectFilter,
}: {
  initialScope: RunScope;
  initialProjectFilter: string;
}) {
  const [scope, setScope] = useState<RunScope>(initialScope);
  const [runs, setRuns] = useState<RunRecordView[]>([]);
  const [metaAgentSessions, setMetaAgentSessions] = useState<MetaAgentSessionSummaryView[]>([]);
  const [summary, setSummary] = useState<RunListResponseView["summary"]>();
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runError, setRunError] = useState("");
  const [filter, setFilter] = useState<RunFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<RunSort>("time_desc");
  const [trendRange, setTrendRange] = useState<TrendRange>(7);
  const [projectFilter, setProjectFilter] = useState(initialProjectFilter);
  const [analytics, setAnalytics] = useState<RunAnalyticsView>();
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");

  useEffect(() => {
    let active = true;
    runtimeClient.listProjects({ includeArchived: true })
      .then((payload) => {
        if (!active) return;
        setProjects(payload.projects);
      })
      .catch(() => {
        if (!active) return;
        setProjects([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle resets loading immediately when scope/filter changes.
    setLoadingRuns(true);
    setRunError("");

    if (scope === "meta_agent_run") {
      metaAgentClient.listSessions({ limit: 300, projectId: projectFilter || undefined })
        .then((payload) => {
          if (!active) return;
          setMetaAgentSessions(payload.sessions);
          setRuns([]);
          setSummary(undefined);
        })
        .catch((error) => {
          if (!active) return;
          setRunError(error instanceof Error ? error.message : "加载 Meta-Agent 会话失败");
        })
        .finally(() => {
          if (!active) return;
          setLoadingRuns(false);
        });
      return () => {
        active = false;
      };
    }

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
        setMetaAgentSessions([]);
        setSummary(payload.summary);
      })
      .catch((error) => {
        if (!active) return;
        setRunError(error instanceof Error ? error.message : "加载运行记录失败");
      })
      .finally(() => {
        if (!active) return;
        setLoadingRuns(false);
      });

    return () => {
      active = false;
    };
  }, [filter, keyword, projectFilter, scope, sort]);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- analytics fetch is coupled to scope/range changes and needs eager loading state.
    setLoadingAnalytics(true);
    setAnalyticsError("");

    if (scope === "meta_agent_run") {
      setAnalytics(undefined);
      setLoadingAnalytics(false);
      return () => {
        active = false;
      };
    }

    runtimeClient.getRunsAnalytics(trendRange, scope)
      .then((payload) => {
        if (!active) return;
        setAnalytics(payload.analytics);
      })
      .catch((error) => {
        if (!active) return;
        setAnalyticsError(error instanceof Error ? error.message : "加载运行分析失败");
      })
      .finally(() => {
        if (!active) return;
        setLoadingAnalytics(false);
      });

    return () => {
      active = false;
    };
  }, [scope, trendRange]);

  const isWorkflow = scope === "workflow_run";
  const isMetaAgent = scope === "meta_agent_run";

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectSummaryView>();
    for (const item of projects) {
      map.set(item.id, item);
    }
    return map;
  }, [projects]);
  const activeProject = projectFilter ? projectMap.get(projectFilter) : undefined;

  const filteredMetaAgentSessions = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    const next = metaAgentSessions.filter((session) => {
      const displayStatus = getMetaAgentDisplayStatus(session);
      if (filter !== "all" && displayStatus !== filter) {
        return false;
      }
      if (!key) return true;
      return (
        session.goal.toLowerCase().includes(key)
        || session.sessionId.toLowerCase().includes(key)
        || session.projectId.toLowerCase().includes(key)
        || String(session.currentPhase ?? "").toLowerCase().includes(key)
      );
    });

    next.sort((a, b) => {
      if (sort === "time_asc") return Date.parse(a.startedAt) - Date.parse(b.startedAt);
      if (sort === "duration_desc") return Number(b.durationMs ?? -1) - Number(a.durationMs ?? -1);
      if (sort === "duration_asc") return Number(a.durationMs ?? Number.MAX_SAFE_INTEGER) - Number(b.durationMs ?? Number.MAX_SAFE_INTEGER);
      if (sort === "tokens_desc") return Number(b.totalTokens ?? 0) - Number(a.totalTokens ?? 0);
      if (sort === "tokens_asc") return Number(a.totalTokens ?? 0) - Number(b.totalTokens ?? 0);
      return Date.parse(b.startedAt) - Date.parse(a.startedAt);
    });

    return next;
  }, [filter, keyword, metaAgentSessions, sort]);

  const metaAnalytics = useMemo(
    () => buildMetaAgentAnalytics(metaAgentSessions, trendRange),
    [metaAgentSessions, trendRange],
  );

  const metaAgentProjectChartData = useMemo(
    () => metaAnalytics.projectDistribution.map((item) => ({
      workflowId: item.projectId,
      workflowName: projectMap.get(item.projectId)?.name ?? item.projectId,
      totalTokens: item.totalTokens,
      runCount: item.runCount,
    })),
    [metaAnalytics, projectMap],
  );

  const overview = isMetaAgent ? metaAnalytics.overview : analytics?.overview;
  const totalRuns = isMetaAgent
    ? (overview?.totalRuns ?? metaAgentSessions.length)
    : (overview?.totalRuns ?? summary?.totalRuns ?? runs.length);
  const successRate = isMetaAgent
    ? overview?.successRate
    : overview?.successRate
      ?? (() => {
        const success = summary?.successCount ?? 0;
        const failed = summary?.failedCount ?? 0;
        const finished = success + failed;
        if (finished <= 0) return undefined;
        return Math.round((success / finished) * 100);
      })();
  const metricValue = isMetaAgent
    ? formatNumber(metaAnalytics.overview.totalTokens)
    : isWorkflow
      ? (analytics?.overview.tokenUsageAvailable ? formatNumber(analytics.overview.totalTokens ?? 0) : "--")
      : formatNumber(totalRuns);
  const metricHint = isMetaAgent
    ? `todo=${metaAnalytics.overview.avgTodoCount} / step=${metaAnalytics.overview.avgStepCount} / issue=${metaAnalytics.overview.avgIssueCount}`
    : isWorkflow
      ? (analytics?.overview.tokenUsageAvailable ? "Token 用量来自运行时 trace 统计。" : "当前范围内暂无 Token 用量数据。")
      : undefined;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">运行中心</h1>
            <p className="mt-1 text-sm text-slate-500">
              {isWorkflow
                ? "查看工作流执行分析、失败热点与 Token 可见性。"
                : isMetaAgent
                  ? "查看 Meta-Agent 会话、控制进度与平台级执行可观测性。"
                  : "查看 Agent Dev 的开发运行分析与执行历史。"}
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            <ScopeTab active={scope === "workflow_run"} onClick={() => setScope("workflow_run")} label="工作流" />
            <ScopeTab active={scope === "dev_run"} onClick={() => setScope("dev_run")} label="开发" />
            <ScopeTab active={scope === "meta_agent_run"} onClick={() => setScope("meta_agent_run")} label="Meta-Agent" />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="运行总数" value={formatNumber(totalRuns)} />
          <MetricCard title="成功率" value={typeof successRate === "number" ? `${successRate}%` : "--"} />
          <MetricCard title="平均耗时" value={typeof overview?.avgDurationMs === "number" ? formatDuration(overview.avgDurationMs) : "--"} />
          <MetricCard
            title={isMetaAgent ? "Token / Todo 平均" : isWorkflow ? "总 Token" : "运行数量"}
            value={metricValue}
            hint={metricHint}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isWorkflow ? "工作流分析" : isMetaAgent ? "Meta-Agent 分析" : "开发运行分析"}
            </h2>
            <p className="text-sm text-slate-500">
              {isWorkflow
                ? "查看趋势、成功率、Token 用量与节点稳定性。"
                : isMetaAgent
                  ? "查看趋势、成功分布、项目分布与活跃规划阶段。"
                  : "查看开发运行的趋势与成功率。"}
            </p>
            {isMetaAgent && activeProject && (
              <p className="mt-1 text-xs text-indigo-600">
                当前按项目筛选: {activeProject.name}
              </p>
            )}
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <RangeButton active={trendRange === 7} onClick={() => setTrendRange(7)} label="近 7 天" />
            <RangeButton active={trendRange === 30} onClick={() => setTrendRange(30)} label="近 30 天" />
          </div>
        </div>

        {analyticsError ? <p className="text-sm text-rose-600">{analyticsError}</p> : null}

        {(loadingAnalytics || (isMetaAgent && loadingRuns)) ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载运行分析...
          </div>
        ) : isMetaAgent ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="会话趋势" subtitle={`最近 ${trendRange} 天的运行变化`}>
              <RunsTrendChart data={metaAnalytics.trend} />
            </ChartCard>
            <ChartCard title="状态分布" subtitle="成功 / 失败 / 运行中">
              <RunsStatusPieChart data={metaAnalytics.statusDistribution} />
            </ChartCard>
            <ChartCard title="项目分布" subtitle="按 Meta-Agent Token 用量统计的项目">
              <WorkflowTokenBarChart data={metaAgentProjectChartData} />
            </ChartCard>
            <ChartCard title="阶段分布" subtitle="活跃与历史会话的当前阶段">
              <div className="space-y-2">
                {metaAnalytics.phaseDistribution.length === 0 ? (
                  <p className="text-sm text-slate-500">当前还没有阶段信号。</p>
                ) : metaAnalytics.phaseDistribution.map((item) => (
                  <div key={item.phase} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-700">{item.phase}</span>
                    <span className="font-medium text-slate-900">{item.count}</span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="运行趋势" subtitle={`最近 ${trendRange} 天的运行变化`}>
              <RunsTrendChart data={analytics?.trend ?? []} />
            </ChartCard>
            <ChartCard title="状态分布" subtitle="成功 / 失败 / 运行中">
              <RunsStatusPieChart data={analytics?.statusDistribution ?? []} />
            </ChartCard>
            {isWorkflow ? (
              <>
                <ChartCard title="工作流 Token 用量" subtitle="按工作流分组">
                  <WorkflowTokenBarChart data={analytics?.workflowTokenUsage ?? []} />
                </ChartCard>
                <ChartCard title="最慢节点" subtitle="按平均耗时排序">
                  <NodeDurationRankingChart data={analytics?.nodeDurationRanking ?? []} />
                </ChartCard>
                <div className="xl:col-span-2">
                  <ChartCard title="节点失败排行" subtitle="按节点失败率排序">
                    <NodeFailureRankingChart data={analytics?.nodeFailureRanking ?? []} />
                  </ChartCard>
                </div>
              </>
            ) : (
              <ChartCard title="运行来源分布" subtitle="按运行来源分组">
                <WorkflowTokenBarChart data={analytics?.workflowTokenUsage ?? []} />
              </ChartCard>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
        <h2 className="text-base font-semibold text-slate-900">
          {isWorkflow ? "工作流运行记录" : isMetaAgent ? "Meta-Agent 会话" : "开发运行记录"}
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="全部" />
          <FilterChip active={filter === "running"} onClick={() => setFilter("running")} label="运行中" />
          <FilterChip active={filter === "success"} onClick={() => setFilter("success")} label="成功" />
          <FilterChip active={filter === "failed"} onClick={() => setFilter("failed")} label="失败" />

          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as RunSort)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none ring-indigo-200 transition focus:ring-2"
          >
            <option value="time_desc">最新优先</option>
            <option value="time_asc">最早优先</option>
            <option value="duration_desc">耗时最长</option>
            <option value="duration_asc">耗时最短</option>
            {(isWorkflow || isMetaAgent) && <option value="tokens_desc">Token 最多</option>}
            {(isWorkflow || isMetaAgent) && <option value="tokens_asc">Token 最少</option>}
          </select>

          {isMetaAgent && (
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none ring-indigo-200 transition focus:ring-2"
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}

          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="ml-auto h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
            placeholder={isMetaAgent ? "搜索目标 / sessionId / 项目" : "搜索工作流 / runId"}
          />
        </div>

        {isMetaAgent && activeProject && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">
              项目筛选: {activeProject.name}
            </span>
            <Link
              href={`/projects/${activeProject.id}`}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:bg-slate-50"
            >
              打开项目
            </Link>
            <Link
              href={`/meta-agent?projectId=${encodeURIComponent(activeProject.id)}`}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:bg-slate-50"
            >
              打开 Meta-Agent 项目视图
            </Link>
            <button
              type="button"
              onClick={() => setProjectFilter("")}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:bg-slate-50"
            >
              清空筛选
            </button>
          </div>
        )}

        {runError ? <p className="mt-2 text-xs text-rose-600">{runError}</p> : null}

        <div className="mt-4">
          {loadingRuns ? (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载运行记录...
            </div>
          ) : null}

          {!loadingRuns && isMetaAgent && filteredMetaAgentSessions.length === 0 ? (
            <EmptyState
              title="没有匹配的 Meta-Agent 会话"
              description="可以调整筛选条件，或前往 Meta-Agent 页面发起新的会话。"
            />
          ) : null}

          {!loadingRuns && !isMetaAgent && runs.length === 0 ? (
            <EmptyState
              title="没有匹配的运行记录"
              description={isWorkflow ? "启动一次工作流运行后会显示在这里。" : "从 Agent Dev 发起运行后会显示在这里。"}
            />
          ) : null}

          {!loadingRuns && isMetaAgent && filteredMetaAgentSessions.length > 0 ? (
            <div className="space-y-2">
              {filteredMetaAgentSessions.map((session) => {
                const project = projectMap.get(session.projectId);
                const displayStatus = getMetaAgentDisplayStatus(session);
                return (
                  <article
                    key={session.sessionId}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{session.goal}</p>
                          <StatusPill status={displayStatus} />
                        </div>
                        <p className="text-xs text-slate-500">
                          项目={project?.name ?? session.projectId}
                          {session.currentPhase ? ` / 阶段=${session.currentPhase}` : ""}
                          {typeof session.currentStep === "number" ? ` / 步骤=${session.currentStep}` : ""}
                        </p>
                        <p className="text-xs text-slate-400">
                          开始于={new Date(session.startedAt).toLocaleString("zh-CN")}
                          {" / "}
                          耗时={typeof session.durationMs === "number" ? formatDuration(session.durationMs) : "--"}
                          {" / "}
                          Todo={session.doneTodoCount}/{session.todoCount}
                          {" / "}
                          问题数={session.issueCount}
                          {" / "}
                          Token={formatNumber(session.totalTokens)}
                        </p>
                        <p className="text-[11px] text-slate-400">sessionId={session.sessionId}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/projects/${session.projectId}`}
                          className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50"
                        >
                          项目
                        </Link>
                        <Link
                          href={`/meta-agent?sessionId=${encodeURIComponent(session.sessionId)}`}
                          className="inline-flex h-9 items-center rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600"
                        >
                          打开 Meta-Agent
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {!loadingRuns && !isMetaAgent && runs.length > 0 ? (
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
                          来源={run.runType === "dev_run" ? "Agent Dev" : (project?.name ?? (run.projectId ? `项目 ${run.projectId}` : "工作区"))}
                          {run.workflowId ? ` / ${run.workflowId}` : ""}
                        </p>
                        <p className="text-xs text-slate-400">
                          开始于={new Date(run.startedAt).toLocaleString("zh-CN")}
                          {" / "}
                          耗时={typeof run.durationMs === "number" ? formatDuration(run.durationMs) : "--"}
                          {isWorkflow ? ` / Token=${run.tokenUsageAvailable ? formatNumber(run.totalTokens ?? 0) : "--"}` : ""}
                        </p>
                        <p className="text-[11px] text-slate-400">runId={run.id}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {run.runType === "dev_run" ? (
                          <Link
                            href="/agent-dev"
                            className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            打开 Agent Dev
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
                            缺少项目上下文
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

function StatusPill({ status }: { status: "running" | "success" | "failed" }) {
  if (status === "success") {
    return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">成功</span>;
  }
  if (status === "failed") {
    return <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">失败</span>;
  }
  return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">运行中</span>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "--";
  if (durationMs < 1_000) return `${Math.round(durationMs)} 毫秒`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  return `${minutes}分 ${seconds}秒`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}
