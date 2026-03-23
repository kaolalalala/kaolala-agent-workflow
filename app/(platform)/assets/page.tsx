"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Link2, Trash2 } from "lucide-react";

import {
  runtimeClient,
  type AgentTemplateView,
  type CredentialSummary,
  type ModelAssetView,
  type PromptTemplateAssetView,
  type ScriptAssetView,
  type SkillAssetView,
  type ToolCategory,
  type ToolDefinitionView,
  type ToolSourceType,
  type WorkflowAssetReferenceView,
  type WorkflowSummaryView,
  type WorkflowTemplateView,
} from "@/features/workflow/adapters/runtime-client";

type AssetTab = "tools" | "models" | "prompts" | "scripts" | "skills";

const TOOL_CATEGORIES: ToolCategory[] = ["search", "retrieval", "automation", "analysis", "integration", "custom"];
const TOOL_SOURCES: ToolSourceType[] = ["http_api", "local_script", "openclaw"];
const AGENT_TEMPLATE_ROLES = [
  "planner",
  "worker",
  "summarizer",
  "reviewer",
  "research",
  "router",
  "human",
  "tool",
  "input",
  "output",
] as const;

const AGENT_ROLE_LABELS: Record<(typeof AGENT_TEMPLATE_ROLES)[number], string> = {
  planner: "规划",
  worker: "执行",
  summarizer: "总结",
  reviewer: "评审",
  research: "研究",
  router: "路由",
  human: "人工",
  tool: "工具",
  input: "输入",
  output: "输出",
};

function toRefKey(workflowId: string, assetType: WorkflowAssetReferenceView["assetType"], assetId: string) {
  return `${workflowId}:${assetType}:${assetId}`;
}

export default function AssetsPage() {
  const [tab, setTab] = useState<AssetTab>("tools");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [tools, setTools] = useState<ToolDefinitionView[]>([]);
  const [models, setModels] = useState<ModelAssetView[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplateAssetView[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplateView[]>([]);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplateView[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummaryView[]>([]);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [references, setReferences] = useState<WorkflowAssetReferenceView[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");

  const [creatingTool, setCreatingTool] = useState(false);
  const [toolDraft, setToolDraft] = useState({
    name: "",
    description: "",
    category: "integration" as ToolCategory,
    sourceType: "http_api" as ToolSourceType,
  });

  const [creatingModel, setCreatingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState({
    name: "",
    provider: "",
    model: "",
    baseUrl: "",
    credentialId: "",
  });

  const [creatingPrompt, setCreatingPrompt] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState({
    name: "",
    templateType: "workflow" as "system" | "agent" | "workflow",
    description: "",
    content: "",
  });

  const [scripts, setScripts] = useState<ScriptAssetView[]>([]);
  const [creatingScript, setCreatingScript] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = useState({
    name: "",
    description: "",
    localPath: "",
    runCommand: "",
    parameterSchema: "{}",
    defaultEnvironmentId: "",
  });

  const [skills, setSkills] = useState<SkillAssetView[]>([]);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState({
    name: "",
    description: "",
    scriptId: "",
    parameterMapping: "{}",
    outputDescription: "",
  });

  const [templateDraftName, setTemplateDraftName] = useState("");
  const [templateDraftDescription, setTemplateDraftDescription] = useState("");
  const [templateKeyword, setTemplateKeyword] = useState("");
  const [templateEnabledFilter, setTemplateEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [editingAgentTemplateId, setEditingAgentTemplateId] = useState<string | null>(null);
  const [agentTemplateKeyword, setAgentTemplateKeyword] = useState("");
  const [agentTemplateEnabledFilter, setAgentTemplateEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [agentTemplateDraft, setAgentTemplateDraft] = useState({
    name: "",
    description: "",
    role: "worker" as AgentTemplateView["role"],
    defaultPrompt: "",
    taskSummary: "",
    responsibilitySummary: "",
  });
  const [savingTemplate, setSavingTemplate] = useState(false);

  const refsByKey = useMemo(() => {
    const map = new Map<string, WorkflowAssetReferenceView>();
    for (const ref of references) {
      map.set(toRefKey(ref.workflowId, ref.assetType, ref.assetId), ref);
    }
    return map;
  }, [references]);

  const filteredWorkflowTemplates = useMemo(() => {
    return workflowTemplates.filter((item) => {
      if (templateEnabledFilter === "enabled" && !item.enabled) return false;
      if (templateEnabledFilter === "disabled" && item.enabled) return false;
      if (!templateKeyword.trim()) return true;
      const key = templateKeyword.trim().toLowerCase();
      return item.name.toLowerCase().includes(key) || item.description?.toLowerCase().includes(key);
    });
  }, [templateEnabledFilter, templateKeyword, workflowTemplates]);

  const filteredAgentTemplates = useMemo(() => {
    return agentTemplates.filter((item) => {
      if (agentTemplateEnabledFilter === "enabled" && !item.enabled) return false;
      if (agentTemplateEnabledFilter === "disabled" && item.enabled) return false;
      if (!agentTemplateKeyword.trim()) return true;
      const key = agentTemplateKeyword.trim().toLowerCase();
      return [
        item.name,
        item.description ?? "",
        item.role,
        item.defaultPrompt ?? "",
        item.taskSummary ?? "",
        item.responsibilitySummary ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(key);
    });
  }, [agentTemplateEnabledFilter, agentTemplateKeyword, agentTemplates]);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [
        toolsPayload,
        modelsPayload,
        promptsPayload,
        workflowTemplatesPayload,
        agentTemplatesPayload,
        workflowsPayload,
        credentialsPayload,
        refsPayload,
        scriptsPayload,
        skillsPayload,
      ] = await Promise.all([
        runtimeClient.listToolAssets(),
        runtimeClient.listModelAssets(),
        runtimeClient.listPromptTemplateAssets(),
        runtimeClient.listWorkflowTemplates(),
        runtimeClient.listAgentTemplates(),
        runtimeClient.listWorkflows(),
        runtimeClient.listCredentials().catch(() => ({ credentials: [] })),
        runtimeClient.listWorkflowAssetReferences(),
        runtimeClient.listScriptAssets().catch(() => ({ scripts: [] as ScriptAssetView[] })),
        runtimeClient.listSkillAssets().catch(() => ({ skills: [] as SkillAssetView[] })),
      ]);
      setTools(toolsPayload.tools);
      setModels(modelsPayload.models);
      setPrompts(promptsPayload.prompts);
      setWorkflowTemplates(workflowTemplatesPayload.workflowTemplates);
      setAgentTemplates(agentTemplatesPayload.agentTemplates);
      setWorkflows(workflowsPayload.workflows);
      setCredentials(credentialsPayload.credentials);
      setReferences(refsPayload.references);
      setScripts(scriptsPayload.scripts);
      setSkills(skillsPayload.skills);
      if (!selectedWorkflowId && workflowsPayload.workflows.length > 0) {
        setSelectedWorkflowId(workflowsPayload.workflows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载资产失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bindToggle = async (assetType: WorkflowAssetReferenceView["assetType"], assetId: string) => {
    if (!selectedWorkflowId) {
      setError("请先选择一个要引用资产的工作流。");
      return;
    }
    setError("");
    const key = toRefKey(selectedWorkflowId, assetType, assetId);
    const existing = refsByKey.get(key);
    try {
      if (existing) {
        await runtimeClient.deleteWorkflowAssetReference(existing.id);
        setReferences((prev) => prev.filter((item) => item.id !== existing.id));
        setMessage("已取消该工作流的资产引用。");
      } else {
        const payload = await runtimeClient.upsertWorkflowAssetReference({
          workflowId: selectedWorkflowId,
          assetType,
          assetId,
        });
        setReferences((prev) => [payload.reference, ...prev]);
        setMessage("资产已引用到当前工作流。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新资产引用失败");
    }
  };

  const isBound = (assetType: WorkflowAssetReferenceView["assetType"], assetId: string) => {
    if (!selectedWorkflowId) return false;
    return refsByKey.has(toRefKey(selectedWorkflowId, assetType, assetId));
  };

  const onCreateTool = async () => {
    if (!toolDraft.name.trim()) {
      setError("工具名称不能为空。");
      return;
    }
    setCreatingTool(true);
    setError("");
    try {
      const payload = await runtimeClient.createToolAsset({
        name: toolDraft.name.trim(),
        description: toolDraft.description.trim() || undefined,
        category: toolDraft.category,
        sourceType: toolDraft.sourceType,
        sourceConfig: toolDraft.sourceType === "http_api" ? { url: "https://example.com/api", method: "GET" } : {},
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        authRequirements: { type: "none", required: false },
        policy: {},
        enabled: true,
      });
      setTools((prev) => [payload.tool, ...prev]);
      setToolDraft({ name: "", description: "", category: "integration", sourceType: "http_api" });
      setMessage("工具资产创建成功。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工具资产失败");
    } finally {
      setCreatingTool(false);
    }
  };

  const onToggleToolEnabled = async (tool: ToolDefinitionView) => {
    try {
      const payload = await runtimeClient.updateToolAsset(tool.toolId, { enabled: !tool.enabled });
      setTools((prev) => prev.map((item) => (item.toolId === tool.toolId ? payload.tool : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新工具状态失败");
    }
  };

  const onEditTool = async (tool: ToolDefinitionView) => {
    const name = window.prompt("请输入新的工具名称", tool.name)?.trim();
    if (!name) return;
    const description = window.prompt("请输入工具描述（可留空）", tool.description ?? "") ?? "";
    try {
      const payload = await runtimeClient.updateToolAsset(tool.toolId, { name, description: description.trim() || undefined });
      setTools((prev) => prev.map((item) => (item.toolId === tool.toolId ? payload.tool : item)));
      setMessage("工具资产已更新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新工具资产失败");
    }
  };

  const onDeleteTool = async (tool: ToolDefinitionView) => {
    if (!window.confirm(`确定删除工具“${tool.name}”吗？删除后不可恢复。`)) return;
    try {
      await runtimeClient.deleteToolAsset(tool.toolId);
      setTools((prev) => prev.filter((item) => item.toolId !== tool.toolId));
      setReferences((prev) => prev.filter((item) => !(item.assetType === "tool" && item.assetId === tool.toolId)));
      setMessage("工具资产已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除工具资产失败");
    }
  };

  const submitModel = async () => {
    if (!modelDraft.name.trim() || !modelDraft.provider.trim() || !modelDraft.model.trim()) {
      setError("模型资产的名称、服务商、模型不能为空。");
      return;
    }
    setCreatingModel(true);
    setError("");
    try {
      if (editingModelId) {
        const payload = await runtimeClient.updateModelAsset(editingModelId, {
          name: modelDraft.name.trim(),
          provider: modelDraft.provider.trim(),
          model: modelDraft.model.trim(),
          baseUrl: modelDraft.baseUrl.trim() || "",
          credentialId: modelDraft.credentialId || "",
        });
        setModels((prev) => prev.map((item) => (item.id === editingModelId ? payload.model : item)));
        setMessage("模型资产已更新。");
      } else {
        const payload = await runtimeClient.createModelAsset({
          name: modelDraft.name.trim(),
          provider: modelDraft.provider.trim(),
          model: modelDraft.model.trim(),
          baseUrl: modelDraft.baseUrl.trim() || undefined,
          credentialId: modelDraft.credentialId || undefined,
          enabled: true,
        });
        setModels((prev) => [payload.model, ...prev]);
        setMessage("模型资产创建成功。");
      }
      setEditingModelId(null);
      setModelDraft({ name: "", provider: "", model: "", baseUrl: "", credentialId: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存模型资产失败");
    } finally {
      setCreatingModel(false);
    }
  };

  const onEditModel = (model: ModelAssetView) => {
    setEditingModelId(model.id);
    setModelDraft({
      name: model.name,
      provider: model.provider,
      model: model.model,
      baseUrl: model.baseUrl ?? "",
      credentialId: model.credentialId ?? "",
    });
  };

  const onDeleteModel = async (model: ModelAssetView) => {
    if (!window.confirm(`确定删除模型资产“${model.name}”吗？删除后不可恢复。`)) return;
    try {
      await runtimeClient.deleteModelAsset(model.id);
      setModels((prev) => prev.filter((item) => item.id !== model.id));
      setReferences((prev) => prev.filter((item) => !(item.assetType === "model" && item.assetId === model.id)));
      setMessage("模型资产已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除模型资产失败");
    }
  };

  const submitPrompt = async () => {
    if (!promptDraft.name.trim() || !promptDraft.content.trim()) {
      setError("Prompt 模板名称和内容不能为空。");
      return;
    }
    setCreatingPrompt(true);
    setError("");
    try {
      if (editingPromptId) {
        const payload = await runtimeClient.updatePromptTemplateAsset(editingPromptId, {
          name: promptDraft.name.trim(),
          templateType: promptDraft.templateType,
          description: promptDraft.description.trim() || "",
          content: promptDraft.content.trim(),
        });
        setPrompts((prev) => prev.map((item) => (item.id === editingPromptId ? payload.prompt : item)));
        setMessage("Prompt 模板已更新。");
      } else {
        const payload = await runtimeClient.createPromptTemplateAsset({
          name: promptDraft.name.trim(),
          templateType: promptDraft.templateType,
          description: promptDraft.description.trim() || undefined,
          content: promptDraft.content.trim(),
          enabled: true,
        });
        setPrompts((prev) => [payload.prompt, ...prev]);
        setMessage("Prompt 模板创建成功。");
      }
      setEditingPromptId(null);
      setPromptDraft({ name: "", templateType: "workflow", description: "", content: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存 Prompt 模板失败");
    } finally {
      setCreatingPrompt(false);
    }
  };

  const onEditPrompt = (prompt: PromptTemplateAssetView) => {
    setEditingPromptId(prompt.id);
    setPromptDraft({
      name: prompt.name,
      templateType: prompt.templateType,
      description: prompt.description ?? "",
      content: prompt.content,
    });
  };

  const onDeletePrompt = async (prompt: PromptTemplateAssetView) => {
    if (!window.confirm(`确定删除 Prompt 模板“${prompt.name}”吗？删除后不可恢复。`)) return;
    try {
      await runtimeClient.deletePromptTemplateAsset(prompt.id);
      setPrompts((prev) => prev.filter((item) => item.id !== prompt.id));
      setReferences((prev) =>
        prev.filter((item) => !(item.assetType === "prompt_template" && item.assetId === prompt.id)),
      );
      setMessage("Prompt 模板已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除 Prompt 模板失败");
    }
  };

  // ── Script handlers ──

  const submitScript = async () => {
    if (!scriptDraft.name.trim() || !scriptDraft.localPath.trim() || !scriptDraft.runCommand.trim()) {
      setError("脚本资产名称、本地路径、运行命令不能为空。");
      return;
    }
    let parameterSchema: Record<string, unknown> = {};
    try {
      parameterSchema = JSON.parse(scriptDraft.parameterSchema);
    } catch {
      setError("参数 Schema 不是合法 JSON。");
      return;
    }
    setCreatingScript(true);
    setError("");
    try {
      if (editingScriptId) {
        const payload = await runtimeClient.updateScriptAsset(editingScriptId, {
          name: scriptDraft.name.trim(),
          description: scriptDraft.description.trim() || "",
          localPath: scriptDraft.localPath.trim(),
          runCommand: scriptDraft.runCommand.trim(),
          parameterSchema,
          defaultEnvironmentId: scriptDraft.defaultEnvironmentId || undefined,
        });
        setScripts((prev) => prev.map((item) => (item.id === editingScriptId ? payload.script : item)));
        setMessage("脚本资产已更新。");
      } else {
        const payload = await runtimeClient.createScriptAsset({
          name: scriptDraft.name.trim(),
          localPath: scriptDraft.localPath.trim(),
          runCommand: scriptDraft.runCommand.trim(),
          description: scriptDraft.description.trim() || undefined,
          parameterSchema,
          defaultEnvironmentId: scriptDraft.defaultEnvironmentId || undefined,
          enabled: true,
        });
        setScripts((prev) => [payload.script, ...prev]);
        setMessage("脚本资产创建成功。");
      }
      setEditingScriptId(null);
      setScriptDraft({ name: "", description: "", localPath: "", runCommand: "", parameterSchema: "{}", defaultEnvironmentId: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存脚本资产失败");
    } finally {
      setCreatingScript(false);
    }
  };

  const onEditScript = (script: ScriptAssetView) => {
    setEditingScriptId(script.id);
    setScriptDraft({
      name: script.name,
      description: script.description ?? "",
      localPath: script.localPath,
      runCommand: script.runCommand,
      parameterSchema: JSON.stringify(script.parameterSchema, null, 2),
      defaultEnvironmentId: script.defaultEnvironmentId ?? "",
    });
    setTab("scripts");
  };

  const onDeleteScript = async (script: ScriptAssetView) => {
    if (!window.confirm(`确定删除脚本资产"${script.name}"吗？关联的技能资产也将被删除。`)) return;
    try {
      await runtimeClient.deleteScriptAsset(script.id);
      setScripts((prev) => prev.filter((item) => item.id !== script.id));
      setSkills((prev) => prev.filter((item) => item.scriptId !== script.id));
      setMessage("脚本资产已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除脚本资产失败");
    }
  };

  const onToggleScriptEnabled = async (script: ScriptAssetView) => {
    try {
      const payload = await runtimeClient.updateScriptAsset(script.id, { enabled: !script.enabled });
      setScripts((prev) => prev.map((item) => (item.id === script.id ? payload.script : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换脚本状态失败");
    }
  };

  // ── Skill handlers ──

  const submitSkill = async () => {
    if (!skillDraft.name.trim() || !skillDraft.scriptId) {
      setError("技能资产名称和绑定脚本不能为空。");
      return;
    }
    let parameterMapping: Record<string, string> = {};
    try {
      parameterMapping = JSON.parse(skillDraft.parameterMapping);
    } catch {
      setError("参数映射不是合法 JSON。");
      return;
    }
    setCreatingSkill(true);
    setError("");
    try {
      if (editingSkillId) {
        const payload = await runtimeClient.updateSkillAsset(editingSkillId, {
          name: skillDraft.name.trim(),
          description: skillDraft.description.trim() || "",
          scriptId: skillDraft.scriptId,
          parameterMapping,
          outputDescription: skillDraft.outputDescription.trim() || "",
        });
        setSkills((prev) => prev.map((item) => (item.id === editingSkillId ? payload.skill : item)));
        setMessage("技能资产已更新。");
      } else {
        const payload = await runtimeClient.createSkillAsset({
          name: skillDraft.name.trim(),
          scriptId: skillDraft.scriptId,
          description: skillDraft.description.trim() || undefined,
          parameterMapping,
          outputDescription: skillDraft.outputDescription.trim() || undefined,
          enabled: true,
        });
        setSkills((prev) => [payload.skill, ...prev]);
        setMessage("技能资产创建成功。");
      }
      setEditingSkillId(null);
      setSkillDraft({ name: "", description: "", scriptId: "", parameterMapping: "{}", outputDescription: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存技能资产失败");
    } finally {
      setCreatingSkill(false);
    }
  };

  const onEditSkill = (skill: SkillAssetView) => {
    setEditingSkillId(skill.id);
    setSkillDraft({
      name: skill.name,
      description: skill.description ?? "",
      scriptId: skill.scriptId,
      parameterMapping: JSON.stringify(skill.parameterMapping, null, 2),
      outputDescription: skill.outputDescription ?? "",
    });
    setTab("skills");
  };

  const onDeleteSkill = async (skill: SkillAssetView) => {
    if (!window.confirm(`确定删除技能资产"${skill.name}"吗？`)) return;
    try {
      await runtimeClient.deleteSkillAsset(skill.id);
      setSkills((prev) => prev.filter((item) => item.id !== skill.id));
      setMessage("技能资产已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除技能资产失败");
    }
  };

  const onToggleSkillEnabled = async (skill: SkillAssetView) => {
    try {
      const payload = await runtimeClient.updateSkillAsset(skill.id, { enabled: !skill.enabled });
      setSkills((prev) => prev.map((item) => (item.id === skill.id ? payload.skill : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换技能状态失败");
    }
  };

  const onCreateWorkflowTemplate = async () => {
    if (!templateDraftName.trim()) {
      setError("请输入工作流模板名称。");
      return;
    }
    setSavingTemplate(true);
    setError("");
    try {
      const payload = await runtimeClient.createWorkflowTemplate({
        name: templateDraftName.trim(),
        description: templateDraftDescription.trim() || "工作流模板",
        nodes: [],
        edges: [],
        tasks: [],
        enabled: true,
      });
      setWorkflowTemplates((prev) => [payload.workflowTemplate, ...prev]);
      setTemplateDraftName("");
      setTemplateDraftDescription("");
      setMessage("工作流模板已创建。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建工作流模板失败");
    } finally {
      setSavingTemplate(false);
    }
  };

  const onRenameWorkflowTemplate = async (template: WorkflowTemplateView) => {
    const nextName = window.prompt("请输入新的模板名称", template.name)?.trim();
    if (!nextName) return;
    try {
      const payload = await runtimeClient.updateWorkflowTemplate(template.id, { name: nextName });
      setWorkflowTemplates((prev) =>
        prev.map((item) => (item.id === template.id ? payload.workflowTemplate : item)),
      );
      setMessage("模板名称已更新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新模板失败");
    }
  };

  const onToggleWorkflowTemplateEnabled = async (template: WorkflowTemplateView) => {
    try {
      const payload = await runtimeClient.updateWorkflowTemplate(template.id, { enabled: !template.enabled });
      setWorkflowTemplates((prev) =>
        prev.map((item) => (item.id === template.id ? payload.workflowTemplate : item)),
      );
      setMessage(payload.workflowTemplate.enabled ? "模板已启用。" : "模板已禁用。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新模板状态失败");
    }
  };

  const onDeleteWorkflowTemplate = async (template: WorkflowTemplateView) => {
    if (!window.confirm(`确定删除模板“${template.name}”吗？删除后不可恢复。`)) return;
    try {
      await runtimeClient.deleteWorkflowTemplate(template.id);
      setWorkflowTemplates((prev) => prev.filter((item) => item.id !== template.id));
      if (previewTemplateId === template.id) {
        setPreviewTemplateId(null);
      }
      setMessage("模板已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除模板失败");
    }
  };

  const resetAgentTemplateDraft = () => {
    setEditingAgentTemplateId(null);
    setAgentTemplateDraft({
      name: "",
      description: "",
      role: "worker",
      defaultPrompt: "",
      taskSummary: "",
      responsibilitySummary: "",
    });
  };

  const onSubmitAgentTemplate = async () => {
    if (!agentTemplateDraft.name.trim()) {
      setError("请输入 Agent 模板名称。");
      return;
    }
    setSavingTemplate(true);
    setError("");
    try {
      if (editingAgentTemplateId) {
        const payload = await runtimeClient.updateAgentTemplate(editingAgentTemplateId, {
          name: agentTemplateDraft.name.trim(),
          description: agentTemplateDraft.description.trim(),
          role: agentTemplateDraft.role,
          defaultPrompt: agentTemplateDraft.defaultPrompt.trim(),
          taskSummary: agentTemplateDraft.taskSummary.trim(),
          responsibilitySummary: agentTemplateDraft.responsibilitySummary.trim(),
        });
        setAgentTemplates((prev) =>
          prev.map((item) => (item.id === editingAgentTemplateId ? payload.agentTemplate : item)),
        );
        setMessage("Agent 模板已更新。");
      } else {
        const payload = await runtimeClient.createAgentTemplate({
          name: agentTemplateDraft.name.trim(),
          description: agentTemplateDraft.description.trim(),
          role: agentTemplateDraft.role,
          defaultPrompt: agentTemplateDraft.defaultPrompt.trim(),
          taskSummary: agentTemplateDraft.taskSummary.trim() || undefined,
          responsibilitySummary: agentTemplateDraft.responsibilitySummary.trim() || undefined,
        });
        setAgentTemplates((prev) => [payload.agentTemplate, ...prev]);
        setMessage("Agent 模板已创建。");
      }
      resetAgentTemplateDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingAgentTemplateId ? "更新 Agent 模板失败" : "创建 Agent 模板失败");
    } finally {
      setSavingTemplate(false);
    }
  };

  const onEditAgentTemplate = (template: AgentTemplateView) => {
    setEditingAgentTemplateId(template.id);
    setAgentTemplateDraft({
      name: template.name,
      description: template.description ?? "",
      role: template.role,
      defaultPrompt: template.defaultPrompt ?? "",
      taskSummary: template.taskSummary ?? "",
      responsibilitySummary: template.responsibilitySummary ?? "",
    });
  };

  const onToggleAgentTemplateEnabled = async (template: AgentTemplateView) => {
    try {
      const payload = await runtimeClient.updateAgentTemplate(template.id, { enabled: !template.enabled });
      setAgentTemplates((prev) =>
        prev.map((item) => (item.id === template.id ? payload.agentTemplate : item)),
      );
      setMessage(payload.agentTemplate.enabled ? "Agent 模板已启用。" : "Agent 模板已禁用。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新 Agent 模板状态失败");
    }
  };

  const onDeleteAgentTemplate = async (template: AgentTemplateView) => {
    if (!window.confirm(`确定删除 Agent 模板“${template.name}”吗？删除后不可恢复。`)) return;
    try {
      await runtimeClient.deleteAgentTemplate(template.id);
      setAgentTemplates((prev) => prev.filter((item) => item.id !== template.id));
      setMessage("Agent 模板已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除 Agent 模板失败");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        <h1 className="text-2xl font-semibold text-slate-900">资产中心</h1>
        <p className="mt-1 text-sm text-slate-500">统一管理工具、模型和 Prompt 模板，并将资产引用到指定工作流。</p>
        <div className="mt-4 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
          <label className="text-sm font-medium text-slate-700">当前引用目标工作流</label>
          <select
            value={selectedWorkflowId}
            onChange={(event) => setSelectedWorkflowId(event.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
          >
            <option value="">请选择工作流</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setTab("tools")} className={`rounded-xl px-3 py-2 text-sm ${tab === "tools" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>工具资产 ({tools.length})</button>
          <button type="button" onClick={() => setTab("models")} className={`rounded-xl px-3 py-2 text-sm ${tab === "models" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>模型 ({models.length})</button>
          <button type="button" onClick={() => setTab("prompts")} className={`rounded-xl px-3 py-2 text-sm ${tab === "prompts" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>Prompt 模板 ({prompts.length})</button>
          <button type="button" onClick={() => setTab("scripts")} className={`rounded-xl px-3 py-2 text-sm ${tab === "scripts" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>脚本资产 ({scripts.length})</button>
          <button type="button" onClick={() => setTab("skills")} className={`rounded-xl px-3 py-2 text-sm ${tab === "skills" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>技能资产 ({skills.length})</button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载资产中...
          </div>
        ) : null}

        {!loading && tab === "tools" ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-4">
              <input value={toolDraft.name} onChange={(event) => setToolDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="工具名称" />
              <input value={toolDraft.description} onChange={(event) => setToolDraft((prev) => ({ ...prev, description: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="工具描述（可选）" />
              <select value={toolDraft.category} onChange={(event) => setToolDraft((prev) => ({ ...prev, category: event.target.value as ToolCategory }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2">
                {TOOL_CATEGORIES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <select value={toolDraft.sourceType} onChange={(event) => setToolDraft((prev) => ({ ...prev, sourceType: event.target.value as ToolSourceType }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2">
                {TOOL_SOURCES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => void onCreateTool()} disabled={creatingTool} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60">
              {creatingTool ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              创建工具资产
            </button>
            <div className="space-y-2">
              {tools.map((tool) => (
                <div key={tool.toolId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{tool.name}</p>
                    <p className="truncate text-xs text-slate-500">{tool.description || "暂无描述"} · {tool.category} · {tool.sourceType}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void bindToggle("tool", tool.toolId)} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${isBound("tool", tool.toolId) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                      <Link2 className="h-3.5 w-3.5" />
                      {isBound("tool", tool.toolId) ? "已引用" : "引用"}
                    </button>
                    <button type="button" onClick={() => void onToggleToolEnabled(tool)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{tool.enabled ? "禁用" : "启用"}</button>
                    <button type="button" onClick={() => void onEditTool(tool)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">编辑</button>
                    <button type="button" onClick={() => void onDeleteTool(tool)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && tab === "models" ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-5">
              <input value={modelDraft.name} onChange={(event) => setModelDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="模型资产名称" />
              <input value={modelDraft.provider} onChange={(event) => setModelDraft((prev) => ({ ...prev, provider: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="服务商" />
              <input value={modelDraft.model} onChange={(event) => setModelDraft((prev) => ({ ...prev, model: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="模型" />
              <input value={modelDraft.baseUrl} onChange={(event) => setModelDraft((prev) => ({ ...prev, baseUrl: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="Base URL（可选）" />
              <select value={modelDraft.credentialId} onChange={(event) => setModelDraft((prev) => ({ ...prev, credentialId: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2">
                <option value="">不指定凭证</option>
                {credentials.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void submitModel()} disabled={creatingModel} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60">
                {creatingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingModelId ? "保存模型资产" : "创建模型资产"}
              </button>
              {editingModelId ? <button type="button" onClick={() => { setEditingModelId(null); setModelDraft({ name: "", provider: "", model: "", baseUrl: "", credentialId: "" }); }} className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">取消编辑</button> : null}
            </div>
            <div className="space-y-2">
              {models.map((model) => (
                <div key={model.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{model.name}</p>
                    <p className="truncate text-xs text-slate-500">{model.provider} / {model.model}{model.baseUrl ? ` · ${model.baseUrl}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void bindToggle("model", model.id)} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${isBound("model", model.id) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                      <Link2 className="h-3.5 w-3.5" />
                      {isBound("model", model.id) ? "已引用" : "引用"}
                    </button>
                    <button type="button" onClick={() => void runtimeClient.updateModelAsset(model.id, { enabled: !model.enabled }).then((payload) => { setModels((prev) => prev.map((item) => (item.id === model.id ? payload.model : item))); }).catch((err) => setError(err instanceof Error ? err.message : "更新模型资产失败"))} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{model.enabled ? "禁用" : "启用"}</button>
                    <button type="button" onClick={() => onEditModel(model)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">编辑</button>
                    <button type="button" onClick={() => void onDeleteModel(model)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && tab === "prompts" ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[220px_180px_minmax(0,1fr)]">
              <input value={promptDraft.name} onChange={(event) => setPromptDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="模板名称" />
              <select value={promptDraft.templateType} onChange={(event) => setPromptDraft((prev) => ({ ...prev, templateType: event.target.value as "system" | "agent" | "workflow" }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2">
                <option value="system">系统 Prompt</option>
                <option value="agent">Agent Prompt</option>
                <option value="workflow">Workflow Prompt</option>
              </select>
              <input value={promptDraft.description} onChange={(event) => setPromptDraft((prev) => ({ ...prev, description: event.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="模板描述（可选）" />
            </div>
            <textarea value={promptDraft.content} onChange={(event) => setPromptDraft((prev) => ({ ...prev, content: event.target.value }))} className="min-h-32 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="请输入模板内容" />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void submitPrompt()} disabled={creatingPrompt} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60">
                {creatingPrompt ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingPromptId ? "保存 Prompt 模板" : "创建 Prompt 模板"}
              </button>
              {editingPromptId ? <button type="button" onClick={() => { setEditingPromptId(null); setPromptDraft({ name: "", templateType: "workflow", description: "", content: "" }); }} className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">取消编辑</button> : null}
            </div>
            <div className="space-y-2">
              {prompts.map((prompt) => (
                <div key={prompt.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{prompt.name}</p>
                    <p className="truncate text-xs text-slate-500">{prompt.description || "暂无描述"} · {prompt.templateType}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{prompt.content}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void bindToggle("prompt_template", prompt.id)} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${isBound("prompt_template", prompt.id) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                      <Link2 className="h-3.5 w-3.5" />
                      {isBound("prompt_template", prompt.id) ? "已引用" : "引用"}
                    </button>
                    <button type="button" onClick={() => onEditPrompt(prompt)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">编辑</button>
                    <button type="button" onClick={() => void onDeletePrompt(prompt)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Scripts Tab ── */}
        {!loading && tab === "scripts" ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              <input value={scriptDraft.name} onChange={(e) => setScriptDraft((prev) => ({ ...prev, name: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="脚本名称" />
              <input value={scriptDraft.description} onChange={(e) => setScriptDraft((prev) => ({ ...prev, description: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="描述（可选）" />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input value={scriptDraft.localPath} onChange={(e) => setScriptDraft((prev) => ({ ...prev, localPath: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="本地项目路径（如 D:\projects\my_tool）" />
              <input value={scriptDraft.runCommand} onChange={(e) => setScriptDraft((prev) => ({ ...prev, runCommand: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="运行命令（如 python -m src.cli {stage} --input {input}）" />
            </div>
            <textarea value={scriptDraft.parameterSchema} onChange={(e) => setScriptDraft((prev) => ({ ...prev, parameterSchema: e.target.value }))} className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none ring-indigo-200 transition focus:ring-2" placeholder='参数 Schema（JSON，如 {"type":"object","properties":{"stage":{"type":"string"}}}）' />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void submitScript()} disabled={creatingScript} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60">
                {creatingScript ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingScriptId ? "保存脚本资产" : "创建脚本资产"}
              </button>
              {editingScriptId ? <button type="button" onClick={() => { setEditingScriptId(null); setScriptDraft({ name: "", description: "", localPath: "", runCommand: "", parameterSchema: "{}", defaultEnvironmentId: "" }); }} className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">取消编辑</button> : null}
            </div>
            <div className="space-y-2">
              {scripts.map((script) => (
                <div key={script.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {script.name}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${script.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {script.enabled ? "已启用" : "已禁用"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500">{script.description || "暂无描述"}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{script.localPath}</p>
                    <p className="truncate font-mono text-[11px] text-indigo-500">{script.runCommand}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void onToggleScriptEnabled(script)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{script.enabled ? "禁用" : "启用"}</button>
                    <button type="button" onClick={() => onEditScript(script)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">编辑</button>
                    <button type="button" onClick={() => void onDeleteScript(script)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {scripts.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">暂无脚本资产</div> : null}
            </div>
          </div>
        ) : null}

        {/* ── Skills Tab ── */}
        {!loading && tab === "skills" ? (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
              <input value={skillDraft.name} onChange={(e) => setSkillDraft((prev) => ({ ...prev, name: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="技能名称（如 ppt_to_text_stage1）" />
              <select value={skillDraft.scriptId} onChange={(e) => setSkillDraft((prev) => ({ ...prev, scriptId: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2">
                <option value="">选择绑定脚本…</option>
                {scripts.filter((s) => s.enabled).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <textarea value={skillDraft.description} onChange={(e) => setSkillDraft((prev) => ({ ...prev, description: e.target.value }))} className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="技能描述（给 LLM 看的语义说明，如：当需要将 PPT 转换为 markdown 文本时调用此工具）" />
            <div className="grid gap-2 md:grid-cols-2">
              <textarea value={skillDraft.parameterMapping} onChange={(e) => setSkillDraft((prev) => ({ ...prev, parameterMapping: e.target.value }))} className="min-h-16 rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none ring-indigo-200 transition focus:ring-2" placeholder='参数映射（JSON，如 {"input_file": "input", "stage": "stage"}）' />
              <input value={skillDraft.outputDescription} onChange={(e) => setSkillDraft((prev) => ({ ...prev, outputDescription: e.target.value }))} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="输出说明（可选）" />
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void submitSkill()} disabled={creatingSkill} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60">
                {creatingSkill ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingSkillId ? "保存技能资产" : "创建技能资产"}
              </button>
              {editingSkillId ? <button type="button" onClick={() => { setEditingSkillId(null); setSkillDraft({ name: "", description: "", scriptId: "", parameterMapping: "{}", outputDescription: "" }); }} className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">取消编辑</button> : null}
            </div>
            <div className="space-y-2">
              {skills.map((skill) => {
                const boundScript = scripts.find((s) => s.id === skill.scriptId);
                return (
                  <div key={skill.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {skill.name}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${skill.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {skill.enabled ? "已启用" : "已禁用"}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">{skill.description || "暂无描述"}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        绑定脚本: <span className="text-indigo-500">{boundScript?.name ?? skill.scriptId}</span>
                        {skill.outputDescription ? ` · 输出: ${skill.outputDescription}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void onToggleSkillEnabled(skill)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{skill.enabled ? "禁用" : "启用"}</button>
                      <button type="button" onClick={() => onEditSkill(skill)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">编辑</button>
                      <button type="button" onClick={() => void onDeleteSkill(skill)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
              {skills.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">暂无技能资产</div> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
          <h2 className="text-base font-semibold text-slate-900">Workflow 模板</h2>
          <p className="mt-1 text-sm text-slate-500">Workflow 模板是整套流程模板。可用于新建工作流，也可在编辑器中通过“保存为模板”覆盖更新。</p>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input value={templateDraftName} onChange={(event) => setTemplateDraftName(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="模板名称" />
            <input value={templateDraftDescription} onChange={(event) => setTemplateDraftDescription(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="模板描述（可选）" />
            <button type="button" onClick={() => void onCreateWorkflowTemplate()} disabled={savingTemplate} className="h-10 rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60">新建模板</button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
            <input value={templateKeyword} onChange={(event) => setTemplateKeyword(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2" placeholder="搜索模板名称或描述" />
            <select value={templateEnabledFilter} onChange={(event) => setTemplateEnabledFilter(event.target.value as "all" | "enabled" | "disabled")} className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2">
              <option value="all">全部状态</option>
              <option value="enabled">仅启用</option>
              <option value="disabled">仅禁用</option>
            </select>
          </div>
          <div className="mt-3 space-y-2">
            {filteredWorkflowTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">暂无匹配模板</div>
            ) : (
              filteredWorkflowTemplates.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {item.name}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${item.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.enabled ? "已启用" : "已禁用"}
                        </span>
                        {item.isBuiltin ? (
                          <span className="ml-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700">内置</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-slate-500">{item.description || "暂无描述"}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        更新：{new Date(item.updatedAt).toLocaleString()} ·
                        类型 {item.templateCategory || "自定义"} ·
                        场景 {item.scenario || "通用"} ·
                        节点 {item.nodeCount ?? item.nodes.length} ·
                        连线 {item.edgeCount ?? item.edges.length} ·
                        预设任务 {item.presetTasks?.length ?? 0}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setPreviewTemplateId((prev) => (prev === item.id ? null : item.id))} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{previewTemplateId === item.id ? "收起预览" : "预览"}</button>
                      <button type="button" onClick={() => void onRenameWorkflowTemplate(item)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">重命名</button>
                      <button type="button" onClick={() => void onToggleWorkflowTemplateEnabled(item)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{item.enabled ? "禁用" : "启用"}</button>
                      <button type="button" onClick={() => void onDeleteWorkflowTemplate(item)} className="h-8 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">删除</button>
                    </div>
                  </div>
                  {previewTemplateId === item.id ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      <p>rootTaskInput：{item.rootTaskInput || "暂无"}</p>
                      <p className="mt-1">任务数：{item.tasks.length}</p>
                      <p className="mt-1">
                        预设任务：
                        {(item.presetTasks ?? []).length > 0
                          ? (item.presetTasks ?? []).map((task) => `[${task.difficulty}] ${task.title}`).join(" / ")
                          : "暂无"}
                      </p>
                      <p className="mt-1">节点预览：{item.nodes.length > 0 ? item.nodes.map((node) => `${node.name}(${node.role})`).slice(0, 6).join("、") : "暂无节点"}</p>
                      <p className="mt-1">连线预览：{item.edges.length > 0 ? item.edges.map((edge) => `${edge.sourceNodeId}→${edge.targetNodeId}`).slice(0, 6).join("、") : "暂无连线"}</p>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.24)]">
          <h2 className="text-base font-semibold text-slate-900">Agent 模板</h2>
          <p className="mt-1 text-sm text-slate-500">
            Agent 模板 = 预配置的节点模板。可在节点库直接插入，也可在新建工作流时快速生成一个可继续编辑的初始 Agent 节点。
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <input
              value={agentTemplateDraft.name}
              onChange={(event) => setAgentTemplateDraft((prev) => ({ ...prev, name: event.target.value }))}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              placeholder="模板名称"
            />
            <select
              value={agentTemplateDraft.role}
              onChange={(event) => setAgentTemplateDraft((prev) => ({ ...prev, role: event.target.value as AgentTemplateView["role"] }))}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
            >
              {AGENT_TEMPLATE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {AGENT_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <input
              value={agentTemplateDraft.description}
              onChange={(event) => setAgentTemplateDraft((prev) => ({ ...prev, description: event.target.value }))}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2 md:col-span-2"
              placeholder="模板描述（可选）"
            />
            <textarea
              value={agentTemplateDraft.defaultPrompt}
              onChange={(event) => setAgentTemplateDraft((prev) => ({ ...prev, defaultPrompt: event.target.value }))}
              className="min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-indigo-200 transition focus:ring-2 md:col-span-2"
              placeholder="默认提示词（可选）"
            />
            <input
              value={agentTemplateDraft.taskSummary}
              onChange={(event) => setAgentTemplateDraft((prev) => ({ ...prev, taskSummary: event.target.value }))}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              placeholder="默认任务说明（可选）"
            />
            <input
              value={agentTemplateDraft.responsibilitySummary}
              onChange={(event) => setAgentTemplateDraft((prev) => ({ ...prev, responsibilitySummary: event.target.value }))}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              placeholder="默认职责说明（可选）"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onSubmitAgentTemplate()}
              disabled={savingTemplate}
              className="h-10 rounded-xl bg-indigo-500 px-3 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-60"
            >
              {editingAgentTemplateId ? "保存 Agent 模板" : "新建 Agent 模板"}
            </button>
            {editingAgentTemplateId ? (
              <button
                type="button"
                onClick={resetAgentTemplateDraft}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm text-slate-600"
              >
                取消编辑
              </button>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
            <input
              value={agentTemplateKeyword}
              onChange={(event) => setAgentTemplateKeyword(event.target.value)}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
              placeholder="搜索名称 / 描述 / 角色 / 提示词"
            />
            <select
              value={agentTemplateEnabledFilter}
              onChange={(event) => setAgentTemplateEnabledFilter(event.target.value as "all" | "enabled" | "disabled")}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none ring-indigo-200 transition focus:ring-2"
            >
              <option value="all">全部状态</option>
              <option value="enabled">仅启用</option>
              <option value="disabled">仅禁用</option>
            </select>
          </div>
          <div className="mt-3 space-y-2">
            {filteredAgentTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">
                暂无匹配 Agent 模板
              </div>
            ) : (
              filteredAgentTemplates.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {item.name}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${item.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {item.enabled ? "已启用" : "已禁用"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {item.description || "暂无描述"} · 角色 {AGENT_ROLE_LABELS[item.role as keyof typeof AGENT_ROLE_LABELS] ?? item.role}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">默认提示词：{item.defaultPrompt || "未设置"}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      更新：{new Date(item.updatedAt).toLocaleString()} · 任务：{item.taskSummary || "未设置"} · 职责：{item.responsibilitySummary || "未设置"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onEditAgentTemplate(item)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">编辑</button>
                    <button type="button" onClick={() => void onToggleAgentTemplateEnabled(item)} className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-600">{item.enabled ? "禁用" : "启用"}</button>
                    <button type="button" onClick={() => void onDeleteAgentTemplate(item)} className="h-8 rounded-lg border border-rose-200 px-2 text-xs text-rose-600">删除</button>
                  </div>
                </div>
              </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
