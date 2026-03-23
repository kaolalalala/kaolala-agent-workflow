"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivitySquare,
  Bell,
  Boxes,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  Plus,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";

import {
  runtimeClient,
  type AgentTemplateView,
  type GlobalSearchResultView,
  type NotificationItemView,
  type ProjectSummaryView,
  type WorkflowTemplateView,
} from "@/features/workflow/adapters/runtime-client";

const READ_NOTIFICATIONS_STORAGE_KEY = "v0_2_read_notification_ids";

const EMPTY_SEARCH: GlobalSearchResultView = {
  projects: [],
  workflows: [],
  runs: [],
  files: [],
};

const navItems = [
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/runs", label: "运行中心", icon: ActivitySquare },
  { href: "/evaluations", label: "评测", icon: ClipboardCheck },
  { href: "/agent-dev", label: "开发台", icon: Terminal },
  { href: "/assets", label: "资产", icon: Boxes },
  { href: "/settings", label: "设置", icon: Settings },
];

function resolvePageTitle(pathname: string) {
  if (pathname.startsWith("/agent-dev")) return "开发台";
  if (pathname.startsWith("/evaluations")) return "评测";
  if (pathname.startsWith("/projects/") && pathname.includes("/workflows/")) return "工作流编辑器";
  if (pathname.startsWith("/projects/")) return "项目详情";
  if (pathname.startsWith("/runs")) return "运行中心";
  if (pathname.startsWith("/dashboard")) return "仪表盘";
  if (pathname.startsWith("/projects")) return "项目";
  if (pathname.startsWith("/assets")) return "资产";
  if (pathname.startsWith("/settings")) return "设置";
  return "平台";
}

function formatDate(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function loadReadNotificationIds(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(READ_NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return {};
    const map: Record<string, boolean> = {};
    for (const id of parsed) {
      if (typeof id === "string" && id) {
        map[id] = true;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function saveReadNotificationIds(map: Record<string, boolean>) {
  try {
    window.localStorage.setItem(READ_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(Object.keys(map)));
  } catch {
    // ignore storage errors
  }
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const pageTitle = resolvePageTitle(pathname);
  const isWorkflowEditorPage = pathname.startsWith("/projects/") && pathname.includes("/workflows/");

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResultView>(EMPTY_SEARCH);

  const [notificationOpen, setNotificationOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItemView[]>([]);
  const [readNotificationMap, setReadNotificationMap] = useState<Record<string, boolean>>({});

  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [modalKind, setModalKind] = useState<"project" | "workflow" | null>(null);
  const [headerError, setHeaderError] = useState("");
  const [headerMessage, setHeaderMessage] = useState("");

  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateView[]>([]);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplateView[]>([]);
  const [createDataLoaded, setCreateDataLoaded] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [workflowProjectId, setWorkflowProjectId] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowMode, setWorkflowMode] = useState<"blank" | "template" | "agent_template">("blank");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [workflowAgentTemplateId, setWorkflowAgentTemplateId] = useState("");
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => acc + (readNotificationMap[item.id] ? 0 : 1), 0),
    [notifications, readNotificationMap],
  );

  const enabledWorkflowTemplates = useMemo(
    () => workflowTemplates.filter((item) => item.enabled),
    [workflowTemplates],
  );

  const enabledAgentTemplates = useMemo(
    () => agentTemplates.filter((item) => item.enabled),
    [agentTemplates],
  );

  const markNotificationsAsRead = useCallback((items: NotificationItemView[]) => {
    if (items.length === 0) return;
    setReadNotificationMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const item of items) {
        if (!next[item.id]) {
          next[item.id] = true;
          changed = true;
        }
      }
      if (changed) {
        saveReadNotificationIds(next);
        return next;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    setReadNotificationMap(loadReadNotificationIds());
    runtimeClient.listNotifications(20)
      .then((payload) => setNotifications(payload.notifications))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (noticeRef.current && !noticeRef.current.contains(target)) setNotificationOpen(false);
      if (createRef.current && !createRef.current.contains(target)) setCreateMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!headerError && !headerMessage) return;
    const timer = window.setTimeout(() => {
      setHeaderError("");
      setHeaderMessage("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [headerError, headerMessage]);

  useEffect(() => {
    if (!searchOpen) return;
    const query = searchKeyword.trim();
    if (!query) {
      setSearchResults(EMPTY_SEARCH);
      setSearchError("");
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      runtimeClient.searchGlobal(query, 6)
        .then((result) => {
          if (!cancelled) setSearchResults(result);
        })
        .catch((error) => {
          if (!cancelled) setSearchError(error instanceof Error ? error.message : "全局搜索失败");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchKeyword, searchOpen]);

  useEffect(() => {
    if (!notificationOpen) return;
    setLoadingNotifications(true);
    runtimeClient.listNotifications(20)
      .then((payload) => {
        setNotifications(payload.notifications);
        markNotificationsAsRead(payload.notifications);
      })
      .catch((error) => {
        setHeaderError(error instanceof Error ? error.message : "获取通知失败");
      })
      .finally(() => setLoadingNotifications(false));
  }, [markNotificationsAsRead, notificationOpen]);

  useEffect(() => {
    if ((!createMenuOpen && !modalKind) || createDataLoaded) return;
    Promise.all([
      runtimeClient.listProjects({ includeArchived: true }),
      runtimeClient.listWorkflowTemplates(),
      runtimeClient.listAgentTemplates(),
    ])
      .then(([projectPayload, templatePayload, agentTemplatePayload]) => {
        setProjects(projectPayload.projects);
        setWorkflowTemplates(templatePayload.workflowTemplates);
        setAgentTemplates(agentTemplatePayload.agentTemplates);
        if (!workflowProjectId) {
          const firstProject = projectPayload.projects.find((item) => !item.archivedAt);
          if (firstProject) setWorkflowProjectId(firstProject.id);
        }
        if (!workflowTemplateId && templatePayload.workflowTemplates[0]) {
          setWorkflowTemplateId(templatePayload.workflowTemplates[0].id);
        }
        if (!workflowAgentTemplateId && agentTemplatePayload.agentTemplates[0]) {
          setWorkflowAgentTemplateId(agentTemplatePayload.agentTemplates[0].id);
        }
        setCreateDataLoaded(true);
      })
      .catch((error) => {
        setHeaderError(error instanceof Error ? error.message : "加载创建数据失败");
      });
  }, [createDataLoaded, createMenuOpen, modalKind, workflowAgentTemplateId, workflowProjectId, workflowTemplateId]);

  const onCreateProject = async () => {
    if (!projectName.trim()) {
      setHeaderError("项目名称不能为空。");
      return;
    }
    setCreatingProject(true);
    try {
      const payload = await runtimeClient.createProject({
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
      });
      setModalKind(null);
      setProjectName("");
      setProjectDescription("");
      setHeaderMessage("项目创建成功。");
      router.push(`/projects/${payload.project.id}`);
    } catch (error) {
      setHeaderError(error instanceof Error ? error.message : "创建项目失败");
    } finally {
      setCreatingProject(false);
    }
  };

  const onCreateWorkflow = async () => {
    if (!workflowProjectId) {
      setHeaderError("请先选择项目。");
      return;
    }
    if (workflowMode === "template" && !workflowTemplateId) {
      setHeaderError("请选择工作流模板。");
      return;
    }
    if (workflowMode === "agent_template" && !workflowAgentTemplateId) {
      setHeaderError("请选择 Agent 模板。");
      return;
    }
    setCreatingWorkflow(true);
    try {
      const payload = await runtimeClient.createProjectWorkflow(workflowProjectId, {
        name: workflowName.trim() || `工作流 ${new Date().toLocaleDateString("zh-CN")}`,
        description: workflowDescription.trim() || undefined,
        templateId: workflowMode === "template" ? workflowTemplateId : undefined,
        agentTemplateId: workflowMode === "agent_template" ? workflowAgentTemplateId : undefined,
      });
      setModalKind(null);
      setWorkflowName("");
      setWorkflowDescription("");
      setHeaderMessage("工作流创建成功。");
      router.push(`/projects/${workflowProjectId}/workflows/${payload.workflow.id}`);
    } catch (error) {
      setHeaderError(error instanceof Error ? error.message : "创建工作流失败");
    } finally {
      setCreatingWorkflow(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f6f7fb] text-slate-900">
      <aside className="w-[220px] border-r border-slate-200/80 bg-[#fbfbfd] px-4 py-6">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="rounded-2xl bg-indigo-100 p-2 text-indigo-600">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Agent Studio</p>
            <p className="text-sm font-semibold text-slate-700">业务工作台</p>
          </div>
        </div>

        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-white hover:text-slate-900"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-indigo-500" : "text-slate-400"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 px-6 py-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xl font-semibold text-slate-900">{pageTitle}</p>
              <p className="text-xs text-slate-500">Agent Workflow Platform v0.2</p>
            </div>

            <div className="flex items-center gap-3">
              <div ref={searchRef} className="relative">
                <label className="flex h-10 w-[280px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500">
                  <Search className="h-4 w-4" />
                  <input
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    onFocus={() => setSearchOpen(true)}
                    placeholder="搜索项目、工作流、运行、文件..."
                    className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  />
                </label>
                {searchOpen && searchKeyword.trim() ? (
                  <div className="absolute right-0 top-12 z-30 w-[420px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)]">
                    {searching ? <p className="text-xs text-slate-500">搜索中...</p> : null}
                    {searchError ? <p className="text-xs text-rose-600">{searchError}</p> : null}
                    {!searching && !searchError && searchResults.projects.length + searchResults.workflows.length + searchResults.runs.length + searchResults.files.length === 0 ? (
                      <p className="text-xs text-slate-500">未找到匹配结果。</p>
                    ) : null}

                    {searchResults.projects.length > 0 ? (
                      <SearchSection title="项目">
                        {searchResults.projects.map((item) => (
                          <Link key={item.id} href={`/projects/${item.id}`} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.name}
                          </Link>
                        ))}
                      </SearchSection>
                    ) : null}

                    {searchResults.workflows.length > 0 ? (
                      <SearchSection title="工作流">
                        {searchResults.workflows.map((item) => (
                          <Link key={item.id} href={`/projects/${item.projectId}/workflows/${item.id}`} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.name}
                          </Link>
                        ))}
                      </SearchSection>
                    ) : null}

                    {searchResults.runs.length > 0 ? (
                      <SearchSection title="运行记录">
                        {searchResults.runs.map((item) => (
                          <Link key={item.id} href={item.projectId ? `/projects/${item.projectId}/runs/${item.id}` : "/runs"} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.workflowName} - {formatDate(item.startedAt)}
                          </Link>
                        ))}
                      </SearchSection>
                    ) : null}

                    {searchResults.files.length > 0 ? (
                      <SearchSection title="文件">
                        {searchResults.files.map((item) => (
                          <Link key={item.id} href={item.projectId ? `/projects/${item.projectId}/files/${item.id}` : "/projects"} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.name}
                          </Link>
                        ))}
                      </SearchSection>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div ref={noticeRef} className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationOpen((prev) => !prev)}
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                  aria-label="通知"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  ) : null}
                </button>
                {notificationOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-[360px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)]">
                    <p className="mb-2 text-sm font-semibold text-slate-800">最近通知</p>
                    {loadingNotifications ? (
                      <p className="text-xs text-slate-500">加载中...</p>
                    ) : notifications.length === 0 ? (
                      <p className="text-xs text-slate-500">暂无通知</p>
                    ) : (
                      <div className="space-y-2">
                        {notifications.map((item) => (
                          <Link
                            key={item.id}
                            href={item.href ?? "#"}
                            onClick={() => setNotificationOpen(false)}
                            className="block rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                          >
                            <p className="text-sm font-medium text-slate-800">{item.title}</p>
                            <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                            <p className="mt-1 text-[11px] text-slate-400">{formatDate(item.time)}</p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div ref={createRef} className="relative">
                <button
                  type="button"
                  onClick={() => setCreateMenuOpen((prev) => !prev)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  新建
                </button>
                {createMenuOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-44 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)]">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        setModalKind("project");
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <FolderKanban className="h-4 w-4 text-slate-400" />
                      新建项目
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        setModalKind("workflow");
                      }}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <Workflow className="h-4 w-4 text-slate-400" />
                      新建工作流
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {headerError ? <p className="mt-3 text-sm text-rose-600">{headerError}</p> : null}
          {headerMessage ? <p className="mt-3 text-sm text-emerald-600">{headerMessage}</p> : null}
        </header>

        <main className={`min-w-0 flex-1 px-6 py-6 ${isWorkflowEditorPage ? "overflow-hidden" : ""}`}>
          {children}
        </main>
      </div>

      {modalKind === "project" ? (
        <Modal title="新建项目" onClose={() => setModalKind(null)}>
          <div className="space-y-3">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="项目名称"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <textarea
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              placeholder="项目描述（可选）"
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalKind(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={creatingProject}
                onClick={() => void onCreateProject()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                创建项目
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modalKind === "workflow" ? (
        <Modal title="新建工作流" onClose={() => setModalKind(null)}>
          <div className="space-y-3">
            <select
              value={workflowProjectId}
              onChange={(event) => setWorkflowProjectId(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">选择项目</option>
              {projects.filter((item) => !item.archivedAt).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
              placeholder="工作流名称"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <textarea
              value={workflowDescription}
              onChange={(event) => setWorkflowDescription(event.target.value)}
              placeholder="工作流描述（可选）"
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />

            <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1">
              {[
                { key: "blank", label: "空白" },
                { key: "template", label: "工作流模板" },
                { key: "agent_template", label: "Agent 模板" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setWorkflowMode(item.key as "blank" | "template" | "agent_template")}
                  className={`rounded-md px-3 py-2 text-sm ${
                    workflowMode === item.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {workflowMode === "template" ? (
              <select
                value={workflowTemplateId}
                onChange={(event) => setWorkflowTemplateId(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              >
                <option value="">选择工作流模板</option>
                {enabledWorkflowTemplates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : null}

            {workflowMode === "agent_template" ? (
              <select
                value={workflowAgentTemplateId}
                onChange={(event) => setWorkflowAgentTemplateId(event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              >
                <option value="">选择 Agent 模板</option>
                {enabledAgentTemplates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalKind(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={creatingWorkflow}
                onClick={() => void onCreateWorkflow()}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {creatingWorkflow ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                创建工作流
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function SearchSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-[11px] font-medium text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_30px_60px_-24px_rgba(15,23,42,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
