/**
 * LongTermMemoryService v2 — semantic memory with embedding-based retrieval.
 *
 * Upgrades over v1:
 * - Embedding vectors for semantic search (with TF fallback when unavailable)
 * - Deduplication: new content is checked against existing memories before insert
 * - Memory types: fact / experience / preference / insight
 * - Decay scoring: memories lose relevance over time if not accessed
 * - Async enrichment: embedding generation runs in background, never blocks callers
 *
 * The public API (remember / search) is backward-compatible with v1 callers.
 */

import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";
import { embeddingService } from "@/server/memory/embedding-service";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export type MemoryScopeType = "workspace" | "workflow" | "run" | "node";
export type MemorySourceType = "node_output" | "human_message" | "document" | "manual_note";
export type MemoryType = "fact" | "experience" | "preference" | "insight";

export interface LongTermMemoryItem {
  id: string;
  scopeType: MemoryScopeType;
  scopeId: string;
  runId?: string;
  workflowId?: string;
  nodeId?: string;
  sourceType: MemorySourceType;
  memoryType: MemoryType;
  title?: string;
  content: string;
  summary: string;
  keywords: string[];
  termWeights: Record<string, number>;
  embedding?: number[];
  importance: number;
  decayScore: number;
  accessCount: number;
  lastAccessedAt?: string;
  version: number;
  parentId?: string;
  mergedInto?: string;
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
  memory_type: MemoryType | null;
  title: string | null;
  content: string;
  summary: string | null;
  keywords_json: string;
  term_weights_json: string;
  embedding_json: string | null;
  importance: number;
  decay_score: number | null;
  access_count: number;
  last_accessed_at: string | null;
  version: number | null;
  parent_id: string | null;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────────────────
// Text processing utilities (kept from v1 for TF fallback)
// ──────────────────────────────────────────────────────────

function clamp(text: string, maxLen: number) {
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

function summarizeContent(text: string, maxLen = 280) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return clamp(normalized, maxLen);
}

export function tokenize(input: string): string[] {
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

export function buildTermWeights(input: string): Record<string, number> {
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

function tfCosineScore(a: Record<string, number>, b: Record<string, number>) {
  let dot = 0;
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  for (const [term, value] of Object.entries(small)) {
    dot += value * (large[term] ?? 0);
  }
  return dot;
}

function overlapScore(aTerms: string[], bTerms: string[]) {
  if (aTerms.length === 0 || bTerms.length === 0) return 0;
  const setA = new Set(aTerms);
  const setB = new Set(bTerms);
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap += 1;
  }
  return overlap / Math.max(setA.size, setB.size, 1);
}

function recencyScore(isoTime: string, nowMs: number) {
  const createdMs = Date.parse(isoTime);
  if (Number.isNaN(createdMs)) return 0;
  const days = Math.max((nowMs - createdMs) / (1000 * 60 * 60 * 24), 0);
  return 1 / (1 + days / 7);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ──────────────────────────────────────────────────────────
// Memory type inference (heuristic, fast, no LLM)
// ──────────────────────────────────────────────────────────

function inferMemoryType(content: string, sourceType: MemorySourceType): MemoryType {
  const lower = content.toLowerCase();

  if (sourceType === "human_message") {
    // Human messages expressing preferences
    if (/(?:偏好|prefer|喜欢|希望|不要|don't|avoid|请用|please use)/i.test(lower)) {
      return "preference";
    }
    return "fact";
  }

  // Experience patterns: lessons, errors, solutions, retries
  if (/(?:经验|教训|lesson|learned|发现.*需要|注意|warning|错误.*原因|failed.*because|retry|重试|应该先|must first)/i.test(lower)) {
    return "experience";
  }

  // Insight patterns: conclusions, analysis, deduction
  if (/(?:结论|conclusion|因此|therefore|综上|总结|分析.*表明|说明|implies|suggests that|可以推断)/i.test(lower)) {
    return "insight";
  }

  return "fact";
}

// ──────────────────────────────────────────────────────────
// Row mapper
// ──────────────────────────────────────────────────────────

function toItem(row: MemoryRow): LongTermMemoryItem {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    runId: row.run_id ?? undefined,
    workflowId: row.workflow_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    sourceType: row.source_type,
    memoryType: row.memory_type ?? "fact",
    title: row.title ?? undefined,
    content: row.content,
    summary: row.summary ?? "",
    keywords: parseJson<string[]>(row.keywords_json, []),
    termWeights: parseJson<Record<string, number>>(row.term_weights_json, {}),
    embedding: parseJson<number[] | undefined>(row.embedding_json, undefined),
    importance: row.importance,
    decayScore: row.decay_score ?? 1.0,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    version: row.version ?? 1,
    parentId: row.parent_id ?? undefined,
    mergedInto: row.merged_into ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ──────────────────────────────────────────────────────────
// Prepared statements
// ──────────────────────────────────────────────────────────

const insertMemoryStmt = db.prepare(`
  INSERT INTO long_term_memory (
    id, scope_type, scope_id, run_id, workflow_id, node_id, source_type, title, content, summary,
    keywords_json, term_weights_json, importance, access_count, last_accessed_at, created_at, updated_at,
    embedding_json, memory_type, decay_score, parent_id, merged_into, version
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateEmbeddingStmt = db.prepare(`
  UPDATE long_term_memory SET embedding_json = ?, updated_at = ? WHERE id = ?
`);

const updateContentStmt = db.prepare(`
  UPDATE long_term_memory
  SET content = ?, summary = ?, keywords_json = ?, term_weights_json = ?,
      importance = ?, version = version + 1, updated_at = ?
  WHERE id = ?
`);

const touchMemoryStmt = db.prepare(`
  UPDATE long_term_memory
  SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ?
  WHERE id = ?
`);

const markMergedStmt = db.prepare(`
  UPDATE long_term_memory SET merged_into = ?, updated_at = ? WHERE id = ?
`);

const applyDecayStmt = db.prepare(`
  UPDATE long_term_memory
  SET decay_score = decay_score * ?, updated_at = ?
  WHERE merged_into IS NULL AND decay_score > 0.05
`);

const deleteDecayedStmt = db.prepare(`
  DELETE FROM long_term_memory
  WHERE decay_score < 0.05 AND access_count = 0 AND merged_into IS NULL
`);

// ──────────────────────────────────────────────────────────
// Async enrichment queue (in-process, fire-and-forget)
// ──────────────────────────────────────────────────────────

interface EnrichmentTask {
  memoryId: string;
  content: string;
}

const enrichmentQueue: EnrichmentTask[] = [];
let enrichmentRunning = false;

async function processEnrichmentQueue(): Promise<void> {
  if (enrichmentRunning) return;
  enrichmentRunning = true;

  try {
    while (enrichmentQueue.length > 0) {
      // Process in batches of up to 16
      const batch = enrichmentQueue.splice(0, 16);
      const texts = batch.map((t) => t.content);

      const embeddings = await embeddingService.embedBatch(texts);
      const now = nowIso();

      for (let i = 0; i < batch.length; i++) {
        const emb = embeddings[i];
        if (emb) {
          updateEmbeddingStmt.run(JSON.stringify(emb), now, batch[i].memoryId);
        }
      }
    }
  } catch (error) {
    console.warn("[MemoryService] Enrichment queue error:", error instanceof Error ? error.message : error);
  } finally {
    enrichmentRunning = false;
  }
}

function enqueueEmbedding(memoryId: string, content: string): void {
  enrichmentQueue.push({ memoryId, content });
  // Fire-and-forget: don't await, don't block caller
  processEnrichmentQueue().catch(() => {});
}

// ──────────────────────────────────────────────────────────
// Deduplication
// ──────────────────────────────────────────────────────────

/**
 * Check if very similar content already exists in the same scope.
 * Uses TF cosine (fast, synchronous) for dedup since embeddings may not be ready yet.
 * Returns the existing memory ID if a near-duplicate is found, null otherwise.
 */
function findDuplicate(
  scopeType: MemoryScopeType,
  scopeId: string,
  newWeights: Record<string, number>,
  threshold = 0.85,
): MemoryRow | null {
  const rows = db.prepare(`
    SELECT * FROM long_term_memory
    WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL
    ORDER BY updated_at DESC LIMIT 100
  `).all(scopeType, scopeId) as MemoryRow[];

  for (const row of rows) {
    const existingWeights = parseJson<Record<string, number>>(row.term_weights_json, {});
    const similarity = tfCosineScore(newWeights, existingWeights);
    if (similarity >= threshold) {
      return row;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────

export const longTermMemoryService = {
  /**
   * Store a new memory. Deduplicates against existing memories in the same scope:
   * if a near-duplicate exists, updates it instead of creating a new entry.
   * Embedding generation happens asynchronously after the synchronous return.
   */
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
    memoryType?: MemoryType;
  }): LongTermMemoryItem | null {
    const content = input.content.trim();
    if (!content) return null;

    const normalizedContent = clamp(content, 6000);
    const fullText = `${input.title ?? ""}\n${normalizedContent}`;
    const weights = buildTermWeights(fullText);
    const keywords = Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term]) => term);
    const memoryType = input.memoryType ?? inferMemoryType(normalizedContent, input.sourceType);
    const importance = Math.max(0.1, Math.min(input.importance ?? 0.6, 1));
    const now = nowIso();

    // ── Deduplication: check for near-duplicate in same scope ──
    const duplicate = findDuplicate(input.scopeType, input.scopeId, weights);
    if (duplicate) {
      // Update existing memory with new content (append or replace if newer is longer)
      const existingContent = duplicate.content;
      const mergedContent = normalizedContent.length > existingContent.length
        ? normalizedContent
        : existingContent;
      const mergedSummary = summarizeContent(mergedContent);
      const mergedWeights = buildTermWeights(`${input.title ?? duplicate.title ?? ""}\n${mergedContent}`);
      const mergedKeywords = Object.entries(mergedWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([term]) => term);
      const mergedImportance = Math.max(duplicate.importance, importance);

      updateContentStmt.run(
        mergedContent,
        mergedSummary,
        JSON.stringify(mergedKeywords),
        JSON.stringify(mergedWeights),
        mergedImportance,
        now,
        duplicate.id,
      );

      // Re-embed the updated content
      enqueueEmbedding(duplicate.id, `${input.title ?? duplicate.title ?? ""}\n${mergedContent}`);

      return toItem({
        ...duplicate,
        content: mergedContent,
        summary: mergedSummary,
        keywords_json: JSON.stringify(mergedKeywords),
        term_weights_json: JSON.stringify(mergedWeights),
        importance: mergedImportance,
        updated_at: now,
      });
    }

    // ── New memory ──
    const item: LongTermMemoryItem = {
      id: makeId("ltm"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      runId: input.runId,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      sourceType: input.sourceType,
      memoryType,
      title: input.title,
      content: normalizedContent,
      summary: summarizeContent(normalizedContent),
      keywords,
      termWeights: weights,
      importance,
      decayScore: 1.0,
      accessCount: 0,
      version: 1,
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
      null, // embedding_json — filled async
      item.memoryType,
      item.decayScore,
      null, // parent_id
      null, // merged_into
      item.version,
    );

    // Async: generate embedding in background
    enqueueEmbedding(item.id, fullText);

    return item;
  },

  /**
   * Search memories using hybrid scoring:
   * - If embeddings are available: vector similarity (55%) + keyword (15%) + recency (10%) + importance (10%) + decay (10%)
   * - Fallback: TF cosine (72%) + keyword (16%) + recency (6%) + importance (6%) — same as v1
   */
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
    if (!query) return [];

    const nowMs = Date.now();
    const queryWeights = buildTermWeights(query);
    const queryKeywords = Object.keys(queryWeights);
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const minScore = input.minScore ?? 0.18;

    const scopes: Array<{ type: MemoryScopeType; id: string }> = [
      { type: "workspace", id: input.workspaceId },
      ...(input.workflowId ? [{ type: "workflow" as const, id: input.workflowId }] : []),
      ...(input.runId ? [{ type: "run" as const, id: input.runId }] : []),
      ...(input.nodeId ? [{ type: "node" as const, id: input.nodeId }] : []),
    ];

    if (scopes.length === 0) return [];

    // Only fetch non-merged memories
    const whereClause = scopes.map(() => "(scope_type = ? AND scope_id = ?)").join(" OR ");
    const params = scopes.flatMap((scope) => [scope.type, scope.id]);
    const rows = db.prepare(`
      SELECT *
      FROM long_term_memory
      WHERE (${whereClause}) AND merged_into IS NULL
      ORDER BY updated_at DESC
      LIMIT 500
    `).all(...params) as MemoryRow[];

    // Check if any rows have embeddings (to decide scoring strategy)
    const hasEmbeddings = rows.some((r) => r.embedding_json !== null);

    // Try to get query embedding for vector search
    let queryEmbedding: number[] | null = null;
    if (hasEmbeddings) {
      // Check cache synchronously — if we have it cached, use it
      // We can't await here (sync function), so we trigger async embed for future queries
      // and use TF for any query not yet cached.
      // Workaround: embed synchronously from cache via a sync helper
      queryEmbedding = this._getCachedQueryEmbedding(query);
      if (!queryEmbedding) {
        // Trigger async embedding for next time
        embeddingService.embed(query).catch(() => {});
      }
    }

    const useVectorScoring = queryEmbedding !== null && hasEmbeddings;

    const scored = rows
      .map((row) => {
        const memory = toItem(row);

        let score: number;
        if (useVectorScoring && memory.embedding && queryEmbedding) {
          // Hybrid vector scoring
          const vectorSim = embeddingService.cosineSimilarity(queryEmbedding, memory.embedding);
          const keyword = overlapScore(queryKeywords, memory.keywords);
          const freshness = recencyScore(memory.updatedAt, nowMs);
          score =
            vectorSim * 0.55 +
            keyword * 0.15 +
            freshness * 0.10 +
            memory.importance * 0.10 +
            memory.decayScore * 0.10;
        } else {
          // TF fallback scoring (v1 compatible)
          const cosine = tfCosineScore(queryWeights, memory.termWeights);
          const overlap = overlapScore(queryKeywords, memory.keywords);
          const freshness = recencyScore(memory.updatedAt, nowMs);
          score =
            cosine * 0.72 +
            overlap * 0.16 +
            freshness * 0.06 +
            memory.importance * 0.06;
        }

        return { ...memory, score };
      })
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Touch accessed memories
    const touchedAt = nowIso();
    for (const item of scored) {
      touchMemoryStmt.run(touchedAt, touchedAt, item.id);
    }

    return scored;
  },

  /**
   * Async search — same as search() but awaits query embedding for vector scoring.
   * Use this when you can afford an async call (e.g., in API routes).
   */
  async searchAsync(input: {
    query: string;
    workspaceId: string;
    workflowId?: string;
    runId?: string;
    nodeId?: string;
    limit?: number;
    minScore?: number;
  }): Promise<MemorySearchResult[]> {
    const query = input.query.trim();
    if (!query) return [];

    // Pre-embed the query so the sync search() can use it from cache
    if (embeddingService.isAvailable()) {
      await embeddingService.embed(query);
    }

    return this.search(input);
  },

  /**
   * Apply decay to all active memories. Call periodically (e.g., after each run completes).
   * Decay factor: memories lose 5% relevance per cycle.
   * Memories with decay_score < 0.05 and zero access are purged.
   */
  applyDecay(factor = 0.95): { decayed: number; purged: number } {
    const now = nowIso();
    const decayResult = applyDecayStmt.run(factor, now);
    const purgeResult = deleteDecayedStmt.run();
    return {
      decayed: decayResult.changes,
      purged: purgeResult.changes,
    };
  },

  /**
   * Mark a memory as merged into another.
   */
  markMerged(sourceId: string, targetId: string): void {
    markMergedStmt.run(targetId, nowIso(), sourceId);
  },

  /**
   * Get a single memory by ID.
   */
  getById(id: string): LongTermMemoryItem | null {
    const row = db.prepare("SELECT * FROM long_term_memory WHERE id = ?").get(id) as MemoryRow | undefined;
    return row ? toItem(row) : null;
  },

  /**
   * List memories for a scope (for UI/debugging).
   */
  listByScope(scopeType: MemoryScopeType, scopeId: string, limit = 50): LongTermMemoryItem[] {
    const rows = db.prepare(`
      SELECT * FROM long_term_memory
      WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL
      ORDER BY updated_at DESC LIMIT ?
    `).all(scopeType, scopeId, limit) as MemoryRow[];
    return rows.map(toItem);
  },

  /**
   * Find similar memories by embedding vector (for consolidation).
   * Returns pairs of memories with similarity above threshold.
   */
  findSimilarPairs(
    scopeType: MemoryScopeType,
    scopeId: string,
    threshold = 0.88,
  ): Array<{ a: LongTermMemoryItem; b: LongTermMemoryItem; similarity: number }> {
    const rows = db.prepare(`
      SELECT * FROM long_term_memory
      WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL AND embedding_json IS NOT NULL
      ORDER BY updated_at DESC LIMIT 200
    `).all(scopeType, scopeId) as MemoryRow[];

    const items = rows.map(toItem);
    const pairs: Array<{ a: LongTermMemoryItem; b: LongTermMemoryItem; similarity: number }> = [];

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[i].embedding && items[j].embedding) {
          const sim = embeddingService.cosineSimilarity(items[i].embedding!, items[j].embedding!);
          if (sim >= threshold) {
            pairs.push({ a: items[i], b: items[j], similarity: sim });
          }
        }
      }
    }

    return pairs.sort((a, b) => b.similarity - a.similarity);
  },

  /**
   * Internal: try to get query embedding from cache (sync).
   * This is a bridge between the sync search() and async embedding.
   */
  _getCachedQueryEmbedding(query: string): number[] | null {
    // embeddingService.embed is async, but results are cached.
    // We synchronously try to get from cache by calling embed and checking if it resolves immediately.
    // This is a pragmatic workaround — the first query won't have embeddings, subsequent ones will.
    let result: number[] | null = null;
    const promise = embeddingService.embed(query);
    // If cached, the promise resolves in the same microtask — but we can't rely on that.
    // Instead, we use a sync approach: check if the embedding service has this in its cache.
    // Since embeddingService doesn't expose sync cache access, we store query embeddings locally.
    const cached = queryEmbeddingCache.get(query);
    if (cached) return cached;

    // Trigger async population for next time
    promise.then((emb) => {
      if (emb) queryEmbeddingCache.set(query, emb);
    }).catch(() => {});

    return result;
  },

  /** Get memory statistics for a scope */
  getStats(scopeType: MemoryScopeType, scopeId: string): {
    total: number;
    withEmbedding: number;
    byType: Record<MemoryType, number>;
    avgDecay: number;
  } {
    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM long_term_memory
      WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL
    `).get(scopeType, scopeId) as { count: number }).count;

    const withEmbedding = (db.prepare(`
      SELECT COUNT(*) as count FROM long_term_memory
      WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL AND embedding_json IS NOT NULL
    `).get(scopeType, scopeId) as { count: number }).count;

    const typeRows = db.prepare(`
      SELECT memory_type, COUNT(*) as count FROM long_term_memory
      WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL
      GROUP BY memory_type
    `).all(scopeType, scopeId) as Array<{ memory_type: string | null; count: number }>;

    const byType: Record<MemoryType, number> = { fact: 0, experience: 0, preference: 0, insight: 0 };
    for (const row of typeRows) {
      const t = (row.memory_type ?? "fact") as MemoryType;
      byType[t] = row.count;
    }

    const avgRow = db.prepare(`
      SELECT AVG(decay_score) as avg_decay FROM long_term_memory
      WHERE scope_type = ? AND scope_id = ? AND merged_into IS NULL
    `).get(scopeType, scopeId) as { avg_decay: number | null };

    return {
      total,
      withEmbedding,
      byType,
      avgDecay: avgRow.avg_decay ?? 1.0,
    };
  },

  resetForTests() {
    db.prepare("DELETE FROM long_term_memory").run();
    queryEmbeddingCache.clear();
    enrichmentQueue.length = 0;
    embeddingService.clearCache();
  },
};

// Local cache for query embeddings (sync access bridge)
const queryEmbeddingCache = new Map<string, number[]>();
