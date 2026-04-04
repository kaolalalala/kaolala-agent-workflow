import { existsSync, readFileSync } from "node:fs";

import { outputManager } from "@/server/runtime/output-manager";
import {
  addWorkspaceFile,
  type RunState,
  type TodoItem,
  type WorkspaceFileKind,
  type WorkspaceFileRecord,
} from "../supervisor-runtime-state";
import { sanitizeModelText } from "../text-cleaner";
import { buildInlinePreview, DEFAULT_OFFLOADING_POLICY } from "./offloading-policy";

function inferFormat(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".txt")) return "text";
  return "text";
}

function inferMimeType(format: string) {
  if (format === "json") return "application/json";
  if (format === "markdown") return "text/markdown";
  return "text/plain";
}

function inferRetention(kind: WorkspaceFileKind) {
  if (kind === "final_output") return "final" as const;
  if (kind === "intermediate_summary" || kind === "research_notes") return "reusable" as const;
  return "ephemeral" as const;
}

export function writeWorkspaceFileForArtifact(
  state: RunState,
  todo: TodoItem,
  producer: string,
  kind: WorkspaceFileKind,
  content: string,
  requestedPath?: string,
  summary?: string,
) {
  const normalizedContent = sanitizeModelText(content);
  const fallbackName = outputManager.createRunScopedFileName(`${todo.id}_${kind}`, kind === "raw_tool_result" ? ".json" : ".md");
  const finalPath = outputManager.writeNodeTextOutput(
    state.run_id,
    todo.id,
    normalizedContent,
    requestedPath,
    fallbackName,
  );
  const format = inferFormat(finalPath);
  const record = addWorkspaceFile(state, {
    path: finalPath,
    kind,
    related_todo: todo.id,
    producer,
    content_summary: sanitizeModelText(summary ?? buildInlinePreview(normalizedContent)),
    scope: "run",
    retention: inferRetention(kind),
    mime_type: inferMimeType(format),
    format,
    size_bytes: Buffer.byteLength(normalizedContent, "utf8"),
  });
  return record;
}

export function readWorkspaceFileSummary(state: RunState, fileId: string) {
  const record = state.workspace_files.find((item) => item.file_id === fileId);
  return record?.content_summary;
}

export function readWorkspaceFileContent(
  state: RunState,
  fileId: string,
  maxChars = DEFAULT_OFFLOADING_POLICY.fullReadMaxChars,
) {
  const record = state.workspace_files.find((item) => item.file_id === fileId);
  if (!record || !existsSync(record.path)) return null;
  const raw = readFileSync(record.path, "utf8");
  const normalized = sanitizeModelText(raw);
  if (!normalized) return null;
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...(truncated)` : normalized;
}

export function readWorkspaceFile(
  state: RunState,
  fileId: string,
  maxChars = 4500,
) {
  const record = state.workspace_files.find((item) => item.file_id === fileId);
  if (!record || !existsSync(record.path)) return null;
  const raw = readFileSync(record.path, "utf8");
  const normalized = sanitizeModelText(raw);
  if (!normalized) return null;
  if (normalized.length <= maxChars) {
    return { content: normalized, truncated: false };
  }
  return {
    content: `${normalized.slice(0, maxChars)}...(truncated)`,
    truncated: true,
  };
}

export interface WorkspaceReadbackOptions {
  maxFiles?: number;
  maxChars?: number;
}

export function resolveWorkspaceReadback(
  state: RunState,
  artifacts: Array<{
    workspace_file_id?: string;
    related_todo: string;
  }>,
  options?: WorkspaceReadbackOptions,
) {
  const maxFiles = Math.max(1, options?.maxFiles ?? 2);
  const maxChars = Math.max(500, options?.maxChars ?? DEFAULT_OFFLOADING_POLICY.fullReadMaxChars);
  let usedChars = 0;
  const results: Array<{ file: WorkspaceFileRecord; content: string }> = [];

  for (const artifact of artifacts) {
    if (!artifact.workspace_file_id) continue;
    const file = state.workspace_files.find((item) => item.file_id === artifact.workspace_file_id);
    if (!file) continue;
    const content = readWorkspaceFileContent(state, file.file_id, maxChars - usedChars);
    if (!content) continue;
    results.push({ file, content });
    usedChars += content.length;
    if (results.length >= maxFiles || usedChars >= maxChars) break;
  }

  return results;
}
