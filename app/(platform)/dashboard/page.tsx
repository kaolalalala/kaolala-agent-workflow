import Link from "next/link";
import { type ReactNode } from "react";
import { Activity, FileText, FolderKanban, PlayCircle, Workflow } from "lucide-react";

import { runService } from "@/server/api/run-service";

export default function DashboardPage() {
  const projects = runService.listProjects().projects;
  const runs = runService.listRuns(20).runs;
  const workflows = runService.listWorkflows().workflows;
  const files = runService.listRecentFiles(10).files;

  const runningCount = runs.filter((item) => item.status === "running").length;
  const successCount = runs.filter((item) => item.status === "success").length;
  const failedCount = runs.filter((item) => item.status === "failed").length;
  const finishedCount = successCount + failedCount;
  const successRate = finishedCount > 0 ? `${Math.round((successCount / finishedCount) * 100)}%` : "--";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 px-6 py-5 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.32),0_10px_18px_-16px_rgba(15,23,42,0.18)]">
        <p className="text-xs font-medium text-slate-500">首页 / 仪表盘</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">欢迎回来，今天继续推进你的 Agent 项目</h1>
        <p className="mt-1 text-sm text-slate-500">以下数据均来自真实项目、工作流、运行记录和文件产物。</p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="项目总数" value={String(projects.length)} hint="已创建项目" icon={<FolderKanban className="h-4 w-4" />} />
        <MetricCard title="工作流总数" value={String(workflows.length)} hint="可编排工作流" icon={<Workflow className="h-4 w-4" />} />
        <MetricCard title="运行中" value={String(runningCount)} hint="正在执行" icon={<Activity className="h-4 w-4" />} />
        <MetricCard title="运行成功率" value={successRate} hint={`成功 ${successCount} / 失败 ${failedCount}`} icon={<PlayCircle className="h-4 w-4" />} />
        <MetricCard title="最近文件" value={String(files.length)} hint="可追溯产物" icon={<FileText className="h-4 w-4" />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.32),0_10px_16px_-14px_rgba(15,23,42,0.18)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">最近项目</h2>
            <Link href="/projects" className="text-xs text-indigo-600 hover:text-indigo-700">查看全部</Link>
          </div>
          {projects.length === 0 ? (
            <Empty hint="还没有项目，先创建一个项目开始搭建工作流。" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {projects.slice(0, 6).map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <p className="truncate text-sm font-medium text-slate-800">{project.name}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{project.description || "暂无描述"}</p>
                  <p className="mt-2 text-xs text-slate-400">{project.workflowCount ?? 0} 个工作流 · 更新于 {new Date(project.updatedAt).toLocaleString()}</p>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.32),0_10px_16px_-14px_rgba(15,23,42,0.18)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">最近运行</h2>
            <PlayCircle className="h-4 w-4 text-slate-400" />
          </div>
          {runs.length === 0 ? (
            <Empty hint="还没有运行记录，打开工作流后点击运行即可生成。" />
          ) : (
            <div className="space-y-1">
              {runs.slice(0, 8).map((run) => (
                <Link
                  key={run.id}
                  href={run.projectId ? `/projects/${run.projectId}/runs/${run.id}` : "/projects"}
                  className="flex items-center justify-between rounded-lg px-2 py-2 transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{run.workflowName}</p>
                    {run.summary ? <p className="truncate text-xs text-slate-400">{run.summary}</p> : null}
                    <p className="text-xs text-slate-500">
                      {new Date(run.startedAt).toLocaleString()}
                      {run.durationMs != null ? ` · ${formatDuration(run.durationMs)}` : ""}
                    </p>
                  </div>
                  <RunStatus status={run.status} />
                </Link>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.32),0_10px_16px_-14px_rgba(15,23,42,0.18)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">最近文件</h2>
          <FileText className="h-4 w-4 text-slate-400" />
        </div>
        {files.length === 0 ? (
          <Empty hint="最近还没有文件产物，运行工作流后会自动沉淀到这里。" />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {files.slice(0, 8).map((file) => (
              <Link
                key={file.id}
                href={file.projectId ? `/projects/${file.projectId}/files/${file.id}` : "/projects"}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-indigo-200 hover:bg-indigo-50/40"
              >
                <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {file.workflowName || "未命名工作流"} · {file.type}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  创建于 {new Date(file.createdAt).toLocaleString()}
                  {file.size != null ? ` · ${formatFileSize(file.size)}` : ""}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-[0_8px_20px_-18px_rgba(15,23,42,0.28)]">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs">{title}</p>
        <span>{icon}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </article>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  );
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RunStatus({ status }: { status: "running" | "success" | "failed" }) {
  if (status === "success") {
    return <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">成功</span>;
  }
  if (status === "failed") {
    return <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">失败</span>;
  }
  return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">运行中</span>;
}
