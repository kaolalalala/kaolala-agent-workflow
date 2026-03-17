"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, ChevronDown, ChevronUp, FileUp, Loader2, Pencil, Save, Trash2, Upload } from "lucide-react";

import {
  runtimeClient,
  type AgentTemplateView,
  type CredentialSummary,
  type ProjectFileView,
  type ProjectSummaryView,
  type RunRecordView,
  type SkillPackPlanView,
  type SkillPackRoleSummaryView,
  type WorkflowSummaryView,
  type WorkflowTemplateView,
} from "@/features/workflow/adapters/runtime-client";

type ProjectTab = "overview" | "workflows" | "runs" | "files" | "settings";

interface SettingsForm {
  name: string;
  description: string;
  defaultProvider: string;
  defaultModel: string;
  defaultBaseUrl: string;
  defaultCredentialId: string;
  defaultTemperature: string;
  projectNotes: string;
}

const EMPTY_SETTINGS: SettingsForm = {
  name: "",
  description: "",
  defaultProvider: "",
  defaultModel: "",
  defaultBaseUrl: "",
  defaultCredentialId: "",
  defaultTemperature: "",
  projectNotes: "",
};

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectSummaryView | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummaryView[]>([]);
  const [runs, setRuns] = useState<RunRecordView[]>([]);
  const [files, setFiles] = useState<ProjectFileView[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateView[]>([]);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplateView[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);

  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [deletingProject, setDeletingProject] = useState(false);
  const [archivingProject, setArchivingProject] = useState(false);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [workflowMode, setWorkflowMode] = useState<"blank" | "template" | "agent_template" | "skill_pack">("blank");
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowDescription, setNewWorkflowDescription] = useState("");
  const [newWorkflowTemplateId, setNewWorkflowTemplateId] = useState("");
  const [newWorkflowTemplateTaskId, setNewWorkflowTemplateTaskId] = useState("");
  const [newWorkflowAgentTemplateId, setNewWorkflowAgentTemplateId] = useState("");
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);

  const [settings, setSettings] = useState<SettingsForm>(EMPTY_SETTINGS);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const enabledWorkflowTemplates = useMemo(
    () => workflowTemplates.filter((item) => item.enabled),
    [workflowTemplates],
  );
  const enabledAgentTemplates = useMemo(
    () => agentTemplates.filter((item) => item.enabled),
    [agentTemplates],
  );

  const hydrateSettings = useCallback((item: ProjectSummaryView | null) => {
    if (!item) {
      setSettings(EMPTY_SETTINGS);
      setSettingsDirty(false);
      return;
    }
    setSettings({
      name: item.name,
      description: item.description ?? "",
      defaultProvider: item.settings.defaultProvider ?? "",
      defaultModel: item.settings.defaultModel ?? "",
      defaultBaseUrl: item.settings.defaultBaseUrl ?? "",
      defaultCredentialId: item.settings.defaultCredentialId ?? "",
      defaultTemperature:
        item.settings.defaultTemperature !== undefined ? String(item.settings.defaultTemperature) : "",
      projectNotes: item.settings.projectNotes ?? "",
    });
    setSettingsDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [projectPayload, workflowPayload, runPayload, filePayload, credentialPayload] = await Promise.all([
        runtimeClient.getProject(projectId),
        runtimeClient.listProjectWorkflows(projectId),
        runtimeClient.listProjectRuns(projectId, 40),
        runtimeClient.listProjectFiles(projectId, 120),
        runtimeClient.listCredentials().catch(() => ({ credentials: [] })),
      ]);
      setProject(projectPayload.project);
      setWorkflows(workflowPayload.workflows);
      setRuns(runPayload.runs);
      setFiles(filePayload.files);
      setCredentials(uniqueCredentials(credentialPayload.credentials));
      hydrateSettings(projectPayload.project);

      const [workflowTemplatesPayload, agentTemplatesPayload] = await Promise.all([
        runtimeClient.listWorkflowTemplates(),
        runtimeClient.listAgentTemplates(),
      ]);
      setWorkflowTemplates(workflowTemplatesPayload.workflowTemplates);
      setAgentTemplates(agentTemplatesPayload.agentTemplates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取项目数据失败");
    } finally {
      setLoading(false);
    }
  }, [hydrateSettings, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (workflowMode === "template" && !newWorkflowTemplateId && enabledWorkflowTemplates[0]) {
      setNewWorkflowTemplateId(enabledWorkflowTemplates[0].id);
    }
    if (workflowMode === "agent_template" && !newWorkflowAgentTemplateId && enabledAgentTemplates[0]) {
      setNewWorkflowAgentTemplateId(enabledAgentTemplates[0].id);
    }
  }, [enabledAgentTemplates, enabledWorkflowTemplates, newWorkflowAgentTemplateId, newWorkflowTemplateId, workflowMode]);

  const selectedTemplate = useMemo(
    () => workflowTemplates.find((item) => item.id === newWorkflowTemplateId),
    [newWorkflowTemplateId, workflowTemplates],
  );

  useEffect(() => {
    if (workflowMode !== "template") return;
    const tasks = selectedTemplate?.presetTasks ?? [];
    if (tasks.length === 0) {
      setNewWorkflowTemplateTaskId("");
      return;
    }
    if (!tasks.some((item) => item.id === newWorkflowTemplateTaskId)) {
      setNewWorkflowTemplateTaskId(tasks[0].id);
    }
  }, [newWorkflowTemplateTaskId, selectedTemplate, workflowMode]);

  const onCreateWorkflow = async () => {
    if (workflowMode === "template" && !newWorkflowTemplateId) {
      setError("请选择 Workflow 模板");
      return;
    }
    if (workflowMode === "agent_template" && !newWorkflowAgentTemplateId) {
      setError("请选择 Agent 模板");
      return;
    }
    setCreatingWorkflow(true);
    setError("");
    setMessage("");
    try {
      const payload = await runtimeClient.createProjectWorkflow(projectId, {
        name: newWorkflowName.trim() || `工作流 ${workflows.length + 1}`,
        description: newWorkflowDescription.trim() || undefined,
        templateId: workflowMode === "template" ? newWorkflowTemplateId : undefined,
        templatePresetTaskId: workflowMode === "template" ? newWorkflowTemplateTaskId || undefined : undefined,
        agentTemplateId: workflowMode === "agent_template" ? newWorkflowAgentTemplateId : undefined,
      });
      setMessage("工作流创建成功，正在进入编辑器...");
      setNewWorkflowName("");
      setNewWorkflowDescription("");
      router.push(`/projects/${projectId}/workflows/${payload.workflow.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作流失败");
    } finally {
      setCreatingWorkflow(false);
    }
  };

  const onRenameWorkflow = async (workflow: WorkflowSummaryView) => {
    const raw = window.prompt("请输入新的工作流名称", workflow.name);
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return setError("工作流名称不能为空");
    try {
      const payload = await runtimeClient.renameWorkflow(workflow.id, {
        projectId,
        name,
        description: workflow.description,
      });
      setWorkflows((prev) => prev.map((item) => (item.id === workflow.id ? payload.workflow : item)));
      setMessage("工作流名称已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名工作流失败");
    }
  };

  const onDeleteWorkflow = async (workflow: WorkflowSummaryView) => {
    if (!window.confirm(`确认删除工作流「${workflow.name}」吗？删除后不可恢复。`)) return;
    setDeletingWorkflowId(workflow.id);
    try {
      await runtimeClient.deleteWorkflow(workflow.id, projectId);
      setWorkflows((prev) => prev.filter((item) => item.id !== workflow.id));
      setRuns((prev) => prev.filter((item) => item.workflowId !== workflow.id));
      setFiles((prev) => prev.filter((item) => item.workflowId !== workflow.id));
      setMessage("工作流已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工作流失败");
    } finally {
      setDeletingWorkflowId(null);
    }
  };

  const onRenameProject = async () => {
    if (!project) return;
    const raw = window.prompt("请输入新的项目名称", project.name);
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return setError("项目名称不能为空");
    try {
      const payload = await runtimeClient.updateProject(project.id, { name });
      setProject(payload.project);
      hydrateSettings(payload.project);
      setMessage("项目名称已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新项目名称失败");
    }
  };

  const onDeleteProject = async () => {
    if (!project) return;
    if (!window.confirm(`确认删除项目「${project.name}」吗？该操作不可恢复。`)) return;
    setDeletingProject(true);
    try {
      await runtimeClient.deleteProject(project.id);
      router.push("/projects");
    } catch (err) {
      setDeletingProject(false);
      setError(err instanceof Error ? err.message : "删除项目失败");
    }
  };

  const onToggleArchive = async () => {
    if (!project) return;
    const archived = Boolean(project.archivedAt);
    setArchivingProject(true);
    try {
      const payload = await runtimeClient.updateProject(project.id, { archived: !archived });
      setProject(payload.project);
      hydrateSettings(payload.project);
      setMessage(archived ? "项目已恢复" : "项目已归档");
    } catch (err) {
      setError(err instanceof Error ? err.message : archived ? "恢复项目失败" : "归档项目失败");
    } finally {
      setArchivingProject(false);
    }
  };

  const onSaveSettings = async () => {
    if (!project) return;
    if (!settings.name.trim()) return setError("项目名称不能为空");
    let defaultTemperature: number | undefined;
    if (settings.defaultTemperature.trim()) {
      const parsed = Number(settings.defaultTemperature);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        return setError("温度必须在 0 到 2 之间");
      }
      defaultTemperature = parsed;
    }
    setSavingSettings(true);
    try {
      const payload = await runtimeClient.updateProject(project.id, {
        name: settings.name.trim(),
        description: settings.description.trim() || undefined,
        settings: {
          defaultProvider: settings.defaultProvider.trim(),
          defaultModel: settings.defaultModel.trim(),
          defaultBaseUrl: settings.defaultBaseUrl.trim(),
          defaultCredentialId: settings.defaultCredentialId,
          defaultTemperature,
          projectNotes: settings.projectNotes.trim(),
        },
      });
      setProject(payload.project);
      hydrateSettings(payload.project);
      setMessage("项目设置已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存项目设置失败");
    } finally {
      setSavingSettings(false);
    }
  };

  const recentFailedRun = useMemo(() => runs.find((item) => item.status === "failed"), [runs]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              <ArrowLeft className="h-3.5 w-3.5" />
              返回项目列表
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{project?.name ?? "项目详情"}</h1>
              {project?.archivedAt ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">已归档</span> : null}
            </div>
            <p className="text-sm text-slate-500">{project?.description || "暂无描述"}</p>
            <p className="text-xs text-slate-400">项目 ID：{projectId}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onRenameProject()} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm">
              <Pencil className="h-4 w-4" />
              重命名
            </button>
            <button type="button" onClick={() => void onToggleArchive()} disabled={archivingProject || !project} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm disabled:opacity-60">
              {archivingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : project?.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {project?.archivedAt ? "恢复" : "归档"}
            </button>
            <button type="button" onClick={() => void onDeleteProject()} disabled={deletingProject || !project} className="inline-flex h-9 items-center gap-1 rounded-xl border border-rose-200 px-3 text-sm text-rose-600 disabled:opacity-60">
              {deletingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              删除项目
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")} label="项目概览" />
          <TabButton active={activeTab === "workflows"} onClick={() => setActiveTab("workflows")} label="工作流" />
          <TabButton active={activeTab === "runs"} onClick={() => setActiveTab("runs")} label="运行记录" />
          <TabButton active={activeTab === "files"} onClick={() => setActiveTab("files")} label="文件" />
          <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")} label="设置" />
        </div>

        {error ? <p className="mb-2 text-xs text-rose-600">{error}</p> : null}
        {message ? <p className="mb-2 text-xs text-emerald-600">{message}</p> : null}

        {activeTab === "overview" ? (
          <OverviewTab
            projectId={projectId}
            project={project}
            workflows={workflows}
            runs={runs}
            files={files}
            recentFailedRun={recentFailedRun}
          />
        ) : null}

        {activeTab === "workflows" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setWorkflowMode("blank")} className={`rounded-xl px-3 py-1.5 text-sm ${workflowMode === "blank" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>空白工作流</button>
              <button type="button" onClick={() => setWorkflowMode("template")} className={`rounded-xl px-3 py-1.5 text-sm ${workflowMode === "template" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>从 Workflow 模板创建</button>
              <button type="button" onClick={() => setWorkflowMode("agent_template")} className={`rounded-xl px-3 py-1.5 text-sm ${workflowMode === "agent_template" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>从 Agent 模板创建</button>
              <button type="button" onClick={() => setWorkflowMode("skill_pack")} className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm ${workflowMode === "skill_pack" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}><FileUp className="h-3.5 w-3.5" />从 Skill 包生成</button>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input value={newWorkflowName} onChange={(e) => setNewWorkflowName(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm" placeholder={`留空将使用默认名称：工作流 ${workflows.length + 1}`} />
              <input value={newWorkflowDescription} onChange={(e) => setNewWorkflowDescription(e.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm" placeholder="输入工作流描述（可选）" />
              <button type="button" onClick={() => void onCreateWorkflow()} disabled={creatingWorkflow} className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-70">
                {creatingWorkflow ? <Loader2 className="h-4 w-4 animate-spin" /> : "创建工作流"}
              </button>
            </div>

            {workflowMode === "template" ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <select value={newWorkflowTemplateId} onChange={(e) => setNewWorkflowTemplateId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                  <option value="">请选择 Workflow 模板</option>
                  {enabledWorkflowTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
            ) : null}
            {workflowMode === "agent_template" ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <select value={newWorkflowAgentTemplateId} onChange={(e) => setNewWorkflowAgentTemplateId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                  <option value="">请选择 Agent 模板</option>
                  {enabledAgentTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
            ) : null}

            {workflowMode === "skill_pack" ? (
              <SkillPackPanel projectId={projectId} onCreated={() => void load()} />
            ) : null}

            {!loading && workflows.length === 0 ? <Empty title="当前项目还没有工作流" description="先创建一个工作流开始使用。" /> : null}
            {workflows.map((workflow) => (
              <div key={workflow.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <Link href={`/projects/${projectId}/workflows/${workflow.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600">{workflow.name}</Link>
                  <p className="text-xs text-slate-500">{workflow.description || "暂无描述"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/projects/${projectId}/workflows/${workflow.id}`} className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm">打开编辑器</Link>
                  <button type="button" onClick={() => void onRenameWorkflow(workflow)} className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm">重命名</button>
                  <button type="button" disabled={deletingWorkflowId === workflow.id} onClick={() => void onDeleteWorkflow(workflow)} className="inline-flex h-9 items-center rounded-xl border border-rose-200 px-3 text-sm text-rose-600 disabled:opacity-60">
                    {deletingWorkflowId === workflow.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "删除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === "runs" ? (
          <div className="space-y-2">
            {!loading && runs.length === 0 ? <Empty title="当前项目还没有运行记录" description="先运行一次工作流再回来查看。" /> : null}
            {runs.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <Link href={`/projects/${projectId}/runs/${run.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600">{run.workflowName}</Link>
                  <p className="text-xs text-slate-500">
                    {run.summary || "暂无摘要"}
                    {" · "}
                    {new Date(run.startedAt).toLocaleString()}
                    {run.durationMs != null ? ` · ${formatDuration(run.durationMs)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={run.status} />
                  <Link href={`/projects/${projectId}/runs/${run.id}`} className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm">查看详情</Link>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === "files" ? (
          <div className="space-y-2">
            {!loading && files.length === 0 ? <Empty title="当前项目还没有文件" description="运行产物会自动沉淀在这里。" /> : null}
            {files.map((file) => (
              <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <Link href={`/projects/${projectId}/files/${file.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600">{file.name}</Link>
                  <p className="text-xs text-slate-500">
                    类型：{file.type} · 来源：{buildFileSource(file)}
                    {file.size != null ? ` · ${formatFileSize(file.size)}` : ""}
                  </p>
                </div>
                <Link href={`/projects/${projectId}/files/${file.id}`} className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm">打开</Link>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === "settings" ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="项目名称（必填）">
                <input value={settings.name} onChange={(e) => { setSettings((p) => ({ ...p, name: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </Field>
              <Field label="项目描述">
                <input value={settings.description} onChange={(e) => { setSettings((p) => ({ ...p, description: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </Field>
              <Field label="默认服务商">
                <input value={settings.defaultProvider} onChange={(e) => { setSettings((p) => ({ ...p, defaultProvider: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </Field>
              <Field label="默认模型">
                <input value={settings.defaultModel} onChange={(e) => { setSettings((p) => ({ ...p, defaultModel: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </Field>
              <Field label="默认 URL">
                <input value={settings.defaultBaseUrl} onChange={(e) => { setSettings((p) => ({ ...p, defaultBaseUrl: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </Field>
              <Field label="默认凭证">
                <select value={settings.defaultCredentialId} onChange={(e) => { setSettings((p) => ({ ...p, defaultCredentialId: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm">
                  <option value="">不使用默认凭证</option>
                  {credentials.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.provider}</option>)}
                </select>
              </Field>
              <Field label="默认温度（0-2）">
                <input value={settings.defaultTemperature} onChange={(e) => { setSettings((p) => ({ ...p, defaultTemperature: e.target.value })); setSettingsDirty(true); }} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              </Field>
            </div>
            <Field label="项目备注">
              <textarea value={settings.projectNotes} onChange={(e) => { setSettings((p) => ({ ...p, projectNotes: e.target.value })); setSettingsDirty(true); }} className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </Field>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">最近更新：{project?.settingsUpdatedAt ? new Date(project.settingsUpdatedAt).toLocaleString() : "暂无"}</p>
              <button type="button" onClick={() => void onSaveSettings()} disabled={savingSettings || !settingsDirty} className="inline-flex h-9 items-center gap-1 rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white disabled:opacity-60">
                {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存设置
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function OverviewTab({
  projectId,
  project,
  workflows,
  runs,
  files,
  recentFailedRun,
}: {
  projectId: string;
  project: ProjectSummaryView | null;
  workflows: WorkflowSummaryView[];
  runs: RunRecordView[];
  files: ProjectFileView[];
  recentFailedRun: RunRecordView | undefined;
}) {
  const recentWorkflows = workflows.slice(0, 5);
  const recentRuns = runs.slice(0, 5);
  const recentFiles = files.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard title="工作流数量" value={String(project?.workflowCount ?? workflows.length)} />
        <OverviewCard title="运行次数" value={String(project?.runCount ?? runs.length)} />
        <OverviewCard title="文件数量" value={String(project?.fileCount ?? files.length)} />
        <OverviewCard
          title="最近失败运行"
          value={recentFailedRun ? `${recentFailedRun.workflowName} · ${new Date(recentFailedRun.updatedAt).toLocaleString()}` : "暂无失败"}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="mb-2 text-xs font-medium text-slate-500">最近工作流</p>
          {recentWorkflows.length === 0 ? (
            <p className="text-sm text-slate-400">暂无工作流</p>
          ) : (
            <div className="space-y-2">
              {recentWorkflows.map((wf) => (
                <Link
                  key={wf.id}
                  href={`/projects/${projectId}/workflows/${wf.id}`}
                  className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <p className="text-sm font-medium text-slate-800">{wf.name}</p>
                  <p className="text-xs text-slate-500">更新时间：{new Date(wf.updatedAt).toLocaleString()}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="mb-2 text-xs font-medium text-slate-500">最近运行</p>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-slate-400">暂无运行记录</p>
          ) : (
            <div className="space-y-2">
              {recentRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/projects/${projectId}/runs/${r.id}`}
                  className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-800">{r.workflowName}</p>
                    <StatusPill status={r.status} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(r.updatedAt).toLocaleString()}
                    {r.durationMs != null ? ` · ${formatDuration(r.durationMs)}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="mb-2 text-xs font-medium text-slate-500">最近文件</p>
          {recentFiles.length === 0 ? (
            <p className="text-sm text-slate-400">暂无文件</p>
          ) : (
            <div className="space-y-2">
              {recentFiles.map((f) => (
                <Link
                  key={f.id}
                  href={`/projects/${projectId}/files/${f.id}`}
                  className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <p className="text-sm font-medium text-slate-800">{f.name}</p>
                  <p className="text-xs text-slate-500">
                    来源：{buildFileSource(f)}
                    {f.size != null ? ` · ${formatFileSize(f.size)}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function uniqueCredentials(items: CredentialSummary[]) {
  const map = new Map<string, CredentialSummary>();
  for (const item of items) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-sm transition ${
        active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );
}

function OverviewCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-base font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      {children}
    </label>
  );
}

function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
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

/* ---------- Skill Pack Panel ---------- */

type SkillPackStep = "upload" | "preview" | "done";

function SkillPackPanel({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<SkillPackStep>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [preferLlm, setPreferLlm] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<SkillPackPlanView | null>(null);
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);

  const onSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const list: File[] = [];
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      if (/\.(md|markdown|zip)$/i.test(f.name)) {
        list.push(f);
      }
    }
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  };

  const onRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const onPlan = async () => {
    if (files.length === 0) {
      setError("请先选择 .md 或 .zip 文件");
      return;
    }
    setPlanning(true);
    setError("");
    try {
      const result = await runtimeClient.planProjectWorkflowFromSkillPack(projectId, {
        files,
        workflowName: workflowName.trim() || undefined,
        workflowDescription: workflowDescription.trim() || undefined,
        preferLlm,
      });
      setPlan(result);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败");
    } finally {
      setPlanning(false);
    }
  };

  const onConfirmCreate = async () => {
    if (!plan) return;
    setSaving(true);
    setError("");
    try {
      const result = await runtimeClient.saveWorkflow({
        projectId,
        name: plan.draft.name,
        description: plan.draft.description,
        rootTaskInput: plan.draft.rootTaskInput,
        versionLabel: "v1",
        versionNotes: `从 Skill Pack 自动生成（${plan.planner}）`,
        workflow: {
          nodes: plan.draft.nodes.map((n) => ({
            id: n.id,
            name: n.name,
            role: n.role,
            taskSummary: n.taskSummary,
            responsibilitySummary: n.responsibilitySummary,
            position: n.position,
            width: n.width,
            height: n.height,
          })),
          edges: plan.draft.edges,
          tasks: plan.draft.tasks,
        },
      });
      setStep("done");
      onCreated();
      router.push(`/projects/${projectId}/workflows/${result.workflow.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作流失败");
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setStep("upload");
    setFiles([]);
    setPlan(null);
    setError("");
    setWorkflowName("");
    setWorkflowDescription("");
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-indigo-500" />
        <p className="text-sm font-medium text-slate-700">从 Skill / Role Markdown 文件生成工作流</p>
      </div>
      <p className="text-xs text-slate-500">
        上传包含角色定义的 .md 文件或 .zip 压缩包，系统将自动解析角色信息并生成多代理协作工作流。
      </p>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      {step === "upload" ? (
        <div className="space-y-3">
          {/* File drop area */}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-6 transition hover:border-indigo-300 hover:bg-indigo-50/30">
            <FileUp className="h-6 w-6 text-slate-400" />
            <span className="text-sm text-slate-500">点击选择文件，或拖拽到此处</span>
            <span className="text-xs text-slate-400">支持 .md / .markdown / .zip（最大 8MB/文件，80个 MD 文件）</span>
            <input type="file" multiple accept=".md,.markdown,.zip" onChange={onSelectFiles} className="hidden" />
          </label>

          {/* Selected files list */}
          {files.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">已选择 {files.length} 个文件：</p>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                  <span className="truncate text-xs text-slate-700">{f.name} <span className="text-slate-400">({formatFileSize(f.size)})</span></span>
                  <button type="button" onClick={() => onRemoveFile(i)} className="text-xs text-slate-400 hover:text-rose-500">移除</button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Options */}
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="工作流名称（可选，自动生成）"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
            />
            <input
              value={workflowDescription}
              onChange={(e) => setWorkflowDescription(e.target.value)}
              placeholder="工作流描述（可选）"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 focus:ring-2"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={preferLlm}
                onChange={(e) => setPreferLlm(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              使用 LLM 智能规划（需要在设置中配置模型）
            </label>
            <button
              type="button"
              onClick={() => void onPlan()}
              disabled={planning || files.length === 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-500 px-5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {planning ? "解析中..." : "解析并预览"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "preview" && plan ? (
        <div className="space-y-3">
          {/* Plan info */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-700">
              {plan.planner === "llm" ? "LLM 智能规划" : "启发式规划"}
            </span>
            <span className="text-xs text-slate-500">
              识别到 {plan.roleSummaries.length} 个角色 · 生成 {plan.draft.nodes.length} 个节点 · {plan.draft.edges.length} 条连接
            </span>
          </div>

          {/* Warnings */}
          {plan.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-amber-700">解析提示 ({plan.warnings.length})</p>
              <ul className="space-y-0.5">
                {plan.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-600">· {w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Role summaries */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">角色摘要</p>
            {plan.roleSummaries.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                expanded={expandedRoleId === role.id}
                onToggle={() => setExpandedRoleId(expandedRoleId === role.id ? null : role.id)}
              />
            ))}
          </div>

          {/* Draft workflow preview */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">生成的工作流</p>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-sm font-medium text-slate-800">{plan.draft.name}</p>
              {plan.draft.description ? <p className="mt-0.5 text-xs text-slate-500">{plan.draft.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {plan.draft.nodes.map((node) => (
                  <span
                    key={node.id}
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                      node.role === "input" ? "bg-blue-100 text-blue-700"
                        : node.role === "output" ? "bg-emerald-100 text-emerald-700"
                          : node.role === "planner" ? "bg-purple-100 text-purple-700"
                            : node.role === "reviewer" ? "bg-amber-100 text-amber-700"
                              : node.role === "research" ? "bg-cyan-100 text-cyan-700"
                                : node.role === "summarizer" ? "bg-teal-100 text-teal-700"
                                  : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {node.name}
                    <span className="ml-1 opacity-60">({node.role})</span>
                  </span>
                ))}
              </div>
              {plan.draft.rootTaskInput ? (
                <p className="mt-2 text-xs text-slate-400">默认输入：{plan.draft.rootTaskInput}</p>
              ) : null}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              重新上传
            </button>
            <button
              type="button"
              onClick={() => void onConfirmCreate()}
              disabled={saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-indigo-500 px-5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "创建中..." : "确认创建工作流"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RoleCard({ role, expanded, onToggle }: { role: SkillPackRoleSummaryView; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{role.roleName}</p>
          <p className="truncate text-xs text-slate-500">{role.positioning || "通用角色"}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{role.sourceFile}</span>
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-slate-100 px-3 py-2.5 text-xs text-slate-600">
          <div className="grid gap-2 md:grid-cols-2">
            {role.responsibilities.length > 0 ? (
              <RoleField label="职责" items={role.responsibilities} />
            ) : null}
            {role.domain.length > 0 ? (
              <RoleField label="专业领域" items={role.domain} />
            ) : null}
            {role.strengths.length > 0 ? (
              <RoleField label="擅长" items={role.strengths} />
            ) : null}
            {role.inputType.length > 0 ? (
              <RoleField label="输入类型" items={role.inputType} />
            ) : null}
            {role.outputType.length > 0 ? (
              <RoleField label="输出类型" items={role.outputType} />
            ) : null}
            {role.collaboration.length > 0 ? (
              <RoleField label="协作关系" items={role.collaboration} />
            ) : null}
            {role.scenarios.length > 0 ? (
              <RoleField label="适用场景" items={role.scenarios} />
            ) : null}
            {role.constraints.length > 0 ? (
              <RoleField label="约束" items={role.constraints} />
            ) : null}
          </div>
          {role.warnings.length > 0 ? (
            <div className="mt-2">
              {role.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600">⚠ {w}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RoleField({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-0.5 font-medium text-slate-500">{label}</p>
      <ul className="list-inside list-disc space-y-0.5 text-slate-600">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
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

function buildFileSource(file: ProjectFileView) {
  if (file.sourceType === "run_output") {
    if (file.workflowName && file.runId) {
      return `${file.workflowName} / ${file.runId}`;
    }
    if (file.runId) return `运行 ${file.runId}`;
    return "运行产物";
  }
  if (file.sourceType === "upload") return "上传";
  return "手动";
}
