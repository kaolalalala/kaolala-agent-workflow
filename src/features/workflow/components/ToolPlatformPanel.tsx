"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  runtimeClient,
  type ToolCategory,
  type ToolDefinitionView,
  type ToolPackageImportResult,
  type ToolSourceType,
} from "@/features/workflow/adapters/runtime-client";

interface ToolPlatformPanelProps {
  onClose: () => void;
}

type Mode = "beginner" | "advanced";
type PackageFormat = "json" | "yaml" | "zip";

const CATEGORIES: ToolCategory[] = ["integration", "automation", "analysis", "search", "retrieval", "custom"];
const SOURCES: ToolSourceType[] = ["http_api", "local_script", "openclaw"];

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  integration: "集成",
  automation: "自动化",
  analysis: "分析",
  search: "搜索",
  retrieval: "检索",
  custom: "自定义",
};

const SOURCE_LABELS: Record<ToolSourceType, string> = {
  http_api: "HTTP API",
  local_script: "本地脚本",
  openclaw: "OpenClaw",
};

function stringify(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function safeJson(text: string, field: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${field} 必须是合法 JSON`);
  }
}

function starterSourceConfig(sourceType: ToolSourceType) {
  if (sourceType === "http_api") {
    return { url: "https://httpbin.org/get", method: "GET" };
  }
  if (sourceType === "local_script") {
    return { command: "node ./scripts/tools/custom-tool.mjs" };
  }
  return { endpoint: "https://example.com/openclaw", method: "POST" };
}

export function ToolPlatformPanel({ onClose }: ToolPlatformPanelProps) {
  const [mode, setMode] = useState<Mode>("beginner");
  const [tools, setTools] = useState<ToolDefinitionView[]>([]);
  const [selectedToolId, setSelectedToolId] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ToolCategory>("integration");
  const [sourceType, setSourceType] = useState<ToolSourceType>("http_api");
  const [sourceConfigText, setSourceConfigText] = useState(stringify(starterSourceConfig("http_api")));
  const [authText, setAuthText] = useState('{"type":"none","required":false}');
  const [policyText, setPolicyText] = useState('{"timeoutMs":10000,"maxRetries":0,"retryBackoffMs":300}');

  const [endpointOrCommand, setEndpointOrCommand] = useState("https://httpbin.org/get");
  const [credentialRequired, setCredentialRequired] = useState(false);
  const [credentialId, setCredentialId] = useState("");

  const [detailSourceConfigText, setDetailSourceConfigText] = useState("{}");
  const [detailAuthText, setDetailAuthText] = useState("{}");
  const [detailPolicyText, setDetailPolicyText] = useState("{}");
  const [testInputText, setTestInputText] = useState('{"ping":"pong"}');
  const [testResultText, setTestResultText] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [packageFormat, setPackageFormat] = useState<PackageFormat>("json");
  const [packageSourceName, setPackageSourceName] = useState("tool-package");
  const [packageContent, setPackageContent] = useState('{"packageName":"demo","version":"1.0.0","tools":[]}');
  const [packageResult, setPackageResult] = useState<ToolPackageImportResult | null>(null);

  const filteredTools = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) {
      return tools;
    }
    return tools.filter((item) => item.name.toLowerCase().includes(key) || item.toolId.toLowerCase().includes(key));
  }, [search, tools]);

  const selectedTool = useMemo(() => tools.find((item) => item.toolId === selectedToolId) ?? null, [tools, selectedToolId]);

  const loadTools = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await runtimeClient.listToolAssets();
      setTools(payload.tools);
      if (!selectedToolId && payload.tools[0]) {
        setSelectedToolId(payload.tools[0].toolId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取工具列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTool) {
      setDetailSourceConfigText("{}");
      setDetailAuthText("{}");
      setDetailPolicyText("{}");
      return;
    }
    setDetailSourceConfigText(stringify(selectedTool.sourceConfig));
    setDetailAuthText(stringify(selectedTool.authRequirements));
    setDetailPolicyText(stringify(selectedTool.policy));
  }, [selectedTool]);

  const applyTemplate = (template: "http_json" | "local_script" | "search_openclaw") => {
    if (template === "http_json") {
      setSourceType("http_api");
      setCategory("integration");
      setEndpointOrCommand("https://httpbin.org/get");
      setSourceConfigText(stringify({ url: "https://httpbin.org/get", method: "GET" }));
      return;
    }
    if (template === "local_script") {
      setSourceType("local_script");
      setCategory("automation");
      setEndpointOrCommand("node ./scripts/tools/custom-tool.mjs");
      setSourceConfigText(stringify({ command: "node ./scripts/tools/custom-tool.mjs" }));
      return;
    }
    setSourceType("openclaw");
    setCategory("search");
    setEndpointOrCommand("https://example.com/openclaw/search");
    setSourceConfigText(stringify({ endpoint: "https://example.com/openclaw/search", method: "POST" }));
  };

  const onCreateBeginner = async () => {
    setError("");
    setMessage("");
    if (!name.trim()) {
      setError("请填写工具名称。");
      return;
    }
    if (!endpointOrCommand.trim()) {
      setError(sourceType === "local_script" ? "请填写脚本命令。" : "请填写接口地址。");
      return;
    }
    try {
      const sourceConfig =
        sourceType === "http_api"
          ? { url: endpointOrCommand, method: "GET", credentialId: credentialId || undefined }
          : sourceType === "local_script"
            ? { command: endpointOrCommand, credentialId: credentialId || undefined }
            : { endpoint: endpointOrCommand, method: "POST", credentialId: credentialId || undefined };

      const auth = credentialRequired
        ? { type: "credential_ref" as const, required: true, fields: ["credentialId"] }
        : { type: "none" as const, required: false };

      const created = await runtimeClient.createToolAsset({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        sourceType,
        sourceConfig,
        inputSchema: {},
        outputSchema: {},
        authRequirements: auth,
        policy: { timeoutMs: 10000, maxRetries: 0, retryBackoffMs: 300 },
        enabled: true,
      });
      setMessage(`工具资产创建成功：${created.tool.toolId}`);
      await loadTools();
      setSelectedToolId(created.tool.toolId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建工具失败");
    }
  };

  const onCreateAdvanced = async () => {
    setError("");
    setMessage("");
    if (!name.trim()) {
      setError("请填写工具名称。");
      return;
    }
    try {
      const created = await runtimeClient.createToolAsset({
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        sourceType,
        inputSchema: {},
        outputSchema: {},
        sourceConfig: safeJson(sourceConfigText, "sourceConfig"),
        authRequirements: safeJson(authText, "authRequirements") as ToolDefinitionView["authRequirements"],
        policy: safeJson(policyText, "policy") as ToolDefinitionView["policy"],
        enabled: true,
      });
      setMessage(`工具资产创建成功：${created.tool.toolId}`);
      await loadTools();
      setSelectedToolId(created.tool.toolId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建工具失败");
    }
  };

  const onSaveDetail = async () => {
    if (!selectedTool) {
      return;
    }
    setError("");
    setMessage("");
    try {
      await runtimeClient.updateToolAsset(selectedTool.toolId, {
        sourceConfig: safeJson(detailSourceConfigText, "sourceConfig"),
        authRequirements: safeJson(detailAuthText, "authRequirements") as ToolDefinitionView["authRequirements"],
        policy: safeJson(detailPolicyText, "policy") as ToolDefinitionView["policy"],
      });
      setMessage("工具资产配置已保存");
      await loadTools();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存工具配置失败");
    }
  };

  const onValidate = async () => {
    if (!selectedTool) {
      return;
    }
    setError("");
    try {
      const result = await runtimeClient.validateTool(selectedTool.toolId);
      setValidationErrors(result.errors);
      setMessage(result.ok ? "工具校验通过" : "工具校验未通过");
    } catch (e) {
      setError(e instanceof Error ? e.message : "校验工具失败");
    }
  };

  const onTest = async () => {
    if (!selectedTool) {
      return;
    }
    setError("");
    try {
      const result = await runtimeClient.testCallTool(selectedTool.toolId, {
        input: safeJson(testInputText, "测试输入"),
      });
      setTestResultText(stringify(result.result));
      setMessage(result.result.ok ? "测试调用成功" : "测试调用失败");
    } catch (e) {
      setError(e instanceof Error ? e.message : "测试调用失败");
    }
  };

  const onToggleTool = async (tool: ToolDefinitionView) => {
    setError("");
    try {
      await runtimeClient.updateToolAsset(tool.toolId, { enabled: !tool.enabled });
      await loadTools();
      setMessage(tool.enabled ? "工具资产已禁用" : "工具资产已启用");
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换工具状态失败");
    }
  };

  const onImportPackage = async () => {
    setError("");
    setMessage("");
    setPackageResult(null);
    try {
      const result = await runtimeClient.importToolPackage({
        format: packageFormat,
        content: packageContent,
        sourceName: packageSourceName.trim() || undefined,
      });
      setPackageResult(result);
      setMessage(`工具包导入完成：成功 ${result.imported.length} 个工具`);
      await loadTools();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入工具包失败");
    }
  };

  const onZipFileSelected = async (file?: File | null) => {
    if (!file) {
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    setPackageContent(btoa(binary));
    setPackageFormat("zip");
    setPackageSourceName(file.name);
  };

  return (
    <div className="w-[min(1080px,calc(100vw-2.5rem))] max-h-[85vh] overflow-y-auto rounded-[30px] border border-white/60 bg-[var(--panel-strong)] p-4 shadow-[0_40px_100px_-40px_var(--shadow-color)] backdrop-blur dark:border-white/10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-slate-500 dark:text-slate-400">工具资产</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">工具资产导入（新手模式 / 高级模式）</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={mode === "beginner" ? "default" : "secondary"} onClick={() => setMode("beginner")} className="rounded-xl">
            新手模式
          </Button>
          <Button variant={mode === "advanced" ? "default" : "secondary"} onClick={() => setMode("advanced")} className="rounded-xl">
            高级模式
          </Button>
          <Button variant="ghost" className="rounded-xl" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-black/8 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按工具资产 ID / 名称搜索" className="mb-3" />
          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {loading ? <p className="text-xs text-slate-500">加载中...</p> : null}
            {!loading && filteredTools.length === 0 ? <p className="text-xs text-slate-500">暂无工具资产</p> : null}
            {filteredTools.map((tool) => (
              <div
                key={tool.toolId}
                className={`rounded-xl border px-3 py-3 text-xs ${
                  selectedToolId === tool.toolId
                    ? "border-emerald-300 bg-emerald-50/90 dark:border-emerald-400/40 dark:bg-emerald-400/10"
                    : "border-black/8 bg-white/80 dark:border-white/10 dark:bg-white/[0.03]"
                }`}
              >
                <button type="button" className="w-full text-left" onClick={() => setSelectedToolId(tool.toolId)}>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{tool.name}</p>
                  <p className="mt-1 text-slate-500 dark:text-slate-400">{tool.toolId}</p>
                </button>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => void onToggleTool(tool)}>
                    {tool.enabled ? "禁用" : "启用"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-black/8 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">创建工具资产（{mode === "beginner" ? "新手模式" : "高级模式"}）</p>
            <div className="grid gap-2 md:grid-cols-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="工具名称" />
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述（可选）" />
              <select value={category} onChange={(e) => setCategory(e.target.value as ToolCategory)} className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
                {CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {CATEGORY_LABELS[item]}
                  </option>
                ))}
              </select>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value as ToolSourceType)} className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
                {SOURCES.map((item) => (
                  <option key={item} value={item}>
                    {SOURCE_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>

            {mode === "beginner" ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => applyTemplate("http_json")}>
                    HTTP JSON 模板
                  </Button>
                  <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => applyTemplate("local_script")}>
                    本地脚本模板
                  </Button>
                  <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => applyTemplate("search_openclaw")}>
                    OpenClaw 搜索模板
                  </Button>
                </div>
                <Input
                  value={endpointOrCommand}
                  onChange={(e) => setEndpointOrCommand(e.target.value)}
                  placeholder={sourceType === "local_script" ? "脚本命令或路径" : "接口 URL"}
                />
                <Input value={credentialId} onChange={(e) => setCredentialId(e.target.value)} placeholder="凭证 ID（可选）" />
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={credentialRequired} onChange={(e) => setCredentialRequired(e.target.checked)} />
                  需要凭证
                </label>
                <div className="flex justify-end">
                  <Button className="rounded-xl" onClick={() => void onCreateBeginner()}>
                    创建工具资产
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">sourceConfig（原始 JSON）</p>
                  <Textarea value={sourceConfigText} onChange={(e) => setSourceConfigText(e.target.value)} className="min-h-[140px]" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">authRequirements（原始 JSON）</p>
                  <Textarea value={authText} onChange={(e) => setAuthText(e.target.value)} className="min-h-[140px]" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">policy（原始 JSON）</p>
                  <Textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} className="min-h-[140px]" />
                </div>
                <div className="md:col-span-3 flex justify-end">
                  <Button className="rounded-xl" onClick={() => void onCreateAdvanced()}>
                    创建工具资产（高级模式）
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-black/8 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">工具包导入（tool.json / tool.yaml / zip）</p>
            <div className="grid gap-2 md:grid-cols-3">
              <select value={packageFormat} onChange={(e) => setPackageFormat(e.target.value as PackageFormat)} className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
                <option value="json">tool.json</option>
                <option value="yaml">tool.yaml</option>
                <option value="zip">zip 工具包</option>
              </select>
              <Input value={packageSourceName} onChange={(e) => setPackageSourceName(e.target.value)} placeholder="来源名称（可选）" />
              <Input type="file" accept=".zip" onChange={(e) => void onZipFileSelected(e.target.files?.[0])} />
            </div>
            <Textarea
              value={packageContent}
              onChange={(e) => setPackageContent(e.target.value)}
              className="mt-2 min-h-[150px]"
              placeholder={packageFormat === "zip" ? "可直接上传 zip，或粘贴 Base64 内容" : "粘贴工具包清单内容"}
            />
            <div className="mt-2 flex justify-end">
              <Button className="rounded-xl" onClick={() => void onImportPackage()}>
                导入工具包
              </Button>
            </div>
            {packageResult ? (
              <div className="mt-2 rounded-xl border border-black/8 bg-white/80 p-2 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                <p>已导入工具：{packageResult.imported.length}</p>
                <p>已生成测试用例：{packageResult.generatedTestCases.length}</p>
                <p>已生成节点注册：{packageResult.generatedNodeRegistrations.length}</p>
              </div>
            ) : null}
          </div>

          {selectedTool ? (
            <div className="rounded-2xl border border-black/8 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">高级编辑：{selectedTool.name}</p>
              <div className="grid gap-2 md:grid-cols-3">
                <Textarea value={detailSourceConfigText} onChange={(e) => setDetailSourceConfigText(e.target.value)} className="min-h-[120px]" />
                <Textarea value={detailAuthText} onChange={(e) => setDetailAuthText(e.target.value)} className="min-h-[120px]" />
                <Textarea value={detailPolicyText} onChange={(e) => setDetailPolicyText(e.target.value)} className="min-h-[120px]" />
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => void onValidate()}>
                  校验
                </Button>
                <Button size="sm" className="rounded-lg" onClick={() => void onSaveDetail()}>
                  保存
                </Button>
              </div>
              <div className="mt-2 rounded-xl border border-black/8 bg-white/80 p-2 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="mb-1 text-xs text-slate-500">测试输入（JSON）</p>
                <Textarea value={testInputText} onChange={(e) => setTestInputText(e.target.value)} className="min-h-[90px]" />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => void onTest()}>
                    执行测试
                  </Button>
                </div>
                <Textarea value={testResultText} readOnly className="mt-2 min-h-[100px]" />
                {validationErrors.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300">
                    {validationErrors.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
      {message ? <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">{message}</p> : null}
    </div>
  );
}
