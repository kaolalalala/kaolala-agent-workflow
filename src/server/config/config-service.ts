import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

import {
  AgentDocument,
  AgentDocumentType,
  AgentNodeConfig,
  AgentNodeToolPolicy,
  SecretCredential,
  StoredWorkflowEdge,
  StoredWorkflowNode,
  StoredWorkflowTask,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowVersionDefinition,
  WorkflowVersionSummary,
  WorkspaceConfig,
} from "@/server/domain";
import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";
import {
  BUILTIN_WORKFLOW_TEMPLATE_SEEDS,
  getBuiltinWorkflowTemplateMeta,
  type WorkflowTemplatePresetTask,
} from "@/server/config/builtin-workflow-templates";

interface WorkspaceConfigRow {
  id: string;
  name: string;
  default_provider: string | null;
  default_model: string | null;
  default_base_url: string | null;
  default_credential_id: string | null;
  default_temperature: number | null;
  created_at: string;
  updated_at: string;
}

interface NodeConfigRow {
  id: string;
  run_id: string;
  node_id: string;
  name: string;
  description: string | null;
  responsibility: string | null;
  system_prompt: string | null;
  additional_prompt: string | null;
  use_workspace_model_default: number;
  provider: string | null;
  model: string | null;
  credential_id: string | null;
  base_url: string | null;
  output_path: string | null;
  temperature: number | null;
  allow_human_input: number;
  tool_policy: string | null;
  execution_mode: string;
  workspace_id: string | null;
  entry_file: string | null;
  run_command: string | null;
  reflection_enabled: number | null;
  max_reflection_rounds: number | null;
  max_tool_rounds: number | null;
  created_at: string;
  updated_at: string;
}

interface CredentialRow {
  id: string;
  provider: string;
  label: string;
  encrypted_value: string;
  created_at: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  run_id: string | null;
  owner_type: "workspace" | "node";
  owner_id: string;
  doc_type: AgentDocumentType;
  name: string;
  format: "markdown";
  content: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowRow {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  root_task_input: string | null;
  nodes_json: string;
  edges_json: string;
  tasks_json: string;
  is_example: number;
  current_version_id: string | null;
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  default_provider: string | null;
  default_model: string | null;
  default_base_url: string | null;
  default_credential_id: string | null;
  default_temperature: number | null;
  project_notes: string | null;
  archived_at: string | null;
  settings_updated_at: string | null;
  workflow_count?: number;
  run_count?: number;
  file_count?: number;
  created_at: string;
  updated_at: string;
}

interface RunRecordRow {
  run_id: string;
  project_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  run_type: string | null;
  run_status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  output: string | null;
  error: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  token_usage_rows: number | null;
}

interface RunAnalyticsRow {
  run_id: string;
  run_status: string;
  workflow_id: string | null;
  workflow_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  bucket_date: string;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  token_usage_rows: number | null;
}

interface RunSnapshotRow {
  run_id: string;
  status: string;
  root_task_id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  project_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  output: string | null;
  error: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  token_usage_rows: number | null;
}

interface RunTaskRow {
  id: string;
  title: string;
  summary: string | null;
}

interface RunEventRow {
  id: string;
  type: string;
  timestamp: string;
  run_event_seq: number | null;
  related_node_id: string | null;
  related_task_id: string | null;
  message: string;
  payload_json: string | null;
}

interface RunNodeExecutionRow {
  id: string;
  name: string;
  role: string;
  status: string;
  agent_definition_id: string;
  context_id: string | null;
  execution_order: number | null;
  latest_input: string | null;
  latest_output: string | null;
  resolved_input: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
  blocked_reason: string | null;
}

interface RunAgentDefinitionRow {
  id: string;
  run_id: string;
  name: string;
  role: string;
  system_prompt: string | null;
  responsibility: string | null;
  input_schema: string | null;
  output_schema: string | null;
  allow_human_input: number;
  model: string | null;
  temperature: number | null;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

interface RunAgentContextRow {
  id: string;
  node_id: string;
  run_id: string;
  system_prompt: string | null;
  task_brief: string | null;
  inbound_messages_json: string;
  outbound_messages_json: string;
  resolved_input: string | null;
  human_messages_json: string;
  recent_outputs_json: string;
  latest_summary: string | null;
  updated_at: string;
}

interface NodeAnalyticsRow {
  node_name: string;
  node_role: string;
  node_status: string;
  duration_ms: number | null;
}

interface ProjectFileRow {
  id: string;
  project_id: string;
  run_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  name: string;
  file_type: string;
  size_bytes: number | null;
  source_type: string;
  content_text: string | null;
  content_json: string | null;
  path_ref: string | null;
  created_at: string;
  updated_at: string;
}

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
  template_type: string;
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

interface WorkflowAssetReferenceRow {
  id: string;
  workflow_id: string;
  asset_type: string;
  asset_id: string;
  created_at: string;
  updated_at: string;
}

interface ScriptAssetRow {
  id: string;
  name: string;
  description: string | null;
  local_path: string;
  run_command: string;
  parameter_schema: string;
  default_environment_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface SkillAssetRow {
  id: string;
  name: string;
  description: string | null;
  script_id: string;
  parameter_mapping: string;
  output_description: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface SkillBindingRow {
  id: string;
  node_id: string;
  run_id: string;
  skill_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  settings: ProjectSettings;
  effectiveSettings?: ProjectSettings;
  archivedAt?: string;
  settingsUpdatedAt?: string;
  workflowCount?: number;
  runCount?: number;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultBaseUrl?: string;
  defaultCredentialId?: string;
  defaultTemperature?: number;
  projectNotes?: string;
}

export interface ModelAsset {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  credentialId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateAsset {
  id: string;
  name: string;
  templateType: "system" | "agent" | "workflow";
  description?: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplateAsset {
  id: string;
  name: string;
  description?: string;
  rootTaskInput?: string;
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
  nodeCount: number;
  edgeCount: number;
  isBuiltin: boolean;
  templateCategory?: "节点规模" | "任务类型";
  scenario?: string;
  presetTasks: WorkflowTemplatePresetTask[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTemplateAsset {
  id: string;
  name: string;
  description?: string;
  role: string;
  defaultPrompt?: string;
  taskSummary?: string;
  responsibilitySummary?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowAssetReference {
  id: string;
  workflowId: string;
  assetType: "tool" | "model" | "prompt_template";
  assetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptAsset {
  id: string;
  name: string;
  description?: string;
  localPath: string;
  runCommand: string;
  parameterSchema: Record<string, unknown>;
  defaultEnvironmentId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillAsset {
  id: string;
  name: string;
  description?: string;
  scriptId: string;
  parameterMapping: Record<string, string>;
  outputDescription?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillBinding {
  id: string;
  nodeId: string;
  runId: string;
  skillId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedNodeSkill {
  skill: SkillAsset;
  script: ScriptAsset;
}

export interface ProjectRunSummary {
  id: string;
  projectId?: string;
  workflowId?: string;
  workflowName: string;
  runType: "workflow_run" | "dev_run";
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable?: boolean;
  summary?: string;
  triggerSource: "manual";
}

export interface RunDetailLogItem {
  id: string;
  type: string;
  level: "info" | "warn" | "error";
  time: string;
  seq?: number;
  message: string;
  payload?: Record<string, unknown>;
  nodeId?: string;
  taskId?: string;
}

export interface ProjectFileSummary {
  id: string;
  projectId: string;
  runId?: string;
  workflowId?: string;
  workflowName?: string;
  name: string;
  type: string;
  size?: number;
  sourceType: "upload" | "run_output" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileDetail extends ProjectFileSummary {
  pathRef?: string;
  contentText?: string;
  contentJson?: unknown;
}

export interface RunTimelineItem {
  nodeId: string;
  name: string;
  role: string;
  status: "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  startOffsetMs?: number;
  endOffsetMs?: number;
}

export interface RunToolCallTrace {
  id: string;
  nodeId: string;
  nodeName: string;
  toolId?: string;
  toolName?: string;
  status: "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

export interface RunPromptTrace {
  provider?: string;
  model?: string;
  requestPath?: string;
  systemPrompt?: string;
  userPrompt?: string;
  messageHistory?: Array<{
    id?: string;
    fromNodeId?: string;
    toNodeId?: string;
    type?: string;
    content?: string;
    createdAt?: string;
  }>;
  completion?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable: boolean;
}

export interface RunNodeTrace {
  nodeId: string;
  name: string;
  role: string;
  status: "running" | "success" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputSnapshot?: string;
  outputSnapshot?: string;
  error?: string;
  promptTrace?: RunPromptTrace;
  toolCalls: RunToolCallTrace[];
}

export interface RunReplayHints {
  nodeReplayReady: boolean;
  stepRerunReady: boolean;
  runCompareReady: boolean;
  notes: string;
}

export interface ProjectRunDetail {
  id: string;
  projectId: string;
  workflowId?: string;
  workflowName: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  updatedAt: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokenUsageAvailable?: boolean;
  inputSnapshot?: string;
  outputSnapshot?: string;
  summary?: string;
  logs: RunDetailLogItem[];
  executionTimeline: RunTimelineItem[];
  nodeExecutions: Array<{
    nodeId: string;
    name: string;
    role: string;
    status: "running" | "success" | "failed";
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    tokenUsageAvailable?: boolean;
    error?: string;
  }>;
  nodeTraces: RunNodeTrace[];
  replayHints: RunReplayHints;
  artifacts: ProjectFileSummary[];
  triggerSource: "manual";
}

export interface RunsAnalytics {
  rangeDays: number;
  generatedAt: string;
  overview: {
    totalRuns: number;
    successCount: number;
    failedCount: number;
    runningCount: number;
    successRate?: number;
    avgDurationMs?: number;
    totalDurationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    tokenUsageAvailable: boolean;
  };
  trend: Array<{
    date: string;
    runCount: number;
    successCount: number;
    failedCount: number;
    runningCount: number;
  }>;
  statusDistribution: Array<{
    status: "success" | "failed" | "running";
    count: number;
  }>;
  workflowTokenUsage: Array<{
    workflowId?: string;
    workflowName: string;
    totalTokens: number;
    runCount: number;
  }>;
  nodeDurationRanking: Array<{
    nodeKey: string;
    nodeName: string;
    role: string;
    avgDurationMs: number;
    runCount: number;
  }>;
  nodeFailureRanking: Array<{
    nodeKey: string;
    nodeName: string;
    role: string;
    failCount: number;
    runCount: number;
    failRate: number;
  }>;
}

interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version_number: number;
  version_label: string;
  version_notes: string | null;
  root_task_input: string | null;
  nodes_json: string;
  edges_json: string;
  tasks_json: string;
  published_at: string | null;
  created_at: string;
}

function toWorkspaceConfig(row: WorkspaceConfigRow): WorkspaceConfig {
  return {
    id: row.id,
    name: row.name,
    defaultProvider: row.default_provider ?? undefined,
    defaultModel: row.default_model ?? undefined,
    defaultBaseUrl: row.default_base_url ?? undefined,
    defaultCredentialId: row.default_credential_id ?? undefined,
    defaultTemperature: row.default_temperature ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNodeConfig(row: NodeConfigRow): AgentNodeConfig {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    name: row.name,
    description: row.description ?? undefined,
    responsibility: row.responsibility ?? undefined,
    systemPrompt: row.system_prompt ?? undefined,
    additionalPrompt: row.additional_prompt ?? undefined,
    useWorkspaceModelDefault: row.use_workspace_model_default === 1,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    credentialId: row.credential_id ?? undefined,
    baseUrl: row.base_url ?? undefined,
    outputPath: row.output_path ?? undefined,
    temperature: row.temperature ?? undefined,
    allowHumanInput: row.allow_human_input === 1,
    toolPolicy: normalizeToolPolicy(row.tool_policy, "allowed"),
    executionMode: (["dev", "script"].includes(row.execution_mode) ? row.execution_mode : "standard") as AgentNodeConfig["executionMode"],
    workspaceId: row.workspace_id ?? undefined,
    entryFile: row.entry_file ?? undefined,
    runCommand: row.run_command ?? undefined,
    reflectionEnabled: row.reflection_enabled === 1 ? true : undefined,
    maxReflectionRounds: row.max_reflection_rounds ?? undefined,
    maxToolRounds: row.max_tool_rounds ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCredential(row: CredentialRow): SecretCredential {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    encryptedValue: row.encrypted_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDocument(row: DocumentRow): AgentDocument {
  return {
    id: row.id,
    runId: row.run_id ?? undefined,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    type: row.doc_type,
    name: row.name,
    format: row.format,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWorkflowVersionSummary(row: WorkflowVersionRow): WorkflowVersionSummary {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    versionLabel: row.version_label,
    versionNotes: row.version_notes ?? undefined,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
  };
}

function toWorkflowVersionDefinition(row: WorkflowVersionRow): WorkflowVersionDefinition {
  return {
    ...toWorkflowVersionSummary(row),
    rootTaskInput: row.root_task_input ?? undefined,
    nodes: JSON.parse(row.nodes_json) as StoredWorkflowNode[],
    edges: JSON.parse(row.edges_json) as StoredWorkflowEdge[],
    tasks: JSON.parse(row.tasks_json) as StoredWorkflowTask[],
  };
}

function toModelAsset(row: ModelAssetRow): ModelAsset {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url ?? undefined,
    credentialId: row.credential_id ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePromptTemplateType(value: string): "system" | "agent" | "workflow" {
  if (value === "system" || value === "agent" || value === "workflow") {
    return value;
  }
  return "workflow";
}

function toPromptTemplateAsset(row: PromptTemplateAssetRow): PromptTemplateAsset {
  return {
    id: row.id,
    name: row.name,
    templateType: normalizePromptTemplateType(row.template_type),
    description: row.description ?? undefined,
    content: row.content,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWorkflowTemplateAsset(row: WorkflowTemplateRow): WorkflowTemplateAsset {
  const nodes = JSON.parse(row.nodes_json) as StoredWorkflowNode[];
  const edges = JSON.parse(row.edges_json) as StoredWorkflowEdge[];
  const tasks = JSON.parse(row.tasks_json) as StoredWorkflowTask[];
  const builtinMeta = getBuiltinWorkflowTemplateMeta(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    rootTaskInput: row.root_task_input ?? undefined,
    nodes,
    edges,
    tasks,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    isBuiltin: Boolean(builtinMeta),
    templateCategory: builtinMeta?.templateCategory,
    scenario: builtinMeta?.scenario,
    presetTasks: builtinMeta?.presetTasks ?? [],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAgentTemplateAsset(row: AgentTemplateRow): AgentTemplateAsset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    role: row.role,
    defaultPrompt: row.default_prompt ?? undefined,
    taskSummary: row.task_summary ?? undefined,
    responsibilitySummary: row.responsibility_summary ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWorkflowAssetReference(row: WorkflowAssetReferenceRow): WorkflowAssetReference {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    assetType:
      row.asset_type === "tool" || row.asset_type === "model" || row.asset_type === "prompt_template"
        ? row.asset_type
        : "tool",
    assetId: row.asset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toScriptAsset(row: ScriptAssetRow): ScriptAsset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    localPath: row.local_path,
    runCommand: row.run_command,
    parameterSchema: JSON.parse(row.parameter_schema) as Record<string, unknown>,
    defaultEnvironmentId: row.default_environment_id ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSkillAsset(row: SkillAssetRow): SkillAsset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scriptId: row.script_id,
    parameterMapping: JSON.parse(row.parameter_mapping) as Record<string, string>,
    outputDescription: row.output_description ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSkillBinding(row: SkillBindingRow): SkillBinding {
  return {
    id: row.id,
    nodeId: row.node_id,
    runId: row.run_id,
    skillId: row.skill_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRunStatus(status: string): "running" | "success" | "failed" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "failed";
  }
  return "running";
}

function normalizeNodeRunStatus(status: string): "running" | "success" | "failed" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed" || status === "cancelled") {
    return "failed";
  }
  return "running";
}

function diffMs(start?: string, end?: string) {
  if (!start || !end) {
    return undefined;
  }
  const value = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return formatLocalDate(parsed);
}

function buildDateRange(days: number) {
  const entries: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let index = days - 1; index >= 0; index -= 1) {
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - index);
    entries.push(formatLocalDate(cursor));
  }

  return entries;
}

function normalizeTokenValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value >= 0 ? value : undefined;
}

function getTokenUsageFromPayload(payload?: Record<string, unknown>) {
  if (!payload) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      tokenUsageAvailable: false,
    };
  }
  const nested = payload.tokenUsage && typeof payload.tokenUsage === "object"
    ? (payload.tokenUsage as Record<string, unknown>)
    : undefined;
  const promptTokens = normalizeTokenValue(
    payload.promptTokens
    ?? payload.prompt_tokens
    ?? nested?.promptTokens
    ?? nested?.prompt_tokens,
  );
  const completionTokens = normalizeTokenValue(
    payload.completionTokens
    ?? payload.completion_tokens
    ?? nested?.completionTokens
    ?? nested?.completion_tokens,
  );
  const totalTokens = normalizeTokenValue(
    payload.totalTokens
    ?? payload.total_tokens
    ?? nested?.totalTokens
    ?? nested?.total_tokens,
  );
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? 0,
    tokenUsageAvailable:
      typeof promptTokens === "number"
      || typeof completionTokens === "number"
      || typeof totalTokens === "number",
  };
}

function buildRunSummary(row: RunRecordRow): ProjectRunSummary {
  const summarySource = (row.error ?? row.output ?? "").trim();
  const startedAt = row.started_at ?? row.created_at;
  const updatedAt = row.finished_at ?? startedAt;
  const tokenUsageAvailable = Number(row.token_usage_rows ?? 0) > 0;
  return {
    id: row.run_id,
    projectId: row.project_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowName: row.workflow_name ?? "未命名工作流",
    runType: (row.run_type === "dev_run" ? "dev_run" : "workflow_run") as ProjectRunSummary["runType"],
    status: normalizeRunStatus(row.run_status),
    startedAt,
    finishedAt: row.finished_at ?? undefined,
    updatedAt,
    durationMs: diffMs(startedAt, row.finished_at ?? undefined),
    promptTokens: tokenUsageAvailable ? Number(row.prompt_tokens ?? 0) : undefined,
    completionTokens: tokenUsageAvailable ? Number(row.completion_tokens ?? 0) : undefined,
    totalTokens: tokenUsageAvailable ? Number(row.total_tokens ?? 0) : undefined,
    tokenUsageAvailable,
    summary: summarySource ? summarySource.slice(0, 160) : undefined,
    triggerSource: "manual",
  };
}

function normalizeRunLogLevel(type: string): RunDetailLogItem["level"] {
  if (type.includes("failed") || type.includes("error")) {
    return "error";
  }
  if (type.includes("waiting")) {
    return "warn";
  }
  return "info";
}

function parseEventPayload(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseJsonArray(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  } catch {
    return [];
  }
}

function toTextValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function toRecordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function excerpt(value: string | undefined, maxLength = 1600): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
}

function extractToolName(message: string): string | undefined {
  const marker = message.indexOf(":");
  if (marker < 0) {
    return undefined;
  }
  const text = message.slice(marker + 1).split("-")[0]?.trim();
  return text || undefined;
}

function mapProjectFileSummary(row: ProjectFileRow): ProjectFileSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    workflowName: row.workflow_name ?? undefined,
    name: row.name,
    type: row.file_type,
    size: row.size_bytes ?? undefined,
    sourceType: (row.source_type as ProjectFileSummary["sourceType"]) ?? "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectFileDetail(row: ProjectFileRow): ProjectFileDetail {
  let contentJson: unknown = undefined;
  if (row.content_json) {
    try {
      contentJson = JSON.parse(row.content_json);
    } catch {
      contentJson = undefined;
    }
  }
  return {
    ...mapProjectFileSummary(row),
    pathRef: row.path_ref ?? undefined,
    contentText: row.content_text ?? undefined,
    contentJson,
  };
}

function normalizeToolPolicy(value: unknown, fallback: AgentNodeToolPolicy): AgentNodeToolPolicy {
  if (value === "disabled" || value === "allowed" || value === "required") {
    return value;
  }
  return fallback;
}

function getDefaultToolPolicyByRole(nodeRole: string): AgentNodeToolPolicy {
  if (nodeRole === "planner" || nodeRole === "input" || nodeRole === "output") {
    return "disabled";
  }
  return "allowed";
}
// ── 凭证加密：AES-256-GCM ──────────────────────────────────────────────────
// 密钥优先读取环境变量 CREDENTIAL_ENCRYPTION_KEY（64 位十六进制字符串 = 32 字节），
// 其次从 .data/credential.key 文件加载（首次运行时自动生成）。
// 加密格式：v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
// 旧 Base64 格式仍可解码（向后兼容）。

const CREDENTIAL_KEY_PATH = resolve(process.cwd(), ".data", "credential.key");

function loadOrCreateEncryptionKey(): Buffer {
  if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
    const hex = process.env.CREDENTIAL_ENCRYPTION_KEY.trim();
    if (hex.length !== 64) {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY 必须是 64 个十六进制字符（32 字节）");
    }
    return Buffer.from(hex, "hex");
  }
  if (existsSync(CREDENTIAL_KEY_PATH)) {
    const hex = readFileSync(CREDENTIAL_KEY_PATH, "utf8").trim();
    if (hex.length === 64) {
      return Buffer.from(hex, "hex");
    }
  }
  const key = randomBytes(32);
  mkdirSync(dirname(CREDENTIAL_KEY_PATH), { recursive: true });
  writeFileSync(CREDENTIAL_KEY_PATH, key.toString("hex"), { encoding: "utf8", mode: 0o600 });
  return key;
}

let _encryptionKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (!_encryptionKey) {
    _encryptionKey = loadOrCreateEncryptionKey();
  }
  return _encryptionKey;
}

function encodeSecret(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decodeSecret(value: string): string {
  if (value.startsWith("v1:")) {
    const parts = value.split(":");
    if (parts.length !== 4) {
      throw new Error("加密凭证格式无效");
    }
    const [, ivHex, authTagHex, cipherHex] = parts;
    const key = getEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
  // 向后兼容：旧版 Base64 格式
  return Buffer.from(value, "base64").toString("utf8");
}

class ConfigService {
  constructor() {
    // Old local DBs can miss columns (e.g. workflow_definition.is_example).
    // We keep bootstrap resilient so API routes don't fail hard on startup.
    try {
      this.pruneLegacyExampleWorkflows();
    } catch (error) {
      console.warn("[ConfigService] pruneLegacyExampleWorkflows skipped:", error);
    }
    try {
      this.ensureTemplateBootstrap();
    } catch (error) {
      console.warn("[ConfigService] ensureTemplateBootstrap skipped:", error);
    }
  }

  private pruneLegacyExampleWorkflows() {
    const exampleWorkflowIds = db
      .prepare("SELECT id FROM workflow_definition WHERE is_example = 1")
      .all() as Array<{ id: string }>;

    if (exampleWorkflowIds.length === 0) {
      return;
    }

    const ids = exampleWorkflowIds.map((item) => item.id);
    const placeholders = ids.map(() => "?").join(", ");

    db.prepare(`DELETE FROM workflow_version WHERE workflow_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM workflow_definition WHERE id IN (${placeholders})`).run(...ids);
  }

  private ensureTemplateBootstrap() {
    this.ensureBuiltinWorkflowTemplates();

    const agentTemplateCountRow = db
      .prepare("SELECT COUNT(1) AS count FROM agent_template")
      .get() as { count: number };
    if (agentTemplateCountRow.count === 0) {
      this.createAgentTemplate({
        name: "通用执行 Agent",
        description: "用于处理主任务的通用 Agent 模板。",
        role: "worker",
        defaultPrompt: "你是一个高可靠执行 Agent，请基于输入输出结构化结果并给出关键结论。",
        taskSummary: "处理任务并返回结构化结果",
        responsibilitySummary: "根据输入执行任务并产出稳定输出",
        enabled: true,
      });
    }
  }

  private ensureBuiltinWorkflowTemplates() {
    for (const seed of BUILTIN_WORKFLOW_TEMPLATE_SEEDS) {
      const exists = db
        .prepare("SELECT id FROM workflow_template WHERE id = ?")
        .get(seed.id) as { id: string } | undefined;
      if (exists) {
        continue;
      }
      this.createWorkflowTemplate({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        rootTaskInput: seed.rootTaskInput,
        nodes: seed.nodes,
        edges: seed.edges,
        tasks: seed.tasks,
        enabled: seed.enabled,
      });
    }
  }

  ensureWorkspaceConfig(): WorkspaceConfig {
    const row = db.prepare("SELECT * FROM workspace_config LIMIT 1").get() as WorkspaceConfigRow | undefined;
    if (row) {
      return toWorkspaceConfig(row);
    }

    const now = nowIso();
    const id = "workspace_default";
    db.prepare(
      `INSERT INTO workspace_config (
        id, name, default_provider, default_model, default_base_url, default_credential_id, default_temperature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, "默认工作区", null, null, null, null, 0.2, now, now);

    const created = db.prepare("SELECT * FROM workspace_config WHERE id = ?").get(id) as WorkspaceConfigRow;
    return toWorkspaceConfig(created);
  }

  updateWorkspaceConfig(payload: Partial<WorkspaceConfig>) {
    const current = this.ensureWorkspaceConfig();
    const next: WorkspaceConfig = {
      ...current,
      name: payload.name ?? current.name,
      defaultProvider: payload.defaultProvider ?? current.defaultProvider,
      defaultModel: payload.defaultModel ?? current.defaultModel,
      defaultBaseUrl: payload.defaultBaseUrl ?? current.defaultBaseUrl,
      defaultCredentialId: payload.defaultCredentialId ?? current.defaultCredentialId,
      defaultTemperature: payload.defaultTemperature ?? current.defaultTemperature,
      updatedAt: nowIso(),
    };

    db.prepare(
      `UPDATE workspace_config SET
        name = ?,
        default_provider = ?,
        default_model = ?,
        default_base_url = ?,
        default_credential_id = ?,
        default_temperature = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      next.name,
      next.defaultProvider ?? null,
      next.defaultModel ?? null,
      next.defaultBaseUrl ?? null,
      next.defaultCredentialId ?? null,
      next.defaultTemperature ?? null,
      next.updatedAt,
      next.id,
    );

    return next;
  }

  listCredentials() {
    const rows = db.prepare("SELECT * FROM secret_credential ORDER BY created_at DESC").all() as CredentialRow[];
    return rows.map(toCredential);
  }

  createCredential(payload: { provider: string; label: string; apiKey: string }) {
    const now = nowIso();
    const credential: SecretCredential = {
      id: makeId("cred"),
      provider: payload.provider,
      label: payload.label,
      encryptedValue: encodeSecret(payload.apiKey),
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(
      `INSERT INTO secret_credential (id, provider, label, encrypted_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      credential.id,
      credential.provider,
      credential.label,
      credential.encryptedValue,
      credential.createdAt,
      credential.updatedAt,
    );

    return credential;
  }

  getCredentialById(credentialId?: string) {
    if (!credentialId) {
      return null;
    }
    const row = db.prepare("SELECT * FROM secret_credential WHERE id = ?").get(credentialId) as CredentialRow | undefined;
    return row ? toCredential(row) : null;
  }

  resolveCredentialApiKey(credentialId?: string) {
    const credential = this.getCredentialById(credentialId);
    if (!credential) {
      return undefined;
    }
    return decodeSecret(credential.encryptedValue);
  }

  ensureNodeConfig(payload: {
    runId: string;
    nodeId: string;
    nodeRole?: string;
    name: string;
    responsibility?: string;
    systemPrompt?: string;
    allowHumanInput: boolean;
  }) {
    const existing = this.getNodeConfig(payload.runId, payload.nodeId);
    if (existing) {
      return existing;
    }

    const defaultToolPolicy = getDefaultToolPolicyByRole(payload.nodeRole ?? "");
    const now = nowIso();
    const id = makeId("node_cfg");
    db.prepare(
      `INSERT INTO node_config (
        id, run_id, node_id, name, description, responsibility, system_prompt, additional_prompt,
        use_workspace_model_default, provider, model, credential_id, base_url, output_path, temperature, allow_human_input, tool_policy,
        execution_mode, workspace_id, entry_file, run_command,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.runId,
      payload.nodeId,
      payload.name,
      null,
      payload.responsibility ?? null,
      payload.systemPrompt ?? null,
      null,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      payload.allowHumanInput ? 1 : 0,
      defaultToolPolicy,
      "standard",
      null,
      null,
      null,
      now,
      now,
    );

    const created = this.getNodeConfig(payload.runId, payload.nodeId);
    if (!created) {
      throw new Error("节点配置创建失败");
    }
    return created;
  }

  getNodeConfig(runId: string, nodeId: string) {
    const row = db.prepare("SELECT * FROM node_config WHERE run_id = ? AND node_id = ?").get(runId, nodeId) as
      | NodeConfigRow
      | undefined;
    return row ? toNodeConfig(row) : null;
  }

  updateNodeConfig(runId: string, nodeId: string, payload: Partial<AgentNodeConfig>) {
    const current = this.getNodeConfig(runId, nodeId);
    if (!current) {
      throw new Error("节点配置不存在");
    }

    const nextToolPolicy = normalizeToolPolicy(payload.toolPolicy, current.toolPolicy);
    const next: AgentNodeConfig = {
      ...current,
      ...payload,
      toolPolicy: nextToolPolicy,
      runId,
      nodeId,
      updatedAt: nowIso(),
    };

    db.prepare(
      `UPDATE node_config SET
        name = ?,
        description = ?,
        responsibility = ?,
        system_prompt = ?,
        additional_prompt = ?,
        use_workspace_model_default = ?,
        provider = ?,
        model = ?,
        credential_id = ?,
        base_url = ?,
        output_path = ?,
        temperature = ?,
        allow_human_input = ?,
        tool_policy = ?,
        execution_mode = ?,
        workspace_id = ?,
        entry_file = ?,
        run_command = ?,
        updated_at = ?
      WHERE run_id = ? AND node_id = ?`,
    ).run(
      next.name,
      next.description ?? null,
      next.responsibility ?? null,
      next.systemPrompt ?? null,
      next.additionalPrompt ?? null,
      next.useWorkspaceModelDefault ? 1 : 0,
      next.provider ?? null,
      next.model ?? null,
      next.credentialId ?? null,
      next.baseUrl ?? null,
      next.outputPath ?? null,
      next.temperature ?? null,
      next.allowHumanInput ? 1 : 0,
      next.toolPolicy,
      next.executionMode ?? "standard",
      next.workspaceId ?? null,
      next.entryFile ?? null,
      next.runCommand ?? null,
      next.updatedAt,
      runId,
      nodeId,
    );

    return next;
  }

  listNodeDocuments(runId: string, nodeId: string) {
    const rows = db
      .prepare("SELECT * FROM agent_document WHERE owner_type = 'node' AND owner_id = ? AND run_id = ? ORDER BY created_at DESC")
      .all(nodeId, runId) as DocumentRow[];
    return rows.map(toDocument);
  }

  createNodeDocument(payload: {
    runId: string;
    nodeId: string;
    type: AgentDocumentType;
    name: string;
    content: string;
  }) {
    const now = nowIso();
    const document: AgentDocument = {
      id: makeId("doc"),
      runId: payload.runId,
      ownerType: "node",
      ownerId: payload.nodeId,
      type: payload.type,
      name: payload.name,
      format: "markdown",
      content: payload.content,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(
      `INSERT INTO agent_document (
        id, run_id, owner_type, owner_id, doc_type, name, format, content, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      document.id,
      document.runId ?? null,
      document.ownerType,
      document.ownerId,
      document.type,
      document.name,
      document.format,
      document.content,
      document.createdAt,
      document.updatedAt,
    );

    return document;
  }

  deleteDocument(documentId: string) {
    const row = db.prepare("SELECT * FROM agent_document WHERE id = ?").get(documentId) as DocumentRow | undefined;
    if (!row) {
      throw new Error("文档不存在");
    }

    db.prepare("DELETE FROM agent_document WHERE id = ?").run(documentId);
    return toDocument(row);
  }

  private normalizeProjectSettings(payload?: Partial<ProjectSettings>): ProjectSettings {
    if (!payload) {
      return {};
    }
    const normalized: ProjectSettings = {};
    if (payload.defaultProvider !== undefined) {
      normalized.defaultProvider = payload.defaultProvider.trim() || undefined;
    }
    if (payload.defaultModel !== undefined) {
      normalized.defaultModel = payload.defaultModel.trim() || undefined;
    }
    if (payload.defaultBaseUrl !== undefined) {
      normalized.defaultBaseUrl = payload.defaultBaseUrl.trim() || undefined;
    }
    if (payload.defaultCredentialId !== undefined) {
      normalized.defaultCredentialId = payload.defaultCredentialId.trim() || undefined;
    }
    if (payload.defaultTemperature !== undefined) {
      normalized.defaultTemperature = Number.isFinite(payload.defaultTemperature) ? payload.defaultTemperature : undefined;
    }
    if (payload.projectNotes !== undefined) {
      normalized.projectNotes = payload.projectNotes.trim() || undefined;
    }
    return normalized;
  }

  private toProjectSettings(row: ProjectRow): ProjectSettings {
    return {
      defaultProvider: row.default_provider ?? undefined,
      defaultModel: row.default_model ?? undefined,
      defaultBaseUrl: row.default_base_url ?? undefined,
      defaultCredentialId: row.default_credential_id ?? undefined,
      defaultTemperature: row.default_temperature ?? undefined,
      projectNotes: row.project_notes ?? undefined,
    };
  }

  private mergeProjectSettingsWithWorkspace(projectSettings: ProjectSettings): ProjectSettings {
    const workspace = this.ensureWorkspaceConfig();
    return {
      defaultProvider: projectSettings.defaultProvider ?? workspace.defaultProvider ?? undefined,
      defaultModel: projectSettings.defaultModel ?? workspace.defaultModel ?? undefined,
      defaultBaseUrl: projectSettings.defaultBaseUrl ?? workspace.defaultBaseUrl ?? undefined,
      defaultCredentialId: projectSettings.defaultCredentialId ?? workspace.defaultCredentialId ?? undefined,
      defaultTemperature: projectSettings.defaultTemperature ?? workspace.defaultTemperature ?? undefined,
      projectNotes: projectSettings.projectNotes,
    };
  }

  private toProjectSummary(row: ProjectRow): ProjectSummary {
    const settings = this.toProjectSettings(row);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      settings,
      effectiveSettings: this.mergeProjectSettingsWithWorkspace(settings),
      archivedAt: row.archived_at ?? undefined,
      settingsUpdatedAt: row.settings_updated_at ?? undefined,
      workflowCount: row.workflow_count ?? 0,
      runCount: row.run_count ?? 0,
      fileCount: row.file_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listProjects(options?: { includeArchived?: boolean }): ProjectSummary[] {
    const includeArchived = options?.includeArchived === true;
    const rows = db
      .prepare(
        `SELECT
          p.*,
          (SELECT COUNT(1) FROM workflow_definition w WHERE w.project_id = p.id) AS workflow_count,
          (SELECT COUNT(1) FROM run_snapshot rs INNER JOIN workflow_definition w ON w.id = rs.workflow_id WHERE w.project_id = p.id) AS run_count,
          (SELECT COUNT(1) FROM project_file pf WHERE pf.project_id = p.id) AS file_count
        FROM project p
        ${includeArchived ? "" : "WHERE p.archived_at IS NULL"}
        ORDER BY p.updated_at DESC`,
      )
      .all() as ProjectRow[];
    return rows.map((row) => this.toProjectSummary(row));
  }

  getProject(projectId: string): ProjectSummary | null {
    const row = db
      .prepare(
        `SELECT
          p.*,
          (SELECT COUNT(1) FROM workflow_definition w WHERE w.project_id = p.id) AS workflow_count,
          (SELECT COUNT(1) FROM run_snapshot rs INNER JOIN workflow_definition w ON w.id = rs.workflow_id WHERE w.project_id = p.id) AS run_count,
          (SELECT COUNT(1) FROM project_file pf WHERE pf.project_id = p.id) AS file_count
        FROM project p
        WHERE p.id = ?`,
      )
      .get(projectId) as ProjectRow | undefined;
    return row ? this.toProjectSummary(row) : null;
  }

  createProject(payload: { name: string; description?: string }) {
    const now = nowIso();
    const project: ProjectSummary = {
      id: makeId("proj"),
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      settings: {},
      archivedAt: undefined,
      settingsUpdatedAt: now,
      workflowCount: 0,
      runCount: 0,
      fileCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(
      `INSERT INTO project (
        id, name, description,
        default_provider, default_model, default_base_url, default_credential_id, default_temperature, project_notes,
        archived_at, settings_updated_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      project.name,
      project.description ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      project.settingsUpdatedAt ?? now,
      project.createdAt,
      project.updatedAt,
    );

    return project;
  }

  updateProject(
    projectId: string,
    payload: {
      name?: string;
      description?: string;
      settings?: Partial<ProjectSettings>;
      archived?: boolean;
    },
  ) {
    const existing = this.getProject(projectId);
    if (!existing) {
      throw new Error("项目不存在");
    }

    const nextName = payload.name !== undefined ? payload.name.trim() : existing.name;
    if (!nextName) {
      throw new Error("项目名称不能为空");
    }

    const hasDescription = payload.description !== undefined;
    const nextDescription = hasDescription ? payload.description?.trim() || undefined : existing.description;
    const hasSettings = payload.settings !== undefined;
    const normalizedSettings = hasSettings ? this.normalizeProjectSettings(payload.settings) : {};
    const nextSettings: ProjectSettings = hasSettings
      ? {
          ...existing.settings,
          ...normalizedSettings,
        }
      : existing.settings;

    if (nextSettings.defaultTemperature !== undefined) {
      if (nextSettings.defaultTemperature < 0 || nextSettings.defaultTemperature > 2) {
        throw new Error("默认温度需在 0 到 2 之间");
      }
    }

    const now = nowIso();
    const nextArchivedAt =
      payload.archived === undefined
        ? existing.archivedAt
        : payload.archived
          ? (existing.archivedAt ?? now)
          : undefined;
    const settingsUpdatedAt = hasSettings ? now : existing.settingsUpdatedAt ?? now;

    db.prepare(
      `UPDATE project
       SET
        name = ?,
        description = ?,
        default_provider = ?,
        default_model = ?,
        default_base_url = ?,
        default_credential_id = ?,
        default_temperature = ?,
        project_notes = ?,
        archived_at = ?,
        settings_updated_at = ?,
        updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      nextDescription ?? null,
      nextSettings.defaultProvider ?? null,
      nextSettings.defaultModel ?? null,
      nextSettings.defaultBaseUrl ?? null,
      nextSettings.defaultCredentialId ?? null,
      nextSettings.defaultTemperature ?? null,
      nextSettings.projectNotes ?? null,
      nextArchivedAt ?? null,
      settingsUpdatedAt,
      now,
      projectId,
    );

    const updated = this.getProject(projectId);
    if (!updated) {
      throw new Error("项目不存在");
    }
    return updated;
  }

  listModelAssets() {
    const rows = db
      .prepare("SELECT * FROM model_asset ORDER BY updated_at DESC")
      .all() as ModelAssetRow[];
    return rows.map(toModelAsset);
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
    if (payload.credentialId) {
      const credential = this.getCredentialById(payload.credentialId);
      if (!credential) {
        throw new Error("凭证不存在");
      }
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
    return toModelAsset(row);
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
    if (nextCredentialId) {
      const credential = this.getCredentialById(nextCredentialId);
      if (!credential) {
        throw new Error("凭证不存在");
      }
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
    return toModelAsset(updated);
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
    return rows.map(toPromptTemplateAsset);
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
    const templateType = normalizePromptTemplateType(payload.templateType);
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
    return toPromptTemplateAsset(row);
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
      payload.templateType !== undefined ? normalizePromptTemplateType(payload.templateType) : row.template_type,
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
    return toPromptTemplateAsset(updated);
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
    this.ensureBuiltinWorkflowTemplates();
    const rows = db
      .prepare("SELECT * FROM workflow_template ORDER BY updated_at DESC")
      .all() as WorkflowTemplateRow[];
    return rows.map(toWorkflowTemplateAsset);
  }

  getWorkflowTemplate(templateId: string) {
    this.ensureBuiltinWorkflowTemplates();
    const row = db
      .prepare("SELECT * FROM workflow_template WHERE id = ?")
      .get(templateId) as WorkflowTemplateRow | undefined;
    return row ? toWorkflowTemplateAsset(row) : null;
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
    return toWorkflowTemplateAsset(row);
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
    return toWorkflowTemplateAsset(updated);
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
    const rows = db
      .prepare("SELECT * FROM agent_template ORDER BY updated_at DESC")
      .all() as AgentTemplateRow[];
    return rows.map(toAgentTemplateAsset);
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
    return toAgentTemplateAsset(row);
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
    return toAgentTemplateAsset(updated);
  }

  deleteAgentTemplate(templateId: string) {
    const row = db.prepare("SELECT * FROM agent_template WHERE id = ?").get(templateId) as AgentTemplateRow | undefined;
    if (!row) {
      throw new Error("Agent 模板不存在");
    }
    db.prepare("DELETE FROM agent_template WHERE id = ?").run(templateId);
    return { id: templateId };
  }

  listWorkflowAssetReferences(options?: {
    workflowId?: string;
    assetType?: "tool" | "model" | "prompt_template";
  }) {
    if (options?.workflowId && options?.assetType) {
      const rows = db
        .prepare(
          "SELECT * FROM workflow_asset_reference WHERE workflow_id = ? AND asset_type = ? ORDER BY updated_at DESC",
        )
        .all(options.workflowId, options.assetType) as WorkflowAssetReferenceRow[];
      return rows.map(toWorkflowAssetReference);
    }
    if (options?.workflowId) {
      const rows = db
        .prepare("SELECT * FROM workflow_asset_reference WHERE workflow_id = ? ORDER BY updated_at DESC")
        .all(options.workflowId) as WorkflowAssetReferenceRow[];
      return rows.map(toWorkflowAssetReference);
    }
    if (options?.assetType) {
      const rows = db
        .prepare("SELECT * FROM workflow_asset_reference WHERE asset_type = ? ORDER BY updated_at DESC")
        .all(options.assetType) as WorkflowAssetReferenceRow[];
      return rows.map(toWorkflowAssetReference);
    }
    const rows = db
      .prepare("SELECT * FROM workflow_asset_reference ORDER BY updated_at DESC")
      .all() as WorkflowAssetReferenceRow[];
    return rows.map(toWorkflowAssetReference);
  }

  private assertAssetExists(assetType: "tool" | "model" | "prompt_template", assetId: string) {
    if (assetType === "tool") {
      const exists = db.prepare("SELECT id FROM tool_definition WHERE id = ?").get(assetId) as { id: string } | undefined;
      if (!exists) {
        throw new Error("工具资产不存在");
      }
      return;
    }
    if (assetType === "model") {
      const exists = db.prepare("SELECT id FROM model_asset WHERE id = ?").get(assetId) as { id: string } | undefined;
      if (!exists) {
        throw new Error("模型资产不存在");
      }
      return;
    }
    const exists = db
      .prepare("SELECT id FROM prompt_template_asset WHERE id = ?")
      .get(assetId) as { id: string } | undefined;
    if (!exists) {
      throw new Error("Prompt 模板不存在");
    }
  }

  upsertWorkflowAssetReference(payload: {
    workflowId: string;
    assetType: "tool" | "model" | "prompt_template";
    assetId: string;
  }) {
    const workflow = db
      .prepare("SELECT id FROM workflow_definition WHERE id = ?")
      .get(payload.workflowId) as { id: string } | undefined;
    if (!workflow) {
      throw new Error("工作流不存在");
    }
    this.assertAssetExists(payload.assetType, payload.assetId);

    const now = nowIso();
    const existing = db
      .prepare(
        "SELECT * FROM workflow_asset_reference WHERE workflow_id = ? AND asset_type = ? AND asset_id = ?",
      )
      .get(payload.workflowId, payload.assetType, payload.assetId) as WorkflowAssetReferenceRow | undefined;
    const id = existing?.id ?? makeId("wf_asset_ref");
    db.prepare(
      `INSERT INTO workflow_asset_reference (
        id, workflow_id, asset_type, asset_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id, asset_type, asset_id) DO UPDATE SET
        updated_at = excluded.updated_at`,
    ).run(id, payload.workflowId, payload.assetType, payload.assetId, existing?.created_at ?? now, now);

    const row = db
      .prepare("SELECT * FROM workflow_asset_reference WHERE id = ?")
      .get(id) as WorkflowAssetReferenceRow | undefined;
    if (!row) {
      throw new Error("创建资产引用失败");
    }
    return toWorkflowAssetReference(row);
  }

  deleteWorkflowAssetReference(referenceId: string) {
    const row = db
      .prepare("SELECT * FROM workflow_asset_reference WHERE id = ?")
      .get(referenceId) as WorkflowAssetReferenceRow | undefined;
    if (!row) {
      throw new Error("资产引用不存在");
    }
    db.prepare("DELETE FROM workflow_asset_reference WHERE id = ?").run(referenceId);
    return { id: referenceId };
  }

  deleteWorkflowAssetReferencesByAsset(assetType: "tool" | "model" | "prompt_template", assetId: string) {
    const refs = this.listWorkflowAssetReferences({ assetType }).filter((item) => item.assetId === assetId);
    db.prepare("DELETE FROM workflow_asset_reference WHERE asset_type = ? AND asset_id = ?").run(assetType, assetId);
    return refs;
  }

  // ── Script Asset CRUD ──

  listScriptAssets() {
    const rows = db
      .prepare("SELECT * FROM script_asset ORDER BY updated_at DESC")
      .all() as ScriptAssetRow[];
    return rows.map(toScriptAsset);
  }

  getScriptAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(assetId) as ScriptAssetRow | undefined;
    return row ? toScriptAsset(row) : null;
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
    if (!row) throw new Error("创建脚本资产失败");
    return toScriptAsset(row);
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
    if (!row) throw new Error("脚本资产不存在");

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
    if (!updated) throw new Error("脚本资产不存在");
    return toScriptAsset(updated);
  }

  deleteScriptAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM script_asset WHERE id = ?").get(assetId) as ScriptAssetRow | undefined;
    if (!row) throw new Error("脚本资产不存在");
    // Cascade: delete skills that reference this script, their bindings, and asset references
    const skills = db.prepare("SELECT id FROM skill_asset WHERE script_id = ?").all(assetId) as { id: string }[];
    for (const skill of skills) {
      db.prepare("DELETE FROM skill_binding WHERE skill_id = ?").run(skill.id);
    }
    db.prepare("DELETE FROM skill_asset WHERE script_id = ?").run(assetId);
    db.prepare("DELETE FROM script_asset WHERE id = ?").run(assetId);
    return { id: assetId };
  }

  // ── Skill Asset CRUD ──

  listSkillAssets() {
    const rows = db
      .prepare("SELECT * FROM skill_asset ORDER BY updated_at DESC")
      .all() as SkillAssetRow[];
    return rows.map(toSkillAsset);
  }

  getSkillAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    return row ? toSkillAsset(row) : null;
  }

  createSkillAsset(payload: {
    name: string;
    scriptId: string;
    description?: string;
    parameterMapping?: Record<string, string>;
    outputDescription?: string;
    enabled?: boolean;
  }) {
    const name = payload.name.trim();
    const scriptId = payload.scriptId.trim();
    if (!name || !scriptId) {
      throw new Error("技能资产名称和绑定脚本不能为空");
    }
    // Verify script exists
    const script = db.prepare("SELECT id FROM script_asset WHERE id = ?").get(scriptId) as { id: string } | undefined;
    if (!script) throw new Error("绑定的脚本资产不存在");

    const now = nowIso();
    const id = makeId("asset_skill");
    db.prepare(
      `INSERT INTO skill_asset (
        id, name, description, script_id, parameter_mapping, output_description,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      payload.description?.trim() || null,
      scriptId,
      JSON.stringify(payload.parameterMapping ?? {}),
      payload.outputDescription?.trim() || null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(id) as SkillAssetRow | undefined;
    if (!row) throw new Error("创建技能资产失败");
    return toSkillAsset(row);
  }

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
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    if (!row) throw new Error("技能资产不存在");

    const nextName = payload.name !== undefined ? payload.name.trim() : row.name;
    const nextScriptId = payload.scriptId !== undefined ? payload.scriptId.trim() : row.script_id;
    if (!nextName || !nextScriptId) {
      throw new Error("技能资产名称和绑定脚本不能为空");
    }
    if (payload.scriptId !== undefined) {
      const script = db.prepare("SELECT id FROM script_asset WHERE id = ?").get(nextScriptId) as { id: string } | undefined;
      if (!script) throw new Error("绑定的脚本资产不存在");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE skill_asset
       SET name = ?, description = ?, script_id = ?, parameter_mapping = ?,
           output_description = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      nextName,
      payload.description !== undefined ? payload.description.trim() || null : row.description,
      nextScriptId,
      payload.parameterMapping !== undefined ? JSON.stringify(payload.parameterMapping) : row.parameter_mapping,
      payload.outputDescription !== undefined ? payload.outputDescription.trim() || null : row.output_description,
      payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : row.enabled,
      now,
      assetId,
    );
    const updated = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    if (!updated) throw new Error("技能资产不存在");
    return toSkillAsset(updated);
  }

  deleteSkillAsset(assetId: string) {
    const row = db.prepare("SELECT * FROM skill_asset WHERE id = ?").get(assetId) as SkillAssetRow | undefined;
    if (!row) throw new Error("技能资产不存在");
    db.prepare("DELETE FROM skill_binding WHERE skill_id = ?").run(assetId);
    db.prepare("DELETE FROM skill_asset WHERE id = ?").run(assetId);
    return { id: assetId };
  }

  // ── Skill Binding CRUD ──

  listSkillBindings(runId: string, nodeId: string) {
    const rows = db
      .prepare("SELECT * FROM skill_binding WHERE run_id = ? AND node_id = ? ORDER BY created_at DESC")
      .all(runId, nodeId) as SkillBindingRow[];
    return rows.map(toSkillBinding);
  }

  upsertSkillBinding(runId: string, nodeId: string, skillId: string, enabled: boolean) {
    const now = nowIso();
    const existing = db
      .prepare("SELECT * FROM skill_binding WHERE run_id = ? AND node_id = ? AND skill_id = ?")
      .get(runId, nodeId, skillId) as SkillBindingRow | undefined;

    if (existing) {
      db.prepare("UPDATE skill_binding SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, now, existing.id);
      const row = db.prepare("SELECT * FROM skill_binding WHERE id = ?").get(existing.id) as SkillBindingRow;
      return toSkillBinding(row);
    }

    const id = makeId("skill_bind");
    db.prepare(
      `INSERT INTO skill_binding (id, node_id, run_id, skill_id, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, nodeId, runId, skillId, enabled ? 1 : 0, now, now);
    const row = db.prepare("SELECT * FROM skill_binding WHERE id = ?").get(id) as SkillBindingRow;
    return toSkillBinding(row);
  }

  deleteSkillBinding(bindingId: string) {
    const row = db.prepare("SELECT * FROM skill_binding WHERE id = ?").get(bindingId) as SkillBindingRow | undefined;
    if (!row) throw new Error("技能绑定不存在");
    db.prepare("DELETE FROM skill_binding WHERE id = ?").run(bindingId);
    return { id: bindingId };
  }

  resolveNodeSkills(runId: string, nodeId: string): ResolvedNodeSkill[] {
    const bindings = this.listSkillBindings(runId, nodeId).filter((b) => b.enabled);
    const results: ResolvedNodeSkill[] = [];
    for (const binding of bindings) {
      const skill = this.getSkillAsset(binding.skillId);
      if (!skill || !skill.enabled) continue;
      const script = this.getScriptAsset(skill.scriptId);
      if (!script || !script.enabled) continue;
      results.push({ skill, script });
    }
    return results;
  }

  private upsertProjectFile(payload: {
    id: string;
    projectId: string;
    runId?: string;
    workflowId?: string;
    workflowName?: string;
    name: string;
    type: string;
    size?: number;
    sourceType: ProjectFileSummary["sourceType"];
    contentText?: string;
    contentJson?: unknown;
    pathRef?: string;
  }) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO project_file (
        id, project_id, run_id, workflow_id, workflow_name, name, file_type, size_bytes, source_type,
        content_text, content_json, path_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        run_id = excluded.run_id,
        workflow_id = excluded.workflow_id,
        workflow_name = excluded.workflow_name,
        name = excluded.name,
        file_type = excluded.file_type,
        size_bytes = excluded.size_bytes,
        source_type = excluded.source_type,
        content_text = excluded.content_text,
        content_json = excluded.content_json,
        path_ref = excluded.path_ref,
        updated_at = excluded.updated_at`,
    ).run(
      payload.id,
      payload.projectId,
      payload.runId ?? null,
      payload.workflowId ?? null,
      payload.workflowName ?? null,
      payload.name,
      payload.type,
      payload.size ?? null,
      payload.sourceType,
      payload.contentText ?? null,
      payload.contentJson !== undefined ? JSON.stringify(payload.contentJson) : null,
      payload.pathRef ?? null,
      now,
      now,
    );

    const row = db.prepare("SELECT * FROM project_file WHERE id = ?").get(payload.id) as ProjectFileRow | undefined;
    if (!row) {
      throw new Error("项目文件保存失败");
    }
    return mapProjectFileSummary(row);
  }

  registerRunArtifacts(runId: string): ProjectFileSummary[] {
    const row = db
      .prepare(
        `SELECT
          rs.run_id,
          rs.workflow_id,
          rs.output,
          rs.error,
          rs.finished_at,
          rs.created_at,
          wf.project_id,
          wf.name AS workflow_name
        FROM run_snapshot rs
        LEFT JOIN workflow_definition wf ON wf.id = rs.workflow_id
        WHERE rs.run_id = ?
        LIMIT 1`,
      )
      .get(runId) as
      | {
          run_id: string;
          workflow_id: string | null;
          output: string | null;
          error: string | null;
          finished_at: string | null;
          created_at: string;
          project_id: string | null;
          workflow_name: string | null;
        }
      | undefined;

    if (!row || !row.project_id) {
      return [];
    }

    const artifacts: ProjectFileSummary[] = [];
    const output = row.output?.trim();
    if (output) {
      let outputJson: unknown = undefined;
      try {
        outputJson = JSON.parse(output);
      } catch {
        outputJson = undefined;
      }
      const fileType = outputJson !== undefined ? "json" : "txt";
      const ext = fileType === "json" ? "json" : "txt";
      const summary = this.upsertProjectFile({
        id: `file_${runId}_output`,
        projectId: row.project_id,
        runId,
        workflowId: row.workflow_id ?? undefined,
        workflowName: row.workflow_name ?? undefined,
        name: `运行输出-${runId.slice(-6)}.${ext}`,
        type: fileType,
        size: Buffer.byteLength(output, "utf8"),
        sourceType: "run_output",
        contentText: output,
        contentJson: outputJson,
      });
      artifacts.push(summary);
    }

    const error = row.error?.trim();
    if (error) {
      const summary = this.upsertProjectFile({
        id: `file_${runId}_error`,
        projectId: row.project_id,
        runId,
        workflowId: row.workflow_id ?? undefined,
        workflowName: row.workflow_name ?? undefined,
        name: `运行日志-${runId.slice(-6)}.log`,
        type: "log",
        size: Buffer.byteLength(error, "utf8"),
        sourceType: "run_output",
        contentText: error,
      });
      artifacts.push(summary);
    }

    return artifacts;
  }

  private listRunArtifacts(projectId: string, runId: string): ProjectFileSummary[] {
    const rows = db
      .prepare(
        `SELECT *
         FROM project_file
         WHERE project_id = ? AND run_id = ?
         ORDER BY created_at DESC`,
      )
      .all(projectId, runId) as ProjectFileRow[];
    return rows.map(mapProjectFileSummary);
  }

  listProjectFiles(projectId: string, limit = 200): ProjectFileSummary[] {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const rows = db
      .prepare(
        `SELECT *
         FROM project_file
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(projectId, safeLimit) as ProjectFileRow[];
    return rows.map(mapProjectFileSummary);
  }

  getProjectFile(projectId: string, fileId: string): ProjectFileDetail | null {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    const row = db
      .prepare(
        `SELECT *
         FROM project_file
         WHERE id = ? AND project_id = ?
         LIMIT 1`,
      )
      .get(fileId, projectId) as ProjectFileRow | undefined;
    return row ? mapProjectFileDetail(row) : null;
  }

  listRecentFiles(limit = 10): ProjectFileSummary[] {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = db
      .prepare(
        `SELECT *
         FROM project_file
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(safeLimit) as ProjectFileRow[];
    return rows.map(mapProjectFileSummary);
  }

  getProjectRunDetail(projectId: string, runId: string): ProjectRunDetail | null {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }

    this.registerRunArtifacts(runId);

    const row = db
      .prepare(
        `SELECT
          rs.run_id,
          rs.status,
          rs.root_task_id,
          rs.workflow_id,
          rs.started_at,
          rs.finished_at,
          rs.created_at,
          rs.output,
          rs.error,
          wf.name AS workflow_name,
          wf.project_id,
          COALESCE(tokens.prompt_tokens, 0) AS prompt_tokens,
          COALESCE(tokens.completion_tokens, 0) AS completion_tokens,
          COALESCE(tokens.total_tokens, 0) AS total_tokens,
          COALESCE(tokens.token_usage_rows, 0) AS token_usage_rows
        FROM run_snapshot rs
        INNER JOIN workflow_definition wf ON wf.id = rs.workflow_id
        LEFT JOIN (
          SELECT
            run_id,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.prompt_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.prompt_tokens') AS INTEGER),
              0
            )) AS prompt_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.completion_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completion_tokens') AS INTEGER),
              0
            )) AS completion_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.total_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.total_tokens') AS INTEGER),
              0
            )) AS total_tokens,
            SUM(CASE
              WHEN json_extract(payload_json, '$.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.total_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.total_tokens') IS NOT NULL
              THEN 1 ELSE 0
            END) AS token_usage_rows
          FROM run_event
          WHERE type = 'llm_response_received'
          GROUP BY run_id
        ) tokens ON tokens.run_id = rs.run_id
        WHERE rs.run_id = ? AND wf.project_id = ?
        LIMIT 1`,
      )
      .get(runId, projectId) as RunSnapshotRow | undefined;

    if (!row) {
      return null;
    }

    const rootTask = db
      .prepare("SELECT id, title, summary FROM run_task WHERE run_id = ? AND id = ? LIMIT 1")
      .get(runId, row.root_task_id) as RunTaskRow | undefined;

    const eventRows = db
      .prepare(
        `SELECT id, type, timestamp, run_event_seq, related_node_id, related_task_id, message, payload_json
         FROM run_event
         WHERE run_id = ?
         ORDER BY run_event_seq ASC`,
      )
      .all(runId) as RunEventRow[];

    const logs: RunDetailLogItem[] = eventRows.map((event) => ({
      id: event.id,
      type: event.type,
      level: normalizeRunLogLevel(event.type),
      time: event.timestamp,
      seq: event.run_event_seq ?? undefined,
      message: event.message,
      payload: parseEventPayload(event.payload_json),
      nodeId: event.related_node_id ?? undefined,
      taskId: event.related_task_id ?? undefined,
    }));

    if (logs.length === 0) {
      logs.push({
        id: `${runId}_created`,
        type: "run_created",
        level: "info",
        time: row.created_at,
        message: "运行已创建",
      });
      if (row.started_at) {
        logs.push({
          id: `${runId}_started`,
          type: "run_started",
          level: "info",
          time: row.started_at,
          message: "运行已启动",
        });
      }
      if (row.finished_at) {
        logs.push({
          id: `${runId}_finished`,
          type: row.status === "failed" ? "run_failed" : "run_completed",
          level: row.status === "failed" ? "error" : "info",
          time: row.finished_at,
          message: row.status === "failed" ? "运行失败" : "运行完成",
        });
      }
    }

    const nodeRows = db
      .prepare(
        `SELECT
          id,
          name,
          role,
          status,
          agent_definition_id,
          context_id,
          execution_order,
          latest_input,
          latest_output,
          resolved_input,
          created_at,
          updated_at,
          error,
          blocked_reason
         FROM run_node
         WHERE run_id = ?
         ORDER BY CASE WHEN execution_order IS NULL THEN 1 ELSE 0 END, execution_order ASC, created_at ASC`,
      )
      .all(runId) as RunNodeExecutionRow[];

    const definitionRows = db
      .prepare(
        `SELECT
          id,
          run_id,
          name,
          role,
          system_prompt,
          responsibility,
          input_schema,
          output_schema,
          allow_human_input,
          model,
          temperature,
          provider,
          created_at,
          updated_at
         FROM run_agent_definition
         WHERE run_id = ?`,
      )
      .all(runId) as RunAgentDefinitionRow[];

    const contextRows = db
      .prepare(
        `SELECT
          id,
          node_id,
          run_id,
          system_prompt,
          task_brief,
          inbound_messages_json,
          outbound_messages_json,
          resolved_input,
          human_messages_json,
          recent_outputs_json,
          latest_summary,
          updated_at
         FROM run_agent_context
         WHERE run_id = ?`,
      )
      .all(runId) as RunAgentContextRow[];

    const definitionById = new Map<string, RunAgentDefinitionRow>(definitionRows.map((item) => [item.id, item]));
    const contextByNodeId = new Map<string, RunAgentContextRow>(contextRows.map((item) => [item.node_id, item]));

    const eventsByNode = new Map<string, RunEventRow[]>();
    for (const event of eventRows) {
      if (!event.related_node_id) {
        continue;
      }
      const list = eventsByNode.get(event.related_node_id) ?? [];
      list.push(event);
      eventsByNode.set(event.related_node_id, list);
    }

    const runStartedAt = row.started_at ?? row.created_at;
    const runStartedMs = new Date(runStartedAt).getTime();
    const runFinished = Boolean(row.finished_at);
    const runFinalStatus = normalizeRunStatus(row.status);

    const nodeTraces: RunNodeTrace[] = nodeRows.map((node) => {
      const nodeEvents = eventsByNode.get(node.id) ?? [];
      const startedAt = nodeEvents.find((event) => event.type === "node_started")?.timestamp ?? node.created_at;
      const finishedAt =
        nodeEvents.find((event) => event.type === "node_completed")?.timestamp
        ?? nodeEvents.find((event) => event.type === "node_failed")?.timestamp
        ?? (node.status === "running"
          ? (runFinished ? (row.finished_at ?? node.updated_at) : undefined)
          : node.updated_at);
      const durationMs = diffMs(startedAt, finishedAt);
      const tokenAggregate = nodeEvents.reduce(
        (acc, event) => {
          if (event.type !== "llm_response_received") {
            return acc;
          }
          const usage = getTokenUsageFromPayload(parseEventPayload(event.payload_json));
          return {
            promptTokens: acc.promptTokens + usage.promptTokens,
            completionTokens: acc.completionTokens + usage.completionTokens,
            totalTokens: acc.totalTokens + usage.totalTokens,
            tokenUsageAvailable: acc.tokenUsageAvailable || usage.tokenUsageAvailable,
          };
        },
        {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          tokenUsageAvailable: false,
        },
      );
      const failedEvent = [...nodeEvents].reverse().find((event) => event.type === "node_failed");

      const definition = definitionById.get(node.agent_definition_id);
      const context = contextByNodeId.get(node.id);

      const requestEvent = [...nodeEvents].reverse().find((event) => event.type === "llm_request_sent");
      const responseEvent = [...nodeEvents].reverse().find((event) => event.type === "llm_response_received");
      const requestPayload = parseEventPayload(requestEvent?.payload_json ?? null);
      const responsePayload = parseEventPayload(responseEvent?.payload_json ?? null);
      const promptTracePayload = toRecordValue(requestPayload?.promptTrace);
      const promptTraceMessageHistoryRaw = promptTracePayload?.messageHistory;
      const promptTraceMessageHistory = Array.isArray(promptTraceMessageHistoryRaw)
        ? promptTraceMessageHistoryRaw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        : [];
      const inboundMessages = parseJsonArray(context?.inbound_messages_json);

      const promptTrace: RunPromptTrace | undefined = requestEvent || responseEvent
        ? {
            provider: toTextValue(requestPayload?.provider) ?? toTextValue(responsePayload?.provider) ?? definition?.provider ?? undefined,
            model: toTextValue(requestPayload?.model) ?? toTextValue(responsePayload?.model) ?? definition?.model ?? undefined,
            requestPath: toTextValue(requestPayload?.requestPath) ?? toTextValue(responsePayload?.requestPath),
            systemPrompt:
              excerpt(toTextValue(promptTracePayload?.systemPrompt))
              ?? excerpt(toTextValue(context?.system_prompt))
              ?? excerpt(toTextValue(definition?.system_prompt)),
            userPrompt:
              excerpt(toTextValue(promptTracePayload?.userPrompt))
              ?? excerpt(toTextValue(node.latest_input))
              ?? excerpt(toTextValue(node.resolved_input))
              ?? excerpt(toTextValue(context?.resolved_input)),
            messageHistory: promptTraceMessageHistory.length > 0
              ? promptTraceMessageHistory.map((item) => ({
                  id: toTextValue(item.id),
                  fromNodeId: toTextValue(item.fromNodeId),
                  toNodeId: toTextValue(item.toNodeId),
                  type: toTextValue(item.type),
                  content: excerpt(toTextValue(item.content), 800),
                  createdAt: toTextValue(item.createdAt),
                }))
              : inboundMessages.map((item) => ({
                  id: toTextValue(item.id),
                  fromNodeId: toTextValue(item.fromNodeId),
                  toNodeId: toTextValue(item.toNodeId),
                  type: toTextValue(item.type),
                  content: excerpt(toTextValue(item.content), 800),
                  createdAt: toTextValue(item.createdAt),
                })),
            completion:
              excerpt(toTextValue(responsePayload?.completion))
              ?? excerpt(toTextValue(node.latest_output))
              ?? excerpt(toTextValue(responsePayload?.rawBodySummary), 1000),
            promptTokens: tokenAggregate.tokenUsageAvailable ? tokenAggregate.promptTokens : undefined,
            completionTokens: tokenAggregate.tokenUsageAvailable ? tokenAggregate.completionTokens : undefined,
            totalTokens: tokenAggregate.tokenUsageAvailable ? tokenAggregate.totalTokens : undefined,
            tokenUsageAvailable: tokenAggregate.tokenUsageAvailable,
          }
        : undefined;

      const toolCalls: RunToolCallTrace[] = [];
      const pendingByToolId = new Map<string, number[]>();
      for (const event of nodeEvents) {
        if (
          event.type !== "tool_invocation_started"
          && event.type !== "tool_invocation_succeeded"
          && event.type !== "tool_invocation_failed"
        ) {
          continue;
        }
        const payload = parseEventPayload(event.payload_json);
        const toolId = toTextValue(payload?.toolId);
        const toolName = toTextValue(payload?.toolName) ?? extractToolName(event.message);
        if (event.type === "tool_invocation_started") {
          const trace: RunToolCallTrace = {
            id: event.id,
            nodeId: node.id,
            nodeName: node.name,
            toolId,
            toolName,
            status: "running",
            startedAt: event.timestamp,
            input: toRecordValue(payload?.input),
          };
          toolCalls.push(trace);
          if (toolId) {
            const queue = pendingByToolId.get(toolId) ?? [];
            queue.push(toolCalls.length - 1);
            pendingByToolId.set(toolId, queue);
          }
          continue;
        }

        const isSuccess = event.type === "tool_invocation_succeeded";
        let targetIndex = -1;
        if (toolId) {
          const queue = pendingByToolId.get(toolId);
          if (queue && queue.length > 0) {
            targetIndex = queue.shift() as number;
          }
        }

        const outputValue = toRecordValue(payload?.output) ?? toRecordValue(payload?.data) ?? toRecordValue(payload?.meta);
        const durationMsFromPayload = toNumberValue(payload?.durationMs);
        const errorPayload = toRecordValue(payload?.error);
        const errorMessage = toTextValue(errorPayload?.message) ?? (isSuccess ? undefined : event.message);

        if (targetIndex >= 0) {
          const current = toolCalls[targetIndex];
          toolCalls[targetIndex] = {
            ...current,
            toolId: toolId ?? current.toolId,
            toolName: toolName ?? current.toolName,
            finishedAt: event.timestamp,
            durationMs: durationMsFromPayload ?? current.durationMs ?? diffMs(current.startedAt, event.timestamp),
            output: outputValue ?? current.output,
            error: errorMessage ?? current.error,
            status: isSuccess ? "success" : "failed",
          };
        } else {
          toolCalls.push({
            id: event.id,
            nodeId: node.id,
            nodeName: node.name,
            toolId,
            toolName,
            status: isSuccess ? "success" : "failed",
            finishedAt: event.timestamp,
            durationMs: durationMsFromPayload,
            output: outputValue,
            error: errorMessage,
          });
        }
      }

      return {
        nodeId: node.id,
        name: node.name,
        role: node.role,
        status: (runFinished && node.status === "running")
          ? runFinalStatus
          : normalizeNodeRunStatus(node.status),
        startedAt,
        finishedAt,
        durationMs,
        inputSnapshot:
          excerpt(toTextValue(node.latest_input))
          ?? excerpt(toTextValue(node.resolved_input))
          ?? excerpt(toTextValue(context?.resolved_input)),
        outputSnapshot:
          excerpt(toTextValue(node.latest_output))
          ?? excerpt(toTextValue(context?.latest_summary)),
        error: node.error ?? node.blocked_reason ?? failedEvent?.message ?? undefined,
        promptTrace,
        toolCalls,
      };
    });

    const nodeExecutions = nodeTraces.map((node) => ({
      nodeId: node.nodeId,
      name: node.name,
      role: node.role,
      status: node.status,
      startedAt: node.startedAt,
      finishedAt: node.finishedAt,
      durationMs: node.durationMs,
      promptTokens: node.promptTrace?.tokenUsageAvailable ? node.promptTrace.promptTokens : undefined,
      completionTokens: node.promptTrace?.tokenUsageAvailable ? node.promptTrace.completionTokens : undefined,
      totalTokens: node.promptTrace?.tokenUsageAvailable ? node.promptTrace.totalTokens : undefined,
      tokenUsageAvailable: node.promptTrace?.tokenUsageAvailable ?? false,
      error: node.error,
    }));

    const executionTimeline: RunTimelineItem[] = nodeTraces
      .map((node) => {
        const startOffsetMs = node.startedAt ? Math.max(0, new Date(node.startedAt).getTime() - runStartedMs) : undefined;
        const endOffsetMs = node.finishedAt ? Math.max(0, new Date(node.finishedAt).getTime() - runStartedMs) : undefined;
        return {
          nodeId: node.nodeId,
          name: node.name,
          role: node.role,
          status: node.status,
          startedAt: node.startedAt,
          finishedAt: node.finishedAt,
          durationMs: node.durationMs,
          startOffsetMs,
          endOffsetMs,
        };
      })
      .sort((a, b) => {
        const aStart = a.startOffsetMs ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.startOffsetMs ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) {
          return aStart - bStart;
        }
        return a.name.localeCompare(b.name, "zh-CN");
      });

    const startedAt = row.started_at ?? row.created_at;
    const updatedAt = row.finished_at ?? startedAt;
    const durationMs = diffMs(startedAt, row.finished_at ?? undefined);
    const tokenUsageAvailable = Number(row.token_usage_rows ?? 0) > 0;
    const outputSnapshot = row.output?.trim() || undefined;
    const summarySource = (row.error ?? row.output ?? rootTask?.summary ?? "").trim();

    return {
      id: row.run_id,
      projectId,
      workflowId: row.workflow_id ?? undefined,
      workflowName: row.workflow_name ?? "未命名工作流",
      status: normalizeRunStatus(row.status),
      startedAt,
      finishedAt: row.finished_at ?? undefined,
      durationMs,
      updatedAt,
      promptTokens: tokenUsageAvailable ? Number(row.prompt_tokens ?? 0) : undefined,
      completionTokens: tokenUsageAvailable ? Number(row.completion_tokens ?? 0) : undefined,
      totalTokens: tokenUsageAvailable ? Number(row.total_tokens ?? 0) : undefined,
      tokenUsageAvailable,
      inputSnapshot: rootTask?.summary?.trim() || rootTask?.title || undefined,
      outputSnapshot,
      summary: summarySource ? summarySource.slice(0, 240) : undefined,
      logs,
      executionTimeline,
      nodeExecutions,
      nodeTraces,
      replayHints: {
        nodeReplayReady: true,
        stepRerunReady: true,
        runCompareReady: true,
        notes: "当前版本支持节点重跑、全量回放与运行对比，可在此基础上扩展评测闭环。",
      },
      artifacts: this.listRunArtifacts(projectId, runId),
      triggerSource: "manual",
    };
  }

  private deleteRunIds(runIds: string[]) {
    if (runIds.length === 0) {
      return;
    }
    const runPlaceholders = runIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM run_task WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_node WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_edge WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_message WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_event WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_agent_definition WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_agent_context WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_human_message WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM node_config WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM agent_document WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM project_file WHERE run_id IN (${runPlaceholders})`).run(...runIds);
    db.prepare(`DELETE FROM run_snapshot WHERE run_id IN (${runPlaceholders})`).run(...runIds);
  }

  private deleteWorkflowIds(workflowIds: string[]) {
    if (workflowIds.length === 0) {
      return;
    }
    const placeholders = workflowIds.map(() => "?").join(", ");
    const runRows = db
      .prepare(`SELECT run_id FROM run_snapshot WHERE workflow_id IN (${placeholders})`)
      .all(...workflowIds) as Array<{ run_id: string }>;
    const runIds = runRows.map((item) => item.run_id);
    this.deleteRunIds(runIds);

    db.prepare(`DELETE FROM workflow_version WHERE workflow_id IN (${placeholders})`).run(...workflowIds);
    db.prepare(`DELETE FROM long_term_memory WHERE workflow_id IN (${placeholders})`).run(...workflowIds);
    db.prepare(`DELETE FROM project_file WHERE workflow_id IN (${placeholders})`).run(...workflowIds);
    db.prepare(`DELETE FROM workflow_definition WHERE id IN (${placeholders})`).run(...workflowIds);
  }

  deleteProject(projectId: string) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }

    const workflowIds = db
      .prepare("SELECT id FROM workflow_definition WHERE project_id = ?")
      .all(projectId) as Array<{ id: string }>;
    const ids = workflowIds.map((item) => item.id);

    this.deleteWorkflowIds(ids);

    db.prepare("DELETE FROM project_file WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM project WHERE id = ?").run(projectId);

    return {
      projectId,
      deletedWorkflowCount: ids.length,
    };
  }

  updateWorkflowMeta(workflowId: string, payload: { projectId?: string; name: string; description?: string }) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error("工作流不存在");
    }
    if (payload.projectId && workflow.projectId && payload.projectId !== workflow.projectId) {
      throw new Error("项目工作流不存在");
    }

    const now = nowIso();
    db.prepare(
      `UPDATE workflow_definition
       SET name = ?, description = ?, updated_at = ?
       WHERE id = ?`,
    ).run(payload.name.trim(), payload.description?.trim() || null, now, workflowId);

    const updated = this.getWorkflow(workflowId);
    if (!updated) {
      throw new Error("工作流不存在");
    }
    return updated;
  }

  deleteWorkflow(workflowId: string, projectId?: string) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error("工作流不存在");
    }
    if (projectId && workflow.projectId && workflow.projectId !== projectId) {
      throw new Error("项目工作流不存在");
    }

    this.deleteWorkflowIds([workflowId]);
    return { workflowId };
  }

  listRuns(limit = 12): ProjectRunSummary[] {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const rows = db
      .prepare(
        `SELECT
          rs.run_id,
          rs.workflow_id,
          rs.run_type,
          rs.status AS run_status,
          rs.started_at,
          rs.finished_at,
          rs.created_at,
          rs.output,
          rs.error,
          wf.project_id,
          COALESCE(wf.name, rs.name) AS workflow_name,
          COALESCE(tokens.prompt_tokens, 0) AS prompt_tokens,
          COALESCE(tokens.completion_tokens, 0) AS completion_tokens,
          COALESCE(tokens.total_tokens, 0) AS total_tokens,
          COALESCE(tokens.token_usage_rows, 0) AS token_usage_rows
        FROM run_snapshot rs
        LEFT JOIN workflow_definition wf ON wf.id = rs.workflow_id
        LEFT JOIN (
          SELECT
            run_id,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.prompt_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.prompt_tokens') AS INTEGER),
              0
            )) AS prompt_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.completion_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completion_tokens') AS INTEGER),
              0
            )) AS completion_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.total_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.total_tokens') AS INTEGER),
              0
            )) AS total_tokens,
            SUM(CASE
              WHEN json_extract(payload_json, '$.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.total_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.total_tokens') IS NOT NULL
              THEN 1 ELSE 0
            END) AS token_usage_rows
          FROM run_event
          WHERE type = 'llm_response_received'
          GROUP BY run_id
        ) tokens ON tokens.run_id = rs.run_id
        ORDER BY COALESCE(rs.started_at, rs.created_at) DESC
        LIMIT ?`,
      )
      .all(safeLimit) as RunRecordRow[];
    return rows.map(buildRunSummary);
  }

  getRunsAnalytics(days = 7, runType?: "workflow_run" | "dev_run"): RunsAnalytics {
    const safeDays = Math.max(1, Math.min(Number.isFinite(days) ? Math.floor(days) : 7, 90));
    const sinceModifier = `-${Math.max(0, safeDays - 1)} days`;
    const runTypeClause = runType ? ` AND rs.run_type = '${runType}'` : "";
    const runRows = db
      .prepare(
        `SELECT
          rs.run_id,
          rs.status AS run_status,
          rs.workflow_id,
          COALESCE(wf.name, rs.name) AS workflow_name,
          rs.started_at,
          rs.finished_at,
          rs.created_at,
          date(COALESCE(rs.started_at, rs.created_at)) AS bucket_date,
          CASE
            WHEN rs.started_at IS NOT NULL AND rs.finished_at IS NOT NULL
            THEN CAST((julianday(rs.finished_at) - julianday(rs.started_at)) * 86400000 AS INTEGER)
            ELSE NULL
          END AS duration_ms,
          COALESCE(tokens.prompt_tokens, 0) AS prompt_tokens,
          COALESCE(tokens.completion_tokens, 0) AS completion_tokens,
          COALESCE(tokens.total_tokens, 0) AS total_tokens,
          COALESCE(tokens.token_usage_rows, 0) AS token_usage_rows
        FROM run_snapshot rs
        LEFT JOIN workflow_definition wf ON wf.id = rs.workflow_id
        LEFT JOIN (
          SELECT
            run_id,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.prompt_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.prompt_tokens') AS INTEGER),
              0
            )) AS prompt_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.completion_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completion_tokens') AS INTEGER),
              0
            )) AS completion_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.total_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.total_tokens') AS INTEGER),
              0
            )) AS total_tokens,
            SUM(CASE
              WHEN json_extract(payload_json, '$.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.total_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.total_tokens') IS NOT NULL
              THEN 1 ELSE 0
            END) AS token_usage_rows
          FROM run_event
          WHERE type = 'llm_response_received'
          GROUP BY run_id
        ) tokens ON tokens.run_id = rs.run_id
        WHERE datetime(COALESCE(rs.started_at, rs.created_at)) >= datetime('now', ?)${runTypeClause}
        ORDER BY COALESCE(rs.started_at, rs.created_at) ASC`,
      )
      .all(sinceModifier) as RunAnalyticsRow[];

    const dateRange = buildDateRange(safeDays);
    const trendMap = new Map<string, { runCount: number; successCount: number; failedCount: number; runningCount: number }>();
    for (const day of dateRange) {
      trendMap.set(day, {
        runCount: 0,
        successCount: 0,
        failedCount: 0,
        runningCount: 0,
      });
    }

    const workflowTokenMap = new Map<string, {
      workflowId?: string;
      workflowName: string;
      totalTokens: number;
      runCount: number;
      tokenUsageAvailable: boolean;
    }>();

    let successCount = 0;
    let failedCount = 0;
    let runningCount = 0;
    let totalDurationMs = 0;
    let durationCount = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let tokenUsageAvailable = false;

    for (const run of runRows) {
      const status = normalizeRunStatus(run.run_status);
      if (status === "success") {
        successCount += 1;
      } else if (status === "failed") {
        failedCount += 1;
      } else {
        runningCount += 1;
      }

      const bucketDate = toDateKey(run.bucket_date ?? run.started_at ?? run.created_at);
      const bucket = trendMap.get(bucketDate);
      if (bucket) {
        bucket.runCount += 1;
        if (status === "success") {
          bucket.successCount += 1;
        } else if (status === "failed") {
          bucket.failedCount += 1;
        } else {
          bucket.runningCount += 1;
        }
      }

      if (typeof run.duration_ms === "number" && Number.isFinite(run.duration_ms) && run.duration_ms >= 0) {
        totalDurationMs += run.duration_ms;
        durationCount += 1;
      }

      const hasTokens = Number(run.token_usage_rows ?? 0) > 0;
      if (hasTokens) {
        tokenUsageAvailable = true;
        promptTokens += Number(run.prompt_tokens ?? 0);
        completionTokens += Number(run.completion_tokens ?? 0);
        totalTokens += Number(run.total_tokens ?? 0);
      }

      const workflowKey = run.workflow_id ?? "__workspace__";
      const current = workflowTokenMap.get(workflowKey) ?? {
        workflowId: run.workflow_id ?? undefined,
        workflowName: run.workflow_name ?? "未命名工作流",
        totalTokens: 0,
        runCount: 0,
        tokenUsageAvailable: false,
      };
      current.runCount += 1;
      if (hasTokens) {
        current.totalTokens += Number(run.total_tokens ?? 0);
        current.tokenUsageAvailable = true;
      }
      workflowTokenMap.set(workflowKey, current);
    }

    const nodeRows = db
      .prepare(
        `SELECT
          rn.name AS node_name,
          rn.role AS node_role,
          rn.status AS node_status,
          CASE
            WHEN rn.created_at IS NOT NULL AND rn.updated_at IS NOT NULL
            THEN CAST((julianday(rn.updated_at) - julianday(rn.created_at)) * 86400000 AS INTEGER)
            ELSE NULL
          END AS duration_ms
        FROM run_node rn
        INNER JOIN run_snapshot rs ON rs.run_id = rn.run_id
        WHERE datetime(COALESCE(rs.started_at, rs.created_at)) >= datetime('now', ?)`,
      )
      .all(sinceModifier) as NodeAnalyticsRow[];

    const nodeMap = new Map<string, {
      nodeKey: string;
      nodeName: string;
      role: string;
      runCount: number;
      failCount: number;
      totalDurationMs: number;
      durationCount: number;
    }>();

    for (const row of nodeRows) {
      const nodeName = row.node_name || "未命名节点";
      const role = row.node_role || "worker";
      const nodeKey = `${nodeName}::${role}`;
      const current = nodeMap.get(nodeKey) ?? {
        nodeKey,
        nodeName,
        role,
        runCount: 0,
        failCount: 0,
        totalDurationMs: 0,
        durationCount: 0,
      };
      current.runCount += 1;
      if (normalizeNodeRunStatus(row.node_status) === "failed") {
        current.failCount += 1;
      }
      if (typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms) && row.duration_ms >= 0) {
        current.totalDurationMs += row.duration_ms;
        current.durationCount += 1;
      }
      nodeMap.set(nodeKey, current);
    }

    const completedCount = successCount + failedCount;
    return {
      rangeDays: safeDays,
      generatedAt: nowIso(),
      overview: {
        totalRuns: runRows.length,
        successCount,
        failedCount,
        runningCount,
        successRate: completedCount > 0 ? Number(((successCount / completedCount) * 100).toFixed(2)) : undefined,
        avgDurationMs: durationCount > 0 ? Math.round(totalDurationMs / durationCount) : undefined,
        totalDurationMs,
        promptTokens: tokenUsageAvailable ? promptTokens : undefined,
        completionTokens: tokenUsageAvailable ? completionTokens : undefined,
        totalTokens: tokenUsageAvailable ? totalTokens : undefined,
        tokenUsageAvailable,
      },
      trend: dateRange.map((date) => ({
        date,
        runCount: trendMap.get(date)?.runCount ?? 0,
        successCount: trendMap.get(date)?.successCount ?? 0,
        failedCount: trendMap.get(date)?.failedCount ?? 0,
        runningCount: trendMap.get(date)?.runningCount ?? 0,
      })),
      statusDistribution: [
        { status: "success", count: successCount },
        { status: "failed", count: failedCount },
        { status: "running", count: runningCount },
      ],
      workflowTokenUsage: Array.from(workflowTokenMap.values())
        .filter((item) => item.tokenUsageAvailable)
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 10)
        .map((item) => ({
          workflowId: item.workflowId,
          workflowName: item.workflowName,
          totalTokens: item.totalTokens,
          runCount: item.runCount,
        })),
      nodeDurationRanking: Array.from(nodeMap.values())
        .filter((item) => item.durationCount > 0)
        .map((item) => ({
          nodeKey: item.nodeKey,
          nodeName: item.nodeName,
          role: item.role,
          avgDurationMs: Math.round(item.totalDurationMs / item.durationCount),
          runCount: item.runCount,
        }))
        .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
        .slice(0, 10),
      nodeFailureRanking: Array.from(nodeMap.values())
        .filter((item) => item.runCount > 0)
        .map((item) => ({
          nodeKey: item.nodeKey,
          nodeName: item.nodeName,
          role: item.role,
          failCount: item.failCount,
          runCount: item.runCount,
          failRate: Number(((item.failCount / item.runCount) * 100).toFixed(2)),
        }))
        .sort((a, b) => {
          if (b.failRate !== a.failRate) {
            return b.failRate - a.failRate;
          }
          return b.failCount - a.failCount;
        })
        .slice(0, 10),
    };
  }

  listProjectRuns(projectId: string, limit = 20): ProjectRunSummary[] {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = db
      .prepare(
        `SELECT
          rs.run_id,
          rs.workflow_id,
          rs.run_type,
          rs.status AS run_status,
          rs.started_at,
          rs.finished_at,
          rs.created_at,
          rs.output,
          rs.error,
          wf.project_id,
          wf.name AS workflow_name,
          COALESCE(tokens.prompt_tokens, 0) AS prompt_tokens,
          COALESCE(tokens.completion_tokens, 0) AS completion_tokens,
          COALESCE(tokens.total_tokens, 0) AS total_tokens,
          COALESCE(tokens.token_usage_rows, 0) AS token_usage_rows
        FROM run_snapshot rs
        INNER JOIN workflow_definition wf ON wf.id = rs.workflow_id
        LEFT JOIN (
          SELECT
            run_id,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.prompt_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.promptTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.prompt_tokens') AS INTEGER),
              0
            )) AS prompt_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.completion_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completionTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.completion_tokens') AS INTEGER),
              0
            )) AS completion_tokens,
            SUM(COALESCE(
              CAST(json_extract(payload_json, '$.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.total_tokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.totalTokens') AS INTEGER),
              CAST(json_extract(payload_json, '$.tokenUsage.total_tokens') AS INTEGER),
              0
            )) AS total_tokens,
            SUM(CASE
              WHEN json_extract(payload_json, '$.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.total_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.promptTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.prompt_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completionTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.completion_tokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.totalTokens') IS NOT NULL
                OR json_extract(payload_json, '$.tokenUsage.total_tokens') IS NOT NULL
              THEN 1 ELSE 0
            END) AS token_usage_rows
          FROM run_event
          WHERE type = 'llm_response_received'
          GROUP BY run_id
        ) tokens ON tokens.run_id = rs.run_id
        WHERE wf.project_id = ?
        ORDER BY COALESCE(rs.started_at, rs.created_at) DESC
        LIMIT ?`,
      )
      .all(projectId, safeLimit) as RunRecordRow[];
    return rows.map(buildRunSummary);
  }

  private listWorkflowVersionRows(workflowId: string) {
    return db
      .prepare("SELECT * FROM workflow_version WHERE workflow_id = ? ORDER BY version_number DESC")
      .all(workflowId) as WorkflowVersionRow[];
  }

  private getWorkflowVersionRow(workflowId: string, versionId?: string) {
    if (versionId) {
      return db
        .prepare("SELECT * FROM workflow_version WHERE workflow_id = ? AND id = ?")
        .get(workflowId, versionId) as WorkflowVersionRow | undefined;
    }
    return undefined;
  }

  private buildWorkflowSummary(row: WorkflowRow): WorkflowDefinitionSummary {
    const versions = this.listWorkflowVersionRows(row.id).map(toWorkflowVersionSummary);
    const currentVersion = versions.find((item) => item.id === row.current_version_id) ?? versions[0];
    const publishedVersion = versions.find((item) => item.id === row.published_version_id);

    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      rootTaskInput: row.root_task_input ?? undefined,
      currentVersionId: currentVersion?.id,
      currentVersionNumber: currentVersion?.versionNumber,
      publishedVersionId: publishedVersion?.id,
      publishedVersionNumber: publishedVersion?.versionNumber,
      versionsCount: versions.length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private buildWorkflowDetails(row: WorkflowRow, preferredVersionId?: string): WorkflowDefinition {
    const versions = this.listWorkflowVersionRows(row.id).map(toWorkflowVersionDefinition);
    const currentVersion = versions.find((item) => item.id === row.current_version_id) ?? versions[0];
    const publishedVersion = versions.find((item) => item.id === row.published_version_id);
    const selectedVersion = versions.find((item) => item.id === preferredVersionId) ?? currentVersion;

    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      rootTaskInput: selectedVersion?.rootTaskInput ?? row.root_task_input ?? undefined,
      nodes: selectedVersion?.nodes ?? (JSON.parse(row.nodes_json) as StoredWorkflowNode[]),
      edges: selectedVersion?.edges ?? (JSON.parse(row.edges_json) as StoredWorkflowEdge[]),
      tasks: selectedVersion?.tasks ?? (JSON.parse(row.tasks_json) as StoredWorkflowTask[]),
      currentVersionId: currentVersion?.id,
      currentVersionNumber: currentVersion?.versionNumber,
      publishedVersionId: publishedVersion?.id,
      publishedVersionNumber: publishedVersion?.versionNumber,
      versionsCount: versions.length,
      versions: versions.map((item) => ({
        id: item.id,
        workflowId: item.workflowId,
        versionNumber: item.versionNumber,
        versionLabel: item.versionLabel,
        versionNotes: item.versionNotes,
        createdAt: item.createdAt,
        publishedAt: item.publishedAt,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private createWorkflowVersion(payload: {
    workflowId: string;
    rootTaskInput?: string;
    nodes: StoredWorkflowNode[];
    edges: StoredWorkflowEdge[];
    tasks: StoredWorkflowTask[];
    versionNumber: number;
    versionLabel?: string;
    versionNotes?: string;
    publishedAt?: string;
  }) {
    const versionId = makeId("wf_ver");
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO workflow_version (
        id, workflow_id, version_number, version_label, version_notes, root_task_input,
        nodes_json, edges_json, tasks_json, published_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versionId,
      payload.workflowId,
      payload.versionNumber,
      payload.versionLabel ?? `v${payload.versionNumber}`,
      payload.versionNotes ?? null,
      payload.rootTaskInput ?? null,
      JSON.stringify(payload.nodes),
      JSON.stringify(payload.edges),
      JSON.stringify(payload.tasks),
      payload.publishedAt ?? null,
      createdAt,
    );

    const created = this.getWorkflowVersionRow(payload.workflowId, versionId);
    if (!created) {
      throw new Error("工作流版本创建失败");
    }
    return toWorkflowVersionDefinition(created);
  }

  listWorkflows(projectId?: string): WorkflowDefinitionSummary[] {
    const rows = projectId
      ? (db
          .prepare("SELECT * FROM workflow_definition WHERE project_id = ? ORDER BY updated_at DESC")
          .all(projectId) as WorkflowRow[])
      : (db
          .prepare("SELECT * FROM workflow_definition ORDER BY updated_at DESC")
          .all() as WorkflowRow[]);

    return rows.map((row) => this.buildWorkflowSummary(row));
  }

  listProjectWorkflows(projectId: string): WorkflowDefinitionSummary[] {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    return this.listWorkflows(projectId);
  }

  listWorkflowVersions(workflowId: string): WorkflowVersionSummary[] {
    const workflow = db.prepare("SELECT * FROM workflow_definition WHERE id = ?").get(workflowId) as WorkflowRow | undefined;
    if (!workflow) {
      throw new Error("工作流不存在");
    }
    return this.listWorkflowVersionRows(workflowId).map(toWorkflowVersionSummary);
  }

  getWorkflow(workflowId: string, versionId?: string): WorkflowDefinition | null {
    const row = db.prepare("SELECT * FROM workflow_definition WHERE id = ?").get(workflowId) as WorkflowRow | undefined;
    return row ? this.buildWorkflowDetails(row, versionId) : null;
  }

  getProjectWorkflow(projectId: string, workflowId: string, versionId?: string): WorkflowDefinition | null {
    const row = db
      .prepare("SELECT * FROM workflow_definition WHERE id = ? AND project_id = ?")
      .get(workflowId, projectId) as WorkflowRow | undefined;
    return row ? this.buildWorkflowDetails(row, versionId) : null;
  }

  publishWorkflowVersion(workflowId: string, versionId?: string) {
    const workflow = db.prepare("SELECT * FROM workflow_definition WHERE id = ?").get(workflowId) as WorkflowRow | undefined;
    if (!workflow) {
      throw new Error("工作流不存在");
    }

    const target = this.getWorkflowVersionRow(workflowId, versionId)
      ?? this.listWorkflowVersionRows(workflowId)[0];
    if (!target) {
      throw new Error("工作流版本不存在");
    }

    const publishedAt = nowIso();
    db.prepare("UPDATE workflow_version SET published_at = ? WHERE id = ?").run(publishedAt, target.id);
    db.prepare(
      `UPDATE workflow_definition
       SET published_version_id = ?, current_version_id = ?, root_task_input = ?, nodes_json = ?, edges_json = ?, tasks_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      target.id,
      target.id,
      target.root_task_input,
      target.nodes_json,
      target.edges_json,
      target.tasks_json,
      publishedAt,
      workflowId,
    );

    const refreshed = this.getWorkflow(workflowId, target.id);
    if (!refreshed) {
      throw new Error("工作流发布失败");
    }
    return refreshed;
  }

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
    const now = nowIso();

    if (payload.workflowId) {
      const exists = db.prepare("SELECT * FROM workflow_definition WHERE id = ?").get(payload.workflowId) as WorkflowRow | undefined;
      if (!exists) {
        throw new Error("工作流不存在");
      }
      const nextProjectId = payload.projectId ?? exists.project_id ?? undefined;
      if (nextProjectId) {
        const project = this.getProject(nextProjectId);
        if (!project) {
          throw new Error("项目不存在");
        }
      }

      const nextVersionNumber = (this.listWorkflowVersionRows(payload.workflowId)[0]?.version_number ?? 0) + 1;
      const version = this.createWorkflowVersion({
        workflowId: payload.workflowId,
        rootTaskInput: payload.rootTaskInput,
        nodes: payload.nodes,
        edges: payload.edges,
        tasks: payload.tasks,
        versionNumber: nextVersionNumber,
        versionLabel: payload.versionLabel,
        versionNotes: payload.versionNotes,
      });

      db.prepare(
        `UPDATE workflow_definition SET
          name = ?,
          description = ?,
          root_task_input = ?,
          project_id = ?,
          nodes_json = ?,
          edges_json = ?,
          tasks_json = ?,
          current_version_id = ?,
          updated_at = ?
        WHERE id = ?`,
      ).run(
        payload.name,
        payload.description ?? null,
        payload.rootTaskInput ?? null,
        nextProjectId ?? null,
        JSON.stringify(payload.nodes),
        JSON.stringify(payload.edges),
        JSON.stringify(payload.tasks),
        version.id,
        now,
        payload.workflowId,
      );

      const updated = this.getWorkflow(payload.workflowId, version.id);
      if (!updated) {
        throw new Error("工作流保存失败");
      }
      return updated;
    }

    const id = makeId("wf");
    if (payload.projectId) {
      const project = this.getProject(payload.projectId);
      if (!project) {
        throw new Error("项目不存在");
      }
    }
    db.prepare(
      `INSERT INTO workflow_definition (
        id, project_id, name, description, root_task_input, nodes_json, edges_json, tasks_json,
        is_example, current_version_id, published_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.projectId ?? null,
      payload.name,
      payload.description ?? null,
      payload.rootTaskInput ?? null,
      JSON.stringify(payload.nodes),
      JSON.stringify(payload.edges),
      JSON.stringify(payload.tasks),
      0,
      null,
      null,
      now,
      now,
    );

    const version = this.createWorkflowVersion({
      workflowId: id,
      rootTaskInput: payload.rootTaskInput,
      nodes: payload.nodes,
      edges: payload.edges,
      tasks: payload.tasks,
      versionNumber: 1,
      versionLabel: payload.versionLabel,
      versionNotes: payload.versionNotes,
    });

    db.prepare(
      `UPDATE workflow_definition
       SET current_version_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(version.id, now, id);

    const created = this.getWorkflow(id, version.id);
    if (!created) {
      throw new Error("工作流创建失败");
    }
    return created;
  }

  resetForTests() {
    db.exec(`
      DELETE FROM workspace_config;
      DELETE FROM node_config;
      DELETE FROM secret_credential;
      DELETE FROM agent_document;
      DELETE FROM workflow_definition;
      DELETE FROM workflow_version;
      DELETE FROM project;
      DELETE FROM project_file;
      DELETE FROM tool_binding;
      DELETE FROM tool_definition;
      DELETE FROM tool_plugin;
      DELETE FROM model_asset;
      DELETE FROM prompt_template_asset;
      DELETE FROM workflow_template;
      DELETE FROM agent_template;
      DELETE FROM workflow_asset_reference;
      DELETE FROM skill_binding;
      DELETE FROM skill_asset;
      DELETE FROM script_asset;
      DELETE FROM long_term_memory;
      DELETE FROM run_task;
      DELETE FROM run_node;
      DELETE FROM run_edge;
      DELETE FROM run_message;
      DELETE FROM run_event;
      DELETE FROM run_agent_definition;
      DELETE FROM run_agent_context;
      DELETE FROM run_human_message;
      DELETE FROM run_snapshot;
    `);
  }
}

export const configService = new ConfigService();
