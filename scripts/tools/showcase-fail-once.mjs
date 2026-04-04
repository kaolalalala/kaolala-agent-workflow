import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const DEFAULT_OUTPUT_DIR = resolve(process.cwd(), process.env.AGENT_WORKFLOW_OUTPUT_DIR || ".output/v0_2");
const TOOL_OUTPUT_DIR = resolve(process.env.TOOL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);

function getInput() {
  try {
    return JSON.parse(process.env.TOOL_INPUT || "{}");
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function ensureAllowedPath(targetPath) {
  const full = isAbsolute(targetPath) ? targetPath : resolve(TOOL_OUTPUT_DIR, targetPath);
  if (!full.toLowerCase().startsWith(TOOL_OUTPUT_DIR.toLowerCase())) {
    throw new Error(`path is not allowed: ${full}`);
  }
  return full;
}

function sanitizeSegment(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").slice(0, 80);
}

async function main() {
  const input = getInput();
  const key = sanitizeSegment(input.key, "default");
  const delayMs = Math.max(0, Math.min(10_000, Number(input.delayMs ?? 800) || 0));
  const message = String(input.message || "intentional showcase failure").trim();
  const successText = String(input.successText || "recovered after single failure").trim();
  const artifactName = sanitizeSegment(input.artifactName, `fail-once-${key}.json`);

  const stateDir = ensureAllowedPath(".showcase-state");
  mkdirSync(stateDir, { recursive: true });
  const statePath = ensureAllowedPath(`.showcase-state/${key}.json`);

  let attempt = 0;
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      attempt = Number(state.attempt ?? 0);
    } catch {
      attempt = 0;
    }
  }
  attempt += 1;
  writeFileSync(statePath, JSON.stringify({ key, attempt, updatedAt: new Date().toISOString() }, null, 2), "utf8");

  await sleep(delayMs);

  if (attempt === 1) {
    throw new Error(`${message} [attempt=${attempt}]`);
  }

  const outputPath = ensureAllowedPath(artifactName);
  mkdirSync(dirname(outputPath), { recursive: true });
  const payload = {
    ok: true,
    key,
    attempt,
    path: outputPath,
    successText,
    recoveredAt: new Date().toISOString(),
  };
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  process.stdout.write(JSON.stringify(payload));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
