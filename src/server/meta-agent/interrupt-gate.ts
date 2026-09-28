import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { outputManager } from "@/server/runtime/output-manager";

import { emitSessionEvent } from "./session-event-bus";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 500;

interface PendingGate {
  token: string;
  resolve: (value: string) => void;
  timer: ReturnType<typeof setTimeout>;
  poller: ReturnType<typeof setInterval>;
  prompt: string;
  requestedAt: string;
  timeoutAt: string;
}

export interface PendingInputInfo {
  token: string;
  prompt: string;
  requestedAt: string;
  timeoutAt: string;
}

interface PersistedInputSubmission {
  token: string;
  value: string;
  submittedAt: string;
}

const gates = new Map<string, PendingGate>();

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
  return path;
}

function getInputStoreRoot() {
  return ensureDir(join(outputManager.baseOutputRoot, "meta_agent_inputs"));
}

function getInputStorePath(sessionId: string) {
  return join(getInputStoreRoot(), `${sessionId}.json`);
}

function clearPersistedInput(sessionId: string) {
  rmSync(getInputStorePath(sessionId), { force: true });
}

function readPersistedInput(sessionId: string): PersistedInputSubmission | null {
  const path = getInputStorePath(sessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PersistedInputSubmission;
  } catch {
    return null;
  }
}

export function persistInjectedInput(sessionId: string, token: string, value: string): void {
  const path = getInputStorePath(sessionId);
  writeFileSync(path, JSON.stringify({
    token,
    value,
    submittedAt: new Date().toISOString(),
  }, null, 2), "utf8");
}

export async function waitForInput(
  sessionId: string,
  prompt: string,
  defaultValue = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  abortGate(sessionId);
  clearPersistedInput(sessionId);

  const token = crypto.randomUUID();

  return new Promise<string>((resolve) => {
    const requestedAt = new Date().toISOString();
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

    const resume = (value: string) => {
      const gate = gates.get(sessionId);
      if (!gate || gate.token !== token) return;
      clearTimeout(gate.timer);
      clearInterval(gate.poller);
      gates.delete(sessionId);
      clearPersistedInput(sessionId);
      emitSessionEvent(sessionId, {
        type: "session_state",
        status: "running",
      });
      resolve(value);
    };

    const timer = setTimeout(() => {
      if (gates.get(sessionId)?.token === token) {
        resume(defaultValue);
      }
    }, timeoutMs);

    const poller = setInterval(() => {
      const injected = readPersistedInput(sessionId);
      if (!injected || injected.token !== token) return;
      resume(injected.value);
    }, POLL_INTERVAL_MS);

    gates.set(sessionId, {
      token,
      resolve,
      timer,
      poller,
      prompt,
      requestedAt,
      timeoutAt,
    });

    emitSessionEvent(sessionId, {
      type: "session_state",
      status: "awaiting_input",
      inputPrompt: prompt,
      inputToken: token,
    });
  });
}

export function injectInput(sessionId: string, token: string, value: string): boolean {
  const gate = gates.get(sessionId);
  if (!gate || gate.token !== token) return false;

  clearTimeout(gate.timer);
  clearInterval(gate.poller);
  gates.delete(sessionId);
  clearPersistedInput(sessionId);

  emitSessionEvent(sessionId, {
    type: "session_state",
    status: "running",
  });

  gate.resolve(value);
  return true;
}

export function abortGate(sessionId: string): void {
  const gate = gates.get(sessionId);
  if (gate) {
    clearTimeout(gate.timer);
    clearInterval(gate.poller);
    gates.delete(sessionId);
    gate.resolve("");
  }
  clearPersistedInput(sessionId);
}

export function isAwaitingInput(sessionId: string): boolean {
  return gates.has(sessionId);
}

export function getPendingInputToken(sessionId: string): string | undefined {
  return gates.get(sessionId)?.token;
}

export function getPendingInputInfo(sessionId: string): PendingInputInfo | undefined {
  const gate = gates.get(sessionId);
  if (!gate) return undefined;
  return {
    token: gate.token,
    prompt: gate.prompt,
    requestedAt: gate.requestedAt,
    timeoutAt: gate.timeoutAt,
  };
}
