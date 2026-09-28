import { makeId, nowIso } from "@/lib/utils";
import type {
  AgentNodeConfig,
  AgentNodeToolPolicy,
  SecretCredential,
  WorkspaceConfig,
} from "@/server/domain";
import { db } from "@/server/persistence/sqlite";

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

export interface WorkspaceConfigServiceDependencies {
  toWorkspaceConfig(row: WorkspaceConfigRow): WorkspaceConfig;
  toNodeConfig(row: NodeConfigRow): AgentNodeConfig;
  toCredential(row: CredentialRow): SecretCredential;
  encodeSecret(value: string): string;
  decodeSecret(value: string): string;
  normalizeToolPolicy(value: unknown, fallback: AgentNodeToolPolicy): AgentNodeToolPolicy;
  getDefaultToolPolicyByRole(nodeRole: string): AgentNodeToolPolicy;
}

export class WorkspaceConfigService {
  constructor(private readonly deps: WorkspaceConfigServiceDependencies) {}

  ensureWorkspaceConfig(): WorkspaceConfig {
    const row = db.prepare("SELECT * FROM workspace_config LIMIT 1").get() as WorkspaceConfigRow | undefined;
    if (row) {
      return this.deps.toWorkspaceConfig(row);
    }

    const now = nowIso();
    const id = "workspace_default";
    db.prepare(
      `INSERT INTO workspace_config (
        id, name, default_provider, default_model, default_base_url, default_credential_id, default_temperature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, "默认工作区", null, null, null, null, 0.2, now, now);

    const created = db.prepare("SELECT * FROM workspace_config WHERE id = ?").get(id) as WorkspaceConfigRow;
    return this.deps.toWorkspaceConfig(created);
  }

  updateWorkspaceConfig(payload: Partial<WorkspaceConfig>) {
    if (payload.defaultProvider?.trim().toLowerCase() === "mock") {
      throw new Error("mock provider has been disabled. Please configure a real LLM provider.");
    }

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
    return rows.map((row) => this.deps.toCredential(row));
  }

  createCredential(payload: { provider: string; label: string; apiKey: string }) {
    const now = nowIso();
    const credential: SecretCredential = {
      id: makeId("cred"),
      provider: payload.provider,
      label: payload.label,
      encryptedValue: this.deps.encodeSecret(payload.apiKey),
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
    return row ? this.deps.toCredential(row) : null;
  }

  resolveCredentialApiKey(credentialId?: string) {
    const credential = this.getCredentialById(credentialId);
    if (!credential) {
      return undefined;
    }
    return this.deps.decodeSecret(credential.encryptedValue);
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

    const defaultToolPolicy = this.deps.getDefaultToolPolicyByRole(payload.nodeRole ?? "");
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
    return row ? this.deps.toNodeConfig(row) : null;
  }

  updateNodeConfig(runId: string, nodeId: string, payload: Partial<AgentNodeConfig>) {
    const current = this.getNodeConfig(runId, nodeId);
    if (!current) {
      throw new Error("节点配置不存在");
    }

    const nextToolPolicy = this.deps.normalizeToolPolicy(payload.toolPolicy, current.toolPolicy);
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
}
