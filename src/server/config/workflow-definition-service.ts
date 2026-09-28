import { makeId, nowIso } from "@/lib/utils";
import {
  StoredWorkflowEdge,
  StoredWorkflowNode,
  StoredWorkflowTask,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowVersionDefinition,
  WorkflowVersionSummary,
} from "@/server/domain";
import { db } from "@/server/persistence/sqlite";
import type { ProjectSummary } from "@/server/config/config-service";

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

interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version_number: number;
  version_label: string | null;
  version_notes: string | null;
  root_task_input: string | null;
  nodes_json: string;
  edges_json: string;
  tasks_json: string;
  published_at: string | null;
  created_at: string;
}

export interface WorkflowDefinitionServiceDependencies {
  getProject(projectId: string): ProjectSummary | null;
  toWorkflowVersionSummary(row: WorkflowVersionRow): WorkflowVersionSummary;
  toWorkflowVersionDefinition(row: WorkflowVersionRow): WorkflowVersionDefinition;
}

export class WorkflowDefinitionService {
  constructor(private readonly deps: WorkflowDefinitionServiceDependencies) {}

  private listWorkflowVersionRows(workflowId: string) {
    return db
      .prepare("SELECT * FROM workflow_version WHERE workflow_id = ? ORDER BY version_number DESC")
      .all(workflowId) as WorkflowVersionRow[];
  }

  private getWorkflowVersionRow(workflowId: string, versionId?: string) {
    if (!versionId) {
      return undefined;
    }
    return db
      .prepare("SELECT * FROM workflow_version WHERE workflow_id = ? AND id = ?")
      .get(workflowId, versionId) as WorkflowVersionRow | undefined;
  }

  private buildWorkflowSummary(row: WorkflowRow): WorkflowDefinitionSummary {
    const versions = this.listWorkflowVersionRows(row.id).map((item) => this.deps.toWorkflowVersionSummary(item));
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
    const versions = this.listWorkflowVersionRows(row.id).map((item) => this.deps.toWorkflowVersionDefinition(item));
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
    return this.deps.toWorkflowVersionDefinition(created);
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
    const project = this.deps.getProject(projectId);
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
    return this.listWorkflowVersionRows(workflowId).map((row) => this.deps.toWorkflowVersionSummary(row));
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
      if (nextProjectId && !this.deps.getProject(nextProjectId)) {
        throw new Error("项目不存在");
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
    if (payload.projectId && !this.deps.getProject(payload.projectId)) {
      throw new Error("项目不存在");
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
}
