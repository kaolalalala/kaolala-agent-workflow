import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { outputManager } from "@/server/runtime/output-manager";
import { normalizeProjectId } from "./long-term-state-utils";
import { createMemoryState, type MemoryState } from "./memory-state";
import { createProjectState, type ProjectState } from "./project-state";

const PROJECT_STATE_DIR = "project_state";
const PROJECT_STATE_FILE = "project-state.json";
const MEMORY_STATE_FILE = "memory-state.json";

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

function getProjectRoot(projectId?: string | null) {
  const normalized = normalizeProjectId(projectId);
  return ensureDir(join(outputManager.baseOutputRoot, PROJECT_STATE_DIR, normalized));
}

function readJsonFile<T>(path: string) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, value: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

export function loadProjectState(projectId?: string | null, longTermGoal?: string) {
  const normalized = normalizeProjectId(projectId);
  const path = join(getProjectRoot(normalized), PROJECT_STATE_FILE);
  const parsed = readJsonFile<ProjectState>(path);
  return parsed && parsed.project_id ? parsed : createProjectState(normalized, longTermGoal);
}

export function saveProjectState(projectState: ProjectState) {
  const path = join(getProjectRoot(projectState.project_id), PROJECT_STATE_FILE);
  writeJsonFile(path, projectState);
  return path;
}

export function loadMemoryState(projectId?: string | null) {
  const normalized = normalizeProjectId(projectId);
  const path = join(getProjectRoot(normalized), MEMORY_STATE_FILE);
  const parsed = readJsonFile<MemoryState>(path);
  return parsed && parsed.project_id ? parsed : createMemoryState(normalized);
}

export function saveMemoryState(memoryState: MemoryState) {
  const path = join(getProjectRoot(memoryState.project_id), MEMORY_STATE_FILE);
  writeJsonFile(path, memoryState);
  return path;
}

export function getProjectStatePaths(projectId?: string | null) {
  const normalized = normalizeProjectId(projectId);
  const root = getProjectRoot(normalized);
  return {
    projectId: normalized,
    root,
    projectStatePath: join(root, PROJECT_STATE_FILE),
    memoryStatePath: join(root, MEMORY_STATE_FILE),
  };
}
