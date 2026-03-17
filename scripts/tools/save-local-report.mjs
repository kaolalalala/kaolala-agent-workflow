import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const DEFAULT_OUTPUT_DIR = resolve(process.cwd(), process.env.AGENT_WORKFLOW_OUTPUT_DIR || ".output/v0_2");
const ALLOWED_ABSOLUTE_PREFIXES = [DEFAULT_OUTPUT_DIR];

function getInput() {
  try {
    return JSON.parse(process.env.TOOL_INPUT || "{}");
  } catch {
    return {};
  }
}

function normalizePath(rawPath) {
  const inputPath = String(rawPath || "").trim();
  if (!inputPath) {
    return resolve(DEFAULT_OUTPUT_DIR, "agent-os-latest.md");
  }
  return inputPath;
}

function ensureAllowedPath(targetPath) {
  const full = isAbsolute(targetPath) ? targetPath : resolve(process.cwd(), targetPath);
  const allowed = ALLOWED_ABSOLUTE_PREFIXES.some((prefix) => full.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!allowed) {
    throw new Error(`path is not allowed: ${full}. allowed prefix: ${ALLOWED_ABSOLUTE_PREFIXES.join(", ")}`);
  }
  return full;
}

function main() {
  const input = getInput();
  const path = ensureAllowedPath(normalizePath(input.path));
  const content = String(input.content || "");
  if (!content.trim()) {
    throw new Error("content is required");
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");

  const output = {
    ok: true,
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    savedAt: new Date().toISOString(),
  };
  process.stdout.write(JSON.stringify(output));
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
}
