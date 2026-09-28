import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname } from "node:path";

import { outputManager } from "@/server/runtime/output-manager";
import type { LLMWithToolsResult } from "../../llm-helper";
import type { DelegationBrief } from "../types";

export interface ExecutionArtifact {
  path: string;
  type: string;
  summary: string;
}

function pushUnique(target: string[], seen: Set<string>, entry: string) {
  const normalized = entry.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function readStructuredArtifactCount(filePath: string) {
  if (!existsSync(filePath) || !filePath.toLowerCase().endsWith(".json")) return 0;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (Array.isArray(parsed.papers)) return parsed.papers.length;
    if (typeof parsed.deliveredCount === "number") return parsed.deliveredCount;
    if (typeof parsed.mergedCount === "number") return parsed.mergedCount;
  } catch {
    return 0;
  }
  return 0;
}

function pickBestArtifactPath(paths: string[], type: "manifest" | "report") {
  const deduped = Array.from(new Set(paths.filter((item) => existsSync(item))));
  if (deduped.length === 0) return null;
  if (type === "report") {
    return deduped
      .sort((left, right) => Number(statSync(right).size) - Number(statSync(left).size))[0] ?? null;
  }
  return deduped
    .sort((left, right) => readStructuredArtifactCount(right) - readStructuredArtifactCount(left))[0] ?? null;
}

function shouldNormalizeDeliveryOutputs(brief: DelegationBrief) {
  const text = [
    brief.todo_title,
    brief.todo_description,
    ...brief.acceptance_criteria,
  ].join("\n").toLowerCase();
  return /deliver|delivery|浜や粯|浜や粯鍖厊鏈€缁堟竻鍗晐final package/.test(text);
}

export function collectPaperPipelineStructuredCriteriaEvidence(result?: Record<string, unknown> | null) {
  if (!result) return [] as string[];

  const evidence: string[] = [];
  const seen = new Set<string>();
  const fields: Array<[string, string]> = [
    ["downloadedCount", "downloadedCount"],
    ["mergedCount", "mergedCount"],
    ["deliveredCount", "deliveredCount"],
    ["missingFileCount", "missingFileCount"],
    ["manifestFinalPath", "manifestFinalPath"],
    ["reportFinalPath", "reportFinalPath"],
    ["labeledManifestPath", "labeledManifestPath"],
    ["labeledManifestFinalPath", "labeledManifestFinalPath"],
    ["labeledReportPath", "labeledReportPath"],
    ["labeledReportFinalPath", "labeledReportFinalPath"],
  ];

  for (const [field, label] of fields) {
    const value = result[field];
    if (typeof value === "number") {
      pushUnique(evidence, seen, `${label}=${value}`);
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      pushUnique(evidence, seen, `${label}=${value.trim()}`);
    }
  }

  const manifestPath = typeof result.manifestPath === "string" ? result.manifestPath.trim() : "";
  const reportPath = typeof result.reportPath === "string" ? result.reportPath.trim() : "";
  if (manifestPath && /final_delivery_manifest\.json$/i.test(manifestPath)) {
    pushUnique(evidence, seen, `finalDeliveryManifestPath=${manifestPath}`);
  }
  if (manifestPath && /merged_paper_manifest\.json$/i.test(manifestPath)) {
    pushUnique(evidence, seen, `mergedManifestPath=${manifestPath}`);
  }
  if (reportPath && /final_delivery_report\.md$/i.test(reportPath)) {
    pushUnique(evidence, seen, `finalDeliveryReportPath=${reportPath}`);
  }

  return evidence;
}

export function collectPaperPipelineArtifactCriteriaEvidence(artifacts: ExecutionArtifact[]) {
  const evidence: string[] = [];
  const seen = new Set<string>();

  for (const artifact of artifacts) {
    const artifactPath = artifact.path.trim();
    if (!artifactPath) continue;

    const lowerBase = basename(artifactPath).toLowerCase();
    if (lowerBase === "final_delivery_manifest.json") {
      pushUnique(evidence, seen, `finalDeliveryManifestPath=${artifactPath}`);
    } else if (lowerBase === "final_delivery_report.md") {
      pushUnique(evidence, seen, `finalDeliveryReportPath=${artifactPath}`);
    } else if (lowerBase === "merged_paper_manifest.json") {
      pushUnique(evidence, seen, `mergedManifestPath=${artifactPath}`);
    }
  }

  return evidence;
}

export function summarizePaperPipelineRecoveredToolResult(toolName: string, result: Record<string, unknown>) {
  const manifestPath = typeof result.manifestPath === "string" ? result.manifestPath : "";
  if (typeof result.downloadedCount === "number") {
    return `Recovered successful tool output from ${toolName}: downloaded ${result.downloadedCount} item(s).`;
  }
  if (typeof result.deliveredCount === "number") {
    const manifestNote = manifestPath ? ` manifestPath=${manifestPath}.` : "";
    const missingNote = typeof result.missingFileCount === "number"
      ? ` missingFileCount=${result.missingFileCount}.`
      : "";
    return `Recovered successful tool output from ${toolName}: delivered ${result.deliveredCount} item(s).${missingNote}${manifestNote}`;
  }
  if (typeof result.mergedCount === "number") {
    const manifestNote = manifestPath ? ` manifestPath=${manifestPath}.` : "";
    return `Recovered successful tool output from ${toolName}: merged ${result.mergedCount} unique item(s).${manifestNote}`;
  }
  return null;
}

export function scorePaperPipelineRecoveredToolCall(
  call: LLMWithToolsResult["tool_calls_made"][number],
  index: number,
) {
  const manifestPath = typeof call.result.manifestPath === "string"
    ? call.result.manifestPath.toLowerCase()
    : "";
  const reportPath = typeof call.result.reportPath === "string"
    ? call.result.reportPath.toLowerCase()
    : "";

  if (typeof call.result.deliveredCount === "number") {
    return 4000 + call.result.deliveredCount * 10 + index;
  }
  if (manifestPath.endsWith("final_delivery_manifest.json") || reportPath.endsWith("final_delivery_report.md")) {
    return 3900 + index;
  }
  if (typeof call.result.mergedCount === "number") {
    return 2000 + call.result.mergedCount * 10 + index;
  }
  if (manifestPath.endsWith("merged_paper_manifest.json")) {
    return 1900 + index;
  }
  if (typeof call.result.downloadedCount === "number") {
    return 1000 + call.result.downloadedCount * 10 + index;
  }
  return null;
}

export function normalizePaperPipelineArtifacts(
  brief: DelegationBrief,
  artifacts: ExecutionArtifact[],
) {
  if (!shouldNormalizeDeliveryOutputs(brief)) {
    return artifacts;
  }

  const manifestPaths = artifacts
    .filter((artifact) => artifact.type === "manifest")
    .map((artifact) => artifact.path);
  const reportPaths = artifacts
    .filter((artifact) => artifact.type === "report")
    .map((artifact) => artifact.path);

  const bestManifestPath = pickBestArtifactPath(manifestPaths, "manifest");
  const bestReportPath = pickBestArtifactPath(reportPaths, "report");
  if (!bestManifestPath && !bestReportPath) {
    return artifacts;
  }

  const canonicalManifestPath = outputManager.normalizeOutputPath(
    brief.run_id,
    brief.todo_id,
    "final_delivery/final_delivery_manifest.json",
    "final_delivery_manifest.json",
  );
  const canonicalReportPath = outputManager.normalizeOutputPath(
    brief.run_id,
    brief.todo_id,
    "final_delivery/final_delivery_report.md",
    "final_delivery_report.md",
  );

  try {
    if (bestManifestPath) {
      mkdirSync(dirname(canonicalManifestPath), { recursive: true });
      copyFileSync(bestManifestPath, canonicalManifestPath);
    }
    if (bestReportPath) {
      mkdirSync(dirname(canonicalReportPath), { recursive: true });
      copyFileSync(bestReportPath, canonicalReportPath);
    }
  } catch {
    return artifacts;
  }

  const next = [...artifacts];
  if (bestManifestPath) {
    next.push({
      path: canonicalManifestPath,
      type: "manifest",
      summary: "Canonical final delivery manifest.",
    });
  }
  if (bestReportPath) {
    next.push({
      path: canonicalReportPath,
      type: "report",
      summary: "Canonical final delivery report.",
    });
  }
  return next;
}
