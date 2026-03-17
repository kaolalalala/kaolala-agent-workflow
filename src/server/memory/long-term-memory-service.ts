import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";

export type MemoryScopeType = "workspace" | "workflow" | "run" | "node";
export type MemorySourceType = "node_output" | "human_message" | "document" | "manual_note";

export interface LongTermMemoryItem {
  id: string;
  scopeType: MemoryScopeType;
  scopeId: string;
  runId?: string;
  workflowId?: string;
  nodeId?: string;
  sourceType: MemorySourceType;
  title?: string;
  content: string;
  summary: string;
  keywords: string[];
  termWeights: Record<string, number>;
  importance: number;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult extends LongTermMemoryItem {
  score: number;
}

interface MemoryRow {
  id: string;
  scope_type: MemoryScopeType;
  scope_id: string;
  run_id: string | null;
  workflow_id: string | null;
  node_id: string | null;
  source_type: MemorySourceType;
  title: string | null;
  content: string;
  summary: string | null;
  keywords_json: string;
  term_weights_json: string;
  importance: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

function clamp(text: string, maxLen: number) {
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

function summarizeContent(text: string, maxLen = 280) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return clamp(normalized, maxLen);
}

function tokenize(input: string): string[] {
  const text = input.toLowerCase();
  const tokens: string[] = [];

  const latin = text.match(/[a-z0-9_]{2,32}/g) ?? [];
  tokens.push(...latin);

  const hanBlocks = text.match(/[\u4e00-\u9fff]{2,32}/g) ?? [];
  for (const block of hanBlocks) {
    tokens.push(block);
    const chars = block.split("");
    for (let i = 0; i < chars.length - 1; i += 1) {
      tokens.push(`${chars[i]}${chars[i + 1]}`);
    }
  }

  return tokens.slice(0, 800);
}

function buildTermWeights(input: string): Record<string, number> {
  const tf = new Map<string, number>();
  const tokens = tokenize(input);
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const entries = Array.from(tf.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120);

  let normSq = 0;
  for (const [, count] of entries) {
    normSq += count * count;
  }
  const norm = Math.sqrt(normSq) || 1;

  const result: Record<string, number> = {};
  for (const [term, count] of entries) {
    result[term] = Number((count / norm).toFixed(6));
  }
  return result;
}

function cosineScore(a: Record<string, number>, b: Record<string, number>) {
  let dot = 0;
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  for (const [term, value] of Object.entries(small)) {
    dot += value * (large[term] ?? 0);
  }
  return dot;
}

function overlapScore(aTerms: string[], bTerms: string[]) {
  if (aTerms.length === 0 || bTerms.length === 0) {
    return 0;
  }
  const setA = new Set(aTerms);
  const setB = new Set(bTerms);
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(setA.size, setB.size, 1);
}

function recencyScore(isoTime: string, nowMs: number) {
  const createdMs = Date.parse(isoTime);
  if (Number.isNaN(createdMs)) {
    return 0;
  }
  const days = Math.max((nowMs - createdMs) / (1000 * 60 * 60 * 24), 0);
  return 1 / (1 + days / 7);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toItem(row: MemoryRow): LongTermMemoryItem {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    runId: row.run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    sourceType: row.source_type,
    title: row.title ?? undefined,
    content: row.content,
    summary: row.summary ?? "",
    keywords: parseJson<string[]>(row.keywords_json, []),
    termWeights: parseJson<Record<string, number>>(row.term_weights_json, {}),
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const insertMemoryStmt = db.prepare(`
  INSERT INTO long_term_memory (
    id, scope_type, scope_id, run_id, workflow_id, node_id, source_type, title, content, summary,
    keywords_json, term_weights_json, importance, access_count, last_accessed_at, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const touchMemoryStmt = db.prepare(`
  UPDATE long_term_memory
  SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ?
  WHERE id = ?
`);

export const longTermMemoryService = {
  remember(input: {
    scopeType: MemoryScopeType;
    scopeId: string;
    runId?: string;
    workflowId?: string;
    nodeId?: string;
    sourceType: MemorySourceType;
    title?: string;
    content: string;
    importance?: number;
  }) {
    const content = input.content.trim();
    if (!content) {
      return null;
    }

    const normalizedContent = clamp(content, 6000);
    const now = nowIso();
    const weights = buildTermWeights(`${input.title ?? ""}\n${normalizedContent}`);
    const keywords = Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term]) => term);

    const item: LongTermMemoryItem = {
      id: makeId("ltm"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      runId: input.runId,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      sourceType: input.sourceType,
      title: input.title,
      content: normalizedContent,
      summary: summarizeContent(normalizedContent),
      keywords,
      termWeights: weights,
      importance: Math.max(0.1, Math.min(input.importance ?? 0.6, 1)),
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    insertMemoryStmt.run(
      item.id,
      item.scopeType,
      item.scopeId,
      item.runId ?? null,
      item.workflowId ?? null,
      item.nodeId ?? null,
      item.sourceType,
      item.title ?? null,
      item.content,
      item.summary,
      JSON.stringify(item.keywords),
      JSON.stringify(item.termWeights),
      item.importance,
      0,
      null,
      item.createdAt,
      item.updatedAt,
    );

    return item;
  },

  search(input: {
    query: string;
    workspaceId: string;
    workflowId?: string;
    runId?: string;
    nodeId?: string;
    limit?: number;
    minScore?: number;
  }): MemorySearchResult[] {
    const query = input.query.trim();
    if (!query) {
      return [];
    }

    const nowMs = Date.now();
    const queryWeights = buildTermWeights(query);
    const queryKeywords = Object.keys(queryWeights);
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const minScore = input.minScore ?? 0.18;

    const scopes: Array<{ type: MemoryScopeType; id?: string }> = [
      { type: "workspace", id: input.workspaceId },
      { type: "workflow", id: input.workflowId },
      { type: "run", id: input.runId },
      { type: "node", id: input.nodeId },
    ].filter((item): item is { type: MemoryScopeType; id: string } => Boolean(item.id));

    if (scopes.length === 0) {
      return [];
    }

    const whereClause = scopes.map(() => "(scope_type = ? AND scope_id = ?)").join(" OR ");
    const params = scopes.flatMap((scope) => [scope.type, scope.id]);
    const rows = db.prepare(`
      SELECT *
      FROM long_term_memory
      WHERE ${whereClause}
      ORDER BY updated_at DESC
      LIMIT 300
    `).all(...params) as MemoryRow[];

    const scored = rows
      .map((row) => {
        const memory = toItem(row);
        const cosine = cosineScore(queryWeights, memory.termWeights);
        const overlap = overlapScore(queryKeywords, memory.keywords);
        const freshness = recencyScore(memory.updatedAt, nowMs);
        const score = (cosine * 0.72) + (overlap * 0.16) + (freshness * 0.06) + (memory.importance * 0.06);
        return { ...memory, score };
      })
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const touchedAt = nowIso();
    for (const item of scored) {
      touchMemoryStmt.run(touchedAt, touchedAt, item.id);
    }

    return scored;
  },

  resetForTests() {
    db.prepare("DELETE FROM long_term_memory").run();
  },
};

