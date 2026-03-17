"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Loader2, Search, Trash2 } from "lucide-react";

import { runtimeClient, type ProjectSummaryView } from "@/features/workflow/adapters/runtime-client";

type FilterType = "active" | "archived" | "all";
type SortType = "updated_desc" | "updated_asc" | "name_asc" | "name_desc";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<FilterType>("active");
  const [sort, setSort] = useState<SortType>("updated_desc");

  const loadProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await runtimeClient.listProjects({ includeArchived: true });
      setProjects(payload.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取项目失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  const visibleProjects = useMemo(() => {
    let list = [...projects];

    if (filter === "active") {
      list = list.filter((item) => !item.archivedAt);
    } else if (filter === "archived") {
      list = list.filter((item) => Boolean(item.archivedAt));
    }

    if (keyword.trim()) {
      const key = keyword.trim().toLowerCase();
      list = list.filter((item) => item.name.toLowerCase().includes(key) || item.description?.toLowerCase().includes(key));
    }

    list.sort((a, b) => {
      if (sort === "updated_asc") {
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      if (sort === "name_asc") {
        return a.name.localeCompare(b.name, "zh-CN");
      }
      if (sort === "name_desc") {
        return b.name.localeCompare(a.name, "zh-CN");
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [filter, keyword, projects, sort]);

  const onCreateProject = async () => {
    if (!name.trim()) {
      setError("请输入项目名称。");
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");
    try {
      const payload = await runtimeClient.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setProjects((prev) => [payload.project, ...prev]);
      setName("");
      setDescription("");
      setMessage("项目创建成功。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建项目失败");
    } finally {
      setCreating(false);
    }
  };

  const onDeleteProject = async (project: ProjectSummaryView) => {
    const confirmed = window.confirm(
      `确定删除项目「${project.name}」吗？\n\n删除后不可恢复，且项目下的工作流、运行记录和文件都会被删除。`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(project.id);
    setError("");
    setMessage("");
    try {
      const result = await runtimeClient.deleteProject(project.id);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      setMessage(`项目已删除，同时清理 ${result.deletedWorkflowCount} 个工作流。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除项目失败");
    } finally {
      setDeletingId(null);
    }
  };

  const onToggleArchive = async (project: ProjectSummaryView, archived: boolean) => {
    setArchivingId(project.id);
    setError("");
    setMessage("");
    try {
      const payload = await runtimeClient.updateProject(project.id, { archived });
      setProjects((prev) => prev.map((item) => (item.id === project.id ? payload.project : item)));
      setMessage(archived ? "项目已归档，可在“全部/已归档”中查看。" : "项目已恢复。");
    } catch (err) {
      setError(err instanceof Error ? err.message : archived ? "归档项目失败" : "恢复项目失败");
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.32),0_10px_16px_-14px_rgba(15,23,42,0.18)]">
        <h1 className="text-xl font-semibold text-slate-900">项目管理</h1>
        <p className="mt-1 text-sm text-slate-500">创建业务项目，并在项目内组织工作流、运行记录与文件产物。</p>
        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="项目名称（必填）"
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
          />
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="项目描述（可选）"
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
          />
          <button
            type="button"
            onClick={() => void onCreateProject()}
            disabled={creating}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "+ 新建项目"}
          </button>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按项目名称或描述搜索"
              className="w-full bg-transparent outline-none placeholder:text-slate-400"
            />
          </label>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as FilterType)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
          >
            <option value="active">仅进行中</option>
            <option value="archived">仅已归档</option>
            <option value="all">全部项目</option>
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortType)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
          >
            <option value="updated_desc">按更新时间（新→旧）</option>
            <option value="updated_asc">按更新时间（旧→新）</option>
            <option value="name_asc">按名称（A→Z）</option>
            <option value="name_desc">按名称（Z→A）</option>
          </select>
        </div>

        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!loading && visibleProjects.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-700">没有匹配的项目</p>
            <p className="mt-1 text-sm text-slate-500">可以先创建项目，或者调整搜索与筛选条件。</p>
          </div>
        ) : null}

        {visibleProjects.map((project) => {
          const archived = Boolean(project.archivedAt);
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_36px_-24px_rgba(99,102,241,0.32)]"
            >
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onToggleArchive(project, !archived);
                  }}
                  disabled={archivingId === project.id}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-70"
                  title={archived ? "恢复项目" : "归档项目"}
                  aria-label={archived ? "恢复项目" : "归档项目"}
                >
                  {archivingId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onDeleteProject(project);
                  }}
                  disabled={deletingId === project.id}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-70"
                  title="删除项目"
                  aria-label="删除项目"
                >
                  {deletingId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>

              <div className="pr-20">
                <p className="text-base font-semibold text-slate-900">{project.name}</p>
                {archived ? (
                  <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    已归档
                  </span>
                ) : null}
              </div>
              <p className="mt-2 line-clamp-2 min-h-10 text-sm text-slate-500">{project.description || "暂无描述"}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{project.workflowCount ?? 0} 个工作流 · {project.runCount ?? 0} 次运行 · {project.fileCount ?? 0} 个文件</span>
                <span>{new Date(project.updatedAt).toLocaleString()}</span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

