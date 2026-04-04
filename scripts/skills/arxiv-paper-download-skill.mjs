// Skill contract: thin wrapper — delegates all I/O to one tool script (arxiv-search-download-batch).
// No network calls here, no retry loops, no scope-expanding decisions. See SKILL_CONTRACT.md.
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
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
    .slice(0, 64) || "paper_download";
}

function asPositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.floor(numeric);
}

function main() {
  const input = getInput();
  const query = String(input.query || "").trim();
  if (!query) {
    throw new Error("query is required");
  }

  const startIndex = Math.max(0, asPositiveInt(input.startIndex ?? 0, 0));
  const count = Math.min(20, Math.max(1, asPositiveInt(input.count ?? input.maxResults ?? 10, 10)));
  const outputLabel = String(input.outputLabel || "").trim();
  const rootOutputDir = resolve(
    process.env.AGENT_OUTPUT_DIR || ".output/v0_2/skill_runs/paper_download",
  );
  const targetOutputDir = outputLabel
    ? join(rootOutputDir, sanitizeSegment(outputLabel))
    : rootOutputDir;
  mkdirSync(targetOutputDir, { recursive: true });

  const delegateScriptPath = join(__dirname, "..", "tools", "arxiv-search-download-batch.mjs");
  const child = spawnSync(
    process.execPath,
    [delegateScriptPath],
    {
      cwd: __dirname,
      env: {
        ...process.env,
        TOOL_INPUT: JSON.stringify({
          query,
          startIndex,
          maxResults: count,
        }),
        TOOL_OUTPUT_DIR: targetOutputDir,
      },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (child.status !== 0) {
    const message = (child.stderr || child.stdout || "").trim() || "paper download skill failed";
    throw new Error(message);
  }

  const raw = (child.stdout || "").trim();
  if (!raw) {
    throw new Error("paper download skill returned empty output");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`paper download skill returned non-JSON output: ${raw.slice(0, 240)}`);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    skill: "arxiv_paper_download_skill",
    query,
    startIndex,
    requestedCount: count,
    outputLabel: outputLabel || undefined,
    outputDir: parsed.outputDir,
    manifestPath: parsed.manifestPath,
    downloadedCount: parsed.downloadedCount,
    failures: parsed.failures ?? [],
    papers: parsed.papers ?? [],
  }));
}

main();
