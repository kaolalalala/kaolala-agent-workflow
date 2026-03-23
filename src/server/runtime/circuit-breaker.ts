/**
 * Circuit Breaker — prevents cascading failures when external services are down.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service considered unavailable, requests fail fast
 * - HALF_OPEN: Probe mode, single request allowed to test recovery
 *
 * Tracks failures per service endpoint. After N consecutive failures,
 * opens the circuit for a cooldown period before allowing probe requests.
 */

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Failures before opening circuit (default 5) */
  failureThreshold: number;
  /** Cooldown before half-open probe in ms (default 60_000) */
  cooldownMs: number;
  /** Successes in half-open to close circuit (default 2) */
  successThreshold: number;
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastError?: string;
}

// ──────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  successThreshold: 2,
};

// ──────────────────────────────────────────────────────────
// Circuit Breaker
// ──────────────────────────────────────────────────────────

export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  /** Check if a request to the given service is allowed */
  canRequest(serviceKey: string): { allowed: boolean; state: CircuitState; reason?: string } {
    const entry = this.circuits.get(serviceKey);
    if (!entry) {
      return { allowed: true, state: "closed" };
    }

    switch (entry.state) {
      case "closed":
        return { allowed: true, state: "closed" };

      case "open": {
        const elapsed = Date.now() - entry.lastFailureTime;
        if (elapsed >= this.config.cooldownMs) {
          // Transition to half-open: allow a probe request
          entry.state = "half_open";
          entry.successes = 0;
          return { allowed: true, state: "half_open" };
        }
        const remainingMs = Math.ceil((this.config.cooldownMs - elapsed) / 1000);
        return {
          allowed: false,
          state: "open",
          reason: `服务熔断中 (${serviceKey})，${remainingMs}s 后重试。最近错误: ${entry.lastError ?? "unknown"}`,
        };
      }

      case "half_open":
        return { allowed: true, state: "half_open" };

      default:
        return { allowed: true, state: "closed" };
    }
  }

  /** Record a successful request */
  onSuccess(serviceKey: string): void {
    const entry = this.circuits.get(serviceKey);
    if (!entry) return;

    if (entry.state === "half_open") {
      entry.successes++;
      if (entry.successes >= this.config.successThreshold) {
        // Recovered — close circuit
        entry.state = "closed";
        entry.failures = 0;
        entry.successes = 0;
        entry.lastError = undefined;
      }
    } else if (entry.state === "closed") {
      // Reset failure count on success
      entry.failures = 0;
    }
  }

  /** Record a failed request */
  onFailure(serviceKey: string, error?: string): void {
    let entry = this.circuits.get(serviceKey);
    if (!entry) {
      entry = { state: "closed", failures: 0, successes: 0, lastFailureTime: 0 };
      this.circuits.set(serviceKey, entry);
    }

    entry.failures++;
    entry.lastFailureTime = Date.now();
    entry.lastError = error?.slice(0, 200);

    if (entry.state === "half_open") {
      // Probe failed — back to open
      entry.state = "open";
      entry.successes = 0;
    } else if (entry.state === "closed" && entry.failures >= this.config.failureThreshold) {
      // Threshold breached — open circuit
      entry.state = "open";
      console.warn("[CircuitBreaker] Circuit opened for", serviceKey, {
        failures: entry.failures,
        lastError: entry.lastError,
      });
    }
  }

  /** Get current state for a service */
  getState(serviceKey: string): CircuitState {
    return this.circuits.get(serviceKey)?.state ?? "closed";
  }

  /** Force-reset a circuit (e.g., after manual intervention) */
  reset(serviceKey: string): void {
    this.circuits.delete(serviceKey);
  }

  /** Reset all circuits */
  resetAll(): void {
    this.circuits.clear();
  }
}

/**
 * Derive a circuit breaker service key from a base URL.
 * Groups requests by host to avoid per-path granularity.
 */
export function serviceKeyFromUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `llm::${url.host}`;
  } catch {
    return `llm::${baseUrl}`;
  }
}

/** Singleton instance for LLM services */
export const llmCircuitBreaker = new CircuitBreaker();
