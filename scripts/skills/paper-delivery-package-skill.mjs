// Skill contract: local filesystem only — reads merged manifest, generates delivery report.
// No network, no spawning, no scope-expanding decisions. See SKILL_CONTRACT.md.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

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
    .slice(0, 64) || "paper_delivery";
}

function ensureJsonPath(inputPath) {
  const resolved = resolve(String(inputPath || ""));
  if (extname(resolved).toLowerCase() === ".json") {
    return resolved;
  }
  if (basename(resolved).toLowerCase() === "manifest.md") {
    return join(dirname(resolved), "manifest.json");
  }
  return resolved;
}

function loadManifest(filePath) {
  const text = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(text);
  return Array.isArray(parsed.papers) ? parsed.papers : [];
}

function buildMarkdownReport(payload) {
  const lines = [
    "# 论文交付包",
    "",
    `- 交付论文数：${payload.deliveredCount}`,
    `- 目标论文数：${payload.requiredCount}`,
    `- 缺失文件数：${payload.missingFileCount}`,
    "",
    "## 论文清单",
    "",
  ];

  for (const paper of payload.papers) {
    lines.push(`- ${paper.title || "未命名论文"}`);
    lines.push(`  - arXiv ID: ${paper.arxivId || "unknown"}`);
    lines.push(`  - PDF: ${paper.filePath || "missing"}`);
    lines.push(`  - 来源: ${paper.absUrl || "unknown"}`);
  }

  if (payload.missingFiles.length > 0) {
    lines.push("");
    lines.push("## 缺失文件");
    lines.push("");
    for (const item of payload.missingFiles) {
      lines.push(`- ${item.arxivId || item.title || "unknown"} -> ${item.filePath || "missing path"}`);
    }
  }

  return lines.join("\n");
}

function main() {
  const input = getInput();
  const manifestPath = ensureJsonPath(input.manifestPath || input.mergedManifestPath || "");
  if (!manifestPath) {
    throw new Error("manifestPath is required");
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }

  const requiredCount = Math.max(1, Number(input.requiredCount || 20));
  const outputLabel = String(input.outputLabel || "").trim();
  const rootOutputDir = resolve(process.env.AGENT_OUTPUT_DIR || ".output/v0_2/skill_runs/paper_delivery");
  const targetOutputDir = outputLabel
    ? join(rootOutputDir, sanitizeSegment(outputLabel))
    : rootOutputDir;
  mkdirSync(targetOutputDir, { recursive: true });

  const papers = loadManifest(manifestPath).slice(0, requiredCount);
  const missingFiles = papers.filter((paper) => {
    if (!paper || typeof paper !== "object" || typeof paper.filePath !== "string" || !paper.filePath.trim()) {
      return true;
    }
    if (!existsSync(paper.filePath)) {
      return true;
    }
    return statSync(paper.filePath).size <= 0;
  });

  const deliveryManifestPath = join(targetOutputDir, "final_delivery_manifest.json");
  const reportPath = join(targetOutputDir, "final_delivery_report.md");
  const payload = {
    ok: true,
    skill: "paper_delivery_package_skill",
    sourceManifestPath: manifestPath,
    manifestPath: deliveryManifestPath,
    reportPath,
    requiredCount,
    deliveredCount: papers.length,
    missingFileCount: missingFiles.length,
    missingFiles,
    papers,
  };

  writeFileSync(deliveryManifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, `${buildMarkdownReport(payload)}\n`, "utf8");
  process.stdout.write(JSON.stringify(payload));
}

main();
