// Skill contract: local filesystem only — reads manifests, deduplicates, reports missingCount.
// If missingCount > 0, the Supervisor must replan a follow-up download todo. See SKILL_CONTRACT.md.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getInput() {
  try {
    return JSON.parse(process.env.AGENT_INPUT || "{}");
  } catch {
    return {};
  }
}

function sanitizeSegment(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "paper_merge";
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function ensureJsonManifestPath(inputPath) {
  const resolved = resolve(inputPath);
  if (extname(resolved).toLowerCase() === ".json") {
    return resolved;
  }
  if (basename(resolved).toLowerCase() === "manifest.md") {
    return join(dirname(resolved), "manifest.json");
  }
  return join(resolved, "manifest.json");
}

function collectManifestPathsFromDir(rootDir, found = new Set()) {
  const resolvedRoot = resolve(rootDir);
  const entries = readdirSync(resolvedRoot, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = join(resolvedRoot, entry.name);
    if (entry.isDirectory()) {
      collectManifestPathsFromDir(nextPath, found);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase() === "manifest.json") {
      found.add(nextPath);
    }
  }
  return Array.from(found);
}

function loadManifest(filePath) {
  const text = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(text);
  return {
    path: filePath,
    query: typeof parsed.query === "string" ? parsed.query : "",
    papers: Array.isArray(parsed.papers) ? parsed.papers : [],
  };
}

function buildPaperKey(paper) {
  if (paper && typeof paper === "object") {
    if (typeof paper.arxivId === "string" && paper.arxivId.trim()) {
      return `arxiv:${paper.arxivId.trim().toLowerCase()}`;
    }
    if (typeof paper.absUrl === "string" && paper.absUrl.trim()) {
      return `abs:${paper.absUrl.trim().toLowerCase()}`;
    }
    if (typeof paper.pdfUrl === "string" && paper.pdfUrl.trim()) {
      return `pdf:${paper.pdfUrl.trim().toLowerCase()}`;
    }
    if (typeof paper.filePath === "string" && paper.filePath.trim()) {
      return `file:${paper.filePath.trim().toLowerCase()}`;
    }
  }
  return null;
}

function buildMarkdownReport(output) {
  const lines = [
    "# 论文合并结果",
    "",
    `- 合并后唯一论文数：${output.mergedCount}`,
    `- 重复论文数：${output.duplicateCount}`,
    `- 来源论文总数：${output.sourcePaperCount}`,
    `- 来源清单数：${output.sourceManifestPaths.length}`,
    `- 目标论文数：${output.requiredCount}`,
    `- 仍需补齐：${output.missingCount}`,
    "",
    "## 来源清单",
    "",
    ...output.sourceManifestPaths.map((item) => `- ${item}`),
    "",
    "## 论文列表",
    "",
  ];

  for (const paper of output.papers) {
    lines.push(`- ${paper.title || "未命名论文"}`);
    lines.push(`  - arXiv ID: ${paper.arxivId || "unknown"}`);
    lines.push(`  - 摘要页: ${paper.absUrl || "unknown"}`);
    lines.push(`  - PDF: ${paper.filePath || paper.pdfUrl || "unknown"}`);
  }

  return lines.join("\n");
}

function appendUniquePapers(target, manifests, seenKeys, papers) {
  let duplicateCount = 0;
  for (const manifest of manifests) {
    for (const paper of manifest.papers) {
      const key = buildPaperKey(paper);
      if (!key) {
        continue;
      }
      if (seenKeys.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seenKeys.add(key);
      target.push({
        ...paper,
        sourceManifestPath: manifest.path,
      });
    }
  }
  return duplicateCount;
}

function main() {
  const input = getInput();
  const manifestPaths = asStringArray(input.manifestPaths).map(ensureJsonManifestPath);
  const sourceDirs = asStringArray(input.sourceDirs);
  const discoveredManifestPaths = manifestPaths.length > 0
    ? []
    : sourceDirs.flatMap((dir) => {
        const resolvedDir = resolve(dir);
        if (!statSync(resolvedDir).isDirectory()) {
          return [];
        }
        return collectManifestPathsFromDir(resolvedDir);
      });

  const allManifestPaths = Array.from(new Set([...manifestPaths, ...discoveredManifestPaths]));
  if (allManifestPaths.length === 0) {
    throw new Error("manifestPaths 或 sourceDirs 至少需要提供一个有效来源");
  }

  const manifests = allManifestPaths.map((filePath) => loadManifest(filePath));
  let sourcePaperCount = manifests.reduce((sum, manifest) => sum + manifest.papers.length, 0);
  const requiredCount = Math.max(0, Number(input.requiredCount || sourcePaperCount || 0));
  const query = String(input.query || manifests.find((item) => item.query)?.query || "").trim();
  const deduped = [];
  const seenKeys = new Set();
  let duplicateCount = appendUniquePapers(deduped, manifests, seenKeys, manifests);

  const outputLabel = String(input.outputLabel || "").trim();
  const rootOutputDir = resolve(process.env.AGENT_OUTPUT_DIR || ".output/v0_2/skill_runs/paper_merge");
  const targetOutputDir = outputLabel
    ? join(rootOutputDir, sanitizeSegment(outputLabel))
    : rootOutputDir;
  mkdirSync(rootOutputDir, { recursive: true });
  if (targetOutputDir !== rootOutputDir) {
    mkdirSync(targetOutputDir, { recursive: true });
  }

  const allSourceManifestPaths = [...allManifestPaths];
  const selectedPapers = requiredCount > 0 ? deduped.slice(0, requiredCount) : deduped;

  const mergedManifestPath = join(rootOutputDir, "merged_paper_manifest.json");
  const mergedManifestAliasPath = join(rootOutputDir, "manifest_final.json");
  const reportPath = join(rootOutputDir, "merged_paper_manifest.md");
  const reportAliasPath = join(rootOutputDir, "manifest_final.md");
  const labeledManifestPath = join(targetOutputDir, "merged_paper_manifest.json");
  const labeledManifestAliasPath = join(targetOutputDir, "manifest_final.json");
  const labeledReportPath = join(targetOutputDir, "merged_paper_manifest.md");
  const labeledReportAliasPath = join(targetOutputDir, "manifest_final.md");
  const mergedOutput = {
    ok: true,
    skill: "paper_manifest_merge_skill",
    query,
    manifestPath: mergedManifestPath,
    manifestFinalPath: mergedManifestAliasPath,
    reportPath,
    reportFinalPath: reportAliasPath,
    labeledManifestPath,
    labeledManifestFinalPath: labeledManifestAliasPath,
    labeledReportPath,
    labeledReportFinalPath: labeledReportAliasPath,
    sourceManifestPaths: allSourceManifestPaths,
    sourceManifestCount: allSourceManifestPaths.length,
    sourcePaperCount,
    requiredCount,
    totalUniqueCount: deduped.length,
    mergedCount: selectedPapers.length,
    duplicateCount,
    missingCount: Math.max(0, requiredCount - selectedPapers.length),
    papers: selectedPapers,
  };

  writeFileSync(mergedManifestPath, `${JSON.stringify(mergedOutput, null, 2)}\n`, "utf8");
  writeFileSync(mergedManifestAliasPath, `${JSON.stringify(mergedOutput, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, `${buildMarkdownReport(mergedOutput)}\n`, "utf8");
  writeFileSync(reportAliasPath, `${buildMarkdownReport(mergedOutput)}\n`, "utf8");
  if (targetOutputDir !== rootOutputDir) {
    writeFileSync(labeledManifestPath, `${JSON.stringify(mergedOutput, null, 2)}\n`, "utf8");
    writeFileSync(labeledManifestAliasPath, `${JSON.stringify(mergedOutput, null, 2)}\n`, "utf8");
    writeFileSync(labeledReportPath, `${buildMarkdownReport(mergedOutput)}\n`, "utf8");
    writeFileSync(labeledReportAliasPath, `${buildMarkdownReport(mergedOutput)}\n`, "utf8");
  }
  process.stdout.write(JSON.stringify(mergedOutput));
}

main();
