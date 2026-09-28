import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import type { TodoItem } from "../../supervisor-runtime-state";
import type { TodoExecutionContext, TodoExecutorResult, TodoReviewResult } from "../types";

function getTodoNoteValue(todo: TodoItem, key: string) {
  for (const note of todo.notes ?? []) {
    if (note.startsWith(`${key}:`)) {
      const value = note.slice(key.length + 1).trim();
      return value || undefined;
    }
    if (note.startsWith(`${key}=`)) {
      const value = note.slice(key.length + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}

function getExpectedCount(todo: TodoItem, fallback: number) {
  const noteValue = Number(getTodoNoteValue(todo, "review_expected_count") ?? "");
  if (Number.isFinite(noteValue) && noteValue > 0) {
    return Math.floor(noteValue);
  }

  const joined = [todo.title, todo.description, ...todo.acceptance_criteria].join(" ");
  const explicitCountMatches = [
    ...joined.matchAll(/\b(\d+)\s+(?:papers?|pdfs?|files?|items?|entries?|results?)\b/gi),
    ...joined.matchAll(/\b(?:download|collect|merge|deliver|list|return|include)\s+(\d+)\b/gi),
  ]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
  if (explicitCountMatches.length > 0) {
    return Math.max(...explicitCountMatches);
  }

  const boundedNumbers = Array.from(joined.matchAll(/\b(\d+)\b/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
  if (boundedNumbers.length > 0) {
    return Math.max(...boundedNumbers);
  }
  return fallback;
}

function collectResultArtifacts(executorResult: TodoExecutorResult) {
  return [
    ...(executorResult.artifact ? [executorResult.artifact] : []),
    ...(executorResult.artifacts ?? []),
  ].filter((item) => item && typeof item.path === "string" && item.path.trim().length > 0);
}

function fileExistsNonEmpty(path: string) {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!fileExistsNonEmpty(path)) return null;
    const text = readFileSync(path, "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getPaperCountFromPayload(payload: Record<string, unknown> | null) {
  if (!payload) return 0;
  if (Array.isArray(payload.papers)) {
    return payload.papers.length;
  }
  const numericKeys = ["downloadedCount", "mergedCount", "deliveredCount", "requiredCount"];
  for (const key of numericKeys) {
    const value = Number(payload[key]);
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return 0;
}

function getExistingPdfCountFromPayload(payload: Record<string, unknown> | null) {
  if (!payload || !Array.isArray(payload.papers)) return 0;
  return payload.papers.filter((paper) => {
    if (!paper || typeof paper !== "object") return false;
    const filePath = typeof (paper as { filePath?: unknown }).filePath === "string"
      ? (paper as { filePath: string }).filePath
      : "";
    return fileExistsNonEmpty(filePath);
  }).length;
}

interface ManifestCandidate {
  path: string;
  payload: Record<string, unknown> | null;
  paperCount: number;
  existingPdfCount: number;
  modifiedAtMs: number;
}

function getManifestCandidate(path: string): ManifestCandidate | null {
  if (!fileExistsNonEmpty(path)) return null;
  const payload = readJsonFile(path);
  return {
    path,
    payload,
    paperCount: getPaperCountFromPayload(payload),
    existingPdfCount: getExistingPdfCountFromPayload(payload),
    modifiedAtMs: statSync(path).mtimeMs,
  };
}

function chooseBestManifestCandidate(paths: string[]) {
  const candidates = paths
    .map((path) => getManifestCandidate(path))
    .filter((candidate): candidate is ManifestCandidate => Boolean(candidate));
  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (right.paperCount !== left.paperCount) {
      return right.paperCount - left.paperCount;
    }
    if (right.existingPdfCount !== left.existingPdfCount) {
      return right.existingPdfCount - left.existingPdfCount;
    }
    return right.modifiedAtMs - left.modifiedAtMs;
  });
  return candidates[0] ?? null;
}

function hasStructuredManifestEntries(payload: Record<string, unknown> | null, minEntries = 1) {
  if (!payload || !Array.isArray(payload.papers) || payload.papers.length < minEntries) return false;
  const sample = payload.papers.slice(0, minEntries);
  return sample.every((paper) => {
    if (!paper || typeof paper !== "object") return false;
    const title = typeof (paper as { title?: unknown }).title === "string"
      ? (paper as { title: string }).title.trim()
      : "";
    const filePath = typeof (paper as { filePath?: unknown }).filePath === "string"
      ? (paper as { filePath: string }).filePath.trim()
      : "";
    return title.length > 0 && filePath.length > 0;
  });
}

function relaxedCollectionReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
): TodoReviewResult | null {
  const expectedCount = getExpectedCount(todo, 5);
  const artifacts = collectResultArtifacts(executorResult);
  const manifestCandidate = chooseBestManifestCandidate(
    artifacts
      .filter((artifact) => /manifest\.json$/i.test(basename(artifact.path)))
      .map((artifact) => artifact.path),
  );
  const pdfArtifactCount = artifacts.filter((artifact) => /\.pdf$/i.test(artifact.path) && fileExistsNonEmpty(artifact.path)).length;
  const manifestPaperCount = manifestCandidate?.paperCount ?? 0;
  const manifestPdfCount = manifestCandidate?.existingPdfCount ?? 0;
  const payload = manifestCandidate?.payload ?? null;

  if (
    manifestCandidate &&
    manifestPaperCount >= expectedCount &&
    Math.max(pdfArtifactCount, manifestPdfCount) >= expectedCount &&
    hasStructuredManifestEntries(payload, Math.min(expectedCount, manifestPaperCount))
  ) {
    return {
      status: "pass",
      reason: `Relaxed paper pipeline review passed: manifest and ${expectedCount} PDF files are present for this collection batch.`,
      missing_criteria: [],
    };
  }

  if (manifestCandidate && manifestPaperCount > 0) {
    return {
      status: "revise",
      reason: "Relaxed paper pipeline review found a partial collection bundle, but the requested paper count or file coverage is still incomplete.",
      missing_criteria: [...todo.acceptance_criteria],
    };
  }

  return null;
}

function relaxedMergeReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
): TodoReviewResult | null {
  const expectedCount = getExpectedCount(todo, 10);
  const artifacts = collectResultArtifacts(executorResult);
  const manifestCandidate = chooseBestManifestCandidate(
    artifacts
      .filter((artifact) => /(?:merged_paper_manifest|manifest_final)\.json$/i.test(basename(artifact.path)))
      .map((artifact) => artifact.path),
  );
  const payload = manifestCandidate?.payload ?? null;
  const mergedCount = Math.max(
    manifestCandidate?.paperCount ?? 0,
    Number(payload?.mergedCount ?? 0),
  );

  if (manifestCandidate && mergedCount >= expectedCount) {
    return {
      status: "pass",
      reason: `Relaxed paper pipeline review passed: merged manifest contains ${mergedCount} paper entries.`,
      missing_criteria: [],
    };
  }

  if (manifestCandidate && mergedCount > 0) {
    return {
      status: "revise",
      reason: "Relaxed paper pipeline review found a merged manifest, but the merged paper count is still below the target.",
      missing_criteria: [...todo.acceptance_criteria],
    };
  }

  return null;
}

function relaxedVerificationReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  context: TodoExecutionContext,
): TodoReviewResult | null {
  const expectedCount = getExpectedCount(todo, 10);
  const reportArtifact = collectResultArtifacts(executorResult).find((artifact) =>
    /report\.md$/i.test(basename(artifact.path)),
  );
  const mergedManifestCandidate = chooseBestManifestCandidate(
    context.input_artifacts
      .filter((artifact) => /(?:merged_paper_manifest|manifest_final)\.json$/i.test(basename(artifact.path)))
      .map((artifact) => artifact.path),
  );
  const paperCount = mergedManifestCandidate?.paperCount ?? 0;
  const pdfCount = mergedManifestCandidate?.existingPdfCount ?? 0;

  if (
    reportArtifact &&
    fileExistsNonEmpty(reportArtifact.path) &&
    paperCount >= expectedCount &&
    pdfCount >= expectedCount
  ) {
    return {
      status: "pass",
      reason: `Relaxed paper pipeline review passed: verification report exists and ${pdfCount} paper files are reachable from the merged manifest.`,
      missing_criteria: [],
    };
  }

  return null;
}

function relaxedDeliveryReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
): TodoReviewResult | null {
  const expectedCount = getExpectedCount(todo, 10);
  const artifacts = collectResultArtifacts(executorResult);
  const manifestCandidate = chooseBestManifestCandidate(
    artifacts
      .filter((artifact) => /final_delivery_manifest\.json$/i.test(basename(artifact.path)))
      .map((artifact) => artifact.path),
  );
  const reportArtifact = artifacts.find((artifact) =>
    /final_delivery_report\.md$/i.test(basename(artifact.path)),
  );
  const payload = manifestCandidate?.payload ?? null;
  const deliveredCount = Math.max(
    manifestCandidate?.paperCount ?? 0,
    Number(payload?.deliveredCount ?? 0),
  );
  const missingFileCount = Number(payload?.missingFileCount ?? 0);

  if (
    manifestCandidate &&
    reportArtifact &&
    fileExistsNonEmpty(reportArtifact.path) &&
    deliveredCount >= expectedCount &&
    missingFileCount === 0
  ) {
    return {
      status: "pass",
      reason: `Relaxed paper pipeline review passed: final delivery manifest/report exist and ${deliveredCount} papers were delivered with no missing files.`,
      missing_criteria: [],
    };
  }

  if (manifestCandidate && deliveredCount > 0) {
    return {
      status: "revise",
      reason: "Relaxed paper pipeline review found a delivery manifest, but the delivered paper count or file completeness is still below the target.",
      missing_criteria: [...todo.acceptance_criteria],
    };
  }

  return null;
}

export function maybeRunPaperPipelineRelaxedReview(
  todo: TodoItem,
  executorResult: TodoExecutorResult,
  context: TodoExecutionContext,
  active: boolean,
): TodoReviewResult | null {
  if (!active) {
    return null;
  }

  if (todo.capability_type === "collection") {
    return relaxedCollectionReview(todo, executorResult);
  }
  if (todo.capability_type === "merge") {
    return relaxedMergeReview(todo, executorResult);
  }
  if (todo.capability_type === "verification") {
    return relaxedVerificationReview(todo, executorResult, context);
  }
  if (todo.capability_type === "writing") {
    return relaxedDeliveryReview(todo, executorResult);
  }
  return null;
}

export function buildPaperPipelineRelaxedPromptBlock(active: boolean) {
  if (!active) {
    return "";
  }

  return [
    "## Review Profile",
    "paper_pipeline_relaxed",
    "",
    "Special handling for this todo:",
    "- Prioritize observable deliverables such as PDF count, manifest presence, and downstream-ready files.",
    "- For paper collection todos, do NOT fail solely because the papers are broader than a requested subtopic or because year/topic boundaries are fuzzy.",
    "- If the batch produced the required number of usable papers plus a structured manifest, prefer pass or revise over semantic nitpicking.",
    "- For merge and delivery todos, focus on deterministic output completeness rather than topical purity.",
    "",
  ].join("\n");
}
