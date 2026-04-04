export interface MetaAgentSessionSummaryView {
  sessionId: string;
  status: "running" | "done" | "error";
  resultStatus?: "success" | "failed" | "max_steps_reached" | "max_iterations_reached";
  goal: string;
  startedAt: string;
  currentPhase?: string;
  currentStep?: number;
  projectId: string;
  runStatus?: string;
  todoCount: number;
  doneTodoCount: number;
  issueCount: number;
  totalTokens: number;
  durationMs?: number;
  lastUpdatedAt?: string;
}

export type MetaAgentDisplayStatus = "running" | "success" | "failed";

export interface MetaAgentAnalyticsView {
  overview: {
    totalRuns: number;
    successCount: number;
    failedCount: number;
    runningCount: number;
    successRate?: number;
    avgDurationMs?: number;
    totalTokens: number;
    avgTodoCount: number;
    avgStepCount: number;
    avgIssueCount: number;
  };
  statusDistribution: Array<{
    status: "success" | "failed" | "running";
    count: number;
  }>;
  trend: Array<{
    date: string;
    runCount: number;
    successCount: number;
    failedCount: number;
    runningCount: number;
  }>;
  projectDistribution: Array<{
    projectId: string;
    totalTokens: number;
    runCount: number;
  }>;
  phaseDistribution: Array<{
    phase: string;
    count: number;
  }>;
}

export function getMetaAgentDisplayStatus(session: MetaAgentSessionSummaryView): MetaAgentDisplayStatus {
  if (session.status === "running") {
    return "running";
  }
  if (session.status === "error") {
    return "failed";
  }
  return session.resultStatus === "success" ? "success" : "failed";
}

export function buildMetaAgentAnalytics(
  sessions: MetaAgentSessionSummaryView[],
  rangeDays: 7 | 30,
  now = new Date(),
): MetaAgentAnalyticsView {
  const totals = {
    success: 0,
    failed: 0,
    running: 0,
    durationSum: 0,
    durationCount: 0,
    tokenSum: 0,
    todoSum: 0,
    stepSum: 0,
    issueSum: 0,
  };

  const phaseCounts = new Map<string, number>();
  const projectMap = new Map<string, { totalTokens: number; runCount: number }>();
  const dayBuckets = new Map<string, { runCount: number; successCount: number; failedCount: number; runningCount: number }>();

  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - offset);
    dayBuckets.set(day.toISOString().slice(0, 10), {
      runCount: 0,
      successCount: 0,
      failedCount: 0,
      runningCount: 0,
    });
  }

  for (const session of sessions) {
    const displayStatus = getMetaAgentDisplayStatus(session);
    if (displayStatus === "success") totals.success += 1;
    if (displayStatus === "failed") totals.failed += 1;
    if (displayStatus === "running") totals.running += 1;

    totals.tokenSum += Number(session.totalTokens ?? 0);
    totals.todoSum += Number(session.todoCount ?? 0);
    totals.stepSum += Number(session.currentStep ?? 0);
    totals.issueSum += Number(session.issueCount ?? 0);

    if (typeof session.durationMs === "number" && Number.isFinite(session.durationMs)) {
      totals.durationSum += session.durationMs;
      totals.durationCount += 1;
    }

    if (session.currentPhase) {
      phaseCounts.set(session.currentPhase, Number(phaseCounts.get(session.currentPhase) ?? 0) + 1);
    }

    const projectEntry = projectMap.get(session.projectId) ?? { totalTokens: 0, runCount: 0 };
    projectEntry.totalTokens += Number(session.totalTokens ?? 0);
    projectEntry.runCount += 1;
    projectMap.set(session.projectId, projectEntry);

    const dayKey = new Date(session.startedAt).toISOString().slice(0, 10);
    const bucket = dayBuckets.get(dayKey);
    if (!bucket) continue;
    bucket.runCount += 1;
    if (displayStatus === "success") bucket.successCount += 1;
    if (displayStatus === "failed") bucket.failedCount += 1;
    if (displayStatus === "running") bucket.runningCount += 1;
  }

  const completedCount = totals.success + totals.failed;

  return {
    overview: {
      totalRuns: sessions.length,
      successCount: totals.success,
      failedCount: totals.failed,
      runningCount: totals.running,
      successRate: completedCount > 0 ? Math.round((totals.success / completedCount) * 100) : undefined,
      avgDurationMs: totals.durationCount > 0 ? Math.round(totals.durationSum / totals.durationCount) : undefined,
      totalTokens: totals.tokenSum,
      avgTodoCount: sessions.length > 0 ? Number((totals.todoSum / sessions.length).toFixed(1)) : 0,
      avgStepCount: sessions.length > 0 ? Number((totals.stepSum / sessions.length).toFixed(1)) : 0,
      avgIssueCount: sessions.length > 0 ? Number((totals.issueSum / sessions.length).toFixed(1)) : 0,
    },
    statusDistribution: [
      { status: "success", count: totals.success },
      { status: "failed", count: totals.failed },
      { status: "running", count: totals.running },
    ],
    trend: Array.from(dayBuckets.entries()).map(([date, bucket]) => ({
      date,
      ...bucket,
    })),
    projectDistribution: Array.from(projectMap.entries())
      .map(([projectId, entry]) => ({
        projectId,
        totalTokens: entry.totalTokens,
        runCount: entry.runCount,
      }))
      .sort((a, b) => b.runCount - a.runCount || b.totalTokens - a.totalTokens)
      .slice(0, 8),
    phaseDistribution: Array.from(phaseCounts.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

async function resolveHttpError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) return payload.error;
  } catch {
    // ignore
  }
  return `${fallback}（HTTP ${response.status}）`;
}

export const metaAgentClient = {
  async listSessions(input?: { projectId?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (input?.projectId) query.set("projectId", input.projectId);
    if (input?.limit) query.set("limit", String(input.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const response = await fetch(`/api/meta-agent${suffix}`);
    if (!response.ok) {
      throw new Error(await resolveHttpError(response, "获取 Meta-Agent 会话失败"));
    }
    return (await response.json()) as {
      message: string;
      sessions: MetaAgentSessionSummaryView[];
    };
  },
};
