/**
 * EmbeddingService — generates vector embeddings for memory content.
 *
 * Uses OpenAI-compatible `/v1/embeddings` endpoint (same baseURL/apiKey as the LLM adapter).
 * Falls back gracefully: if embedding is unavailable, callers get `null` and should
 * degrade to the existing TF-based scoring.
 *
 * Design choices:
 * - Batch API: send up to 32 texts per request to reduce round-trips.
 * - In-memory LRU cache: avoid re-embedding identical content within a process lifetime.
 * - Configurable model/dimensions so users can swap to a smaller model if needed.
 */

import { configService } from "@/server/config/config-service";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface EmbeddingConfig {
  /** Override the embedding model (default: text-embedding-3-small) */
  model?: string;
  /** Target dimensions for the embedding vector */
  dimensions?: number;
  /** Max texts per batch request */
  batchSize?: number;
}

interface EmbeddingResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

// ──────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BATCH_SIZE = 32;

// Simple LRU-ish cache (Map preserves insertion order)
const CACHE_MAX = 2000;
const embeddingCache = new Map<string, number[]>();

function cacheKey(text: string, model: string): string {
  // Use first 200 chars + length as a fast cache key
  return `${model}:${text.length}:${text.slice(0, 200)}`;
}

function cacheGet(key: string): number[] | undefined {
  const value = embeddingCache.get(key);
  if (value) {
    // Move to end (most-recently-used)
    embeddingCache.delete(key);
    embeddingCache.set(key, value);
  }
  return value;
}

function cacheSet(key: string, value: number[]): void {
  if (embeddingCache.size >= CACHE_MAX) {
    // Evict oldest entry
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey !== undefined) {
      embeddingCache.delete(firstKey);
    }
  }
  embeddingCache.set(key, value);
}

// ──────────────────────────────────────────────────────────
// Resolve credentials from workspace config
// ──────────────────────────────────────────────────────────

function resolveEmbeddingEndpoint(): { baseURL: string; apiKey: string } | null {
  try {
    const workspace = configService.ensureWorkspaceConfig();
    const baseURL = workspace.defaultBaseUrl;
    const credentialId = workspace.defaultCredentialId;
    if (!baseURL || !credentialId) {
      return null;
    }
    const apiKey = configService.resolveCredentialApiKey(credentialId);
    if (!apiKey) {
      return null;
    }
    return { baseURL, apiKey };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// Core embedding call
// ──────────────────────────────────────────────────────────

async function callEmbeddingAPI(
  texts: string[],
  config: EmbeddingConfig = {},
): Promise<(number[] | null)[]> {
  const endpoint = resolveEmbeddingEndpoint();
  if (!endpoint) {
    return texts.map(() => null);
  }

  const model = config.model ?? DEFAULT_MODEL;
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;

  // Check cache first, identify which texts actually need API calls
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const key = cacheKey(texts[i], model);
    const cached = cacheGet(key);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  if (uncachedTexts.length === 0) {
    return results;
  }

  // Batch API calls
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  for (let start = 0; start < uncachedTexts.length; start += batchSize) {
    const batchTexts = uncachedTexts.slice(start, start + batchSize);
    const batchOriginalIndices = uncachedIndices.slice(start, start + batchSize);

    try {
      const url = `${endpoint.baseURL.replace(/\/+$/, "")}/v1/embeddings`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: batchTexts,
          dimensions,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        console.warn(`[EmbeddingService] API returned ${response.status}: ${response.statusText}`);
        continue;
      }

      const data = (await response.json()) as EmbeddingResponse;
      if (data.data) {
        for (const item of data.data) {
          if (item.embedding && typeof item.index === "number") {
            const originalIdx = batchOriginalIndices[item.index];
            results[originalIdx] = item.embedding;
            cacheSet(cacheKey(texts[originalIdx], model), item.embedding);
          }
        }
      }
    } catch (error) {
      console.warn(
        "[EmbeddingService] Embedding API call failed:",
        error instanceof Error ? error.message : error,
      );
      // Continue — failed batches return null, callers degrade to TF
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────

export const embeddingService = {
  /** Embed a single text. Returns null if embedding is unavailable. */
  async embed(text: string, config?: EmbeddingConfig): Promise<number[] | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const [result] = await callEmbeddingAPI([trimmed], config);
    return result;
  },

  /** Embed multiple texts in batch. Returns null for any that fail. */
  async embedBatch(texts: string[], config?: EmbeddingConfig): Promise<(number[] | null)[]> {
    const trimmed = texts.map((t) => t.trim());
    return callEmbeddingAPI(trimmed, config);
  },

  /** Compute cosine similarity between two embedding vectors */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  },

  /** Check if embedding service is available (has valid config) */
  isAvailable(): boolean {
    return resolveEmbeddingEndpoint() !== null;
  },

  /** Clear the in-memory cache (for tests) */
  clearCache(): void {
    embeddingCache.clear();
  },
};
