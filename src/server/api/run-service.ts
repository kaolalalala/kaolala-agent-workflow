import { configService } from "@/server/config/config-service";
import {
  AgentDocumentType,
  AgentNodeConfig,
  RunMode,
  StoredWorkflowEdge,
  StoredWorkflowNode,
  StoredWorkflowTask,
  WorkspaceConfig,
} from "@/server/domain";
import { runtimeEngine } from "@/server/runtime/runtime-engine";
import { memoryStore } from "@/server/store/memory-store";
import { longTermMemoryService } from "@/server/memory/long-term-memory-service";
import { ToolDefinition, ToolPluginManifest, ToolScopeType } from "@/server/tools/contracts";
import { toolResolver } from "@/server/tools/tool-resolver";
import { toolService } from "@/server/tools/tool-service";
import { toolExecutor } from "@/server/tools/tool-executor";
import { buildRunDiagnosticsReport } from "@/server/api/run-diagnostics";
import { executeDevAgent } from "@/server/runtime/execution/dev-agent-executor";
import { workspaceService } from "@/server/workspace/workspace-service";
import { localProjectService } from "@/server/workspace/local-project-service";
import { makeId, nowIso } from "@/lib/utils";

function ensureRun(runId: string) {
  const snapshot = memoryStore.getRunSnapshot(runId);
  if (!snapshot) {
    throw new Error("运行不存在");
  }
  return snapshot;
}

type RunListSort = "time_desc" | "time_asc" | "duration_desc" | "duration_asc" | "tokens_desc" | "tokens_asc";

function normalizeRunListOptions(input?: number | {
  limit?: number;
  status?: "running" | "success" | "failed";
  q?: string;
  workflowId?: string;
  sort?: RunListSort;
  runType?: "workflow_run" | "dev_run";
}) {
  if (typeof input === "number") {
    return {
      limit: Math.max(1, Math.min(Math.floor(input), 200)),
      status: undefined,
      q: "",
      workflowId: undefined,
      sort: "time_desc" as RunListSort,
      runType: undefined as "workflow_run" | "dev_run" | undefined,
    };
  }
  return {
    limit: Math.max(1, Math.min(Math.floor(input?.limit ?? 40), 200)),
    status: input?.status,
    q: input?.q?.trim().toLowerCase() ?? "",
    workflowId: input?.workflowId,
    sort: input?.sort ?? "time_desc",
    runType: input?.runType,
  };
}

export const runService = {
  createRun(payload: {
    task: string;
    runMode?: RunMode;
    workflowId?: string;
    workflowVersionId?: string;
    workflow?: {
      nodes: StoredWorkflowNode[];
      edges: StoredWorkflowEdge[];
      tasks: StoredWorkflowTask[];
    };
  }) {
    toolService.ensurePlatformBootstrap();

    const task = payload.task ?? "";
    if (!task.trim()) {
      throw new Error("任务不能为空");
    }

    const run = runtimeEngine.createRun(task.trim(), payload.workflow, payload.runMode ?? "standard", {
      workflowId: payload.workflowId,
      workflowVersionId: payload.workflowVersionId,
    });
    return { runId: run.id };
  },
  getRunSnapshot(runId: string) {
    return ensureRun(runId);
  },
  exportRunDiagnostics(runId: string) {
    const snapshot = ensureRun(runId);
    return buildRunDiagnosticsReport(snapshot);
  },
  async startRun(runId: string) {
    const snapshot = ensureRun(runId);

    if (snapshot.run.status === "running") {
      return { ok: true };
    }

    runtimeEngine.startRun(runId).catch((error: unknown) => {
      console.error("[RunService] startRun unhandled error:", error);
    });
    return { ok: true };
  },
  getEvents(runId: string) {
    const snapshot = ensureRun(runId);
    return { events: snapshot.events };
  },
  getMessages(runId: string) {
    const snapshot = ensureRun(runId);
    return { messages: snapshot.messages };
  },
  getNodeAgent(runId: string, nodeId: string) {
    ensureRun(runId);
    return runtimeEngine.getNodeAgent(runId, nodeId);
  },
  sendHumanMessage(runId: string, nodeId: string, content: string, attachments: { name: string; mimeType: string; content: string }[] = []) {
    ensureRun(runId);

    if (!content.trim() && attachments.length === 0) {
      throw new Error("消息内容和附件不能同时为空");
    }

    const message = runtimeEngine.sendHumanMessage(runId, nodeId, content.trim(), attachments);
    return { ok: true, humanMessageId: message.id };
  },
  async rerunFromNode(runId: string, nodeId: string, includeDownstream: boolean) {
    ensureRun(runId);
    runtimeEngine.rerunFromNode(runId, nodeId, includeDownstream).catch((error: unknown) => {
      console.error("[RunService] rerunFromNode unhandled error:", error);
    });
    return { ok: true };
  },
  getWorkspaceConfig() {
    const workspace = configService.ensureWorkspaceConfig();
    const credentials = configService.listCredentials().map((item) => ({
      id: item.id,
      provider: item.provider,
      label: item.label,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
    return { workspace, credentials };
  },
  updateWorkspaceConfig(payload: Partial<WorkspaceConfig>) {
    const workspace = configService.updateWorkspaceConfig(payload);
    return { workspace };
  },
  listCredentials() {
    const credentials = configService.listCredentials().map((item) => ({
      id: item.id,
      provider: item.provider,
      label: item.label,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
    return { credentials };
  },
  createCredential(payload: { provider?: string; label?: string; apiKey?: string }) {
    if (!payload.provider?.trim() || !payload.label?.trim() || !payload.apiKey?.trim()) {
      throw new Error("provider、label、apiKey 不能为空");
    }

    const credential = configService.createCredential({
      provider: payload.provider.trim(),
      label: payload.label.trim(),
      apiKey: payload.apiKey.trim(),
    });

    return { credentialId: credential.id };
  },
  getNodeConfig(runId: string, nodeId: string) {
    ensureRun(runId);
    const config = configService.getNodeConfig(runId, nodeId);
    if (!config) {
      throw new Error("节点配置不存在");
    }
    const documents = configService.listNodeDocuments(runId, nodeId);
    return { config, documents };
  },
  updateNodeConfig(runId: string, nodeId: string, payload: Partial<AgentNodeConfig>) {
    ensureRun(runId);

    const config = configService.updateNodeConfig(runId, nodeId, payload);

    const node = memoryStore.getNodeById(runId, nodeId);
    if (node) {
      memoryStore.updateNode(runId, nodeId, (current) => ({
        ...current,
        name: config.name,
        responsibility: config.responsibility ?? current.responsibility,
        updatedAt: new Date().toISOString(),
      }));
    }

    return { config };
  },
  uploadNodeDocument(runId: string, nodeId: string, payload: { type: AgentDocumentType; name: string; content: string }) {
    const snapshot = ensureRun(runId);
    if (!payload.content.trim()) {
      throw new Error("文档内容不能为空");
    }

    const document = configService.createNodeDocument({
      runId,
      nodeId,
      type: payload.type,
      name: payload.name,
      content: payload.content,
    });
    const memoryItem = longTermMemoryService.remember({
      scopeType: snapshot.run.workflowId ? "workflow" : "workspace",
      scopeId: snapshot.run.workflowId ?? "workspace_default",
      runId,
      workflowId: snapshot.run.workflowId,
      nodeId,
      sourceType: "document",
      title: `文档 ${payload.name}`,
      content: payload.content,
      importance: payload.type === "reference" ? 0.85 : 0.66,
    });

    return { document, memory: memoryItem };
  },
  queryLongTermMemory(runId: string, payload: { query?: string; nodeId?: string; limit?: number }) {
    const snapshot = ensureRun(runId);
    const query = payload.query?.trim();
    if (!query) {
      throw new Error("query 不能为空");
    }
    const items = longTermMemoryService.search({
      query,
      workspaceId: "workspace_default",
      workflowId: snapshot.run.workflowId,
      runId,
      nodeId: payload.nodeId,
      limit: payload.limit,
    });
    return { items };
  },
  deleteDocument(documentId: string) {
    const document = configService.deleteDocument(documentId);
    return { document };
  },
  listWorkflows() {
    return { workflows: configService.listWorkflows() };
  },
  listProjectWorkflows(projectId: string) {
    return { workflows: configService.listProjectWorkflows(projectId) };
  },
  listWorkflowTemplates() {
    return { workflowTemplates: configService.listWorkflowTemplates() };
  },
  getWorkflowTemplate(templateId: string) {
    const workflowTemplate = configService.getWorkflowTemplate(templateId);
    if (!workflowTemplate) {
      throw new Error("工作流模板不存在");
    }
    return { workflowTemplate };
  },
  createWorkflowTemplate(payload: {
    name?: string;
    description?: string;
    rootTaskInput?: string;
    nodes?: StoredWorkflowNode[];
    edges?: StoredWorkflowEdge[];
    tasks?: StoredWorkflowTask[];
    enabled?: boolean;
  }) {
    if (!payload.name?.trim()) {
      throw new Error("工作流模板名称不能为空");
    }
    return {
      workflowTemplate: configService.createWorkflowTemplate({
        name: payload.name.trim(),
        description: payload.description,
        rootTaskInput: payload.rootTaskInput,
        nodes: payload.nodes ?? [],
        edges: payload.edges ?? [],
        tasks: payload.tasks ?? [],
        enabled: payload.enabled,
      }),
    };
  },
  updateWorkflowTemplate(
    templateId: string,
    payload: Partial<{
      name: string;
      description: string;
      rootTaskInput: string;
      nodes: StoredWorkflowNode[];
      edges: StoredWorkflowEdge[];
      tasks: StoredWorkflowTask[];
      enabled: boolean;
    }>,
  ) {
    return { workflowTemplate: configService.updateWorkflowTemplate(templateId, payload) };
  },
  deleteWorkflowTemplate(templateId: string) {
    return configService.deleteWorkflowTemplate(templateId);
  },
  listAgentTemplates() {
    return { agentTemplates: configService.listAgentTemplates() };
  },
  createAgentTemplate(payload: {
    name?: string;
    description?: string;
    role?: string;
    defaultPrompt?: string;
    taskSummary?: string;
    responsibilitySummary?: string;
    enabled?: boolean;
  }) {
    if (!payload.name?.trim() || !payload.role?.trim()) {
      throw new Error("Agent 模板名称和角色不能为空");
    }
    return {
      agentTemplate: configService.createAgentTemplate({
        name: payload.name.trim(),
        description: payload.description,
        role: payload.role.trim(),
        defaultPrompt: payload.defaultPrompt,
        taskSummary: payload.taskSummary,
        responsibilitySummary: payload.responsibilitySummary,
        enabled: payload.enabled,
      }),
    };
  },
  updateAgentTemplate(
    templateId: string,
    payload: Partial<{
      name: string;
      description: string;
      role: string;
      defaultPrompt: string;
      taskSummary: string;
      responsibilitySummary: string;
      enabled: boolean;
    }>,
  ) {
    return { agentTemplate: configService.updateAgentTemplate(templateId, payload) };
  },
  deleteAgentTemplate(templateId: string) {
    return configService.deleteAgentTemplate(templateId);
  },
  listModelAssets() {
    return { models: configService.listModelAssets() };
  },
  createModelAsset(payload: {
    name?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
    credentialId?: string;
    enabled?: boolean;
  }) {
    if (!payload.name?.trim() || !payload.provider?.trim() || !payload.model?.trim()) {
      throw new Error("模型资产名称、服务商、模型不能为空");
    }
    return {
      model: configService.createModelAsset({
        name: payload.name.trim(),
        provider: payload.provider.trim(),
        model: payload.model.trim(),
        baseUrl: payload.baseUrl,
        credentialId: payload.credentialId,
        enabled: payload.enabled,
      }),
    };
  },
  updateModelAsset(
    assetId: string,
    payload: Partial<{
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      credentialId: string;
      enabled: boolean;
    }>,
  ) {
    return { model: configService.updateModelAsset(assetId, payload) };
  },
  deleteModelAsset(assetId: string) {
    return configService.deleteModelAsset(assetId);
  },
  listPromptTemplateAssets(templateType?: "system" | "agent" | "workflow") {
    return { prompts: configService.listPromptTemplateAssets(templateType) };
  },
  createPromptTemplateAsset(payload: {
    name?: string;
    templateType?: "system" | "agent" | "workflow";
    description?: string;
    content?: string;
    enabled?: boolean;
  }) {
    if (!payload.name?.trim() || !payload.content?.trim()) {
      throw new Error("Prompt 模板名称和内容不能为空");
    }
    return {
      prompt: configService.createPromptTemplateAsset({
        name: payload.name.trim(),
        templateType: payload.templateType ?? "workflow",
        description: payload.description,
        content: payload.content.trim(),
        enabled: payload.enabled,
      }),
    };
  },
  updatePromptTemplateAsset(
    templateId: string,
    payload: Partial<{
      name: string;
      templateType: "system" | "agent" | "workflow";
      description: string;
      content: string;
      enabled: boolean;
    }>,
  ) {
    return { prompt: configService.updatePromptTemplateAsset(templateId, payload) };
  },
  deletePromptTemplateAsset(templateId: string) {
    return configService.deletePromptTemplateAsset(templateId);
  },
  listWorkflowAssetReferences(options?: { workflowId?: string; assetType?: "tool" | "model" | "prompt_template" }) {
    return { references: configService.listWorkflowAssetReferences(options) };
  },
  upsertWorkflowAssetReference(payload: {
    workflowId?: string;
    assetType?: "tool" | "model" | "prompt_template";
    assetId?: string;
  }) {
    if (!payload.workflowId || !payload.assetType || !payload.assetId) {
      throw new Error("workflowId、assetType、assetId 不能为空");
    }
    return {
      reference: configService.upsertWorkflowAssetReference({
        workflowId: payload.workflowId,
        assetType: payload.assetType,
        assetId: payload.assetId,
      }),
    };
  },
  deleteWorkflowAssetReference(referenceId: string) {
    return configService.deleteWorkflowAssetReference(referenceId);
  },

  // ── Script Assets ──

  listScriptAssets() {
    return { scripts: configService.listScriptAssets() };
  },
  createScriptAsset(payload: {
    name?: string;
    localPath?: string;
    runCommand?: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
    defaultEnvironmentId?: string;
    enabled?: boolean;
  }) {
    if (!payload.name?.trim() || !payload.localPath?.trim() || !payload.runCommand?.trim()) {
      throw new Error("脚本资产名称、本地路径、运行命令不能为空");
    }
    return {
      script: configService.createScriptAsset({
        name: payload.name.trim(),
        localPath: payload.localPath.trim(),
        runCommand: payload.runCommand.trim(),
        description: payload.description,
        parameterSchema: payload.parameterSchema,
        defaultEnvironmentId: payload.defaultEnvironmentId,
        enabled: payload.enabled,
      }),
    };
  },
  updateScriptAsset(
    assetId: string,
    payload: Partial<{
      name: string;
      description: string;
      localPath: string;
      runCommand: string;
      parameterSchema: Record<string, unknown>;
      defaultEnvironmentId: string;
      enabled: boolean;
    }>,
  ) {
    return { script: configService.updateScriptAsset(assetId, payload) };
  },
  deleteScriptAsset(assetId: string) {
    return configService.deleteScriptAsset(assetId);
  },

  // ── Skill Assets ──

  listSkillAssets() {
    return { skills: configService.listSkillAssets() };
  },
  createSkillAsset(payload: {
    name?: string;
    scriptId?: string;
    description?: string;
    parameterMapping?: Record<string, string>;
    outputDescription?: string;
    enabled?: boolean;
  }) {
    if (!payload.name?.trim() || !payload.scriptId?.trim()) {
      throw new Error("技能资产名称和绑定脚本不能为空");
    }
    return {
      skill: configService.createSkillAsset({
        name: payload.name.trim(),
        scriptId: payload.scriptId.trim(),
        description: payload.description,
        parameterMapping: payload.parameterMapping,
        outputDescription: payload.outputDescription,
        enabled: payload.enabled,
      }),
    };
  },
  updateSkillAsset(
    assetId: string,
    payload: Partial<{
      name: string;
      description: string;
      scriptId: string;
      parameterMapping: Record<string, string>;
      outputDescription: string;
      enabled: boolean;
    }>,
  ) {
    return { skill: configService.updateSkillAsset(assetId, payload) };
  },
  deleteSkillAsset(assetId: string) {
    return configService.deleteSkillAsset(assetId);
  },

  // ── Skill Bindings ──

  listSkillBindings(runId: string, nodeId: string) {
    return { bindings: configService.listSkillBindings(runId, nodeId) };
  },
  upsertSkillBinding(runId: string, nodeId: string, skillId: string, enabled: boolean) {
    return { binding: configService.upsertSkillBinding(runId, nodeId, skillId, enabled) };
  },
  deleteSkillBinding(bindingId: string) {
    return configService.deleteSkillBinding(bindingId);
  },

  listRuns(input?: number | {
    limit?: number;
    status?: "running" | "success" | "failed";
    q?: string;
    workflowId?: string;
    sort?: RunListSort;
    runType?: "workflow_run" | "dev_run";
  }) {
    const options = normalizeRunListOptions(input);
    const fetchLimit = options.q || options.sort !== "time_desc" || options.status || options.workflowId
      ? Math.min(600, Math.max(options.limit * 6, 120))
      : options.limit;
    const baseRuns = configService.listRuns(fetchLimit);
    const filtered = baseRuns
      .filter((item) => (options.runType ? item.runType === options.runType : true))
      .filter((item) => (options.status ? item.status === options.status : true))
      .filter((item) => (options.workflowId ? item.workflowId === options.workflowId : true))
      .filter((item) => {
        if (!options.q) {
          return true;
        }
        const haystack = `${item.id} ${item.workflowId ?? ""} ${item.workflowName} ${item.projectId ?? ""} ${item.summary ?? ""}`
          .toLowerCase();
        return haystack.includes(options.q);
      });

    const sorted = [...filtered].sort((a, b) => {
      if (options.sort === "time_asc") {
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      if (options.sort === "duration_desc") {
        return (b.durationMs ?? -1) - (a.durationMs ?? -1);
      }
      if (options.sort === "duration_asc") {
        return (a.durationMs ?? Number.MAX_SAFE_INTEGER) - (b.durationMs ?? Number.MAX_SAFE_INTEGER);
      }
      if (options.sort === "tokens_desc") {
        return (b.totalTokens ?? -1) - (a.totalTokens ?? -1);
      }
      if (options.sort === "tokens_asc") {
        return (a.totalTokens ?? Number.MAX_SAFE_INTEGER) - (b.totalTokens ?? Number.MAX_SAFE_INTEGER);
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const runs = sorted.slice(0, options.limit);
    const durationRuns = runs.filter((item) => typeof item.durationMs === "number");
    const tokenUsageAvailable = runs.some((item) => item.tokenUsageAvailable);
    const totalDurationMs = durationRuns.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
    const promptTokens = runs.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0);
    const completionTokens = runs.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0);
    const totalTokens = runs.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);

    const workflowMap = new Map<string, {
      workflowId?: string;
      workflowName: string;
      runCount: number;
      runningCount: number;
      successCount: number;
      failedCount: number;
      totalDurationMs: number;
      durationCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      tokenUsageAvailable: boolean;
      lastRunAt: string;
    }>();

    for (const run of runs) {
      const key = run.workflowId ?? "__workspace__";
      const current = workflowMap.get(key) ?? {
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        runCount: 0,
        runningCount: 0,
        successCount: 0,
        failedCount: 0,
        totalDurationMs: 0,
        durationCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tokenUsageAvailable: false,
        lastRunAt: run.updatedAt,
      };
      current.runCount += 1;
      current.runningCount += run.status === "running" ? 1 : 0;
      current.successCount += run.status === "success" ? 1 : 0;
      current.failedCount += run.status === "failed" ? 1 : 0;
      current.totalDurationMs += run.durationMs ?? 0;
      current.durationCount += typeof run.durationMs === "number" ? 1 : 0;
      current.promptTokens += run.promptTokens ?? 0;
      current.completionTokens += run.completionTokens ?? 0;
      current.totalTokens += run.totalTokens ?? 0;
      current.tokenUsageAvailable ||= run.tokenUsageAvailable ?? false;
      if (new Date(run.updatedAt).getTime() > new Date(current.lastRunAt).getTime()) {
        current.lastRunAt = run.updatedAt;
      }
      workflowMap.set(key, current);
    }

    return {
      runs,
      summary: {
        totalRuns: runs.length,
        runningCount: runs.filter((item) => item.status === "running").length,
        successCount: runs.filter((item) => item.status === "success").length,
        failedCount: runs.filter((item) => item.status === "failed").length,
        totalDurationMs,
        avgDurationMs: durationRuns.length > 0 ? Math.round(totalDurationMs / durationRuns.length) : undefined,
        promptTokens: tokenUsageAvailable ? promptTokens : undefined,
        completionTokens: tokenUsageAvailable ? completionTokens : undefined,
        totalTokens: tokenUsageAvailable ? totalTokens : undefined,
        tokenUsageAvailable,
      },
      workflowSummaries: Array.from(workflowMap.values())
        .map((item) => ({
          workflowId: item.workflowId,
          workflowName: item.workflowName,
          runCount: item.runCount,
          runningCount: item.runningCount,
          successCount: item.successCount,
          failedCount: item.failedCount,
          totalDurationMs: item.totalDurationMs,
          avgDurationMs: item.durationCount > 0 ? Math.round(item.totalDurationMs / item.durationCount) : undefined,
          promptTokens: item.tokenUsageAvailable ? item.promptTokens : undefined,
          completionTokens: item.tokenUsageAvailable ? item.completionTokens : undefined,
          totalTokens: item.tokenUsageAvailable ? item.totalTokens : undefined,
          tokenUsageAvailable: item.tokenUsageAvailable,
          lastRunAt: item.lastRunAt,
        }))
        .sort((a, b) => new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime()),
    };
  },
  getRunsAnalytics(days?: number, runType?: "workflow_run" | "dev_run") {
    return { analytics: configService.getRunsAnalytics(days, runType) };
  },
  listProjectRuns(projectId: string, limit?: number) {
    return { runs: configService.listProjectRuns(projectId, limit) };
  },
  getProjectRunDetail(projectId: string, runId: string) {
    const detail = configService.getProjectRunDetail(projectId, runId);
    if (!detail) {
      throw new Error("运行记录不存在");
    }
    return { run: detail };
  },
  listProjectFiles(projectId: string, limit?: number) {
    return { files: configService.listProjectFiles(projectId, limit) };
  },
  getProjectFile(projectId: string, fileId: string) {
    const file = configService.getProjectFile(projectId, fileId);
    if (!file) {
      throw new Error("文件不存在");
    }
    return { file };
  },
  listRecentFiles(limit?: number) {
    return { files: configService.listRecentFiles(limit) };
  },
  listProjects(options?: { includeArchived?: boolean }) {
    return { projects: configService.listProjects(options) };
  },
  getProject(projectId: string) {
    const project = configService.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    return { project };
  },
  updateProject(
    projectId: string,
    payload: {
      name?: string;
      description?: string;
      settings?: {
        defaultProvider?: string;
        defaultModel?: string;
        defaultBaseUrl?: string;
        defaultCredentialId?: string;
        defaultTemperature?: number;
        projectNotes?: string;
      };
      archived?: boolean;
    },
  ) {
    return { project: configService.updateProject(projectId, payload) };
  },
  deleteProject(projectId: string) {
    return configService.deleteProject(projectId);
  },
  createProject(payload: { name?: string; description?: string }) {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error("项目名称不能为空");
    }
    return { project: configService.createProject({ name, description: payload.description }) };
  },
  getProjectWorkflow(projectId: string, workflowId: string, versionId?: string) {
    const workflow = configService.getProjectWorkflow(projectId, workflowId, versionId);
    if (!workflow) {
      throw new Error("项目工作流不存在");
    }
    return { workflow };
  },
  updateWorkflowMeta(payload: { workflowId: string; projectId?: string; name?: string; description?: string }) {
    const name = payload.name?.trim();
    if (!name) {
      throw new Error("工作流名称不能为空");
    }
    return {
      workflow: configService.updateWorkflowMeta(payload.workflowId, {
        projectId: payload.projectId,
        name,
        description: payload.description,
      }),
    };
  },
  deleteWorkflow(workflowId: string, projectId?: string) {
    return configService.deleteWorkflow(workflowId, projectId);
  },
  getWorkflow(workflowId: string, versionId?: string) {
    const workflow = configService.getWorkflow(workflowId, versionId);
    if (!workflow) {
      throw new Error("工作流不存在");
    }
    return { workflow };
  },
  listWorkflowVersions(workflowId: string) {
    return { versions: configService.listWorkflowVersions(workflowId) };
  },
  publishWorkflowVersion(workflowId: string, versionId?: string) {
    return { workflow: configService.publishWorkflowVersion(workflowId, versionId) };
  },
  saveWorkflow(payload: {
    workflowId?: string;
    projectId?: string;
    name: string;
    description?: string;
    rootTaskInput?: string;
    nodes: StoredWorkflowNode[];
    edges: StoredWorkflowEdge[];
    tasks: StoredWorkflowTask[];
    versionLabel?: string;
    versionNotes?: string;
  }) {
    if (!payload.name.trim()) {
      throw new Error("工作流名称不能为空");
    }
    const workflow = configService.saveWorkflow({
      ...payload,
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      rootTaskInput: payload.rootTaskInput?.trim() || undefined,
      versionLabel: payload.versionLabel?.trim() || undefined,
      versionNotes: payload.versionNotes?.trim() || undefined,
    });
    return { workflow };
  },
  listTools() {
    toolService.ensurePlatformBootstrap();
    return { tools: toolService.listTools() };
  },
  getTool(toolId: string) {
    const tool = toolService.getTool(toolId);
    if (!tool) {
      throw new Error("工具不存在");
    }
    return { tool };
  },
  createTool(payload: {
    toolId?: string;
    pluginId?: string;
    name?: string;
    description?: string;
    category?: ToolDefinition["category"];
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    sourceType?: ToolDefinition["sourceType"];
    sourceConfig?: Record<string, unknown>;
    authRequirements?: ToolDefinition["authRequirements"];
    policy?: ToolDefinition["policy"];
    enabled?: boolean;
  }) {
    return { tool: toolService.createTool(payload) };
  },
  updateTool(toolId: string, payload: Partial<ToolDefinition>) {
    return { tool: toolService.updateTool(toolId, payload) };
  },
  disableTool(toolId: string) {
    return { tool: toolService.disableTool(toolId) };
  },
  deleteTool(toolId: string) {
    const refs = configService.deleteWorkflowAssetReferencesByAsset("tool", toolId);
    const result = toolService.deleteTool(toolId);
    return { ...result, deletedReferenceCount: refs.length };
  },
  importOpenClawTools(payload: {
    tools?: Array<{
      id?: string;
      name?: string;
      description?: string;
      category?: ToolDefinition["category"];
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      sourceConfig?: Record<string, unknown>;
      authRequirements?: Partial<ToolDefinition["authRequirements"]>;
      policy?: ToolDefinition["policy"];
      enabled?: boolean;
    }>;
  }) {
    return toolService.importOpenClawTools(payload);
  },
  importToolPackage(payload: {
    packageName?: string;
    version?: string;
    tools?: Array<{
      toolId?: string;
      name: string;
      description?: string;
      category?: ToolDefinition["category"];
      sourceType?: ToolDefinition["sourceType"];
      sourceConfig?: Record<string, unknown>;
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      authRequirements?: Partial<ToolDefinition["authRequirements"]>;
      policy?: ToolDefinition["policy"];
      enabled?: boolean;
    }>;
  }) {
    return toolService.importToolPackage({
      packageName: payload.packageName,
      version: payload.version,
      tools: payload.tools ?? [],
    });
  },
  listToolPlugins() {
    toolService.ensurePlatformBootstrap();
    return { plugins: toolService.listPlugins() };
  },
  installToolPlugin(payload: ToolPluginManifest) {
    return toolService.installPlugin(payload);
  },
  setToolPluginEnabled(pluginId: string, enabled: boolean) {
    const plugin = toolService.setPluginEnabled(pluginId, enabled);
    if (!plugin) {
      throw new Error("插件不存在");
    }
    return { plugin };
  },
  listToolBindings(scopeType?: ToolScopeType, scopeId?: string) {
    return { bindings: toolService.listBindings(scopeType, scopeId) };
  },
  replaceToolBindings(
    scopeType: ToolScopeType,
    scopeId: string,
    bindings: Array<{
      toolId: string;
      enabled?: boolean;
      priority?: number;
      overrideConfig?: Record<string, unknown>;
    }>,
  ) {
    return { bindings: toolService.replaceBindings(scopeType, scopeId, bindings) };
  },
  resolveToolsForNode(runId: string, nodeId: string, role: string) {
    toolService.ensurePlatformBootstrap();
    return toolResolver.resolveForNode(runId, nodeId, role);
  },
  validateTool(toolId: string) {
    const tool = toolService.getTool(toolId);
    if (!tool) {
      throw new Error("工具不存在");
    }
    return toolService.validateToolDefinition(tool);
  },
  async testCallTool(toolId: string, payload: { input?: Record<string, unknown>; timeoutMs?: number; maxRetries?: number }) {
    const tool = toolService.getTool(toolId);
    if (!tool) {
      throw new Error("工具不存在");
    }

    const resolvedTool = {
      ...tool,
      effectiveEnabled: tool.enabled,
      effectivePriority: 0,
      resolvedFrom: "platform_pool" as const,
      effectiveConfig: { ...tool.sourceConfig },
    };

    const result = await toolExecutor.execute(
      resolvedTool,
      payload.input ?? {},
      {
        runId: "tool_test",
        nodeId: "tool_test",
      },
      {
        timeoutMs: payload.timeoutMs,
        maxRetries: payload.maxRetries,
      },
    );

    return { result };
  },

  // ── Execution Debug Traces ──
  getTraces(runId: string, nodeId?: string) {
    ensureRun(runId);
    return {
      nodeTraces: memoryStore.getNodeTraces(runId, nodeId),
      promptTraces: memoryStore.getPromptTraces(runId, nodeId),
      toolTraces: memoryStore.getToolTraces(runId, nodeId),
      stateTraces: memoryStore.getStateTraces(runId, nodeId),
    };
  },

  // ── Dev Run (开发台) ──

  listWorkspaces() {
    const ids = workspaceService.listWorkspaces();
    return {
      workspaces: ids.map((id) => {
        const config = localProjectService.getConfig(id);
        return {
          id,
          localPath: config?.localPath,
          entryFile: config?.entryFile,
          runCommand: config?.runCommand,
        };
      }),
    };
  },

  createWorkspace(payload: {
    localPath?: string;
    entryFile?: string;
    runCommand?: string;
  }) {
    const workspaceId = makeId("ws");
    workspaceService.createWorkspace(workspaceId);
    if (payload.localPath?.trim()) {
      localProjectService.saveConfig(workspaceId, {
        localPath: payload.localPath.trim(),
        entryFile: payload.entryFile?.trim(),
        runCommand: payload.runCommand?.trim(),
      });
    }
    const config = localProjectService.getConfig(workspaceId);
    return {
      id: workspaceId,
      localPath: config?.localPath,
      entryFile: config?.entryFile,
      runCommand: config?.runCommand,
    };
  },

  deleteWorkspace(workspaceId: string) {
    if (!workspaceId?.trim()) throw new Error("workspaceId 不能为空");
    localProjectService.deleteConfig(workspaceId);
    workspaceService.deleteWorkspace(workspaceId);
    return { ok: true };
  },

  updateWorkspace(workspaceId: string, payload: {
    localPath?: string;
    entryFile?: string;
    runCommand?: string;
  }) {
    if (!workspaceId?.trim()) throw new Error("workspaceId 不能为空");
    if (payload.localPath?.trim()) {
      localProjectService.saveConfig(workspaceId, {
        localPath: payload.localPath.trim(),
        entryFile: payload.entryFile?.trim(),
        runCommand: payload.runCommand?.trim(),
      });
    }
    const config = localProjectService.getConfig(workspaceId);
    return {
      id: workspaceId,
      localPath: config?.localPath,
      entryFile: config?.entryFile,
      runCommand: config?.runCommand,
    };
  },

  async createDevRun(payload: {
    workspaceId: string;
    runCommand: string;
    entryFile?: string;
    environmentId?: string;
    cwdOverride?: string;
    env?: Record<string, string>;
    resolvedInput?: string;
  }) {
    if (!payload.workspaceId?.trim()) throw new Error("workspaceId 不能为空");
    if (!payload.runCommand?.trim()) throw new Error("runCommand 不能为空");

    const now = nowIso();
    const runId = makeId("dev_run");

    // Create run_snapshot with run_type=dev_run
    memoryStore.createRunSnapshot({
      run: {
        id: runId,
        name: `开发运行 ${payload.runCommand.slice(0, 40)}`,
        rootTaskId: runId,
        status: "running",
        runMode: "standard",
        runType: "dev_run",
        createdAt: now,
        startedAt: now,
      },
      tasks: [],
      nodes: [],
      edges: [],
      messages: [],
      events: [],
      agentDefinitions: [],
      agentContexts: [],
      humanMessages: [],
    });

    // Execute
    let result: Awaited<ReturnType<typeof executeDevAgent>>;
    try {
      result = await executeDevAgent({
        workspaceId: payload.workspaceId,
        entryFile: payload.entryFile ?? "",
        runCommand: payload.runCommand,
        resolvedInput: payload.resolvedInput ?? "",
        environmentId: payload.environmentId,
        cwdOverride: payload.cwdOverride,
        env: payload.env,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      memoryStore.updateRun(runId, (r) => ({
        ...r,
        status: "failed",
        finishedAt: nowIso(),
        error: errMsg,
      }));
      throw err;
    }

    // Record detail
    const detailId = makeId("dev_detail");
    memoryStore.insertDevRunDetail({
      id: detailId,
      runSnapshotId: runId,
      workspaceId: payload.workspaceId,
      entryFile: payload.entryFile,
      runCommand: payload.runCommand,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      environmentId: payload.environmentId,
      createdAt: now,
    });

    // Finalize run_snapshot
    const finishedAt = nowIso();
    memoryStore.updateRun(runId, (r) => ({
      ...r,
      status: result.success ? "completed" : "failed",
      finishedAt,
      output: result.stdout.slice(0, 2000) || undefined,
      error: result.success ? undefined : result.stderr.slice(0, 500),
    }));

    return {
      runId,
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      outputFiles: result.outputFiles,
    };
  },

  listDevRuns(limit = 20) {
    return {
      runs: memoryStore.listDevRunsWithDetail(limit),
    };
  },

  getDevRunDetail(runId: string) {
    const detail = memoryStore.getDevRunDetail(runId);
    return { detail };
  },
};
