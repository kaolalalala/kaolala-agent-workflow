/**
 * POST /api/meta-agent/input
 *
 * Human-in-the-Loop 用户输入接口。
 * 当 SSE 流推送 { type: "session_state", status: "awaiting_input", inputToken: "..." }
 * 事件后，前端展示输入框，用户提交时调用此接口。
 *
 * 请求体：
 *   { sessionId: string, inputToken: string, value: string }
 *
 *   - sessionId:   正在等待输入的 session ID
 *   - inputToken:  来自 awaiting_input 事件的 token（防止 CSRF / 重放攻击）
 *   - value:       用户输入的字符串（空字符串表示"直接确认，不修改计划"）
 *
 * 响应：
 *   200 { ok: true }            — 成功注入，orchestrator 已恢复执行
 *   400 { error: "..." }        — 参数缺失
 *   404 { error: "..." }        — session 不存在或未处于 awaiting_input 状态
 *   409 { error: "..." }        — token 不匹配（过期 / 重放）
 *
 * GET /api/meta-agent/input?sessionId=xxx
 *
 * 查询 session 当前是否处于 awaiting_input 状态。
 * 响应：{ awaiting: boolean, inputToken?: string }
 */

import { NextResponse } from "next/server";
import { metaAgentService } from "@/server/meta-agent/meta-agent-service";
import {
  getPendingInputInfo,
  injectInput,
  isAwaitingInput,
  getPendingInputToken,
  persistInjectedInput,
} from "@/server/meta-agent/interrupt-gate";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, inputToken, value } = (body ?? {}) as Record<string, unknown>;

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!inputToken || typeof inputToken !== "string") {
    return NextResponse.json({ error: "inputToken is required" }, { status: 400 });
  }

  // Verify the session exists.
  const session = metaAgentService.getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Check that this session is currently awaiting input.
  const sessionPendingInput = session.pendingInput?.awaiting ? session.pendingInput : undefined;
  const awaiting = isAwaitingInput(sessionId) || Boolean(sessionPendingInput);
  if (!awaiting) {
    return NextResponse.json(
      { error: "Session is not currently awaiting user input" },
      { status: 404 },
    );
  }

  const expectedToken = getPendingInputToken(sessionId) || sessionPendingInput?.inputToken;
  if (!expectedToken || expectedToken !== inputToken) {
    return NextResponse.json(
      { error: "Invalid or expired inputToken" },
      { status: 409 },
    );
  }

  // Prefer in-memory injection when the gate lives in this worker.
  // Fall back to persisted submission so the orchestrator can resume even
  // when /api/meta-agent and /api/meta-agent/input are handled by different workers.
  const normalizedValue = typeof value === "string" ? value : "";
  const injected = injectInput(sessionId, inputToken, normalizedValue);
  if (!injected) {
    persistInjectedInput(sessionId, inputToken, normalizedValue);
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = metaAgentService.getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const inMemoryAwaiting = isAwaitingInput(sessionId);
  const pending = inMemoryAwaiting
    ? getPendingInputInfo(sessionId)
    : (session.pendingInput?.awaiting
        ? {
            token: session.pendingInput.inputToken || "",
            prompt: session.pendingInput.prompt,
            requestedAt: session.pendingInput.requestedAt,
            timeoutAt: session.pendingInput.timeoutAt,
          }
        : undefined);
  const awaiting = inMemoryAwaiting || Boolean(session.pendingInput?.awaiting);
  return NextResponse.json({
    awaiting,
    inputToken: awaiting ? (getPendingInputToken(sessionId) || session.pendingInput?.inputToken) : undefined,
    prompt: pending?.prompt,
    requestedAt: pending?.requestedAt,
    timeoutAt: pending?.timeoutAt,
  });
}
