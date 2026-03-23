/**
 * MemoryConsolidation — merges similar memories and applies decay.
 *
 * Run after each workflow run completes, or periodically.
 *
 * Two operations:
 * 1. **Merge**: Find memory pairs with embedding similarity > threshold,
 *    combine them into a single refined memory, mark originals as merged.
 * 2. **Decay**: Reduce decay_score for all active memories, purge the lowest.
 */

import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";
import { embeddingService } from "@/server/memory/embedding-service";
import {
  longTermMemoryService,
  buildTermWeights,
  type MemoryScopeType,
  type LongTermMemoryItem,
} from "@/server/memory/long-term-memory-service";

// ──────────────────────────────────────────────────────────
// Merge
// ──────────────────────────────────────────────────────────

interface MergeResult {
  mergedPairs: number;
  newMemoryIds: string[];
}

/**
 * Merge highly similar memories within a scope.
 * Strategy: pick the longer content, combine keywords, keep the higher importance.
 * This is a deterministic merge (no LLM) — fast and predictable.
 */
export async function consolidateScope(
  scopeType: MemoryScopeType,
  scopeId: string,
  options: {
    similarityThreshold?: number;
    maxMergesPerRun?: number;
    decayFactor?: number;
  } = {},
): Promise<{ merge: MergeResult; decay: { decayed: number; purged: number } }> {
  const threshold = options.similarityThreshold ?? 0.88;
  const maxMerges = options.maxMergesPerRun ?? 10;
  const decayFactor = options.decayFactor ?? 0.95;

  // ── Step 1: Find similar pairs ──
  const pairs = longTermMemoryService.findSimilarPairs(scopeType, scopeId, threshold);
  const mergedSourceIds = new Set<string>();
  const newMemoryIds: string[] = [];
  let mergedPairs = 0;

  for (const { a, b, similarity } of pairs) {
    if (mergedPairs >= maxMerges) break;
    if (mergedSourceIds.has(a.id) || mergedSourceIds.has(b.id)) continue;

    // Pick the longer/more important one as the base
    const [primary, secondary] = a.content.length >= b.content.length ? [a, b] : [b, a];

    // Merge content: keep the primary content, append unique info from secondary
    const mergedContent = primary.content.length > secondary.content.length
      ? primary.content
      : `${primary.content}\n\n${secondary.content}`;
    const clampedContent = mergedContent.slice(0, 6000);

    const mergedTitle = primary.title ?? secondary.title;
    const mergedWeights = buildTermWeights(`${mergedTitle ?? ""}\n${clampedContent}`);
    const mergedKeywords = Object.entries(mergedWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term]) => term);

    // Create the merged memory
    const now = nowIso();
    const newId = makeId("ltm");
    const mergedImportance = Math.max(primary.importance, secondary.importance);

    // Generate embedding for merged content
    let embeddingJson: string | null = null;
    const emb = await embeddingService.embed(`${mergedTitle ?? ""}\n${clampedContent}`);
    if (emb) {
      embeddingJson = JSON.stringify(emb);
    }

    db.prepare(`
      INSERT INTO long_term_memory (
        id, scope_type, scope_id, run_id, workflow_id, node_id, source_type, title, content, summary,
        keywords_json, term_weights_json, importance, access_count, last_accessed_at, created_at, updated_at,
        embedding_json, memory_type, decay_score, parent_id, merged_into, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId,
      primary.scopeType,
      primary.scopeId,
      primary.runId ?? secondary.runId ?? null,
      primary.workflowId ?? secondary.workflowId ?? null,
      null, // node_id — merged memories are scope-level
      primary.sourceType,
      mergedTitle ?? null,
      clampedContent,
      clampedContent.replace(/\s+/g, " ").trim().slice(0, 280),
      JSON.stringify(mergedKeywords),
      JSON.stringify(mergedWeights),
      mergedImportance,
      primary.accessCount + secondary.accessCount,
      now,
      now,
      now,
      embeddingJson,
      primary.memoryType,
      1.0, // Fresh decay score
      null, // parent_id
      null, // merged_into
      1,
    );

    // Mark originals as merged
    longTermMemoryService.markMerged(primary.id, newId);
    longTermMemoryService.markMerged(secondary.id, newId);

    mergedSourceIds.add(primary.id);
    mergedSourceIds.add(secondary.id);
    newMemoryIds.push(newId);
    mergedPairs++;
  }

  // ── Step 2: Apply decay ──
  const decay = longTermMemoryService.applyDecay(decayFactor);

  return {
    merge: { mergedPairs, newMemoryIds },
    decay,
  };
}

/**
 * Consolidate all active workflow scopes.
 * Intended to be called periodically or after runs complete.
 */
export async function consolidateAll(options?: {
  similarityThreshold?: number;
  maxMergesPerRun?: number;
  decayFactor?: number;
}): Promise<{
  scopesProcessed: number;
  totalMerged: number;
  totalDecayed: number;
  totalPurged: number;
}> {
  // Find all distinct scopes with active memories
  const scopes = db.prepare(`
    SELECT DISTINCT scope_type, scope_id FROM long_term_memory
    WHERE merged_into IS NULL
  `).all() as Array<{ scope_type: MemoryScopeType; scope_id: string }>;

  let totalMerged = 0;
  let totalDecayed = 0;
  let totalPurged = 0;

  for (const scope of scopes) {
    const result = await consolidateScope(scope.scope_type, scope.scope_id, options);
    totalMerged += result.merge.mergedPairs;
    totalDecayed += result.decay.decayed;
    totalPurged += result.decay.purged;
  }

  return {
    scopesProcessed: scopes.length,
    totalMerged,
    totalDecayed,
    totalPurged,
  };
}
