import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface LegacyDependencyItem {
  file: string;
  line: number;
  excerpt: string;
}

export interface LegacyDependencyAudit {
  legacy_only_paths: LegacyDependencyItem[];
  legacy_compatible_paths: LegacyDependencyItem[];
  safe_to_delete: Array<{ path: string; removed: boolean }>;
  unknown_dependency: LegacyDependencyItem[];
}

export interface LegacyRegressionSummary {
  api: boolean;
  ui: boolean;
  e2e: boolean;
  tsc: boolean;
  tests: boolean;
  deadPathGuardTriggeredCount: number;
}

export interface LegacyRemovalReadiness {
  ready_to_delete: boolean;
  blocking_reasons: string[];
  warnings: string[];
  audit: LegacyDependencyAudit;
}

const SCAN_ROOTS = ["src", "app", "scripts"];
const IGNORE_DIRS = new Set([".git", ".next", "node_modules", "dist", "coverage"]);
const CODE_FILE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const LEGACY_ONLY_PATTERNS: RegExp[] = [
  /\bMETA_AGENT_PRIMARY_RUNTIME_MODE\b/,
  /\bPrimaryRuntimeMode\b/,
  /\bassertLegacyMainLoopAllowed\b/,
  /\bLegacyDeadPathError\b/,
  /\bmode\s*===\s*["']legacy["']\b/,
  /\brunMetaAgent\([^)]*legacy/i,
];

const LEGACY_COMPATIBLE_ALLOW_PATTERNS: RegExp[] = [
  /\bpruneLegacyExampleWorkflows\b/,
  /\btryParseLegacyPayload\b/,
  /Legacy DB compatibility/i,
];

const REMOVAL_TARGETS = [
  "src/server/meta-agent/runtime-mode.ts",
  "src/server/__tests__/meta-todo-legacy-dead-path.test.ts",
];

function walkFiles(absDir: string, rootDir: string, files: string[]) {
  if (!statSync(absDir).isDirectory()) return;
  for (const entry of readdirSync(absDir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const nextAbs = path.join(absDir, entry);
    const stats = statSync(nextAbs);
    if (stats.isDirectory()) {
      walkFiles(nextAbs, rootDir, files);
      continue;
    }
    const ext = path.extname(entry).toLowerCase();
    if (!CODE_FILE_EXT.has(ext)) continue;
    files.push(path.relative(rootDir, nextAbs).replace(/\\/g, "/"));
  }
}

function scanFileForLegacy(filePathAbs: string, filePathRel: string) {
  if (
    filePathRel === "src/server/meta-agent/legacy-removal-readiness.ts" ||
    filePathRel === "src/server/__tests__/meta-agent-ui-regression.test.ts" ||
    filePathRel === "src/server/__tests__/meta-todo-post-removal.test.ts"
  ) {
    return {
      legacyOnly: [] as LegacyDependencyItem[],
      legacyCompatible: [] as LegacyDependencyItem[],
      unknown: [] as LegacyDependencyItem[],
    };
  }

  const content = readFileSync(filePathAbs, "utf8");
  const lines = content.split(/\r?\n/);
  const legacyOnly: LegacyDependencyItem[] = [];
  const legacyCompatible: LegacyDependencyItem[] = [];
  const unknown: LegacyDependencyItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const hasLegacyWord = /legacy/i.test(line);
    if (!hasLegacyWord) continue;

    const item: LegacyDependencyItem = {
      file: filePathRel,
      line: i + 1,
      excerpt: line.trim().slice(0, 240),
    };

    if (LEGACY_ONLY_PATTERNS.some((pattern) => pattern.test(line))) {
      legacyOnly.push(item);
      continue;
    }

    if (LEGACY_COMPATIBLE_ALLOW_PATTERNS.some((pattern) => pattern.test(line))) {
      legacyCompatible.push(item);
      continue;
    }

    unknown.push(item);
  }

  return { legacyOnly, legacyCompatible, unknown };
}

export function auditLegacyDependencies(rootDir = process.cwd()): LegacyDependencyAudit {
  const files: string[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absRoot = path.join(rootDir, scanRoot);
    try {
      walkFiles(absRoot, rootDir, files);
    } catch {
      // ignore missing roots
    }
  }

  const audit: LegacyDependencyAudit = {
    legacy_only_paths: [],
    legacy_compatible_paths: [],
    safe_to_delete: REMOVAL_TARGETS.map((target) => ({
      path: target,
      removed: !statSafe(path.join(rootDir, target)),
    })),
    unknown_dependency: [],
  };

  for (const rel of files) {
    const abs = path.join(rootDir, rel);
    const scanned = scanFileForLegacy(abs, rel);
    audit.legacy_only_paths.push(...scanned.legacyOnly);
    audit.legacy_compatible_paths.push(...scanned.legacyCompatible);
    audit.unknown_dependency.push(...scanned.unknown);
  }

  return audit;
}

function statSafe(absPath: string) {
  try {
    return statSync(absPath);
  } catch {
    return null;
  }
}

function hasTodoDrivenMainEntry(rootDir: string) {
  const servicePath = path.join(rootDir, "src/server/meta-agent/meta-agent-service.ts");
  const text = readFileSync(servicePath, "utf8");
  return /runTodoDrivenOrchestrator/.test(text) && /fallback:\s*"disabled"/.test(text);
}

function hasSilentLegacyFallback(rootDir: string) {
  const servicePath = path.join(rootDir, "src/server/meta-agent/meta-agent-service.ts");
  const text = readFileSync(servicePath, "utf8");
  return /\bmode\s*===\s*["']legacy["']/.test(text) || /\bassertLegacyMainLoopAllowed\b/.test(text);
}

export function checkLegacyRemovalReadiness(
  regression: LegacyRegressionSummary,
  rootDir = process.cwd(),
): LegacyRemovalReadiness {
  const audit = auditLegacyDependencies(rootDir);
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (audit.legacy_only_paths.length > 0) {
    blocking.push(`legacy_only_paths_detected=${audit.legacy_only_paths.length}`);
  }

  if (!hasTodoDrivenMainEntry(rootDir)) {
    blocking.push("todo_driven_main_entry_missing_or_not_enforced");
  }

  if (hasSilentLegacyFallback(rootDir)) {
    blocking.push("silent_or_explicit_legacy_fallback_detected");
  }

  if (!regression.api) blocking.push("api_regression_failed");
  if (!regression.ui) blocking.push("ui_regression_failed");
  if (!regression.e2e) blocking.push("e2e_regression_failed");
  if (!regression.tsc) blocking.push("tsc_failed");
  if (!regression.tests) blocking.push("tests_failed");
  if (regression.deadPathGuardTriggeredCount > 0) {
    blocking.push(`dead_path_guard_triggered_count=${regression.deadPathGuardTriggeredCount}`);
  }

  if (audit.legacy_compatible_paths.length > 0) {
    warnings.push(`legacy_compatible_paths=${audit.legacy_compatible_paths.length}`);
  }
  if (audit.unknown_dependency.length > 0) {
    warnings.push(`unknown_dependency=${audit.unknown_dependency.length}`);
  }
  for (const target of audit.safe_to_delete) {
    if (!target.removed) {
      warnings.push(`removal_target_still_exists=${target.path}`);
    }
  }

  return {
    ready_to_delete: blocking.length === 0,
    blocking_reasons: blocking,
    warnings,
    audit,
  };
}
