"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, Mail, Plus, Save, Send, Trash2, Webhook } from "lucide-react";

import {
  runtimeClient,
  type CredentialSummary,
  type NotificationChannelView,
  type ProjectSummaryView,
  type WorkspaceConfigView,
} from "@/features/workflow/adapters/runtime-client";

/* ── Global Settings form ── */

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

/* ── Adapter metadata ── */

const ADAPTER_OPTIONS = [
  { value: "feishu", label: "飞书", icon: "🔵" },
  { value: "dingtalk", label: "钉钉", icon: "🔷" },
  { value: "slack", label: "Slack", icon: "💬" },
  { value: "discord", label: "Discord", icon: "🎮" },
  { value: "generic", label: "通用 Webhook", icon: "🔗" },
  { value: "smtp", label: "邮件 (SMTP)", icon: "📧" },
] as const;

type AdapterType = (typeof ADAPTER_OPTIONS)[number]["value"];

function adapterLabel(type: string) {
  return ADAPTER_OPTIONS.find((a) => a.value === type)?.label ?? type;
}

/* ── Channel form state ── */

interface ChannelForm {
  name: string;
  adapterType: AdapterType;
  triggerOnSuccess: boolean;
  triggerOnFailure: boolean;
  // Webhook fields
  webhookUrl: string;
  secret: string;
  // Generic webhook
  url: string;
  method: string;
  customHeaders: string;
  // Email fields
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

const EMPTY_FORM: ChannelForm = {
  name: "",
  adapterType: "feishu",
  triggerOnSuccess: true,
  triggerOnFailure: true,
  webhookUrl: "",
  secret: "",
  url: "",
  method: "POST",
  customHeaders: "",
  host: "",
  port: "465",
  secure: true,
  user: "",
  pass: "",
  from: "",
  to: "",
};

function formToConfig(form: ChannelForm): Record<string, unknown> {
  if (form.adapterType === "smtp") {
    return {
      host: form.host,
      port: Number(form.port) || 465,
      secure: form.secure,
      user: form.user,
      pass: form.pass,
      from: form.from || form.user,
      to: form.to.split(/[,;，；\s]+/).filter(Boolean),
    };
  }
  if (form.adapterType === "generic") {
    const headers: Record<string, string> = {};
    form.customHeaders.split("\n").forEach((line) => {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return { url: form.url, method: form.method, headers };
  }
  // feishu / dingtalk / slack / discord
  return { webhookUrl: form.webhookUrl, ...(form.secret ? { secret: form.secret } : {}) };
}

const inputClass =
  "h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2";
const cardClass =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]";

/* ── Page ── */

export default function SettingsPage() {
  /* Global Settings state */
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

  /* Notification channels state */
  const [channels, setChannels] = useState<NotificationChannelView[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [channelForm, setChannelForm] = useState<ChannelForm>(EMPTY_FORM);
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; error?: string }>>({});

  /* ── Load ── */

  const loadGlobal = async () => {
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

  const loadChannels = async () => {
    setChannelsLoading(true);
    try {
      const data = await runtimeClient.listNotificationChannels();
      setChannels(data.channels);
    } catch {
      /* ignore */
    } finally {
      setChannelsLoading(false);
    }
  };

  useEffect(() => {
    void loadGlobal();
    void loadChannels();
  }, []);

  /* ── Global save ── */

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
      setMessage("Global Settings 已保存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存全局设置失败");
    } finally {
      setSaving(false);
    }
  };

  /* ── Channel actions ── */

  const onCreateChannel = async () => {
    setChannelSaving(true);
    setChannelError("");
    try {
      const channelType = channelForm.adapterType === "smtp" ? "email" : "webhook";
      await runtimeClient.createNotificationChannel({
        name: channelForm.name,
        channelType,
        adapterType: channelForm.adapterType,
        config: formToConfig(channelForm),
        triggerOnSuccess: channelForm.triggerOnSuccess,
        triggerOnFailure: channelForm.triggerOnFailure,
      });
      setShowForm(false);
      setChannelForm(EMPTY_FORM);
      await loadChannels();
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setChannelSaving(false);
    }
  };

  const onDeleteChannel = async (id: string) => {
    if (!confirm("确定删除该通知通道？")) return;
    await runtimeClient.deleteNotificationChannel(id);
    await loadChannels();
  };

  const onToggleChannel = async (ch: NotificationChannelView) => {
    await runtimeClient.updateNotificationChannel(ch.id, { enabled: !ch.enabled });
    await loadChannels();
  };

  const onTestChannel = async (id: string) => {
    setTestingId(id);
    const result = await runtimeClient.testNotificationChannel(id);
    setTestResult((prev) => ({ ...prev, [id]: result }));
    setTestingId(null);
    await loadChannels();
  };

  /* ── Render ── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className={cardClass}>
        <h1 className="text-2xl font-semibold text-slate-900">设置</h1>
        <p className="mt-1 text-sm text-slate-500">
          管理平台全局配置、通知通道等。
        </p>
      </section>

      {/* ── Global Settings ── */}
      <section className={cardClass}>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Save className="h-5 w-5 text-indigo-500" />
          Global Settings
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          平台级默认模型配置。继承关系：Global → Project → Workflow → Node。
        </p>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载配置...
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认 provider</span>
                <input
                  value={form.defaultProvider}
                  onChange={(e) => setForm((p) => ({ ...p, defaultProvider: e.target.value }))}
                  className={inputClass}
                  placeholder="例如 OpenAI / MiniMax / Anthropic"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认模型</span>
                <input
                  value={form.defaultModel}
                  onChange={(e) => setForm((p) => ({ ...p, defaultModel: e.target.value }))}
                  className={inputClass}
                  placeholder="例如 gpt-4.1 / MiniMax-M2.5"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认 baseUrl</span>
                <input
                  value={form.defaultBaseUrl}
                  onChange={(e) => setForm((p) => ({ ...p, defaultBaseUrl: e.target.value }))}
                  className={inputClass}
                  placeholder="例如 https://api.openai.com/v1"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-700">默认 credential</span>
                <select
                  value={form.defaultCredentialId}
                  onChange={(e) => setForm((p) => ({ ...p, defaultCredentialId: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">不指定</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-slate-700">默认温度（0-2）</span>
                <input
                  value={form.defaultTemperature}
                  onChange={(e) => setForm((p) => ({ ...p, defaultTemperature: e.target.value }))}
                  className={inputClass}
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
              保存
            </button>
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
          </div>
        )}
      </section>

      {/* ── Notification Channels ── */}
      <section className={cardClass}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Bell className="h-5 w-5 text-indigo-500" />
            通知通道
          </h2>
          <button
            type="button"
            onClick={() => { setShowForm(true); setChannelForm(EMPTY_FORM); setChannelError(""); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600"
          >
            <Plus className="h-4 w-4" />
            添加通道
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          运行完成或失败时，自动通过 Webhook / 邮件发送通知。支持飞书、钉钉、Slack、Discord。
        </p>

        {/* Channel list */}
        {channelsLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : channels.length === 0 && !showForm ? (
          <p className="mt-4 text-sm text-slate-400">暂未配置通知通道。</p>
        ) : (
          <div className="mt-4 space-y-2">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-lg shadow-sm">
                  {ch.adapterType === "smtp" ? <Mail className="h-4 w-4 text-indigo-500" /> : <Webhook className="h-4 w-4 text-indigo-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{ch.name}</span>
                    <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {adapterLabel(ch.adapterType)}
                    </span>
                    {ch.triggerOnSuccess && (
                      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">成功</span>
                    )}
                    {ch.triggerOnFailure && (
                      <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">失败</span>
                    )}
                  </div>
                  {ch.lastTestAt && (
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      上次测试: {new Date(ch.lastTestAt).toLocaleString()} —{" "}
                      {ch.lastTestOk ? <span className="text-emerald-600">成功</span> : <span className="text-rose-600">失败</span>}
                    </p>
                  )}
                  {testResult[ch.id] && (
                    <p className={`mt-0.5 text-[11px] ${testResult[ch.id].ok ? "text-emerald-600" : "text-rose-600"}`}>
                      {testResult[ch.id].ok ? "测试发送成功！" : `测试失败: ${testResult[ch.id].error}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void onToggleChannel(ch)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${ch.enabled ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-slate-200 text-slate-500 hover:bg-slate-300"}`}
                  >
                    {ch.enabled ? "已启用" : "已禁用"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onTestChannel(ch.id)}
                    disabled={testingId === ch.id}
                    className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {testingId === ch.id ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <Send className="inline h-3 w-3" />}
                    {" "}测试
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteChannel(ch.id)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create channel form */}
        {showForm && (
          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
            <h3 className="text-sm font-semibold text-slate-800">新建通知通道</h3>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-slate-700">通道名称</span>
                  <input
                    value={channelForm.name}
                    onChange={(e) => setChannelForm((p) => ({ ...p, name: e.target.value }))}
                    className={inputClass}
                    placeholder="例如：飞书运维群"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-slate-700">类型</span>
                  <select
                    value={channelForm.adapterType}
                    onChange={(e) => setChannelForm((p) => ({ ...p, adapterType: e.target.value as AdapterType }))}
                    className={inputClass}
                  >
                    {ADAPTER_OPTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.icon} {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Dynamic config fields */}
              {channelForm.adapterType === "smtp" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">SMTP 主机</span>
                    <input
                      value={channelForm.host}
                      onChange={(e) => setChannelForm((p) => ({ ...p, host: e.target.value }))}
                      className={inputClass}
                      placeholder="smtp.qq.com"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">端口</span>
                    <input
                      value={channelForm.port}
                      onChange={(e) => setChannelForm((p) => ({ ...p, port: e.target.value }))}
                      className={inputClass}
                      placeholder="465"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">用户名</span>
                    <input
                      value={channelForm.user}
                      onChange={(e) => setChannelForm((p) => ({ ...p, user: e.target.value }))}
                      className={inputClass}
                      placeholder="your@qq.com"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">密码 / 授权码</span>
                    <input
                      type="password"
                      value={channelForm.pass}
                      onChange={(e) => setChannelForm((p) => ({ ...p, pass: e.target.value }))}
                      className={inputClass}
                      placeholder="SMTP 授权码"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">发件人</span>
                    <input
                      value={channelForm.from}
                      onChange={(e) => setChannelForm((p) => ({ ...p, from: e.target.value }))}
                      className={inputClass}
                      placeholder="留空则使用用户名"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">收件人（逗号分隔）</span>
                    <input
                      value={channelForm.to}
                      onChange={(e) => setChannelForm((p) => ({ ...p, to: e.target.value }))}
                      className={inputClass}
                      placeholder="a@example.com, b@example.com"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={channelForm.secure}
                      onChange={(e) => setChannelForm((p) => ({ ...p, secure: e.target.checked }))}
                    />
                    SSL / TLS
                  </label>
                </div>
              ) : channelForm.adapterType === "generic" ? (
                <div className="space-y-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">Webhook URL</span>
                    <input
                      value={channelForm.url}
                      onChange={(e) => setChannelForm((p) => ({ ...p, url: e.target.value }))}
                      className={inputClass}
                      placeholder="https://your-server.com/webhook"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-700">自定义 Headers（每行 Key: Value）</span>
                    <textarea
                      value={channelForm.customHeaders}
                      onChange={(e) => setChannelForm((p) => ({ ...p, customHeaders: e.target.value }))}
                      className="min-h-[60px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-indigo-200 transition focus:ring-2"
                      placeholder={"Authorization: Bearer xxx\nX-Custom: value"}
                    />
                  </label>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm md:col-span-2">
                    <span className="text-slate-700">Webhook URL</span>
                    <input
                      value={channelForm.webhookUrl}
                      onChange={(e) => setChannelForm((p) => ({ ...p, webhookUrl: e.target.value }))}
                      className={inputClass}
                      placeholder={
                        channelForm.adapterType === "feishu"
                          ? "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
                          : channelForm.adapterType === "dingtalk"
                            ? "https://oapi.dingtalk.com/robot/send?access_token=xxx"
                            : channelForm.adapterType === "slack"
                              ? "https://hooks.slack.com/services/xxx"
                              : "https://discord.com/api/webhooks/xxx"
                      }
                    />
                  </label>
                  {(channelForm.adapterType === "feishu" || channelForm.adapterType === "dingtalk") && (
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span className="text-slate-700">签名密钥（可选）</span>
                      <input
                        value={channelForm.secret}
                        onChange={(e) => setChannelForm((p) => ({ ...p, secret: e.target.value }))}
                        className={inputClass}
                        placeholder="留空则不签名"
                      />
                    </label>
                  )}
                </div>
              )}

              {/* Trigger options */}
              <div className="flex items-center gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={channelForm.triggerOnSuccess}
                    onChange={(e) => setChannelForm((p) => ({ ...p, triggerOnSuccess: e.target.checked }))}
                  />
                  运行成功时通知
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={channelForm.triggerOnFailure}
                    onChange={(e) => setChannelForm((p) => ({ ...p, triggerOnFailure: e.target.checked }))}
                  />
                  运行失败时通知
                </label>
              </div>

              {channelError && <p className="text-xs text-rose-600">{channelError}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onCreateChannel()}
                  disabled={channelSaving || !channelForm.name}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60"
                >
                  {channelSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="h-9 rounded-xl px-4 text-sm text-slate-600 transition hover:bg-slate-100"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Project inheritance preview ── */}
      <section className={cardClass}>
        <h2 className="text-base font-semibold text-slate-900">Project 继承预览（Global → Project）</h2>
        <p className="mt-1 text-sm text-slate-500">当 Project 未设置默认值时，使用 Global 默认值。</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2 font-medium">项目</th>
                <th className="px-3 py-2 font-medium">Project 配置</th>
                <th className="px-3 py-2 font-medium">Effective</th>
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
