// Skill contract: local filesystem only — reads manifest, checks file sizes, reports results.
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
    .slice(0, 64) || "paper_verify";
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
    "# 论文完整性校验",
    "",
    `- 总检查数：${payload.checkedCount}`,
    `- 通过数：${payload.passedCount}`,
    `- 失败数：${payload.failedCount}`,
    `- 全部通过：${payload.allPassed ? "是" : "否"}`,
    "",
    "## 逐项结果",
    "",
  ];

  for (const item of payload.checks) {
    lines.push(`- [${item.ok ? "PASS" : "FAIL"}] ${item.arxivId || item.title || "unknown"}`);
    lines.push(`  - 路径: ${item.filePath || "missing"}`);
    lines.push(`  - 大小: ${item.sizeBytes}`);
    lines.push(`  - 原因: ${item.reason}`);
  }

  return lines.join("\n");
}

function main() {
  const input = getInput();
  const manifestPath = ensureJsonPath(input.manifestPath || input.deliveryManifestPath || "");
  if (!manifestPath) {
    throw new Error("manifestPath is required");
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }

  const requiredCount = Math.max(1, Number(input.requiredCount || 20));
  const outputLabel = String(input.outputLabel || "").trim();
  const rootOutputDir = resolve(process.env.AGENT_OUTPUT_DIR || ".output/v0_2/skill_runs/paper_verify");
  const targetOutputDir = outputLabel
    ? join(rootOutputDir, sanitizeSegment(outputLabel))
    : rootOutputDir;
  mkdirSync(targetOutputDir, { recursive: true });

  const papers = loadManifest(manifestPath).slice(0, requiredCount);
  const checks = papers.map((paper) => {
    const filePath = typeof paper.filePath === "string" ? paper.filePath : "";
    if (!filePath || !existsSync(filePath)) {
      return {
        ok: false,
        arxivId: paper.arxivId,
        title: paper.title,
        filePath,
        sizeBytes: 0,
        reason: "file_missing",
      };
    }
    const sizeBytes = statSync(filePath).size;
    return {
      ok: sizeBytes > 0,
      arxivId: paper.arxivId,
      title: paper.title,
      filePath,
      sizeBytes,
      reason: sizeBytes > 0 ? "ok" : "empty_file",
    };
  });

  const passedCount = checks.filter((item) => item.ok).length;
  const failedCount = checks.length - passedCount;
  const payload = {
    ok: true,
    skill: "paper_integrity_verify_skill",
    sourceManifestPath: manifestPath,
    manifestPath: join(targetOutputDir, "verification_manifest.json"),
    reportPath: join(targetOutputDir, "verification_report.md"),
    checkedCount: checks.length,
    requiredCount,
    passedCount,
    failedCount,
    allPassed: failedCount === 0 && checks.length === requiredCount,
    checks,
  };

  writeFileSync(payload.manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(payload.reportPath, `${buildMarkdownReport(payload)}\n`, "utf8");
  process.stdout.write(JSON.stringify(payload));
}

main();
