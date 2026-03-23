import type { IPty } from "node-pty";

interface TerminalSession {
  pty: IPty;
  cwd: string;
  createdAt: number;
}

const sessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

export const terminalManager = {
  /** Spawn a new PTY session */
  spawn(sessionId: string, cwd: string, cols = 80, rows = 24): IPty {
    // Kill existing session if any
    this.kill(sessionId);

    // Dynamic import node-pty (native module)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pty = require("node-pty") as typeof import("node-pty");

    const shell = getDefaultShell();
    const args = process.platform === "win32" ? [] : ["-l"];

    const ptyProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    sessions.set(sessionId, {
      pty: ptyProcess,
      cwd,
      createdAt: Date.now(),
    });

    return ptyProcess;
  },

  /** Write data to a PTY session */
  write(sessionId: string, data: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      session.pty.write(data);
    }
  },

  /** Resize a PTY session */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = sessions.get(sessionId);
    if (session) {
      session.pty.resize(cols, rows);
    }
  },

  /** Kill a PTY session */
  kill(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      try {
        session.pty.kill();
      } catch {
        // Already dead
      }
      sessions.delete(sessionId);
    }
  },

  /** Get a session */
  get(sessionId: string): TerminalSession | undefined {
    return sessions.get(sessionId);
  },

  /** Check if a session exists */
  has(sessionId: string): boolean {
    return sessions.has(sessionId);
  },

  /** Kill all sessions */
  killAll(): void {
    for (const [id] of sessions) {
      this.kill(id);
    }
  },
};
