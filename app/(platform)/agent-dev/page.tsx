"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileCode,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  PlayCircle,
  Plus,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";

import { runtimeClient } from "@/features/workflow/adapters/runtime-client";

interface WorkspaceItem {
  id: string;
  localPath?: string;
  entryFile?: string;
  runCommand?: string;
}

interface DevRunItem {
  id: string;
  name: string;
  status: string;
  runType: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  workspaceId?: string;
  entryFile?: string;
  runCommand?: string;
  exitCode?: number;
  durationMs?: number;
}

export default function AgentDevPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [recentRuns, setRecentRuns] = useState<DevRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createPath, setCreatePath] = useState("");
  const [createEntry, setCreateEntry] = useState("");
  const [createCmd, setCreateCmd] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [wsData, runData] = await Promise.all([
        runtimeClient.listWorkspaces(),
        runtimeClient.listDevRuns(15),
      ]);
      setWorkspaces(wsData.workspaces);
      setRecentRuns(runData.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await runtimeClient.createWorkspace({
        localPath: createPath.trim() || undefined,
        entryFile: createEntry.trim() || undefined,
        runCommand: createCmd.trim() || undefined,
      });
      setShowCreate(false);
      setCreatePath("");
      setCreateEntry("");
      setCreateCmd("");
      setLoading(true);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作台失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (workspaceId: string) => {
    try {
      await runtimeClient.deleteWorkspace(workspaceId);
      setDeletingId(null);
      setLoading(true);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工作台失败");
    }
  };

  // Workspace map for quick lookup
  const wsMap = new Map(workspaces.map((ws) => [ws.id, ws]));

  const runningCount = recentRuns.filter((r) => r.status === "running").length;
  const successCount = recentRuns.filter((r) => r.status === "completed").length;
  const failedCount = recentRuns.filter((r) => r.status === "failed").length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">开发台</h1>
            <p className="mt-1 text-sm text-slate-500">
              管理开发工作台，直接运行脚本文件，运行记录自动接入运行中心。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600"
          >
            <Plus className="h-4 w-4" />
            新建工作台
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="工作台数量" value={String(workspaces.length)} icon={<Terminal className="h-4 w-4" />} />
          <StatCard title="正在运行" value={String(runningCount)} icon={<PlayCircle className="h-4 w-4" />} highlight={runningCount > 0} />
          <StatCard title="最近成功" value={String(successCount)} icon={<CheckCircle2 className="h-4 w-4" />} />
          <StatCard title="最近失败" value={String(failedCount)} icon={<XCircle className="h-4 w-4" />} />
        </div>
      </section>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {/* Create dialog */}
      {showCreate && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-5">
          <h3 className="text-sm font-semibold text-slate-800">创建新工作台</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-slate-500">本地项目路径</label>
              <input
                value={createPath}
                onChange={(e) => setCreatePath(e.target.value)}
                placeholder="D:\projects\my-app"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">入口文件（可选）</label>
              <input
                value={createEntry}
                onChange={(e) => setCreateEntry(e.target.value)}
                placeholder="main.py"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">运行命令（可选）</label>
              <input
                value={createCmd}
                onChange={(e) => setCreateCmd(e.target.value)}
                placeholder="python main.py"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              创建
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              取消
            </button>
          </div>
        </section>
      )}

      {/* Main content: Workspaces + Recent Runs */}
      <div className="grid gap-5 xl:grid-cols-3">
        {/* Workspaces list */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)] xl:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">工作台列表</h2>
          <p className="mt-1 text-sm text-slate-500">点击进入 IDE，选中文件即可直接运行</p>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : workspaces.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center">
              <Terminal className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">暂无工作台</p>
              <p className="mt-1 text-xs text-slate-400">点击「新建工作台」创建第一个开发环境</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {workspaces.map((ws) => {
                const dirName = ws.localPath ? ws.localPath.replace(/\\/g, "/").split("/").pop() : undefined;
                return (
                  <div
                    key={ws.id}
                    className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-indigo-200 hover:shadow-md"
                  >
                    <div className="rounded-lg bg-indigo-50 p-2 text-indigo-500 group-hover:bg-indigo-100">
                      {ws.localPath ? <HardDrive className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
                    </div>

                    <Link href={`/agent-dev/${ws.id}`} className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{dirName ?? ws.id.slice(0, 12)}</p>
                      {ws.localPath && (
                        <p className="mt-0.5 truncate text-xs text-slate-500" title={ws.localPath}>{ws.localPath}</p>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        {ws.runCommand && (
                          <span className="truncate font-mono text-xs text-slate-400" title={ws.runCommand}>$ {ws.runCommand}</span>
                        )}
                        {ws.entryFile && (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <FileCode className="h-3 w-3" />{ws.entryFile}
                          </span>
                        )}
                        {!ws.localPath && !ws.runCommand && (
                          <span className="text-xs text-slate-400">Workspace 模式</span>
                        )}
                      </div>
                    </Link>

                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      {deletingId === ws.id ? (
                        <>
                          <button type="button" onClick={() => handleDelete(ws.id)} className="inline-flex h-7 items-center rounded-lg bg-rose-500 px-2 text-xs font-medium text-white transition hover:bg-rose-600">确认删除</button>
                          <button type="button" onClick={() => setDeletingId(null)} className="inline-flex h-7 items-center rounded-lg border border-slate-200 px-2 text-xs text-slate-600 transition hover:bg-slate-50">取消</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setDeletingId(ws.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500" title="删除工作台">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Runs sidebar */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">最近运行</h2>
            <Link href="/runs" className="text-xs text-indigo-500 transition hover:text-indigo-600">
              查看全部
            </Link>
          </div>

          {recentRuns.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <Clock className="mx-auto h-6 w-6 text-slate-300" />
              <p className="mt-2 text-xs text-slate-400">暂无运行记录</p>
              <p className="mt-1 text-[11px] text-slate-400">在工作台中打开文件并点击运行</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {recentRuns.map((run) => {
                const ws = run.workspaceId ? wsMap.get(run.workspaceId) : undefined;
                const displayCmd = run.runCommand || run.name || run.id.slice(0, 12);
                const wsLink = run.workspaceId
                  ? `/agent-dev/${run.workspaceId}${run.entryFile ? `?entryFile=${encodeURIComponent(run.entryFile)}` : ""}`
                  : undefined;

                return (
                  <div key={run.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-indigo-200 hover:bg-indigo-50/40">
                    <div className="flex items-center justify-between gap-2">
                      {wsLink ? (
                        <Link href={wsLink} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-600" title={`打开: ${displayCmd}`}>
                          {displayCmd}
                        </Link>
                      ) : (
                        <p className="min-w-0 truncate text-sm font-medium text-slate-800">{displayCmd}</p>
                      )}
                      <RunStatusPill status={run.status} />
                    </div>

                    {/* Script path / entry file */}
                    {run.entryFile && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                        <FileCode className="h-3 w-3 shrink-0" />
                        {run.entryFile}
                      </p>
                    )}

                    {/* Workspace local path */}
                    {ws?.localPath && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-400" title={ws.localPath}>
                        {ws.localPath}
                      </p>
                    )}

                    <p className="mt-0.5 text-xs text-slate-400">
                      {new Date(run.createdAt).toLocaleString("zh-CN")}
                      {typeof run.durationMs === "number" ? ` · ${formatDuration(run.durationMs)}` : ""}
                      {typeof run.exitCode === "number" ? ` · exit ${run.exitCode}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, highlight }: { title: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${highlight ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center gap-2">
        <span className={highlight ? "text-amber-500" : "text-slate-400"}>{icon}</span>
        <p className="text-xs text-slate-500">{title}</p>
      </div>
      <p className={`mt-1 text-lg font-semibold ${highlight ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function RunStatusPill({ status }: { status: string }) {
  if (status === "completed") return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">成功</span>;
  if (status === "failed") return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">失败</span>;
  if (status === "running") return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">运行中</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{status}</span>;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}
