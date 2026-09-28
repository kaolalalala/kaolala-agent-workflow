import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { outputManager } from "@/server/runtime/output-manager";
import type { MetaAgentResult } from "./types";

const META_AGENT_SESSION_DIR = "meta_agent_sessions";

export interface PersistedMetaAgentSession {
  sessionId: string;
  status: "running" | "done" | "error";
  goal: string;
  startedAt: string;
  currentPhase?: string;
  currentStep?: number;
  currentIteration?: number;
  errorMessage?: string;
  steps?: unknown[];
  iterations: unknown[];
  supervisorRunState?: Record<string, unknown>;
  projectId?: string;
  runConfig?: {
    projectId: string;
    maxPlanningRounds: number;
    maxStepLimit: number;
    qualityThreshold: number;
    workflowTemplateId?: string;
  };
  planningContextSummary?: unknown;
  controlPlaneSummary?: unknown;
  checkpoints?: unknown[];
  replayCandidates?: unknown[];
  memoryWritebackSummary?: unknown;
  pendingInput?: {
    awaiting: boolean;
    prompt: string;
    requestedAt: string;
    timeoutAt: string;
    inputToken?: string;
  };
  result: MetaAgentResult | null;
  lastUpdatedAt: string;
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

function getSessionStoreRoot() {
  return ensureDir(join(outputManager.baseOutputRoot, META_AGENT_SESSION_DIR));
}

function getSessionFilePath(sessionId: string) {
  return join(getSessionStoreRoot(), `${sessionId}.json`);
}

function readSessionFile(path: string) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PersistedMetaAgentSession;
  } catch {
    return null;
  }
}

export function saveMetaAgentSession(session: PersistedMetaAgentSession) {
  const path = getSessionFilePath(session.sessionId);
  writeFileSync(path, JSON.stringify(session, null, 2), "utf8");
  return path;
}

export function loadMetaAgentSession(sessionId: string) {
  return readSessionFile(getSessionFilePath(sessionId));
}

export function listMetaAgentSessions() {
  const root = getSessionStoreRoot();
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);

  return files
    .map((file) => readSessionFile(join(root, file)))
    .filter((session): session is PersistedMetaAgentSession => Boolean(session))
    .sort((left, right) => {
      const leftTs = Date.parse(left.lastUpdatedAt || left.startedAt || "");
      const rightTs = Date.parse(right.lastUpdatedAt || right.startedAt || "");
      return rightTs - leftTs;
    });
}

export function removeMetaAgentSession(sessionId: string) {
  rmSync(getSessionFilePath(sessionId), { force: true });
}
