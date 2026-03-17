"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  workspaceId: string;
  className?: string;
}

export function TerminalPanel({ workspaceId, className }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string>("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!sessionIdRef.current || !mountedRef.current) return;
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll", sessionId: sessionIdRef.current }),
      });
      if (!res.ok) return;
      const { data, alive } = await res.json();
      if (data && terminalRef.current) {
        terminalRef.current.write(data);
      }
      if (!alive) {
        stopPolling();
      }
    } catch {
      // Silently ignore poll errors
    }
  }, [stopPolling]);

  const spawnTerminal = useCallback(async (cols: number, rows: number) => {
    const sessionId = `term_${workspaceId}_${Date.now()}`;
    sessionIdRef.current = sessionId;

    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "spawn",
          sessionId,
          workspaceId,
          cols,
          rows,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        terminalRef.current?.write(`\r\n[错误] ${err.error || "启动终端失败"}\r\n`);
        return;
      }

      // Start polling for output
      pollingRef.current = setInterval(poll, 100);
    } catch (err) {
      terminalRef.current?.write(`\r\n[错误] 启动终端失败\r\n`);
    }
  }, [workspaceId, poll]);

  useEffect(() => {
    mountedRef.current = true;
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit to container
    setTimeout(() => {
      fitAddon.fit();
      spawnTerminal(term.cols, term.rows);
    }, 50);

    // Send keystrokes to backend
    term.onData((data) => {
      if (!sessionIdRef.current) return;
      fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "write",
          sessionId: sessionIdRef.current,
          data,
        }),
      }).catch(() => {});
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        if (sessionIdRef.current && terminalRef.current) {
          fetch("/api/terminal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "resize",
              sessionId: sessionIdRef.current,
              cols: terminalRef.current.cols,
              rows: terminalRef.current.rows,
            }),
          }).catch(() => {});
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      mountedRef.current = false;
      stopPolling();
      resizeObserver.disconnect();

      // Kill the terminal session
      if (sessionIdRef.current) {
        fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "kill", sessionId: sessionIdRef.current }),
        }).catch(() => {});
        sessionIdRef.current = "";
      }

      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [workspaceId, spawnTerminal, stopPolling]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full min-h-[100px] ${className ?? ""}`}
      style={{ backgroundColor: "#1e1e2e" }}
    />
  );
}
