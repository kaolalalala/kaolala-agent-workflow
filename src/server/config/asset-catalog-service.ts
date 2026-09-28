import { makeId, nowIso } from "@/lib/utils";
import { db } from "@/server/persistence/sqlite";
import type {
  AgentTemplateAsset,
  ModelAsset,
  PromptTemplateAsset,
  ScriptAsset,
  SkillAsset,
  WorkflowTemplateAsset,
} from "@/server/config/config-service";
import type { StoredWorkflowEdge, StoredWorkflowNode, StoredWorkflowTask } from "@/server/domain";

interface ModelAssetRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string | null;
  credential_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface PromptTemplateAssetRow {
  id: string;
  name: string;
  template_type: "system" | "agent" | "workflow";
  description: string | null;
  content: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface WorkflowTemplateRow {
  id: string;
  name: string;
  description: string | null;
  root_task_input: string | null;
  nodes_json: string;
  edges_json: string;
  tasks_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface AgentTemplateRow {
  id: string;
  name: string;
  description: string | null;
  role: string;
  default_prompt: string | null;
  task_summary: string | null;
  responsibility_summary: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ScriptAssetRow {
  id: string;
  name: string;
  description: string | null;
  local_path: string;
  run_command: string;
  parameter_schema: string | null;
  default_environment_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface SkillAssetRow {
  id: string;
  name: string;
  description: string | null;
  guide_content: string | null;
  planning_hint: string | null;
  runtime_profile_id: string | null;
  script_id: string;
  parameter_mapping: string | null;
  output_description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AssetCatalogServiceDependencies {
  getCredentialById(credentialId?: string): unknown;
  ensureBuiltinWorkflowTemplates(): void;
  normalizePromptTemplateType(value: string): "system" | "agent" | "workflow";
  toModelAsset(row: ModelAssetRow): ModelAsset;
  toPromptTemplateAsset(row: PromptTemplateAssetRow): PromptTemplateAsset;
  toWorkflowTemplateAsset(row: WorkflowTemplateRow): WorkflowTemplateAsset;
  toAgentTemplateAsset(row: AgentTemplateRow): AgentTemplateAsset;
  toScriptAsset(row: ScriptAssetRow): ScriptAsset;
  toSkillAsset(row: SkillAssetRow): SkillAsset;
}

export class AssetCatalogService {
  constructor(private readonly deps: AssetCatalogServiceDependencies) {}

  listModelAssets() {
    const rows = db.prepare("SELECT * FROM model_asset ORDER BY updated_at DESC").all() as ModelAssetRow[];
    return rows.map((row) => this.deps.toModelAsset(row));
  }

  createModelAsset(payload: {
    name: string;
    provider: string;
    model: string;
    baseUrl?: string;
    credentialId?: string;
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    const provider = payload.provider.trim();
    const model = payload.model.trim();
    if (!name || !provider || !model) {
      throw new Error("模型资产名称、服务商、模型不能为空");
    }
    if (payload.credentialId && !this.deps.getCredentialById(payload.credentialId)) {
      throw new Error("凭证不存在");
    }

    const now = nowIso();
    const id = makeId("asset_model");
    db.prepare(
      `INSERT INTO model_asset (
        id, name, provider, model, base_url, credential_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      provider,
      model,
      payload.baseUrl?.trim() || null,
      payload.credentialId?.trim() || null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM model_asset WHERE id = ?").get(id) as ModelAssetRow | undefined;
    if (!row) {
      throw new Error("创建模型资产失败");
    }
    return this.deps.toModelAsset(row);
  }

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
    const row = db.prepare("SELECT * FROM model_asset WHERE id = ?").get(assetId) as ModelAssetRow | undefined;
    if (!row) {
      throw new Error("模型资产不存在");
    }

    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    const nextProvider = payload.provider !== undefined ? payload.provider.trim() : row.provider;
    const nextModel = payload.model !== undefined ? payload.model.trim() : row.model;
    if (!nextName || !nextProvider || !nextModel) {
      throw new Error("模型资产名称、服务商、模型不能为空");
    }

    const nextCredentialId = payload.credentialId !== undefined ? payload.credentialId.trim() || null : row.credential_id;
    if (nextCredentialId && !this.deps.getCredentialById(nextCredentialId)) {
      throw new Error("凭证不存在");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE model_asset
       SET name = ?, provider = ?, model = ?, base_url = ?, credential_id = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      nextProvider,
      nextModel,
      payload.baseUrl !== undefined ? payload.baseUrl.trim() || null : row.base_url,
      nextCredentialId,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      assetId,
    );
    const updated = db.prepare("SELECT * FROM model_asset WHERE id = ?").get(assetId) as ModelAssetRow | undefined;
    if (!updated) {
      throw new Error("模型资产不存在");
    }
    return this.deps.toModelAsset(updated);
  }

  deleteModelAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM model_asset WHERE id = ?").get(assetId) as ModelAssetRow | undefined;
    if (!row) {
      throw new Error("模型资产不存在");
    }
    db.prepare("DELETE FROM workflow_asset_reference WHERE asset_type = 'model' AND asset_id = ?").run(assetId);
    db.prepare("DELETE FROM model_asset WHERE id = ?").run(assetId);
    return { id: assetId };
  }

  listPromptTemplateAssets(templateType?: "system" | "agent" | "workflow") {
    const rows = templateType
      ? (db
          .prepare("SELECT * FROM prompt_template_asset WHERE template_type = ? ORDER BY updated_at DESC")
          .all(templateType) as PromptTemplateAssetRow[])
      : (db
          .prepare("SELECT * FROM prompt_template_asset ORDER BY updated_at DESC")
          .all() as PromptTemplateAssetRow[]);
    return rows.map((row) => this.deps.toPromptTemplateAsset(row));
  }

  createPromptTemplateAsset(payload: {
    name: string;
    templateType: "system" | "agent" | "workflow";
    description?: string;
    content: string;
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    const content = payload.content.trim();
    if (!name || !content) {
      throw new Error("Prompt 模板名称和内容不能为空");
    }
    const templateType = this.deps.normalizePromptTemplateType(payload.templateType);
    const now = nowIso();
    const id = makeId("asset_prompt");
    db.prepare(
      `INSERT INTO prompt_template_asset (
        id, name, template_type, description, content, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      templateType,
      payload.description?.trim() || null,
      content,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM prompt_template_asset WHERE id = ?").get(id) as PromptTemplateAssetRow | undefined;
    if (!row) {
      throw new Error("创建 Prompt 模板失败");
    }
    return this.deps.toPromptTemplateAsset(row);
  }

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
    const row = db.prepare("SELECT * FROM prompt_template_asset WHERE id = ?").get(templateId) as PromptTemplateAssetRow | undefined;
    if (!row) {
      throw new Error("Prompt 模板不存在");
    }

    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    const nextContent = payload.content !== undefined ? payload.content.trim() : row.content;
    if (!nextName || !nextContent) {
      throw new Error("Prompt 模板名称和内容不能为空");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE prompt_template_asset
       SET name = ?, template_type = ?, description = ?, content = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      payload.templateType !== undefined ? this.deps.normalizePromptTemplateType(payload.templateType) : row.template_type,
      payload.description !== undefined ? payload.description.trim() || null : row.description,
      nextContent,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      templateId,
    );
    const updated = db.prepare("SELECT * FROM prompt_template_asset WHERE id = ?").get(templateId) as PromptTemplateAssetRow | undefined;
    if (!updated) {
      throw new Error("Prompt 模板不存在");
    }
    return this.deps.toPromptTemplateAsset(updated);
  }

  deletePromptTemplateAsset(templateId: string) {
    const row = db.prepare("SELECT * FROM prompt_template_asset WHERE id = ?").get(templateId) as PromptTemplateAssetRow | undefined;
    if (!row) {
      throw new Error("Prompt 模板不存在");
    }
    db.prepare("DELETE FROM workflow_asset_reference WHERE asset_type = 'prompt_template' AND asset_id = ?").run(templateId);
    db.prepare("DELETE FROM prompt_template_asset WHERE id = ?").run(templateId);
    return { id: templateId };
  }

  listWorkflowTemplates() {
    this.deps.ensureBuiltinWorkflowTemplates();
    const rows = db.prepare("SELECT * FROM workflow_template ORDER BY updated_at DESC").all() as WorkflowTemplateRow[];
    return rows.map((row) => this.deps.toWorkflowTemplateAsset(row));
  }

  getWorkflowTemplate(templateId: string) {
    this.deps.ensureBuiltinWorkflowTemplates();
    const row = db.prepare("SELECT * FROM workflow_template WHERE id = ?").get(templateId) as WorkflowTemplateRow | undefined;
    return row ? this.deps.toWorkflowTemplateAsset(row) : null;
  }

  createWorkflowTemplate(payload: {
    id?: string;
    name: string;
    description?: string;
    rootTaskInput?: string;
    nodes: StoredWorkflowNode[];
    edges: StoredWorkflowEdge[];
    tasks: StoredWorkflowTask[];
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    if (!name) {
      throw new Error("工作流模板名称不能为空");
    }
    const now = nowIso();
    const id = payload.id?.trim() || makeId("wf_tpl");
    db.prepare(
      `INSERT INTO workflow_template (
        id, name, description, root_task_input, nodes_json, edges_json, tasks_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      payload.description?.trim() || null,
      payload.rootTaskInput?.trim() || null,
      JSON.stringify(payload.nodes ?? []),
      JSON.stringify(payload.edges ?? []),
      JSON.stringify(payload.tasks ?? []),
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM workflow_template WHERE id = ?").get(id) as WorkflowTemplateRow | undefined;
    if (!row) {
      throw new Error("创建工作流模板失败");
    }
    return this.deps.toWorkflowTemplateAsset(row);
  }

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
    const row = db.prepare("SELECT * FROM workflow_template WHERE id = ?").get(templateId) as WorkflowTemplateRow | undefined;
    if (!row) {
      throw new Error("工作流模板不存在");
    }
    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    if (!nextName) {
      throw new Error("工作流模板名称不能为空");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE workflow_template
       SET name = ?, description = ?, root_task_input = ?, nodes_json = ?, edges_json = ?, tasks_json = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      payload.description !== undefined ? payload.description.trim() || null : row.description,
      payload.rootTaskInput !== undefined ? payload.rootTaskInput.trim() || null : row.root_task_input,
      payload.nodes !== undefined ? JSON.stringify(payload.nodes) : row.nodes_json,
      payload.edges !== undefined ? JSON.stringify(payload.edges) : row.edges_json,
      payload.tasks !== undefined ? JSON.stringify(payload.tasks) : row.tasks_json,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      templateId,
    );
    const updated = db.prepare("SELECT * FROM workflow_template WHERE id = ?").get(templateId) as WorkflowTemplateRow | undefined;
    if (!updated) {
      throw new Error("工作流模板不存在");
    }
    return this.deps.toWorkflowTemplateAsset(updated);
  }

  deleteWorkflowTemplate(templateId: string) {
    const row = db.prepare("SELECT * FROM workflow_template WHERE id = ?").get(templateId) as WorkflowTemplateRow | undefined;
    if (!row) {
      throw new Error("工作流模板不存在");
    }
    db.prepare("DELETE FROM workflow_template WHERE id = ?").run(templateId);
    return { id: templateId };
  }

  listAgentTemplates() {
    const rows = db.prepare("SELECT * FROM agent_template ORDER BY updated_at DESC").all() as AgentTemplateRow[];
    return rows.map((row) => this.deps.toAgentTemplateAsset(row));
  }

  createAgentTemplate(payload: {
    name: string;
    description?: string;
    role: string;
    defaultPrompt?: string;
    taskSummary?: string;
    responsibilitySummary?: string;
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    const role = payload.role.trim();
    if (!name || !role) {
      throw new Error("Agent 模板名称和角色不能为空");
    }
    const now = nowIso();
    const id = makeId("agent_tpl");
    db.prepare(
      `INSERT INTO agent_template (
        id, name, description, role, default_prompt, task_summary, responsibility_summary, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      payload.description?.trim() || null,
      role,
      payload.defaultPrompt?.trim() || null,
      payload.taskSummary?.trim() || null,
      payload.responsibilitySummary?.trim() || null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM agent_template WHERE id = ?").get(id) as AgentTemplateRow | undefined;
    if (!row) {
      throw new Error("创建 Agent 模板失败");
    }
    return this.deps.toAgentTemplateAsset(row);
  }

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
    const row = db.prepare("SELECT * FROM agent_template WHERE id = ?").get(templateId) as AgentTemplateRow | undefined;
    if (!row) {
      throw new Error("Agent 模板不存在");
    }

    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    const nextRole = payload.role !== undefined ? payload.role.trim() : row.role;
    if (!nextName || !nextRole) {
      throw new Error("Agent 模板名称和角色不能为空");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE agent_template
       SET name = ?, description = ?, role = ?, default_prompt = ?, task_summary = ?, responsibility_summary = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      payload.description !== undefined ? payload.description.trim() || null : row.description,
      nextRole,
      payload.defaultPrompt !== undefined ? payload.defaultPrompt.trim() || null : row.default_prompt,
      payload.taskSummary !== undefined ? payload.taskSummary.trim() || null : row.task_summary,
      payload.responsibilitySummary !== undefined ? payload.responsibilitySummary.trim() || null : row.responsibility_summary,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      templateId,
    );
    const updated = db.prepare("SELECT * FROM agent_template WHERE id = ?").get(templateId) as AgentTemplateRow | undefined;
    if (!updated) {
      throw new Error("Agent 模板不存在");
    }
    return this.deps.toAgentTemplateAsset(updated);
  }

  deleteAgentTemplate(templateId: string) {
    const row = db.prepare("SELECT * FROM agent_template WHERE id = ?").get(templateId) as AgentTemplateRow | undefined;
    if (!row) {
      throw new Error("Agent 模板不存在");
    }
    db.prepare("DELETE FROM agent_template WHERE id = ?").run(templateId);
    return { id: templateId };
  }

  listScriptAssets() {
    const rows = db.prepare("SELECT * FROM script_asset ORDER BY updated_at DESC").all() as ScriptAssetRow[];
    return rows.map((row) => this.deps.toScriptAsset(row));
  }

  getScriptAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(assetId) as ScriptAssetRow | undefined;
    return row ? this.deps.toScriptAsset(row) : null;
  }

  createScriptAsset(payload: {
    name: string;
    localPath: string;
    runCommand: string;
    description?: string;
    parameterSchema?: Record<string, unknown>;
    defaultEnvironmentId?: string;
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    const localPath = payload.localPath.trim();
    const runCommand = payload.runCommand.trim();
    if (!name || !localPath || !runCommand) {
      throw new Error("脚本资产名称、本地路径、运行命令不能为空");
    }

    const now = nowIso();
    const id = makeId("asset_script");
    db.prepare(
      `INSERT INTO script_asset (
        id, name, description, local_path, run_command, parameter_schema,
        default_environment_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      payload.description?.trim() || null,
      localPath,
      runCommand,
      JSON.stringify(payload.parameterSchema ?? {}),
      payload.defaultEnvironmentId?.trim() || null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(id) as ScriptAssetRow | undefined;
    if (!row) {
      throw new Error("创建脚本资产失败");
    }
    return this.deps.toScriptAsset(row);
  }

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
    const row = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(assetId) as ScriptAssetRow | undefined;
    if (!row) {
      throw new Error("脚本资产不存在");
    }

    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    const nextLocalPath = payload.localPath !== undefined ? payload.localPath.trim() : row.local_path;
    const nextRunCommand = payload.runCommand !== undefined ? payload.runCommand.trim() : row.run_command;
    if (!nextName || !nextLocalPath || !nextRunCommand) {
      throw new Error("脚本资产名称、本地路径、运行命令不能为空");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE script_asset
       SET name = ?, description = ?, local_path = ?, run_command = ?, parameter_schema = ?,
           default_environment_id = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      payload.description !== undefined ? payload.description.trim() || null : row.description,
      nextLocalPath,
      nextRunCommand,
      payload.parameterSchema !== undefined ? JSON.stringify(payload.parameterSchema) : row.parameter_schema,
      payload.defaultEnvironmentId !== undefined ? payload.defaultEnvironmentId.trim() || null : row.default_environment_id,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      assetId,
    );
    const updated = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(assetId) as ScriptAssetRow | undefined;
    if (!updated) {
      throw new Error("脚本资产不存在");
    }
    return this.deps.toScriptAsset(updated);
  }

  deleteScriptAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(assetId) as ScriptAssetRow | undefined;
    if (!row) {
      throw new Error("脚本资产不存在");
    }
    const skills = db.prepare("SELECT id FROM skill_asset WHERE script_id = ?").all(assetId) as { id: string }[];
    for (const skill of skills) {
      db.prepare("DELETE FROM skill_binding WHERE skill_id = ?").run(skill.id);
    }
    db.prepare("DELETE FROM skill_asset WHERE script_id = ?").run(assetId);
    db.prepare("DELETE FROM script_asset WHERE id = ?").run(assetId);
    return { id: assetId };
  }

  listSkillAssets() {
    const rows = db.prepare("SELECT * FROM skill_asset ORDER BY updated_at DESC").all() as SkillAssetRow[];
    return rows.map((row) => this.deps.toSkillAsset(row));
  }

  getSkillAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    return row ? this.deps.toSkillAsset(row) : null;
  }

  createSkillAsset(payload: {
    name: string;
    scriptId: string;
    description?: string;
    guideContent?: string;
    planningHint?: string;
    runtimeProfileId?: string;
    parameterMapping?: Record<string, string>;
    outputDescription?: string;
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    const scriptId = payload.scriptId.trim();
    if (!name || !scriptId) {
      throw new Error("技能资产名称和绑定脚本不能为空");
    }
    const script = db.prepare("SELECT id FROM script_asset WHERE id = ?").get(scriptId) as { id: string } | undefined;
    if (!script) {
      throw new Error("绑定的脚本资产不存在");
    }

    const now = nowIso();
    const id = makeId("asset_skill");
    db.prepare(
      `INSERT INTO skill_asset (
        id, name, description, guide_content, planning_hint, runtime_profile_id, script_id, parameter_mapping, output_description,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      payload.description?.trim() || null,
      payload.guideContent?.trim() || null,
      payload.planningHint?.trim() || null,
      payload.runtimeProfileId?.trim() || null,
      scriptId,
      JSON.stringify(payload.parameterMapping ?? {}),
      payload.outputDescription?.trim() || null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(id) as SkillAssetRow | undefined;
    if (!row) {
      throw new Error("创建技能资产失败");
    }
    return this.deps.toSkillAsset(row);
  }

  updateSkillAsset(
    assetId: string,
    payload: Partial<{
      name: string;
      description: string;
      guideContent: string;
      planningHint: string;
      runtimeProfileId: string;
      scriptId: string;
      parameterMapping: Record<string, string>;
      outputDescription: string;
      enabled: boolean;
    }>,
  ) {
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    if (!row) {
      throw new Error("技能资产不存在");
    }

    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    const nextScriptId = payload.scriptId !== undefined ? payload.scriptId.trim() : row.script_id;
    if (!nextName || !nextScriptId) {
      throw new Error("技能资产名称和绑定脚本不能为空");
    }
    if (payload.scriptId !== undefined) {
      const script = db.prepare("SELECT id FROM script_asset WHERE id = ?").get(nextScriptId) as { id: string } | undefined;
      if (!script) {
        throw new Error("绑定的脚本资产不存在");
      }
    }

    const now = nowIso();
    db.prepare(
      `UPDATE skill_asset
       SET name = ?, description = ?, guide_content = ?, planning_hint = ?, runtime_profile_id = ?, script_id = ?, parameter_mapping = ?,
           output_description = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      payload.description !== undefined ? payload.description.trim() || null : row.description,
      payload.guideContent !== undefined ? payload.guideContent.trim() || null : row.guide_content,
      payload.planningHint !== undefined ? payload.planningHint.trim() || null : row.planning_hint,
      payload.runtimeProfileId !== undefined ? payload.runtimeProfileId.trim() || null : row.runtime_profile_id,
      nextScriptId,
      payload.parameterMapping !== undefined ? JSON.stringify(payload.parameterMapping) : row.parameter_mapping,
      payload.outputDescription !== undefined ? payload.outputDescription.trim() || null : row.output_description,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      assetId,
    );
    const updated = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    if (!updated) {
      throw new Error("技能资产不存在");
    }
    return this.deps.toSkillAsset(updated);
  }

  deleteSkillAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    if (!row) {
      throw new Error("技能资产不存在");
    }
    db.prepare("DELETE FROM skill_binding WHERE skill_id = ?").run(assetId);
    db.prepare("DELETE FROM skill_asset WHERE id = ?").run(assetId);
    return { id: assetId };
  }
}
