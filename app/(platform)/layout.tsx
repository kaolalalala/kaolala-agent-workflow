"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivitySquare,
  Bell,
  Boxes,
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
  type GlobalSearchResultView,
  type NotificationItemView,
  type ProjectSummaryView,
  type WorkflowTemplateView,
  type AgentTemplateView,
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
  { href: "/agent-dev", label: "开发台", icon: Terminal },
  { href: "/assets", label: "资产", icon: Boxes },
  { href: "/settings", label: "设置", icon: Settings },
];

function resolvePageTitle(pathname: string) {
  if (pathname.startsWith("/agent-dev")) return "开发台";
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
      if (typeof id === "string" && id) map[id] = true;
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
  const [workflowMode, setWorkflowMode] = useState<"blank" | "template" | "agent_template">("blank");
  const [headerError, setHeaderError] = useState("");
  const [headerMessage, setHeaderMessage] = useState("");

  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplateView[]>([]);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplateView[]>([]);
  const [createDataLoaded, setCreateDataLoaded] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [workflowProjectId, setWorkflowProjectId] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [workflowAgentTemplateId, setWorkflowAgentTemplateId] = useState("");
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);

  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const enabledTemplates = useMemo(() => templates.filter((item) => item.enabled), [templates]);
  const enabledAgentTemplates = useMemo(() => agentTemplates.filter((item) => item.enabled), [agentTemplates]);
  const activeProjects = useMemo(() => projects.filter((item) => !item.archivedAt), [projects]);
  const totalSearchCount = searchResults.projects.length + searchResults.workflows.length + searchResults.runs.length + searchResults.files.length;
  const isSearchEmpty = !searching && !searchError && searchKeyword.trim() && totalSearchCount === 0;

  // FIX: unreadCount is derived from both notifications and readNotificationMap.
  // readNotificationMap is initialized from localStorage on mount, so notifications
  // that were previously read will correctly show as read.
  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => acc + (readNotificationMap[item.id] ? 0 : 1), 0),
    [notifications, readNotificationMap],
  );

  // FIX: markNotificationsAsRead updates the map AND persists to localStorage
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
      if (changed) saveReadNotificationIds(next);
      return changed ? next : prev;
    });
  }, []);

  // Load read notification ids from localStorage on mount
  useEffect(() => {
    const map = loadReadNotificationIds();
    setReadNotificationMap(map);
    runtimeClient.listNotifications(20)
      .then((payload) => setNotifications(payload.notifications))
      .catch(() => {});
  }, []);

  // Close popups on outside click
  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (noticeRef.current && !noticeRef.current.contains(target)) setNotificationOpen(false);
      if (createRef.current && !createRef.current.contains(target)) setCreateMenuOpen(false);
      if (userRef.current && !userRef.current.contains(target)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Auto-clear header messages
  useEffect(() => {
    if (!headerError && !headerMessage) return;
    const timer = window.setTimeout(() => {
      setHeaderError("");
      setHeaderMessage("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [headerError, headerMessage]);

  // Search effect
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
    const timer = window.setTimeout(() => {
      runtimeClient.searchGlobal(query, 6)
        .then((result) => { if (!cancelled) setSearchResults(result); })
        .catch((error) => { if (!cancelled) setSearchError(error instanceof Error ? error.message : "搜索失败"); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [searchKeyword, searchOpen]);

  // FIX: When notification panel opens, fetch latest notifications and mark them all as read
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

  // Load create data when menu opens
  useEffect(() => {
    if ((!createMenuOpen && !modalKind) || createDataLoaded) return;
    Promise.all([
      runtimeClient.listProjects({ includeArchived: true }),
      runtimeClient.listWorkflowTemplates(),
      runtimeClient.listAgentTemplates(),
    ]).then(([projectPayload, templatePayload, agentTemplatePayload]) => {
      setProjects(projectPayload.projects);
      setTemplates(templatePayload.workflowTemplates);
      setAgentTemplates(agentTemplatePayload.agentTemplates);
      if (!workflowProjectId) {
        const first = projectPayload.projects.find((item) => !item.archivedAt);
        if (first) setWorkflowProjectId(first.id);
      }
      setCreateDataLoaded(true);
    }).catch((error) => {
      setHeaderError(error instanceof Error ? error.message : "加载创建数据失败");
    });
  }, [createDataLoaded, createMenuOpen, modalKind, workflowProjectId]);

  const onCreateProject = async () => {
    if (!projectName.trim()) return setHeaderError("项目名称不能为空。");
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
    if (!workflowProjectId) return setHeaderError("请先选择项目。");
    if (workflowMode === "template" && !workflowTemplateId) return setHeaderError("请选择工作流模板。");
    if (workflowMode === "agent_template" && !workflowAgentTemplateId) return setHeaderError("请选择 Agent 模板。");
    setCreatingWorkflow(true);
    try {
      const payload = await runtimeClient.createProjectWorkflow(workflowProjectId, {
        name: workflowName.trim() || `工作流 ${new Date().toLocaleDateString("zh-CN")}`,
        description: workflowDescription.trim() || undefined,
        templateId: workflowMode === "template" ? workflowTemplateId : undefined,
        agentTemplateId: workflowMode === "agent_template" ? workflowAgentTemplateId : undefined,
      });
      setModalKind(null);
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
      {/* Sidebar */}
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

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 px-6 py-4 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xl font-semibold text-slate-900">{pageTitle}</p>
              <p className="text-xs text-slate-500">Agent Workflow Platform v0.2</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div ref={searchRef} className="relative">
                <label className="flex h-10 w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500">
                  <Search className="h-4 w-4" />
                  <input
                    value={searchKeyword}
                    onChange={(event) => setSearchKeyword(event.target.value)}
                    onFocus={() => setSearchOpen(true)}
                    placeholder="全局搜索项目、工作流、运行..."
                    className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  />
                </label>
                {searchOpen && searchKeyword.trim() ? (
                  <div className="absolute right-0 top-12 z-30 w-[400px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)]">
                    {searching ? <p className="text-xs text-slate-500">搜索中...</p> : null}
                    {searchError ? <p className="text-xs text-rose-600">{searchError}</p> : null}
                    {isSearchEmpty ? <p className="text-xs text-slate-500">未找到匹配结果。</p> : null}
                    {searchResults.projects.length > 0 ? (
                      <div className="mb-2">
                        <p className="mb-1 text-[11px] font-medium text-slate-400">项目</p>
                        {searchResults.projects.map((item) => (
                          <Link key={item.id} href={`/projects/${item.id}`} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {searchResults.workflows.length > 0 ? (
                      <div className="mb-2">
                        <p className="mb-1 text-[11px] font-medium text-slate-400">工作流</p>
                        {searchResults.workflows.map((item) => (
                          <Link key={item.id} href={`/projects/${item.projectId}/workflows/${item.id}`} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {searchResults.runs.length > 0 ? (
                      <div className="mb-2">
                        <p className="mb-1 text-[11px] font-medium text-slate-400">运行记录</p>
                        {searchResults.runs.map((item) => (
                          <Link key={item.id} href={item.projectId ? `/projects/${item.projectId}/runs/${item.id}` : "/runs"} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.workflowName} - {formatDate(item.startedAt)}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {searchResults.files.length > 0 ? (
                      <div>
                        <p className="mb-1 text-[11px] font-medium text-slate-400">文件</p>
                        {searchResults.files.map((item) => (
                          <Link key={item.id} href={item.projectId ? `/projects/${item.projectId}/files/${item.id}` : "/projects"} onClick={() => setSearchOpen(false)} className="block rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                            {item.name}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Notification bell */}
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
                      <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        加载中...
                      </div>
                    ) : null}
                    {!loadingNotifications && notifications.length === 0 ? (
                      <p className="py-3 text-xs text-slate-500">暂无通知。</p>
                    ) : null}
                    {!loadingNotifications ? notifications.map((item) => (
                      <Link
                        key={item.id}
                        href={item.href ?? "/"}
                        onClick={() => setNotificationOpen(false)}
                        className="block rounded-lg px-2 py-2 transition hover:bg-slate-50"
                      >
                        <p className="text-sm font-medium text-slate-700">{item.title}</p>
                        <p className="text-xs text-slate-500">{item.description}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{formatDate(item.time)}</p>
                      </Link>
                    )) : null}
                  </div>
                ) : null}
              </div>

              {/* Create menu */}
              <div ref={createRef} className="relative">
                <button
                  type="button"
                  onClick={() => setCreateMenuOpen((prev) => !prev)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600"
                >
                  <Plus className="h-4 w-4" />
                  新建
                </button>
                {createMenuOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-[200px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)]">
                    <button
                      type="button"
                      onClick={() => { setCreateMenuOpen(false); setModalKind("project"); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <FolderKanban className="h-4 w-4 text-slate-400" />
                      新建项目
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreateMenuOpen(false); setModalKind("workflow"); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <Workflow className="h-4 w-4 text-slate-400" />
                      新建工作流
                    </button>
                  </div>
                ) : null}
              </div>

              {/* User menu */}
              <div ref={userRef} className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
                >
                  U
                </button>
                {userMenuOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.25)]">
                    <p className="px-3 py-2 text-xs text-slate-500">账户功能预留</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {headerError ? <p className="mt-2 text-xs text-rose-600">{headerError}</p> : null}
          {headerMessage ? <p className="mt-2 text-xs text-emerald-600">{headerMessage}</p> : null}
        </header>

        {/* Page content */}
        <main className={isWorkflowEditorPage ? "flex-1" : "flex-1 px-6 py-5"}>
          {children}
        </main>
      </div>

      {/* Create Project Modal */}
      {modalKind === "project" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-900">新建项目</h2>
            <div className="mt-4 space-y-3">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
                placeholder="项目名称（必填）"
              />
              <input
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
                placeholder="项目描述（可选）"
              />
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setModalKind(null)} className="h-9 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
                取消
              </button>
              <button type="button" onClick={() => void onCreateProject()} disabled={creatingProject} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-60">
                {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                创建项目
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create Workflow Modal */}
      {modalKind === "workflow" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-900">新建工作流</h2>
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button type="button" onClick={() => setWorkflowMode("blank")} className={`rounded-xl px-3 py-1.5 text-sm ${workflowMode === "blank" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>空白</button>
                <button type="button" onClick={() => setWorkflowMode("template")} className={`rounded-xl px-3 py-1.5 text-sm ${workflowMode === "template" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>Workflow 模板</button>
                <button type="button" onClick={() => setWorkflowMode("agent_template")} className={`rounded-xl px-3 py-1.5 text-sm ${workflowMode === "agent_template" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>Agent 模板</button>
              </div>
              <select
                value={workflowProjectId}
                onChange={(event) => setWorkflowProjectId(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
              >
                <option value="">请选择项目</option>
                {activeProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <input
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
                placeholder="工作流名称（留空自动生成）"
              />
              <input
                value={workflowDescription}
                onChange={(event) => setWorkflowDescription(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
                placeholder="工作流描述（可选）"
              />
              {workflowMode === "template" ? (
                <select
                  value={workflowTemplateId}
                  onChange={(event) => setWorkflowTemplateId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
                >
                  <option value="">请选择 Workflow 模板</option>
                  {enabledTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              ) : null}
              {workflowMode === "agent_template" ? (
                <select
                  value={workflowAgentTemplateId}
                  onChange={(event) => setWorkflowAgentTemplateId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
                >
                  <option value="">请选择 Agent 模板</option>
                  {enabledAgentTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              ) : null}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setModalKind(null)} className="h-9 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
                取消
              </button>
              <button type="button" onClick={() => void onCreateWorkflow()} disabled={creatingWorkflow} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-60">
                {creatingWorkflow ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                创建工作流
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
