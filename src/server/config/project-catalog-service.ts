import { makeId, nowIso } from "@/lib/utils";
import { db } from "@/server/persistence/sqlite";
import type { ProjectRunSummary, ProjectSettings, ProjectSummary } from "@/server/config/config-service";

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

export interface ProjectCatalogServiceDependencies {
  toProjectSummary(row: ProjectRow): ProjectSummary;
  normalizeProjectSettings(value?: Partial<ProjectSettings>): Partial<ProjectSettings>;
  buildRunSummary(row: RunRecordRow): ProjectRunSummary;
}

export class ProjectCatalogService {
  constructor(private readonly deps: ProjectCatalogServiceDependencies) {}

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
    return rows.map((row) => this.deps.toProjectSummary(row));
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
    return row ? this.deps.toProjectSummary(row) : null;
  }

  createProject(payload: { name: string; description?: string }) {
    const now = nowIso();
    const project: ProjectSummary = {
      id: makeId("proj"),
      name: payload.name.trim(),
      description: payload.description?.trim() || undefined,
      settings: {},
      effectiveSettings: {},
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

    const created = this.getProject(project.id);
    if (!created) {
      throw new Error("项目创建失败");
    }
    return created;
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
    const normalizedSettings = hasSettings ? this.deps.normalizeProjectSettings(payload.settings) : {};
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
    return rows.map((row) => this.deps.buildRunSummary(row));
  }
}
