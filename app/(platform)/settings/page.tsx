"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

import {
  runtimeClient,
  type CredentialSummary,
  type ProjectSummaryView,
  type WorkspaceConfigView,
} from "@/features/workflow/adapters/runtime-client";

interface GlobalForm {
  defaultProvider: string;
  defaultModel: string;
  defaultBaseUrl: string;
  defaultCredentialId: string;
  defaultTemperature: string;
}

function toForm(workspace: WorkspaceConfigView): GlobalForm {
  return {
    defaultProvider: workspace.defaultProvider ?? "",
    defaultModel: workspace.defaultModel ?? "",
    defaultBaseUrl: workspace.defaultBaseUrl ?? "",
    defaultCredentialId: workspace.defaultCredentialId ?? "",
    defaultTemperature:
      workspace.defaultTemperature !== undefined ? String(workspace.defaultTemperature) : "",
  };
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [form, setForm] = useState<GlobalForm>({
    defaultProvider: "",
    defaultModel: "",
    defaultBaseUrl: "",
    defaultCredentialId: "",
    defaultTemperature: "",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [workspacePayload, projectsPayload] = await Promise.all([
        runtimeClient.getWorkspaceConfig(),
        runtimeClient.listProjects({ includeArchived: true }),
      ]);
      setCredentials(workspacePayload.credentials);
      setProjects(projectsPayload.projects);
      setForm(toForm(workspacePayload.workspace));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载全局设置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const temperature = form.defaultTemperature.trim()
        ? Number(form.defaultTemperature.trim())
        : undefined;
      if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
        setError("默认温度需在 0 到 2 之间。");
        setSaving(false);
        return;
      }
      const payload = await runtimeClient.updateWorkspaceConfig({
        defaultProvider: form.defaultProvider.trim() || undefined,
        defaultModel: form.defaultModel.trim() || undefined,
        defaultBaseUrl: form.defaultBaseUrl.trim() || undefined,
        defaultCredentialId: form.defaultCredentialId || undefined,
        defaultTemperature: temperature,
      });
      setForm(toForm(payload.workspace));
      const projectsPayload = await runtimeClient.listProjects({ includeArchived: true });
      setProjects(projectsPayload.projects);
      setMessage("Global Settings 已保存。Project 会继承未覆盖的全局默认值。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存全局设置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        <h1 className="text-2xl font-semibold text-slate-900">Global Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          维护平台级默认模型配置。继承关系：Global → Project → Workflow → Node（本轮落地 Global → Project）。
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载配置...
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认 provider</span>
                <input
                  value={form.defaultProvider}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultProvider: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
                  placeholder="例如 OpenAI / MiniMax / Anthropic"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认模型</span>
                <input
                  value={form.defaultModel}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultModel: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
                  placeholder="例如 gpt-4.1 / MiniMax-M2.5"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认 baseUrl</span>
                <input
                  value={form.defaultBaseUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultBaseUrl: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
                  placeholder="例如 https://api.openai.com/v1"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认 credential</span>
                <select
                  value={form.defaultCredentialId}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultCredentialId: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
                >
                  <option value="">不指定（可由 Project 覆盖）</option>
                  {credentials.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-slate-700">默认温度（0-2）</span>
                <input
                  value={form.defaultTemperature}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultTemperature: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
                  placeholder="例如 0.2"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存 Global Settings
            </button>
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        <h2 className="text-base font-semibold text-slate-900">Project 继承预览（Global → Project）</h2>
        <p className="mt-1 text-sm text-slate-500">当 Project 未设置默认值时，使用 Global 默认值作为 effective 配置。</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2 font-medium">项目</th>
                <th className="px-3 py-2 font-medium">Project 配置</th>
                <th className="px-3 py-2 font-medium">Effective（继承后）</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-700">{project.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    <div>provider: {project.settings.defaultProvider || "-"}</div>
                    <div>model: {project.settings.defaultModel || "-"}</div>
                    <div>baseUrl: {project.settings.defaultBaseUrl || "-"}</div>
                    <div>credential: {project.settings.defaultCredentialId || "-"}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-700">
                    <div>provider: {project.effectiveSettings?.defaultProvider || "-"}</div>
                    <div>model: {project.effectiveSettings?.defaultModel || "-"}</div>
                    <div>baseUrl: {project.effectiveSettings?.defaultBaseUrl || "-"}</div>
                    <div>credential: {project.effectiveSettings?.defaultCredentialId || "-"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
