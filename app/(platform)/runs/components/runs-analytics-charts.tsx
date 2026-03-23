"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { RunAnalyticsView } from "@/features/workflow/adapters/runtime-client";

const STATUS_COLORS: Record<RunAnalyticsView["statusDistribution"][number]["status"], string> = {
  success: "#16a34a",
  failed: "#e11d48",
  running: "#f59e0b",
};

const LINE_COLORS = {
  runCount: "#4f46e5",
  successCount: "#16a34a",
  failedCount: "#e11d48",
};

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="h-64">{children}</div>
    </article>
  );
}

export function RunsTrendChart({ data }: { data: RunAnalyticsView["trend"] }) {
  if (!data.length) {
    return <EmptyChart text="暂无运行趋势数据" />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#64748b" }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="runCount" name="运行总数" stroke={LINE_COLORS.runCount} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="successCount" name="成功" stroke={LINE_COLORS.successCount} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="failedCount" name="失败" stroke={LINE_COLORS.failedCount} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RunsStatusPieChart({ data }: { data: RunAnalyticsView["statusDistribution"] }) {
  const pieData = data.filter((item) => item.count > 0);
  if (!pieData.length) {
    return <EmptyChart text="暂无状态分布数据" />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Pie
          data={pieData}
          dataKey="count"
          nameKey="status"
          cx="50%"
          cy="50%"
          outerRadius={88}
          labelLine={false}
          label={({ name, percent }) => `${statusToLabel(String(name))} ${((percent ?? 0) * 100).toFixed(0)}%`}
        >
          {pieData.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function WorkflowTokenBarChart({ data }: { data: RunAnalyticsView["workflowTokenUsage"] }) {
  if (!data.length) {
    return <EmptyChart text="当前范围没有可用的 Token 统计" />;
  }
  const chartData = data.map((item) => ({
    name: item.workflowName,
    totalTokens: item.totalTokens,
    runCount: item.runCount,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} interval={0} angle={-20} textAnchor="end" height={56} />
        <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
        <Bar dataKey="totalTokens" name="Token 总量" fill="#6366f1" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function NodeDurationRankingChart({ data }: { data: RunAnalyticsView["nodeDurationRanking"] }) {
  if (!data.length) {
    return <EmptyChart text="暂无节点耗时数据" />;
  }
  const chartData = data.map((item) => ({
    label: `${item.nodeName} (${item.role})`,
    avgDurationMs: item.avgDurationMs,
    runCount: item.runCount,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 12, left: 24, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} />
        <YAxis type="category" dataKey="label" width={148} tick={{ fontSize: 12, fill: "#64748b" }} />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
        <Bar dataKey="avgDurationMs" name="平均耗时(ms)" fill="#0ea5e9" radius={[0, 8, 8, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function NodeFailureRankingChart({ data }: { data: RunAnalyticsView["nodeFailureRanking"] }) {
  if (!data.length) {
    return <EmptyChart text="暂无节点失败率数据" />;
  }
  const chartData = data.map((item) => ({
    label: `${item.nodeName} (${item.role})`,
    failRate: Number(item.failRate.toFixed(2)),
    failCount: item.failCount,
    runCount: item.runCount,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} interval={0} angle={-18} textAnchor="end" height={54} />
        <YAxis tick={{ fontSize: 12, fill: "#64748b" }} unit="%" />
        <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
        <Bar dataKey="failRate" name="失败率(%)" fill="#f97316" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
      {text}
    </div>
  );
}

function statusToLabel(status: string) {
  if (status === "success") {
    return "成功";
  }
  if (status === "failed") {
    return "失败";
  }
  return "运行中";
}
