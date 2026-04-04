/**
 * Bandit Strategy Types — domain types for the LinUCB-based strategy selection system.
 *
 * The bandit model sits between user input and LLM planning:
 *   User goal → LLM task analysis → feature vector → Bandit selects template → LLM fills details
 */

/* ── Task Analysis (LLM extracts these from natural language) ─────────── */

export type TaskType = "research" | "creation" | "analysis" | "coding" | "translation" | "planning" | "other";

export interface TaskAnalysis {
  taskType: TaskType;
  complexity: number;          // 1-5
  subtaskCount: number;        // suggested number of subtasks
  parallelizable: boolean;     // can subtasks run in parallel?
  needsReview: boolean;        // needs quality review step?
  needsTools: boolean;         // needs tool invocations?
  domains: string[];           // e.g. ["AI", "finance"]
  toolsNeeded: string[];       // e.g. ["web_search", "code_exec"]
}

/* ── Feature Vector ──────────────────────────────────────────────────── */

/** Fixed-dimension numeric vector derived from TaskAnalysis, consumed by LinUCB. */
export type FeatureVector = number[];

/** Feature dimension metadata (for debugging / UI display) */
export const FEATURE_NAMES = [
  // task type one-hot (7)
  "type_research", "type_creation", "type_analysis", "type_coding",
  "type_translation", "type_planning", "type_other",
  // numeric features (5)
  "complexity", "subtask_count", "parallelizable", "needs_review", "needs_tools",
  // tool signals (4)
  "tool_web_search", "tool_code_exec", "tool_file_io", "tool_api_call",
  // bias term (1)
  "bias",
] as const;

export const FEATURE_DIM = FEATURE_NAMES.length;  // 18

/* ── Strategy Templates ──────────────────────────────────────────────── */

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  /** Topology pattern: how nodes are connected */
  topology: "linear" | "parallel" | "fan_out_fan_in" | "pipeline_review" | "deep_chain";
  /** Slot definitions: each slot becomes an agent node */
  slots: TemplateSlot[];
  /** Edge pattern between slots */
  edgePattern: TemplateEdge[];
  /** When to prefer this template (for display/debugging) */
  heuristic: string;
}

export interface TemplateSlot {
  slotId: string;
  role: string;
  nameTemplate: string;           // e.g. "调研专家 - {domain}"
  promptSkeleton: string;         // prompt with {variable} placeholders
  /** Variables the LLM needs to fill */
  variables: string[];
  /** Whether this slot can be duplicated for parallel execution */
  replicable: boolean;
  /** Optional: preferred tools for this slot */
  preferredToolCategories?: string[];
}

export interface TemplateEdge {
  fromSlot: string;
  toSlot: string;
  type: "task_flow" | "output_flow" | "loop_back";
}

/* ── LinUCB Model State ──────────────────────────────────────────────── */

export interface ArmState {
  templateId: string;
  /** A matrix (d x d) — inverse of covariance, stored as flat array row-major */
  A_inv: number[];
  /** b vector (d x 1) */
  b: number[];
  /** Number of times this arm has been pulled */
  pullCount: number;
}

export interface BanditModelState {
  version: number;
  alpha: number;                   // exploration parameter (UCB confidence)
  featureDim: number;
  arms: ArmState[];
  totalPulls: number;
  createdAt: string;
  updatedAt: string;
}

/* ── Experience Record (training data) ────────────────────────────────── */

export interface ExperienceRecord {
  id: string;
  /** Source: "meta_agent" session or "historical" from run center */
  source: "meta_agent" | "historical";
  /** Original goal / task description */
  goal: string;
  /** LLM-extracted task analysis */
  taskAnalysis: TaskAnalysis;
  /** Feature vector (derived from taskAnalysis) */
  features: FeatureVector;
  /** Which template was selected */
  templateId: string;
  /** Reward signal: normalized reflect score (0-1) */
  reward: number;
  /** Additional context */
  runId?: string;
  sessionId?: string;
  runDurationMs?: number;
  totalTokens?: number;
  nodeCount?: number;
  /** Timestamp */
  createdAt: string;
}

/* ── Bandit Decision Output ──────────────────────────────────────────── */

export interface BanditDecision {
  /** Selected template */
  templateId: string;
  /** UCB score for each arm (for UI display) */
  armScores: Array<{ templateId: string; score: number; exploitation: number; exploration: number }>;
  /** Task analysis used */
  taskAnalysis: TaskAnalysis;
  /** Feature vector used */
  features: FeatureVector;
  /** Whether this was an exploration (random) or exploitation (best known) pick */
  isExploration: boolean;
}

/* ── Spawned Agent Definition ─────────────────────────────────────────── */

export interface SpawnedAgent {
  id: string;
  slotId: string;
  name: string;
  role: string;
  systemPrompt: string;
  taskSummary: string;
  responsibilitySummary: string;
  toolIds: string[];
}
