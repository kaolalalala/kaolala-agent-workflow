/**
 * Retry — automatic retry with exponential backoff and jitter for transient errors.
 *
 * Classifies errors as transient (retryable) or permanent (fail immediately).
 * Used by LLM adapter and tool executor for resilient external calls.
 */

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface RetryConfig {
  /** Max retry attempts (default 3) */
  maxRetries: number;
  /** Base delay in ms (default 1000) */
  baseDelayMs: number;
  /** Max delay in ms (default 30000) */
  maxDelayMs: number;
  /** Jitter factor 0-1 (default 0.3) */
  jitterFactor: number;
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

// ──────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
};

// ──────────────────────────────────────────────────────────
// Error classification
// ──────────────────────────────────────────────────────────

/** HTTP status codes that are transient (retryable) */
const TRANSIENT_HTTP_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Determine if an error is transient and worth retrying.
 * - Network errors (ECONNRESET, ENOTFOUND, etc.)
 * - Timeouts
 * - HTTP 429 (rate limit), 5xx (server error)
 */
export function isTransientError(error: unknown): boolean {
  // Explicitly marked permanent errors are never retried
  if (error && typeof error === "object" && "permanent" in error && (error as Record<string, unknown>).permanent === true) {
    return false;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Timeout errors
    if (error.name === "TimeoutError" || msg.includes("timeout") || msg.includes("timed out")) {
      return true;
    }
    // Network errors
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("enotfound")
        || msg.includes("fetch failed") || msg.includes("network")
        || msg.includes("socket hang up") || msg.includes("epipe")) {
      return true;
    }
    // Rate limiting
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many request")) {
      return true;
    }
    // Server errors (5xx)
    if (/\b5\d{2}\b/.test(msg)) {
      return true;
    }
  }
  return false;
}

/** Check if an HTTP status code is transient */
export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_CODES.has(status);
}

// ──────────────────────────────────────────────────────────
// Delay calculation
// ──────────────────────────────────────────────────────────

/**
 * Calculate delay with exponential backoff + jitter.
 * delay = min(baseDelay * 2^attempt, maxDelay) * (1 ± jitter)
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitter = capped * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

// ──────────────────────────────────────────────────────────
// Retry executor
// ──────────────────────────────────────────────────────────

/**
 * Execute a function with automatic retry on transient errors.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param onRetry - Optional callback for logging/observability on each retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<RetryResult<T>> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt + 1, totalDelayMs };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If not transient or last attempt, don't retry
      if (!isTransientError(error) || attempt >= cfg.maxRetries) {
        return { ok: false, error: lastError, attempts: attempt + 1, totalDelayMs };
      }

      // Calculate and apply delay
      const delayMs = calculateDelay(attempt, cfg);
      totalDelayMs += delayMs;
      onRetry?.(attempt + 1, lastError, delayMs);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return { ok: false, error: lastError, attempts: cfg.maxRetries + 1, totalDelayMs };
}
