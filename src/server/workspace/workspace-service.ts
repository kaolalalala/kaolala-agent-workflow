import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

import JSZip from "jszip";

const STORAGE_ROOT = resolve(process.cwd(), ".data", "workspaces");

export interface WorkspaceFileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  updatedAt: string;
}

export interface WorkspaceFileTree {
  workspaceId: string;
  files: WorkspaceFileInfo[];
}

// Characters that must never appear in workspace-relative paths
const UNSAFE_PATH_PATTERN = /\.\.|[<>:"|?*\0]/;

function workspacePath(workspaceId: string): string {
  if (!workspaceId || UNSAFE_PATH_PATTERN.test(workspaceId)) {
    throw new Error("无效的 workspace ID");
  }
  return join(STORAGE_ROOT, workspaceId);
}

function safeFilePath(workspaceId: string, filePath: string): string {
  if (!filePath || UNSAFE_PATH_PATTERN.test(filePath)) {
    throw new Error("无效的文件路径");
  }
  const wsRoot = workspacePath(workspaceId);
  const resolved = resolve(wsRoot, filePath);
  // Ensure resolved path is within workspace root (prevent path traversal)
  if (!resolved.startsWith(wsRoot)) {
    throw new Error("文件路径不允许超出 workspace 目录");
  }
  return resolved;
}

function ensureWorkspaceDir(workspaceId: string): string {
  const dir = workspacePath(workspaceId);
  mkdirSync(dir, { recursive: true });
  // Ensure inputs subdirectory exists
  mkdirSync(join(dir, "inputs"), { recursive: true });
  return dir;
}

function scanDir(dir: string, wsRoot: string): WorkspaceFileInfo[] {
  if (!existsSync(dir)) return [];
  const results: WorkspaceFileInfo[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const stat = statSync(fullPath);
    const relPath = relative(wsRoot, fullPath).replace(/\\/g, "/");
    results.push({
      name: entry.name,
      path: relPath,
      isDirectory: entry.isDirectory(),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
    if (entry.isDirectory()) {
      results.push(...scanDir(fullPath, wsRoot));
    }
  }
  return results;
}

// Maximum individual file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Maximum total workspace size: 20MB
const MAX_WORKSPACE_SIZE = 20 * 1024 * 1024;

function getWorkspaceSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getWorkspaceSize(fullPath);
    } else {
      total += statSync(fullPath).size;
    }
  }
  return total;
}

// Text-editable file extensions
const TEXT_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".md", ".txt",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh",
  ".bash", ".bat", ".ps1", ".csv", ".xml", ".html", ".css",
  ".sql", ".r", ".jl", ".lua", ".rb", ".go", ".rs", ".c",
  ".cpp", ".h", ".hpp", ".java", ".kt", ".swift", ".env",
]);

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export const workspaceService = {
  /** List all workspace IDs that exist on disk */
  listWorkspaces(): string[] {
    if (!existsSync(STORAGE_ROOT)) return [];
    return readdirSync(STORAGE_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  },

  /** Ensure workspace directory exists and return its ID */
  ensureWorkspace(workspaceId: string): string {
    ensureWorkspaceDir(workspaceId);
    return workspaceId;
  },

  /** List all files in workspace */
  listFiles(workspaceId: string): WorkspaceFileTree {
    const wsRoot = workspacePath(workspaceId);
    const files = scanDir(wsRoot, wsRoot);
    return { workspaceId, files };
  },

  /** Read a file's content (text files only) */
  readFile(workspaceId: string, filePath: string): { content: string; name: string; size: number } {
    const absPath = safeFilePath(workspaceId, filePath);
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

  /** Write (create or update) a file */
  writeFile(workspaceId: string, filePath: string, content: string): WorkspaceFileInfo {
    const absPath = safeFilePath(workspaceId, filePath);
    const contentBuffer = Buffer.from(content, "utf-8");

    if (contentBuffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    const wsRoot = workspacePath(workspaceId);
    const currentSize = getWorkspaceSize(wsRoot);
    // Subtract existing file size if overwriting
    let existingSize = 0;
    if (existsSync(absPath)) {
      existingSize = statSync(absPath).size;
    }
    if (currentSize - existingSize + contentBuffer.length > MAX_WORKSPACE_SIZE) {
      throw new Error(`Workspace 总大小超过限制 (最大 ${MAX_WORKSPACE_SIZE / 1024 / 1024}MB)`);
    }

    // Ensure parent directory exists
    const parentDir = resolve(absPath, "..");
    mkdirSync(parentDir, { recursive: true });

    writeFileSync(absPath, content, "utf-8");
    const stat = statSync(absPath);
    const relPath = relative(wsRoot, absPath).replace(/\\/g, "/");

    return {
      name: basename(absPath),
      path: relPath,
      isDirectory: false,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  },

  /** Upload a binary file from base64 */
  uploadFile(workspaceId: string, filePath: string, base64Content: string): WorkspaceFileInfo {
    const absPath = safeFilePath(workspaceId, filePath);
    const buffer = Buffer.from(base64Content, "base64");

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    const wsRoot = workspacePath(workspaceId);
    const currentSize = getWorkspaceSize(wsRoot);
    let existingSize = 0;
    if (existsSync(absPath)) {
      existingSize = statSync(absPath).size;
    }
    if (currentSize - existingSize + buffer.length > MAX_WORKSPACE_SIZE) {
      throw new Error(`Workspace 总大小超过限制 (最大 ${MAX_WORKSPACE_SIZE / 1024 / 1024}MB)`);
    }

    const parentDir = resolve(absPath, "..");
    mkdirSync(parentDir, { recursive: true });

    writeFileSync(absPath, buffer);
    const stat = statSync(absPath);
    const relPath = relative(wsRoot, absPath).replace(/\\/g, "/");

    return {
      name: basename(absPath),
      path: relPath,
      isDirectory: false,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  },

  /** Delete a file or directory */
  deleteFile(workspaceId: string, filePath: string): void {
    const absPath = safeFilePath(workspaceId, filePath);
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

  /** Create a subdirectory in the workspace */
  createDirectory(workspaceId: string, dirPath: string): WorkspaceFileInfo {
    const absPath = safeFilePath(workspaceId, dirPath);
    mkdirSync(absPath, { recursive: true });
    const wsRoot = workspacePath(workspaceId);
    const relPath = relative(wsRoot, absPath).replace(/\\/g, "/");
    return {
      name: basename(absPath),
      path: relPath,
      isDirectory: true,
      size: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  /** Import a ZIP file into workspace, extracting all entries */
  async importZip(workspaceId: string, zipBuffer: Buffer): Promise<{ imported: number }> {
    const wsRoot = ensureWorkspaceDir(workspaceId);
    const currentSize = getWorkspaceSize(wsRoot);

    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.entries(zip.files);

    // Calculate total uncompressed size
    let totalNewSize = 0;
    for (const [, file] of entries) {
      if (!file.dir) {
        const buf = await file.async("nodebuffer");
        totalNewSize += buf.length;
      }
    }
    if (currentSize + totalNewSize > MAX_WORKSPACE_SIZE) {
      throw new Error(`解压后总大小超过 workspace 限制 (最大 ${MAX_WORKSPACE_SIZE / 1024 / 1024}MB)`);
    }

    let imported = 0;

    for (const [entryPath, file] of entries) {
      // Skip macOS resource forks and hidden entries
      if (entryPath.startsWith("__MACOSX/") || entryPath.includes("/.__")) continue;

      // Normalize: strip leading single root directory if all entries share one
      let normalizedPath = entryPath;
      // Security: reject path traversal
      if (normalizedPath.includes("..") || normalizedPath.startsWith("/")) continue;

      if (file.dir) {
        const dirAbs = resolve(wsRoot, normalizedPath);
        if (!dirAbs.startsWith(wsRoot)) continue;
        mkdirSync(dirAbs, { recursive: true });
      } else {
        const fileAbs = resolve(wsRoot, normalizedPath);
        if (!fileAbs.startsWith(wsRoot)) continue;

        const buf = await file.async("nodebuffer");
        if (buf.length > MAX_FILE_SIZE) continue; // skip oversized files

        const parentDir = resolve(fileAbs, "..");
        mkdirSync(parentDir, { recursive: true });
        writeFileSync(fileAbs, buf);
        imported++;
      }
    }

    return { imported };
  },

  /** Import a ZIP file into the inputs/ subdirectory */
  async importZipToInputs(workspaceId: string, zipBuffer: Buffer): Promise<{ imported: number }> {
    const wsRoot = ensureWorkspaceDir(workspaceId);
    const inputsRoot = join(wsRoot, "inputs");
    mkdirSync(inputsRoot, { recursive: true });

    const currentSize = getWorkspaceSize(wsRoot);
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.entries(zip.files);

    let totalNewSize = 0;
    for (const [, file] of entries) {
      if (!file.dir) {
        const buf = await file.async("nodebuffer");
        totalNewSize += buf.length;
      }
    }
    if (currentSize + totalNewSize > MAX_WORKSPACE_SIZE) {
      throw new Error(`解压后总大小超过限制 (最大 ${MAX_WORKSPACE_SIZE / 1024 / 1024}MB)`);
    }

    let imported = 0;
    for (const [entryPath, file] of entries) {
      if (entryPath.startsWith("__MACOSX/") || entryPath.includes("/.__")) continue;
      const normalizedPath = entryPath;
      if (normalizedPath.includes("..") || normalizedPath.startsWith("/")) continue;

      if (file.dir) {
        const dirAbs = resolve(inputsRoot, normalizedPath);
        if (!dirAbs.startsWith(inputsRoot)) continue;
        mkdirSync(dirAbs, { recursive: true });
      } else {
        const fileAbs = resolve(inputsRoot, normalizedPath);
        if (!fileAbs.startsWith(inputsRoot)) continue;
        const buf = await file.async("nodebuffer");
        if (buf.length > MAX_FILE_SIZE) continue;
        const parentDir = resolve(fileAbs, "..");
        mkdirSync(parentDir, { recursive: true });
        writeFileSync(fileAbs, buf);
        imported++;
      }
    }
    return { imported };
  },

  /** Get the absolute path of a workspace directory (for runtime executor) */
  getWorkspaceAbsolutePath(workspaceId: string): string {
    return workspacePath(workspaceId);
  },

  /** Create a new workspace directory and return its path */
  createWorkspace(workspaceId: string): string {
    return ensureWorkspaceDir(workspaceId);
  },

  /** Delete a workspace directory and all its contents */
  deleteWorkspace(workspaceId: string): void {
    const dir = workspacePath(workspaceId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  },
};
