/**
 * Token Budget — per-run and per-node token consumption tracking and enforcement.
 *
 * Prevents runaway LLM calls by tracking cumulative token usage and rejecting
 * requests that would exceed configured budgets.
 *
 * Budget levels:
 * - Run-level:  Total tokens across all nodes in a run (default 500k)
 * - Node-level: Total tokens for a single node execution (default 100k)
 */

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface TokenBudgetConfig {
  /** Max total tokens per run (default 500_000) */
  runBudget: number;
  /** Max total tokens per node execution (default 100_000) */
  nodeBudget: number;
}

export interface TokenUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  runUsed: number;
  runBudget: number;
  nodeUsed: number;
  nodeBudget: number;
}

// ──────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────

export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = {
  runBudget: 500_000,
  nodeBudget: 100_000,
};

// ──────────────────────────────────────────────────────────
// Budget Tracker
// ──────────────────────────────────────────────────────────

export class TokenBudgetTracker {
  private runUsage = new Map<string, TokenUsageSnapshot>();
  private nodeUsage = new Map<string, TokenUsageSnapshot>();
  private configs = new Map<string, TokenBudgetConfig>();

  /** Set budget config for a run */
  configure(runId: string, config: Partial<TokenBudgetConfig>): void {
    this.configs.set(runId, {
      runBudget: config.runBudget ?? DEFAULT_TOKEN_BUDGET.runBudget,
      nodeBudget: config.nodeBudget ?? DEFAULT_TOKEN_BUDGET.nodeBudget,
    });
  }

  /** Record token usage for a node within a run */
  record(runId: string, nodeId: string, usage: Partial<TokenUsageSnapshot>): void {
    const prompt = usage.promptTokens ?? 0;
    const completion = usage.completionTokens ?? 0;
    const total = usage.totalTokens ?? (prompt + completion);

    // Update run-level usage
    const runKey = runId;
    const currentRun = this.runUsage.get(runKey) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.runUsage.set(runKey, {
      promptTokens: currentRun.promptTokens + prompt,
      completionTokens: currentRun.completionTokens + completion,
      totalTokens: currentRun.totalTokens + total,
    });

    // Update node-level usage
    const nodeKey = `${runId}::${nodeId}`;
    const currentNode = this.nodeUsage.get(nodeKey) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.nodeUsage.set(nodeKey, {
      promptTokens: currentNode.promptTokens + prompt,
      completionTokens: currentNode.completionTokens + completion,
      totalTokens: currentNode.totalTokens + total,
    });
  }

  /** Check whether a new LLM request is allowed within budget */
  check(runId: string, nodeId: string): BudgetCheckResult {
    const config = this.configs.get(runId) ?? DEFAULT_TOKEN_BUDGET;
    const runUsed = this.runUsage.get(runId)?.totalTokens ?? 0;
    const nodeUsed = this.nodeUsage.get(`${runId}::${nodeId}`)?.totalTokens ?? 0;

    if (runUsed >= config.runBudget) {
      return {
        allowed: false,
        reason: `运行级 Token 预算耗尽 (已用 ${runUsed.toLocaleString()} / 上限 ${config.runBudget.toLocaleString()})`,
        runUsed,
        runBudget: config.runBudget,
        nodeUsed,
        nodeBudget: config.nodeBudget,
      };
    }

    if (nodeUsed >= config.nodeBudget) {
      return {
        allowed: false,
        reason: `节点级 Token 预算耗尽 (已用 ${nodeUsed.toLocaleString()} / 上限 ${config.nodeBudget.toLocaleString()})`,
        runUsed,
        runBudget: config.runBudget,
        nodeUsed,
        nodeBudget: config.nodeBudget,
      };
    }

    return {
      allowed: true,
      runUsed,
      runBudget: config.runBudget,
      nodeUsed,
      nodeBudget: config.nodeBudget,
    };
  }

  /** Get usage snapshot for a run */
  getRunUsage(runId: string): TokenUsageSnapshot {
    return this.runUsage.get(runId) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  /** Get usage snapshot for a specific node */
  getNodeUsage(runId: string, nodeId: string): TokenUsageSnapshot {
    return this.nodeUsage.get(`${runId}::${nodeId}`) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  /** Clean up data for a completed run */
  cleanup(runId: string): void {
    this.runUsage.delete(runId);
    this.configs.delete(runId);
    // Clean node-level entries
    for (const key of this.nodeUsage.keys()) {
      if (key.startsWith(`${runId}::`)) {
        this.nodeUsage.delete(key);
      }
    }
  }
}

/** Singleton instance */
export const tokenBudgetTracker = new TokenBudgetTracker();
