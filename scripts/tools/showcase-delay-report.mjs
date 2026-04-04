import { mkdirSync, writeFileSync } from "node:fs";
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

function sanitizeFileSegment(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").slice(0, 80);
}

async function main() {
  const input = getInput();
  const title = String(input.title || "").trim();
  const content = String(input.content || "").trim();
  const delayMs = Math.max(0, Math.min(15_000, Number(input.delayMs ?? 2_000) || 0));
  const artifactName = sanitizeFileSegment(input.artifactName, `${sanitizeFileSegment(title, "showcase-demo")}.md`);
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};

  if (!title) {
    throw new Error("title is required");
  }
  if (!content) {
    throw new Error("content is required");
  }

  await sleep(delayMs);

  const outputPath = ensureAllowedPath(artifactName);
  mkdirSync(dirname(outputPath), { recursive: true });
  const markdown = [
    `# ${title}`,
    "",
    content,
    "",
    "## Metadata",
    "```json",
    JSON.stringify(
      {
        delayMs,
        metadata,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "```",
    "",
  ].join("\n");
  writeFileSync(outputPath, markdown, "utf8");

  process.stdout.write(
    JSON.stringify({
      ok: true,
      title,
      content,
      delayMs,
      path: outputPath,
      bytes: Buffer.byteLength(markdown, "utf8"),
      metadata,
      generatedAt: new Date().toISOString(),
    }),
  );
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
