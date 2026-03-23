import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve } from "node:path";

import { makeId } from "@/lib/utils";

const BASE_OUTPUT_ROOT = resolve(process.cwd(), ".output", "v0_2");
const TMP_PREFIXES = ["/tmp", "\\tmp", "tmp/"];
const PATH_FIELD_NAMES = [
  "outputPath",
  "output_path",
  "targetPath",
  "target_path",
  "destinationPath",
  "destination_path",
];

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileName(name: string, fallback = "output.txt") {
  const trimmed = name.trim();
  const base = trimmed ? parse(trimmed).base || trimmed : fallback;
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180);
  return cleaned || fallback;
}

function inferFileName(requestedPath?: string, fallback = "output.txt") {
  if (!requestedPath?.trim()) {
    return fallback;
  }
  return safeFileName(parse(requestedPath.trim()).base || fallback, fallback);
}

export class OutputManager {
  readonly baseOutputRoot = BASE_OUTPUT_ROOT;

  getRunNodeOutputDir(runId: string, nodeId: string) {
    return ensureDir(join(this.baseOutputRoot, runId, nodeId));
  }

  normalizeOutputPath(runId: string, nodeId: string, requestedPath?: string, fallbackFileName = "output.txt") {
    const safeDir = this.getRunNodeOutputDir(runId, nodeId);
    const requested = requestedPath?.trim();

    if (!requested) {
      return join(safeDir, safeFileName(fallbackFileName, "output.txt"));
    }

    const lower = requested.toLowerCase();
    if (TMP_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      return join(safeDir, inferFileName(requested, fallbackFileName));
    }

    if (isAbsolute(requested)) {
      return join(safeDir, inferFileName(requested, fallbackFileName));
    }

    return normalize(join(safeDir, requested));
  }

  writeNodeTextOutput(runId: string, nodeId: string, content: string, requestedPath?: string, fallbackFileName = "output.txt") {
    const finalPath = this.normalizeOutputPath(runId, nodeId, requestedPath, fallbackFileName);
    ensureDir(dirname(finalPath));
    writeFileSync(finalPath, content, "utf8");
    return finalPath;
  }

  normalizeToolInputPaths(runId: string, nodeId: string, input: Record<string, unknown>) {
    const next: Record<string, unknown> = { ...input };
    for (const field of PATH_FIELD_NAMES) {
      const value = next[field];
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      next[field] = this.normalizeOutputPath(runId, nodeId, value, "tool-output.txt");
    }
    return next;
  }

  collectOutputFiles(...roots: Array<string | undefined>) {
    const results = new Set<string>();

    const visit = (root: string) => {
      if (!existsSync(root)) {
        return;
      }
      const stat = statSync(root);
      if (stat.isFile()) {
        results.add(root);
        return;
      }
      if (!stat.isDirectory()) {
        return;
      }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        visit(join(root, entry.name));
      }
    };

    for (const root of roots) {
      if (root) {
        visit(root);
      }
    }

    return Array.from(results).sort();
  }

  toProjectRelativePath(filePath: string) {
    return relative(process.cwd(), filePath).replace(/\\/g, "/");
  }

  createRunScopedFileName(prefix: string, ext = ".md") {
    const finalExt = ext.startsWith(".") ? ext : `.${ext}`;
    return `${prefix}-${makeId("out")}${finalExt}`;
  }
}

export const outputManager = new OutputManager();
