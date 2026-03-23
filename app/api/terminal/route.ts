import { NextResponse } from "next/server";

import { terminalManager } from "@/server/terminal/terminal-manager";
import { localProjectService } from "@/server/workspace/local-project-service";

/**
 * Terminal API using a buffer-based polling approach.
 * The terminal output is buffered and returned on each poll.
 * This avoids the complexity of WebSocket in Next.js App Router.
 */

// Output buffers keyed by session ID
const outputBuffers = new Map<string, string[]>();
const MAX_BUFFER_CHUNKS = 500;

function getOrCreateBuffer(sessionId: string): string[] {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = [];
    outputBuffers.set(sessionId, buf);
  }
  return buf;
}

/** POST /api/terminal — spawn / write / resize / kill / poll */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: "spawn" | "write" | "resize" | "kill" | "poll";
      sessionId: string;
      workspaceId?: string;
      data?: string;
      cols?: number;
      rows?: number;
    };

    const { action, sessionId } = body;

    switch (action) {
      case "spawn": {
        if (!body.workspaceId) {
          return NextResponse.json({ error: "缺少 workspaceId" }, { status: 400 });
        }
        const config = localProjectService.getConfig(body.workspaceId);
        if (!config) {
          return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
        }

        // Set up output buffer
        const buffer = getOrCreateBuffer(sessionId);
        buffer.length = 0;

        const pty = terminalManager.spawn(
          sessionId,
          config.localPath,
          body.cols ?? 80,
          body.rows ?? 24,
        );

        // Pipe pty output to buffer
        pty.onData((data: string) => {
          const buf = getOrCreateBuffer(sessionId);
          buf.push(data);
          // Trim buffer if too large
          if (buf.length > MAX_BUFFER_CHUNKS) {
            buf.splice(0, buf.length - MAX_BUFFER_CHUNKS);
          }
        });

        pty.onExit(() => {
          const buf = getOrCreateBuffer(sessionId);
          buf.push("\r\n[进程已退出]\r\n");
        });

        return NextResponse.json({ ok: true, pid: pty.pid });
      }

      case "write": {
        if (!terminalManager.has(sessionId)) {
          return NextResponse.json({ error: "终端不存在" }, { status: 404 });
        }
        terminalManager.write(sessionId, body.data ?? "");
        return NextResponse.json({ ok: true });
      }

      case "resize": {
        if (!terminalManager.has(sessionId)) {
          return NextResponse.json({ error: "终端不存在" }, { status: 404 });
        }
        terminalManager.resize(sessionId, body.cols ?? 80, body.rows ?? 24);
        return NextResponse.json({ ok: true });
      }

      case "kill": {
        terminalManager.kill(sessionId);
        outputBuffers.delete(sessionId);
        return NextResponse.json({ ok: true });
      }

      case "poll": {
        const buf = outputBuffers.get(sessionId);
        if (!buf) {
          return NextResponse.json({ data: "", alive: false });
        }
        // Drain buffer
        const data = buf.join("");
        buf.length = 0;
        const alive = terminalManager.has(sessionId);
        return NextResponse.json({ data, alive });
      }

      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "终端操作失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
