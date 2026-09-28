/**
 * SessionEventBus — 轻量级内存事件总线，per sessionId。
 *
 * 职责：
 * - 每个 Meta-Agent session 拥有一条独立的事件流。
 * - orchestrator / subagent-executor 在关键节点调用 emit() 发布事件。
 * - SSE 路由订阅 subscribe()，将事件实时推送给前端。
 * - Human-in-the-Loop 的 awaiting_input 事件也通过此总线广播，前端
 *   收到后弹出输入框，用户提交后调用 POST /api/meta-agent/input。
 *
 * 设计约束：
 * - 纯内存，不持久化——进程重启后 SSE 连接断开，客户端重连时
 *   通过 GET /api/meta-agent?sessionId=xxx 全量拉取历史快照，
 *   之后再重新订阅 SSE 只接增量。
 * - 每个 sessionId 最多缓存 MAX_BUFFER 条最近事件，供新连接的客户端
 *   补齐断连期间遗漏的事件（类似 EventSource lastEventId 机制）。
 */

import { EventEmitter } from "node:events";

// ─── 事件类型定义 ────────────────────────────────────────────────

/** 执行日志行事件 — 对应 ExecutionLogEntry 的实时推送 */
export interface LogLineEvent {
  type: "log_line";
  sessionId: string;
  seq: number;          // 单调递增序号，客户端用于去重/排序
  timestamp: string;
  todo_id: string;
  actor: string;
  action: string;
  message: string;
}

/** 步骤完成事件 — 对应 orchestrator onProgress 触发 */
export interface StepProgressEvent {
  type: "step_progress";
  sessionId: string;
  seq: number;
  step: number;
  phase: string;
  reflectionScore?: number;
  reflectionVerdict?: string;
  todoSummary: Array<{
    id: string;
    title: string;
    status: string;
    retry_count: number;
  }>;
  totalTokens: number;
  llmCallCount: number;
}

/** 会话状态变更事件 — running / done / failed / awaiting_input */
export interface SessionStateEvent {
  type: "session_state";
  sessionId: string;
  seq: number;
  status: "running" | "done" | "failed" | "awaiting_input";
  /** 当 status=awaiting_input 时，向用户展示的提示文字 */
  inputPrompt?: string;
  /** 当 status=awaiting_input 时，前端用此 token 提交回答 */
  inputToken?: string;
}

/** 合并类型 */
export type SessionEvent = LogLineEvent | StepProgressEvent | SessionStateEvent;

/**
 * Distributive Omit: correctly removes keys from each union member independently.
 * Standard `Omit<UnionType, K>` distributes incorrectly over unions in TS.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Parameter type for emitSessionEvent — all union members minus auto-filled fields. */
export type SessionEventInput = DistributiveOmit<SessionEvent, "sessionId" | "seq">;

// ─── 内部实现 ────────────────────────────────────────────────────

const MAX_BUFFER = 200; // 每个 session 最多缓存多少条历史事件

interface BusEntry {
  emitter: EventEmitter;
  buffer: SessionEvent[];
  seq: number;            // 下一条事件的序号
}

const buses = new Map<string, BusEntry>();

function getOrCreate(sessionId: string): BusEntry {
  let entry = buses.get(sessionId);
  if (!entry) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50); // 允许多个并发 SSE 连接
    entry = { emitter, buffer: [], seq: 0 };
    buses.set(sessionId, entry);
  }
  return entry;
}

/**
 * 发布一条事件到指定 session 的总线。
 * 自动填充 seq，并放入滚动缓冲区。
 */
export function emitSessionEvent(
  sessionId: string,
  event: SessionEventInput,
): void {
  const entry = getOrCreate(sessionId);
  const full: SessionEvent = {
    ...event,
    sessionId,
    seq: entry.seq++,
  } as SessionEvent;

  // 滚动缓冲区：超过 MAX_BUFFER 丢弃最旧的
  entry.buffer.push(full);
  if (entry.buffer.length > MAX_BUFFER) {
    entry.buffer.shift();
  }

  entry.emitter.emit("event", full);
}

/**
 * 订阅指定 session 的事件流。
 * afterSeq：只接收序号 > afterSeq 的事件（用于断线重连补齐）。
 * 返回取消订阅函数。
 */
export function subscribeSessionEvents(
  sessionId: string,
  afterSeq: number,
  onEvent: (event: SessionEvent) => void,
): () => void {
  const entry = getOrCreate(sessionId);

  // 先补发缓冲区里遗漏的事件
  for (const buffered of entry.buffer) {
    if (buffered.seq > afterSeq) {
      onEvent(buffered);
    }
  }

  const listener = (event: SessionEvent) => onEvent(event);
  entry.emitter.on("event", listener);

  return () => {
    entry.emitter.off("event", listener);
  };
}

/**
 * 销毁 session 总线（session 结束后释放资源）。
 * 调用后该 sessionId 的所有订阅者将不再收到事件。
 */
export function destroySessionBus(sessionId: string): void {
  const entry = buses.get(sessionId);
  if (entry) {
    entry.emitter.removeAllListeners();
    buses.delete(sessionId);
  }
}

/**
 * 返回 session 当前的事件缓冲区（用于 SSE 重连时补发）。
 */
export function getSessionEventBuffer(sessionId: string): SessionEvent[] {
  return buses.get(sessionId)?.buffer ?? [];
}
