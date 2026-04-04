/**
 * Experience Store — persistence layer for Bandit model state and training data.
 *
 * Two responsibilities:
 * 1. Persist/restore BanditModelState (so model survives server restarts)
 * 2. Store ExperienceRecords (training data) and provide cold-start data from run center
 *
 * Data source for cold-start:
 *   - Historical runs in run_snapshot table (from the run center)
 *   - Meta-agent sessions produce new experience records automatically
 */
import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";
import { memoryStore } from "@/server/store/memory-store";
import { analysisToFeatures } from "./strategy-bandit";
import { getTemplateIds } from "./prompt-skeletons";
import type {
  BanditModelState,
  ExperienceRecord,
  TaskAnalysis,
} from "./types";

// ── Schema (appended to the same SQLite database) ────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS bandit_model_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bandit_experience (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  goal TEXT NOT NULL,
  task_analysis_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  template_id TEXT NOT NULL,
  reward REAL NOT NULL,
  run_id TEXT,
  session_id TEXT,
  run_duration_ms INTEGER,
  total_tokens INTEGER,
  node_count INTEGER,
  created_at TEXT NOT NULL
);
`);

// ── Prepared Statements ──────────────────────────────────────────────────

const stmts = {
  getModelState: db.prepare("SELECT state_json FROM bandit_model_state WHERE id = 'default'"),
  upsertModelState: db.prepare(`
    INSERT INTO bandit_model_state (id, state_json, created_at, updated_at)
    VALUES ('default', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
  `),
  insertExperience: db.prepare(`
    INSERT INTO bandit_experience (id, source, goal, task_analysis_json, features_json, template_id, reward, run_id, session_id, run_duration_ms, total_tokens, node_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listExperiences: db.prepare("SELECT * FROM bandit_experience ORDER BY created_at DESC LIMIT ?"),
  countExperiences: db.prepare("SELECT COUNT(*) as cnt FROM bandit_experience"),
  getExperienceByRunId: db.prepare("SELECT * FROM bandit_experience WHERE run_id = ?"),
};

// ── Model State Persistence ──────────────────────────────────────────────

export function loadModelState(): BanditModelState | null {
  const row = stmts.getModelState.get() as { state_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as BanditModelState;
  } catch {
    return null;
  }
}

export function saveModelState(state: BanditModelState): void {
  const now = nowIso();
  stmts.upsertModelState.run(JSON.stringify(state), state.createdAt || now, now);
}

// ── Experience Records ───────────────────────────────────────────────────

export function saveExperience(record: ExperienceRecord): void {
  stmts.insertExperience.run(
    record.id,
    record.source,
    record.goal,
    JSON.stringify(record.taskAnalysis),
    JSON.stringify(record.features),
    record.templateId,
    record.reward,
    record.runId ?? null,
    record.sessionId ?? null,
    record.runDurationMs ?? null,
    record.totalTokens ?? null,
    record.nodeCount ?? null,
    record.createdAt,
  );
}

export function listExperiences(limit = 100): ExperienceRecord[] {
  const rows = stmts.listExperiences.all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToExperience);
}

export function countExperiences(): number {
  const row = stmts.countExperiences.get() as { cnt: number };
  return row.cnt;
}

function rowToExperience(row: Record<string, unknown>): ExperienceRecord {
  return {
    id: row.id as string,
    source: row.source as "meta_agent" | "historical",
    goal: row.goal as string,
    taskAnalysis: JSON.parse(row.task_analysis_json as string),
    features: JSON.parse(row.features_json as string),
    templateId: row.template_id as string,
    reward: row.reward as number,
    runId: (row.run_id as string) || undefined,
    sessionId: (row.session_id as string) || undefined,
    runDurationMs: (row.run_duration_ms as number) || undefined,
    totalTokens: (row.total_tokens as number) || undefined,
    nodeCount: (row.node_count as number) || undefined,
    createdAt: row.created_at as string,
  };
}

// ── Cold-Start: Generate Training Data from Run Center ───────────────────

/**
 * Scan completed runs in the run center and generate pseudo-experience records
 * for cold-start training.
 *
 * Strategy:
 * 1. Read completed runs from run_snapshot
 * 2. For each run, analyze its structure (node count, topology, success/failure)
 * 3. Map the structure to the closest matching strategy template
 * 4. Generate a synthetic TaskAnalysis based on the run's task input
 * 5. Compute reward based on run outcome
 *
 * This lets the Bandit learn from existing usage without any manual labeling.
 */
export function generateColdStartData(limit = 50): ExperienceRecord[] {
  const runs = memoryStore.listRunSnapshotRows({ limit, runType: "workflow_run" });
  const templateIds = new Set(getTemplateIds());
  const records: ExperienceRecord[] = [];

  for (const run of runs) {
    // Skip incomplete runs
    if (run.status !== "completed" && run.status !== "failed") continue;

    // Skip runs we already have experience for
    const existing = stmts.getExperienceByRunId.get(run.id) as Record<string, unknown> | undefined;
    if (existing) continue;

    const snapshot = memoryStore.getRunSnapshot(run.id);
    if (!snapshot) continue;

    const nodes = snapshot.nodes;
    const edges = snapshot.edges;
    const nodeCount = nodes.length;

    // Determine topology pattern
    const templateId = inferTemplateFromTopology(nodes, edges);
    if (!templateIds.has(templateId)) continue;

    // Build synthetic TaskAnalysis from run metadata
    const taskInput = run.taskInput || run.name || "";
    const taskAnalysis = inferTaskAnalysis(taskInput, nodes, run);

    // Compute reward based on run outcome
    const reward = computeRunReward(run, snapshot);

    const features = analysisToFeatures(taskAnalysis);

    const record: ExperienceRecord = {
      id: makeId("exp"),
      source: "historical",
      goal: taskInput,
      taskAnalysis,
      features,
      templateId,
      reward,
      runId: run.id,
      runDurationMs: diffMs(run.createdAt, run.finishedAt),
      totalTokens: memoryStore.getNodeTraces(run.id).reduce((sum, t) => sum + (t.totalTokens ?? 0), 0),
      nodeCount,
      createdAt: nowIso(),
    };

    records.push(record);
  }

  return records;
}

/** Map a run's topology to the closest strategy template id */
function inferTemplateFromTopology(
  nodes: Array<{ role: string; id: string }>,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
): string {
  const roles = nodes.map((n) => n.role);
  const hasReviewer = roles.includes("reviewer");
  const hasPlanner = roles.includes("planner");
  const hasSummarizer = roles.includes("summarizer");
  const hasResearch = roles.includes("research");
  const workerCount = roles.filter((r) => r === "worker").length;
  const researchCount = roles.filter((r) => r === "research").length;

  // Check for parallel patterns: any node with multiple outgoing edges to same-role nodes
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    outDegree.set(e.sourceNodeId, (outDegree.get(e.sourceNodeId) ?? 0) + 1);
  }
  const hasParallel = [...outDegree.values()].some((d) => d > 1);

  // Deep pipeline: planner + parallel workers + summarizer + reviewer
  if (hasPlanner && hasParallel && hasSummarizer && hasReviewer) return "deep_pipeline";
  // Parallel research + review
  if (hasParallel && hasResearch && hasSummarizer && hasReviewer) return "parallel_research_review";
  // Parallel research
  if (hasParallel && (hasResearch || researchCount >= 2) && hasSummarizer) return "parallel_research";
  // Parallel workers
  if (hasParallel && workerCount >= 2 && hasSummarizer) return "parallel_workers";
  // Plan-execute-review
  if (hasPlanner && hasReviewer) return "plan_execute_review";
  // Linear with review
  if (hasReviewer) return "linear_review";
  // Simple linear
  return "linear_simple";
}

/** Infer TaskAnalysis from run metadata (no LLM call needed for cold-start) */
function inferTaskAnalysis(
  taskInput: string,
  nodes: Array<{ role: string }>,
  run: { status: string },
): TaskAnalysis {
  void run;
  const text = taskInput.toLowerCase();
  const roles = nodes.map((n) => n.role);

  // Infer task type from keywords
  let taskType: TaskAnalysis["taskType"] = "other";
  if (text.includes("调研") || text.includes("research") || text.includes("搜索")) taskType = "research";
  else if (text.includes("代码") || text.includes("code") || text.includes("实现")) taskType = "coding";
  else if (text.includes("分析") || text.includes("analysis")) taskType = "analysis";
  else if (text.includes("翻译") || text.includes("translat")) taskType = "translation";
  else if (text.includes("计划") || text.includes("plan") || text.includes("规划")) taskType = "planning";
  else if (text.includes("写") || text.includes("创作") || text.includes("生成") || text.includes("报告")) taskType = "creation";

  const workerLikeCount = roles.filter((r) => r === "worker" || r === "research").length;

  return {
    taskType,
    complexity: Math.min(5, Math.max(1, Math.ceil(nodes.length / 2))),
    subtaskCount: Math.max(1, workerLikeCount),
    parallelizable: workerLikeCount > 1,
    needsReview: roles.includes("reviewer"),
    needsTools: roles.includes("tool") || text.includes("工具") || text.includes("tool"),
    domains: [],
    toolsNeeded: [],
  };
}

/** Compute a reward signal from run outcome */
function computeRunReward(
  run: { status: string; finishedAt?: string; createdAt: string },
  snapshot: { nodes: Array<{ status: string }> },
): number {
  const completedNodes = snapshot.nodes.filter((n) => n.status === "completed").length;
  const totalNodes = snapshot.nodes.length;
  const completionRate = totalNodes > 0 ? completedNodes / totalNodes : 0;

  if (run.status === "completed") {
    // Base reward + completion rate bonus
    return 0.5 + completionRate * 0.5;
  } else if (run.status === "failed") {
    // Partial credit for how far it got
    return completionRate * 0.4;
  }
  return 0.3;
}

function diffMs(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const val = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(val) && val >= 0 ? val : undefined;
}
