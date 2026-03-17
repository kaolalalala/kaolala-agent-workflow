import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { db } from "@/server/persistence/sqlite";

/* ── Types ── */

export interface LocalProjectConfig {
  id: string;
  workspaceId: string;
  localPath: string;
  entryFile?: string;
  runCommand?: string;
  environmentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalFileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  updatedAt: string;
}

/* ── Constants ── */

/** Directories to skip when scanning local projects */
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv",
  ".next", ".nuxt", "dist", "build", "target", ".tox",
  ".mypy_cache", ".pytest_cache", ".cache", ".eggs",
  "env", ".env", ".idea", ".vscode", "coverage",
  ".turbo", ".vercel", ".output",
]);

/** Max depth for directory scanning */
const MAX_SCAN_DEPTH = 8;

/** Max number of files returned from a scan */
const MAX_SCAN_FILES = 2000;

/** Text-editable file extensions */
const TEXT_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".md", ".txt",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh",
  ".bash", ".bat", ".ps1", ".csv", ".xml", ".html", ".css",
  ".sql", ".r", ".jl", ".lua", ".rb", ".go", ".rs", ".c",
  ".cpp", ".h", ".hpp", ".java", ".kt", ".swift", ".env",
  ".gitignore", ".dockerignore", ".editorconfig",
]);

/* ── Helpers ── */

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (ext === "") {
    // Check extensionless files by name
    const name = basename(filePath).toLowerCase();
    return ["makefile", "dockerfile", "readme", "license", "changelog"].includes(name);
  }
  return TEXT_EXTENSIONS.has(ext);
}

function validateLocalPath(localPath: string): void {
  if (!localPath || typeof localPath !== "string") {
    throw new Error("本地路径不能为空");
  }
  // Must be absolute
  const resolved = resolve(localPath);
  if (resolved !== localPath.replace(/[\\/]+$/, "").replace(/\//g, "\\")) {
    // On Windows, normalize slashes for comparison
    const normalizedInput = resolve(localPath);
    if (normalizedInput !== resolved) {
      throw new Error("本地路径必须为绝对路径");
    }
  }
  if (!existsSync(resolved)) {
    throw new Error(`本地路径不存在: ${localPath}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error("本地路径必须为目录");
  }
}

function safeResolvePath(rootPath: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("..")) {
    throw new Error("无效的文件路径");
  }
  const resolved = resolve(rootPath, relativePath);
  if (!resolved.startsWith(resolve(rootPath))) {
    throw new Error("文件路径不允许超出项目目录");
  }
  return resolved;
}

function scanLocalDir(
  dir: string,
  rootPath: string,
  depth: number,
  results: LocalFileInfo[],
): void {
  if (depth > MAX_SCAN_DEPTH || results.length >= MAX_SCAN_FILES) return;
  if (!existsSync(dir)) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied, etc.
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (results.length >= MAX_SCAN_FILES) break;

    // Skip ignored directories and hidden files/dirs (starting with .)
    if (entry.isDirectory() && (IGNORE_DIRS.has(entry.name) || entry.name.startsWith("."))) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    const relPath = relative(rootPath, fullPath).replace(/\\/g, "/");

    results.push({
      name: entry.name,
      path: relPath,
      isDirectory: entry.isDirectory(),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });

    if (entry.isDirectory()) {
      scanLocalDir(fullPath, rootPath, depth + 1, results);
    }
  }
}

/* ── DB Helpers ── */

interface LocalProjectRow {
  id: string;
  workspace_id: string;
  local_path: string;
  entry_file: string | null;
  run_command: string | null;
  environment_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToConfig(row: LocalProjectRow): LocalProjectConfig {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    localPath: row.local_path,
    entryFile: row.entry_file ?? undefined,
    runCommand: row.run_command ?? undefined,
    environmentId: row.environment_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ── Service ── */

export const localProjectService = {
  /** Get local project config for a workspace */
  getConfig(workspaceId: string): LocalProjectConfig | null {
    const row = db.prepare(
      "SELECT * FROM local_project_config WHERE workspace_id = ?",
    ).get(workspaceId) as LocalProjectRow | undefined;
    return row ? rowToConfig(row) : null;
  },

  /** Create or update local project config */
  saveConfig(
    workspaceId: string,
    config: { localPath: string; entryFile?: string; runCommand?: string; environmentId?: string },
  ): LocalProjectConfig {
    validateLocalPath(config.localPath);
    const now = new Date().toISOString();

    const existing = this.getConfig(workspaceId);
    if (existing) {
      db.prepare(`
        UPDATE local_project_config
        SET local_path = ?, entry_file = ?, run_command = ?, environment_id = ?, updated_at = ?
        WHERE workspace_id = ?
      `).run(
        config.localPath,
        config.entryFile ?? null,
        config.runCommand ?? null,
        config.environmentId ?? null,
        now,
        workspaceId,
      );
      return { ...existing, ...config, updatedAt: now };
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO local_project_config (id, workspace_id, local_path, entry_file, run_command, environment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      workspaceId,
      config.localPath,
      config.entryFile ?? null,
      config.runCommand ?? null,
      config.environmentId ?? null,
      now,
      now,
    );
    return {
      id,
      workspaceId,
      localPath: config.localPath,
      entryFile: config.entryFile,
      runCommand: config.runCommand,
      environmentId: config.environmentId,
      createdAt: now,
      updatedAt: now,
    };
  },

  /** Delete local project config */
  deleteConfig(workspaceId: string): void {
    db.prepare("DELETE FROM local_project_config WHERE workspace_id = ?").run(workspaceId);
  },

  /** List files in a local project directory */
  listFiles(localPath: string): LocalFileInfo[] {
    validateLocalPath(localPath);
    const results: LocalFileInfo[] = [];
    scanLocalDir(localPath, localPath, 0, results);
    return results;
  },

  /** Read a file from the local project */
  readFile(localPath: string, filePath: string): { content: string; name: string; size: number } {
    const absPath = safeResolvePath(localPath, filePath);
    if (!existsSync(absPath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      throw new Error("不能读取目录");
    }
    if (!isTextFile(absPath)) {
      throw new Error("只支持读取文本文件");
    }
    const content = readFileSync(absPath, "utf-8");
    return { content, name: basename(absPath), size: stat.size };
  },

  /** Write a file in the local project */
  writeFile(localPath: string, filePath: string, content: string): LocalFileInfo {
    const absPath = safeResolvePath(localPath, filePath);
    const parentDir = resolve(absPath, "..");
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    const stat = statSync(absPath);
    return {
      name: basename(absPath),
      path: filePath,
      isDirectory: false,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  },

  /** Create a new file or directory */
  createFile(localPath: string, filePath: string, content?: string): LocalFileInfo {
    const absPath = safeResolvePath(localPath, filePath);
    if (existsSync(absPath)) {
      throw new Error(`文件已存在: ${filePath}`);
    }
    const parentDir = resolve(absPath, "..");
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(absPath, content ?? "", "utf-8");
    const stat = statSync(absPath);
    return {
      name: basename(absPath),
      path: filePath,
      isDirectory: false,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  },

  /** Create a directory */
  createDirectory(localPath: string, dirPath: string): LocalFileInfo {
    const absPath = safeResolvePath(localPath, dirPath);
    mkdirSync(absPath, { recursive: true });
    return {
      name: basename(absPath),
      path: dirPath,
      isDirectory: true,
      size: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  /** Delete a file or directory */
  deleteFile(localPath: string, filePath: string): void {
    const absPath = safeResolvePath(localPath, filePath);
    if (!existsSync(absPath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      rmSync(absPath, { recursive: true });
    } else {
      unlinkSync(absPath);
    }
  },

  /** Get absolute path for runtime use */
  getAbsolutePath(localPath: string): string {
    validateLocalPath(localPath);
    return resolve(localPath);
  },
};
