import { nowIso } from "@/lib/utils";
import { db } from "@/server/persistence/sqlite";
import type { ProjectFileDetail, ProjectFileSummary, ProjectSummary } from "@/server/config/config-service";

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

export interface ArtifactIndexServiceDependencies {
  getProject(projectId: string): ProjectSummary | null;
  mapProjectFileSummary(row: ProjectFileRow): ProjectFileSummary;
  mapProjectFileDetail(row: ProjectFileRow): ProjectFileDetail;
}

export class ArtifactIndexService {
  constructor(private readonly deps: ArtifactIndexServiceDependencies) {}

  upsertProjectFile(payload: {
    id: string;
    projectId: string;
    runId?: string;
    workflowId?: string;
    workflowName?: string;
    name: string;
    type: string;
    size?: number;
    sourceType: string;
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
    return this.deps.mapProjectFileSummary(row);
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
      artifacts.push(
        this.upsertProjectFile({
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
        }),
      );
    }

    const error = row.error?.trim();
    if (error) {
      artifacts.push(
        this.upsertProjectFile({
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
        }),
      );
    }

    return artifacts;
  }

  listProjectFiles(projectId: string, limit = 200): ProjectFileSummary[] {
    if (!this.deps.getProject(projectId)) {
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
    return rows.map((row) => this.deps.mapProjectFileSummary(row));
  }

  getProjectFile(projectId: string, fileId: string): ProjectFileDetail | null {
    if (!this.deps.getProject(projectId)) {
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
    return row ? this.deps.mapProjectFileDetail(row) : null;
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
    return rows.map((row) => this.deps.mapProjectFileSummary(row));
  }
}
