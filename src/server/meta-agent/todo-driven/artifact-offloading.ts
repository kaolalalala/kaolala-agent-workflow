import { existsSync } from "node:fs";
import { outputManager } from "@/server/runtime/output-manager";
import {
  addArtifact,
  addExecutionLog,
  type ArtifactRecord,
  type RunState,
  type TodoItem,
} from "../supervisor-runtime-state";
import { sanitizeModelText } from "../text-cleaner";
import { buildInlinePreview, decideOffload } from "./offloading-policy";
import { writeWorkspaceFileForArtifact } from "./workspace-files";
import type { TodoExecutorResult } from "./types";

function message(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

export function persistExecutionArtifacts(
  state: RunState,
  todo: TodoItem,
  producer: string,
  result: TodoExecutorResult,
  scope: "serial" | "wave",
) {
  const drafts = [
    ...(result.artifact ? [result.artifact] : []),
    ...(Array.isArray(result.artifacts) ? result.artifacts : []),
  ];
  const created: ArtifactRecord[] = [];

  drafts.forEach((draft, index) => {
    const content = sanitizeModelText(
      index === 0
        ? result.output || draft.summary
        : draft.summary || result.summary || result.output,
    ) || draft.summary || result.summary || "artifact output";
    const summary = sanitizeModelText(draft.summary || result.summary || buildInlinePreview(content));
    const existingArtifactPath = typeof draft.path === "string" && draft.path.trim() && existsSync(draft.path.trim())
      ? draft.path.trim()
      : null;

    if (existingArtifactPath) {
      const artifact = addArtifact(state, {
        path: existingArtifactPath,
        type: draft.type,
        producer,
        related_todo: todo.id,
        summary,
        storage_mode: "inline",
        inline_preview: buildInlinePreview(content),
      });
      created.push(artifact);

      addExecutionLog(state, {
        timestamp: new Date().toISOString(),
        todo_id: todo.id,
        actor: producer,
        action: "external_artifact_registered",
        message: message({
          scope,
          type: draft.type,
          path: existingArtifactPath,
          preview_length: artifact.inline_preview?.length ?? 0,
        }),
      });
      return;
    }

    const decision = decideOffload({
      content,
      result_type: draft.type,
      related_todo: todo,
      producer,
    });

    addExecutionLog(state, {
      timestamp: new Date().toISOString(),
      todo_id: todo.id,
      actor: producer,
      action: "offload_decided",
      message: message({
        scope,
        should_offload: decision.should_offload,
        reason: decision.reason,
        offload_mode: decision.offload_mode,
        artifact_kind: decision.artifact_kind,
      }),
    });

    if (decision.should_offload) {
      const workspaceFile = writeWorkspaceFileForArtifact(
        state,
        todo,
        producer,
        decision.artifact_kind,
        content,
        draft.path,
        summary,
      );
      const artifact = addArtifact(state, {
        path: workspaceFile.path,
        type: draft.type,
        producer,
        related_todo: todo.id,
        summary,
        storage_mode: "workspace",
        workspace_file_id: workspaceFile.file_id,
        inline_preview: decision.keep_inline_summary ? summary : undefined,
        kind: decision.artifact_kind,
      });
      created.push(artifact);

      addExecutionLog(state, {
        timestamp: new Date().toISOString(),
        todo_id: todo.id,
        actor: producer,
        action: "workspace_file_written",
        message: message({
          scope,
          file_id: workspaceFile.file_id,
          kind: workspaceFile.kind,
          path: workspaceFile.path,
          size_bytes: workspaceFile.size_bytes ?? 0,
        }),
      });
      return;
    }

    const finalPath = outputManager.writeNodeTextOutput(
      state.run_id,
      todo.id,
      content,
      draft.path,
      outputManager.createRunScopedFileName(todo.id, ".md"),
    );
    const artifact = addArtifact(state, {
      path: finalPath,
      type: draft.type,
      producer,
      related_todo: todo.id,
      summary,
      storage_mode: "inline",
      inline_preview: buildInlinePreview(content),
      kind: decision.artifact_kind,
    });
    created.push(artifact);

    addExecutionLog(state, {
      timestamp: new Date().toISOString(),
      todo_id: todo.id,
      actor: producer,
      action: "inline_artifact_written",
      message: message({
        scope,
        type: draft.type,
        preview_length: artifact.inline_preview?.length ?? 0,
      }),
    });
  });

  return created;
}
