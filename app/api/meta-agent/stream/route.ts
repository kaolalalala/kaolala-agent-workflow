/**
 * GET /api/meta-agent/stream?sessionId=xxx[&afterSeq=N]
 *
 * Server-Sent Events (SSE) 流式接口，实时推送 Meta-Agent 执行事件。
 *
 * 事件格式（每条 SSE 消息）：
 *   data: {"type":"log_line","sessionId":"...","seq":0,"actor":"...","action":"...","message":"..."}\n\n
 *   data: {"type":"step_progress","sessionId":"...","seq":1,"step":1,"phase":"todo",...}\n\n
 *   data: {"type":"session_state","sessionId":"...","seq":2,"status":"done"}\n\n
 *
 * 参数：
 *   sessionId  必填。要订阅的 session ID。
 *   afterSeq   可选，默认 -1。只接收序号 > afterSeq 的事件，用于断线重连。
 *
 * 连接生命周期：
 *   - session 状态变为 done/failed 后，服务端发送最终 session_state 事件，
 *     然后关闭流（客户端收到 readyState=2 后停止重连）。
 *   - 客户端主动关闭时（navigating away），abort signal 触发清理。
 *   - 连接超时：MAX_DURATION_MS 后自动关闭，客户端收到关闭后可重连。
 */

import { metaAgentService } from "@/server/meta-agent/meta-agent-service";
import {
  subscribeSessionEvents,
  type SessionEvent,
} from "@/server/meta-agent/session-event-bus";

/** 单连接最长保持时间（防止连接僵死）：8 分钟 */
const MAX_DURATION_MS = 8 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const afterSeqParam = url.searchParams.get("afterSeq");
  const afterSeq = afterSeqParam !== null ? Number(afterSeqParam) : -1;

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify session exists before opening stream.
  const session = metaAgentService.getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Build SSE Response via ReadableStream ──────────────────────────────────
  const encoder = new TextEncoder();

  /** Format a SessionEvent as an SSE message string. */
  function formatSseMessage(event: SessionEvent): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  /** Format a keep-alive comment (SSE comments start with ':'). */
  function keepAlive(): string {
    return `: ping\n\n`;
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
      let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

      function push(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      }

      function cleanup() {
        if (closed) return;
        closed = true;
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        if (maxDurationTimer) clearTimeout(maxDurationTimer);
        unsubscribe?.();
        try { controller.close(); } catch { /* already closed */ }
      }

      // Subscribe to the session event bus (also replays buffered events > afterSeq).
      const unsubscribe = subscribeSessionEvents(sessionId, afterSeq, (event) => {
        push(formatSseMessage(event));

        // Auto-close stream when session reaches terminal state.
        if (
          event.type === "session_state" &&
          (event.status === "done" || event.status === "failed")
        ) {
          // Give the client a moment to process the final event before closing.
          setTimeout(cleanup, 200);
        }
      });

      // Keep-alive ping every 25s (prevents proxy/CDN from closing idle connections).
      keepAliveTimer = setInterval(() => push(keepAlive()), 25_000);

      // Max duration guard.
      maxDurationTimer = setTimeout(() => {
        push(formatSseMessage({
          type: "session_state",
          sessionId,
          seq: -1,
          status: "running", // Not terminal — client should reconnect.
        }));
        cleanup();
      }, MAX_DURATION_MS);

      // Handle client disconnect.
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Allow cross-origin SSE (if needed for dev setups).
      "Access-Control-Allow-Origin": "*",
    },
  });
}
