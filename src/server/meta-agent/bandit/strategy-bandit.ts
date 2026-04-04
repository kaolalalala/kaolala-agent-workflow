/**
 * Strategy Bandit — LinUCB contextual bandit for workflow template selection.
 *
 * LinUCB learns which template works best for each type of task by:
 * 1. Encoding the task as a feature vector (via LLM task analysis)
 * 2. Computing a UCB score for each template (exploitation + exploration)
 * 3. Selecting the template with the highest UCB score
 * 4. After execution, updating the model with the reward (reflect score)
 *
 * All linear algebra is done with flat arrays — no external dependencies.
 */
import type {
  BanditDecision,
  BanditModelState,
  ExperienceRecord,
  FeatureVector,
  TaskAnalysis,
} from "./types";
import { FEATURE_DIM } from "./types";

// ── Linear Algebra Helpers (flat row-major arrays) ───────────────────────

/** Create d×d identity matrix as flat array */
function eye(d: number): number[] {
  const m = new Array(d * d).fill(0);
  for (let i = 0; i < d; i++) m[i * d + i] = 1;
  return m;
}

/** Create d-length zero vector */
function zeros(d: number): number[] {
  return new Array(d).fill(0);
}

/** Matrix-vector multiply: M(d×d) * v(d) → result(d) */
function matvec(M: number[], v: number[], d: number): number[] {
  const result = new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    let sum = 0;
    for (let j = 0; j < d; j++) {
      sum += M[i * d + j] * v[j];
    }
    result[i] = sum;
  }
  return result;
}

/** Dot product of two vectors */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Outer product: a(d) ⊗ b(d) → M(d×d) */
function outer(a: number[], b: number[], d: number): number[] {
  const M = new Array(d * d).fill(0);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      M[i * d + j] = a[i] * b[j];
    }
  }
  return M;
}

/** Vector addition: a + b (in-place on a) */
function vecAdd(a: number[], b: number[]): void {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
}

/**
 * Sherman-Morrison update for A_inv:
 *   A_inv_new = A_inv - (A_inv * x * x^T * A_inv) / (1 + x^T * A_inv * x)
 *
 * This avoids re-inverting the full matrix on each update — O(d²) instead of O(d³).
 */
function shermanMorrisonUpdate(A_inv: number[], x: number[], d: number): void {
  const Ax = matvec(A_inv, x, d);          // A_inv * x
  const xAx = dot(x, Ax);                   // x^T * A_inv * x
  const denom = 1 + xAx;
  const AxAxt = outer(Ax, Ax, d);           // (A_inv * x)(A_inv * x)^T

  for (let i = 0; i < d * d; i++) {
    A_inv[i] -= AxAxt[i] / denom;
  }
}

// ── Feature Extraction ──────────────────────────────────────────────────

/** Convert TaskAnalysis to a fixed-dimension feature vector for LinUCB */
export function analysisToFeatures(analysis: TaskAnalysis): FeatureVector {
  const taskTypeMap: Record<string, number> = {
    research: 0, creation: 1, analysis: 2, coding: 3,
    translation: 4, planning: 5, other: 6,
  };

  // Task type one-hot (7 dims)
  const typeOneHot = new Array(7).fill(0);
  typeOneHot[taskTypeMap[analysis.taskType] ?? 6] = 1;

  // Tool signals (4 dims)
  const tools = new Set(analysis.toolsNeeded.map((t) => t.toLowerCase()));

  const features = [
    ...typeOneHot,
    analysis.complexity / 5,                          // normalize to [0,1]
    Math.min(analysis.subtaskCount, 10) / 10,         // normalize
    analysis.parallelizable ? 1 : 0,
    analysis.needsReview ? 1 : 0,
    analysis.needsTools ? 1 : 0,
    tools.has("web_search") ? 1 : 0,
    tools.has("code_exec") ? 1 : 0,
    tools.has("file_io") || tools.has("file_read") ? 1 : 0,
    tools.has("api_call") || tools.has("http") ? 1 : 0,
    1,                                                 // bias term
  ];

  // Safety: ensure dimension matches
  while (features.length < FEATURE_DIM) features.push(0);
  return features.slice(0, FEATURE_DIM);
}

// ── LinUCB Bandit ────────────────────────────────────────────────────────

export class StrategyBandit {
  private state: BanditModelState;

  constructor(templateIds: string[], alpha = 1.5) {
    this.state = {
      version: 1,
      alpha,
      featureDim: FEATURE_DIM,
      arms: templateIds.map((id) => ({
        templateId: id,
        A_inv: eye(FEATURE_DIM),
        b: zeros(FEATURE_DIM),
        pullCount: 0,
      })),
      totalPulls: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Restore from serialized state */
  static fromState(state: BanditModelState): StrategyBandit {
    const bandit = new StrategyBandit([], state.alpha);
    bandit.state = state;
    return bandit;
  }

  /** Export state for persistence */
  getState(): BanditModelState {
    return this.state;
  }

  /** Get training statistics */
  getStats() {
    return {
      totalPulls: this.state.totalPulls,
      alpha: this.state.alpha,
      arms: this.state.arms.map((arm) => ({
        templateId: arm.templateId,
        pullCount: arm.pullCount,
        // Estimated theta (learned weight vector)
        theta: matvec(arm.A_inv, arm.b, this.state.featureDim),
      })),
    };
  }

  /**
   * Select the best template for the given task features.
   *
   * UCB score for arm a:
   *   score_a = theta_a^T * x + alpha * sqrt(x^T * A_inv_a * x)
   *
   * where theta_a = A_inv_a * b_a (ridge regression estimate)
   */
  select(features: FeatureVector, taskAnalysis: TaskAnalysis): BanditDecision {
    const { alpha, arms, featureDim } = this.state;
    const x = features;

    let bestArm = 0;
    let bestScore = -Infinity;
    const armScores: BanditDecision["armScores"] = [];

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      const theta = matvec(arm.A_inv, arm.b, featureDim);
      const exploitation = dot(theta, x);

      const Ax = matvec(arm.A_inv, x, featureDim);
      const exploration = alpha * Math.sqrt(Math.max(0, dot(x, Ax)));

      const score = exploitation + exploration;

      armScores.push({
        templateId: arm.templateId,
        score,
        exploitation,
        exploration,
      });

      if (score > bestScore) {
        bestScore = score;
        bestArm = i;
      }
    }

    // Determine if this is exploration: if the winning arm has high exploration relative to exploitation
    const winner = armScores[bestArm];
    const isExploration = winner.exploration > Math.abs(winner.exploitation) * 0.5;

    return {
      templateId: arms[bestArm].templateId,
      armScores,
      taskAnalysis,
      features,
      isExploration,
    };
  }

  /**
   * Update the model with observed reward.
   *
   * LinUCB update:
   *   A_a = A_a + x * x^T   (via Sherman-Morrison on A_inv)
   *   b_a = b_a + reward * x
   */
  update(templateId: string, features: FeatureVector, reward: number): void {
    const arm = this.state.arms.find((a) => a.templateId === templateId);
    if (!arm) return;

    const x = features;
    const d = this.state.featureDim;

    // Sherman-Morrison update of A_inv (avoids full matrix inversion)
    shermanMorrisonUpdate(arm.A_inv, x, d);

    // b = b + reward * x
    const rx = x.map((xi) => reward * xi);
    vecAdd(arm.b, rx);

    arm.pullCount++;
    this.state.totalPulls++;
    this.state.updatedAt = new Date().toISOString();
  }

  /**
   * Batch update from historical experience records.
   * Used for cold-start training from run center data.
   */
  batchUpdate(records: ExperienceRecord[]): { updated: number; skipped: number } {
    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      const arm = this.state.arms.find((a) => a.templateId === record.templateId);
      if (!arm) {
        skipped++;
        continue;
      }
      this.update(record.templateId, record.features, record.reward);
      updated++;
    }

    return { updated, skipped };
  }

  /**
   * Add a new arm (template) to the bandit.
   * Used when new strategy templates are added to the system.
   */
  addArm(templateId: string): void {
    if (this.state.arms.some((a) => a.templateId === templateId)) return;
    this.state.arms.push({
      templateId,
      A_inv: eye(FEATURE_DIM),
      b: zeros(FEATURE_DIM),
      pullCount: 0,
    });
  }

  /**
   * Decay exploration parameter over time.
   * As more data is collected, reduce exploration to exploit learned knowledge.
   */
  decayAlpha(minAlpha = 0.3): void {
    // Exponential decay: alpha decreases as total pulls increase
    const decayRate = 0.995;
    this.state.alpha = Math.max(minAlpha, this.state.alpha * decayRate);
  }
}
