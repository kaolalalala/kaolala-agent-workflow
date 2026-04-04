/**
 * Data Collector — harvests high-quality training samples from the platform's runtime data.
 *
 * Five data sources / collection strategies:
 * 1. Orchestrator SFT: (full planning context, blueprint with systemPrompts, reward) → orchestrator fine-tuning
 * 2. Agent SFT: (system_prompt, user_prompt, message_history, completion) → agent fine-tuning
 * 3. DPO Pairs: same-goal comparisons of high-reward vs low-reward orchestrator blueprints
 *
 * Quality improvements over v1:
 * - Full decision context snapshots (not just goal string)
 * - Node systemPrompts extracted from node_config table
 * - Structured inputContext as JSON (available templates, tools, feedback)
 * - Same-goal DPO pairing with Jaccard similarity fallback
 * - Goal hash indexing for efficient lookups
 */
import { db } from "@/server/persistence/sqlite";
import { makeId, nowIso } from "@/lib/utils";
import { memoryStore } from "@/server/store/memory-store";
import { configService } from "@/server/config/config-service";
import { toolService } from "@/server/tools/tool-service";

// ── Schema ──────────────────────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS training_sample (
  id TEXT PRIMARY KEY,
  sample_type TEXT NOT NULL,
  goal TEXT NOT NULL,
  goal_hash TEXT,
  instruction TEXT NOT NULL,
  input_context TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL,
  reward REAL,
  run_id TEXT,
  session_id TEXT,
  node_count INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  quality_scores_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_sample_type ON training_sample(sample_type);
CREATE INDEX IF NOT EXISTS idx_training_sample_reward ON training_sample(reward);
`);

// Migration: add columns that may not exist on older schemas
try { db.exec("ALTER TABLE training_sample ADD COLUMN goal_hash TEXT"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE training_sample ADD COLUMN quality_scores_json TEXT"); } catch { /* already exists */ }
try { db.exec("CREATE INDEX IF NOT EXISTS idx_training_sample_goal_hash ON training_sample(goal_hash)"); } catch { /* old schema fallback */ }

// ── Types ───────────────────────────────────────────────────────────────

export interface TrainingSample {
  id: string;
  sampleType: "orchestrator_sft_v3" | "agent_sft" | "orchestrator_dpo_v3_chosen" | "orchestrator_dpo_v3_rejected";
  goal: string;
  goalHash?: string;
  instruction: string;
  inputContext: string;
  output: string;
  reward?: number;
  runId?: string;
  sessionId?: string;
  nodeCount?: number;
  totalTokens?: number;
  durationMs?: number;
  qualityScores?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** Structured orchestrator input context (stored as JSON in inputContext field) */
type TaskTypeLike =
  | "research"
  | "creation"
  | "analysis"
  | "coding"
  | "translation"
  | "planning"
  | "other";

interface OrchestratorInputContext {
  sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel";
  goal: string;
  taskFeatures: {
    taskType: TaskTypeLike;
    estimatedWorkItems: number;
    workItemType: string;
    itemIndependence: "low" | "medium" | "high";
    crossItemDependency: "low" | "medium" | "high";
    globalAggregationNeeded: boolean;
    latencyBudgetMs: number;
    costSensitivity: "low" | "medium" | "high";
    riskLevel: "low" | "medium" | "high";
    domains: string[];
    toolsNeeded: string[];
  };
  graphRequirements: {
    requiredRoles: string[];
    maxWorkers: number;
    expectedPattern: "serial" | "fan_out_fan_in" | "map_reduce";
    minNodes: number;
    maxNodes: number;
  };
  resourceContext: {
    availableTemplates: string[];
    availableToolIds: string[];
  };
  runContext: {
    templateId?: string;
    source: string;
  };
  previousFeedback?: string;
  planningPrompt?: string;
  curriculumTag?: "explicit_parallel_teaching" | "implicit_parallel_trigger" | "serial_anchor";
}

interface TaskAnalysisLike {
  taskType?: TaskTypeLike;
  complexity?: number;
  subtaskCount?: number;
  parallelizable?: boolean;
  needsReview?: boolean;
  needsTools?: boolean;
  domains?: string[];
  toolsNeeded?: string[];
}

interface TopologyMetrics {
  dagDepth: number;
  maxParallelWidth: number;
  hasParallel: boolean;
}

interface OrchestratorOutputV2 {
  sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel";
  orchestrationDecision: {
    shouldParallelize: boolean;
    decisionReason: string[];
    strategyType: "serial" | "fan_out_fan_in" | "map_reduce";
  };
  workloadPlan: {
    splitUnit: string;
    splitMethod: "equal_batch" | "semantic_cluster" | "single_flow";
    batchCount: number;
    batchSize: number;
    workerAssignment: Array<{
      workerId: string;
      nodeId: string;
      role: string;
      batchSelector: string;
      toolBindings: string[];
    }>;
  };
  parallelStructure: {
    splitter: { nodeId: string; outputShards: number };
    parallelGroup: {
      groupId: string;
      workerCount: number;
      workers: string[];
    };
    fanIn: {
      joinType: "wait_all" | "single_path";
      mergeNodeId: string;
    };
  };
  joinPolicy: {
    mergeStrategy: "evidence_weighted" | "single_stream";
    conflictResolution: "reviewer_tiebreak" | "none";
    finalVerifier: string;
    outputContract: string[];
  };
  graphStats: {
    nodeCount: number;
    edgeCount: number;
    dagDepth: number;
    maxParallelWidth: number;
    hasParallel: boolean;
    hasReviewer: boolean;
    hasSummarizer: boolean;
    hasResearch: boolean;
    rootTask: string;
  };
  nodeSpecs: Array<{
    nodeId: string;
    nodeName: string;
    nodeRole: string;
    taskSummary: string;
    responsibilitySummary: string;
    systemPrompt: string;
    toolIds: string[];
    inDegree: number;
    outDegree: number;
    executionOrder?: number;
  }>;
  edgeSpecs: Array<{
    edgeId: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: string;
  }>;
  executionStats: {
    runStatus: string;
    durationMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    llmRoundCount: number;
    toolCallCount: number;
    failedNodeCount: number;
    completedNodeCount: number;
    retryCount: number;
  };
  strategyMeta: {
    templateId?: string;
    source: string;
    runId: string;
    sessionId?: string;
    reward?: number;
  };
}

/** Structured agent input context (stored as JSON in inputContext field) */
interface AgentInputContext {
  goal: string;
  systemPrompt: string;
  userPrompt: string;
  messageHistory?: unknown[];
  nodeRole: string;
  nodeName: string;
  round: number;
}

// ── Prepared Statements ─────────────────────────────────────────────────

const stmts = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO training_sample
    (id, sample_type, goal, instruction, input_context, output, reward,
     run_id, session_id, node_count, total_tokens, duration_ms, quality_scores_json, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  list: db.prepare("SELECT * FROM training_sample ORDER BY created_at DESC LIMIT ?"),
  listByType: db.prepare("SELECT * FROM training_sample WHERE sample_type = ? ORDER BY created_at DESC LIMIT ?"),
  count: db.prepare("SELECT sample_type, COUNT(*) as cnt FROM training_sample GROUP BY sample_type"),
  countAll: db.prepare("SELECT COUNT(*) as cnt FROM training_sample"),
  listByMinReward: db.prepare("SELECT * FROM training_sample WHERE reward >= ? ORDER BY reward DESC LIMIT ?"),
  existsForRun: db.prepare("SELECT 1 FROM training_sample WHERE run_id = ? AND sample_type = ? LIMIT 1"),
  updateQuality: db.prepare(`
    UPDATE training_sample
    SET reward = ?, quality_scores_json = ?, metadata_json = ?
    WHERE id = ?
  `),
  deleteAll: db.prepare("DELETE FROM training_sample"),
  deleteOrchestratorFamily: db.prepare(`
    DELETE FROM training_sample
    WHERE sample_type IN (
      'orchestrator_sft',
      'orchestrator_sft_v2',
      'orchestrator_sft_v3',
      'orchestrator_dpo_chosen',
      'orchestrator_dpo_rejected',
      'orchestrator_dpo_v2_chosen',
      'orchestrator_dpo_v2_rejected',
      'orchestrator_dpo_v3_chosen',
      'orchestrator_dpo_v3_rejected'
    )
  `),
};

// ── Save / Query ────────────────────────────────────────────────────────

function saveSample(sample: TrainingSample): void {
  stmts.insert.run(
    sample.id,
    sample.sampleType,
    sample.goal,
    sample.instruction,
    sample.inputContext,
    sample.output,
    sample.reward ?? null,
    sample.runId ?? null,
    sample.sessionId ?? null,
    sample.nodeCount ?? null,
    sample.totalTokens ?? null,
    sample.durationMs ?? null,
    sample.qualityScores ? JSON.stringify(sample.qualityScores) : null,
    sample.metadata ? JSON.stringify(sample.metadata) : null,
    sample.createdAt,
  );
}

function rowToSample(row: Record<string, unknown>): TrainingSample {
  return {
    id: row.id as string,
    sampleType: row.sample_type as TrainingSample["sampleType"],
    goal: row.goal as string,
    goalHash: (row.goal_hash as string) || undefined,
    instruction: row.instruction as string,
    inputContext: row.input_context as string,
    output: row.output as string,
    reward: row.reward as number | undefined,
    runId: (row.run_id as string) || undefined,
    sessionId: (row.session_id as string) || undefined,
    nodeCount: (row.node_count as number) || undefined,
    totalTokens: (row.total_tokens as number) || undefined,
    durationMs: (row.duration_ms as number) || undefined,
    qualityScores: row.quality_scores_json ? JSON.parse(row.quality_scores_json as string) : undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : undefined,
    createdAt: row.created_at as string,
  };
}

export function listSamples(limit = 100): TrainingSample[] {
  return (stmts.list.all(limit) as Array<Record<string, unknown>>).map(rowToSample);
}

export function listSamplesByType(type: string, limit = 100): TrainingSample[] {
  return (stmts.listByType.all(type, limit) as Array<Record<string, unknown>>).map(rowToSample);
}

export function listHighQualitySamples(minReward: number, limit = 500): TrainingSample[] {
  return (stmts.listByMinReward.all(minReward, limit) as Array<Record<string, unknown>>).map(rowToSample);
}

export function listSamplesByGoalHash(goalHash: string, type: string): TrainingSample[] {
  return listSamplesByType(type, 5000).filter((sample) => {
    const hash = sample.goalHash ?? computeGoalHash(sample.goal);
    return hash === goalHash;
  });
}

export function getSampleCounts(): Record<string, number> {
  const rows = stmts.count.all() as Array<{ sample_type: string; cnt: number }>;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.sample_type] = r.cnt;
  counts._total = (stmts.countAll.get() as { cnt: number }).cnt;
  return counts;
}

export function clearAllSamples(): void {
  stmts.deleteAll.run();
}

export function updateSampleQuality(
  sampleId: string,
  reward: number,
  qualityScores: Record<string, unknown>,
  metadataPatch?: Record<string, unknown>,
): void {
  const row = db
    .prepare("SELECT metadata_json FROM training_sample WHERE id = ?")
    .get(sampleId) as { metadata_json?: string | null } | undefined;
  if (!row) return;

  let currentMeta: Record<string, unknown> = {};
  if (row.metadata_json) {
    try { currentMeta = JSON.parse(row.metadata_json); } catch { currentMeta = {}; }
  }
  const nextMeta = metadataPatch ? { ...currentMeta, ...metadataPatch } : currentMeta;

  stmts.updateQuality.run(
    reward,
    JSON.stringify(qualityScores),
    Object.keys(nextMeta).length > 0 ? JSON.stringify(nextMeta) : null,
    sampleId,
  );
}

// ── Collector: Orchestrator SFT Samples (Enriched) ──────────────────────
//
// From Meta-Agent runs: full planning context + enriched blueprint with systemPrompts + reward.
// This trains the model to do task decomposition, agent design, and prompt writing.

const ORCHESTRATOR_INSTRUCTION = `你是多智能体编排器（orchestrator），请输出结构化 workflow 设计结果。
要求：
1. 必须产出可执行的图结构（节点+边）。
2. 明确每个节点的角色、职责、工具绑定、上下游依赖。
3. 必须给出拓扑统计（节点数、并行度、深度、关键角色覆盖）。
4. 输出必须是严格 JSON，可直接用于运行时装载。`;

/**
 * Collect orchestrator SFT samples from completed Meta-Agent sessions.
 * Enriched with: full planning context, node systemPrompts, reasoning chain.
 */
export function collectFromMetaAgentSessions(): number {
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db.prepare(
      "SELECT * FROM bandit_experience WHERE reward > 0 ORDER BY created_at DESC LIMIT 500",
    ).all() as Array<Record<string, unknown>>;
  } catch {
    // bandit module not initialized yet, skip this source gracefully
    return 0;
  }

  // Hard migration: remove old orchestrator-family formats and rebuild as v2 only.
  stmts.deleteOrchestratorFamily.run();

  // Gather available context once (shared across all samples)
  const templates = configService.listWorkflowTemplates();
  const templateNames = templates.map((t) => `${t.name}: ${t.description ?? ""}`);
  const availableToolIds = toolService
    .listTools()
    .filter((tool) => tool.enabled)
    .map((tool) => tool.toolId);

  let collected = 0;
  const seenRunIds = new Set<string>();

  for (const row of rows) {
    const runId = row.run_id as string | null;
    if (!runId) continue;
    if (seenRunIds.has(runId)) continue;
    seenRunIds.add(runId);

    const snapshot = memoryStore.getRunSnapshot(runId);
    if (!snapshot) continue;

    const goal = (row.goal as string) || "";
    const reward = row.reward as number;
    const taskAnalysis = safeParseTaskAnalysis(row.task_analysis_json as string | undefined);

    const curriculumTag = selectCurriculumTag(goal);
    const inputContext: OrchestratorInputContext = {
      sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel",
      goal,
      taskFeatures: normalizeTaskFeatures(taskAnalysis, snapshot.nodes.length, goal),
      graphRequirements: {
        requiredRoles: ["input", "output", "worker"],
        maxWorkers: 8,
        expectedPattern: inferExpectedPattern(goal, taskAnalysis),
        minNodes: 3,
        maxNodes: 10,
      },
      resourceContext: {
        availableTemplates: templateNames,
        availableToolIds,
      },
      runContext: {
        templateId: typeof row.template_id === "string" ? row.template_id : undefined,
        source: "meta_agent_session",
      },
      previousFeedback: (row.metadata_json as string)
        ? tryParseField(row.metadata_json as string, "previousFeedback")
        : undefined,
      planningPrompt: (row.metadata_json as string)
        ? tryParseField(row.metadata_json as string, "planningPrompt")
        : undefined,
      curriculumTag,
    };

    const outputPayload = buildOrchestratorOutputV2(snapshot, runId, goal, {
      reward,
      templateId: typeof row.template_id === "string" ? row.template_id : undefined,
      sessionId: typeof row.session_id === "string" ? row.session_id : undefined,
      source: "meta_agent_session",
    });
    const output = JSON.stringify(outputPayload, null, 2);

    const goalHash = computeGoalHash(goal);
    const nodeTraces = memoryStore.getNodeTraces(runId);
    const totalTokens = nodeTraces.reduce((s, t) => s + (t.totalTokens ?? 0), 0);

    saveSample({
      id: makeId("ts"),
      sampleType: "orchestrator_sft_v3",
      goal,
      goalHash,
      instruction: ORCHESTRATOR_INSTRUCTION,
      inputContext: JSON.stringify(inputContext),
      output,
      reward,
      runId,
      nodeCount: snapshot.nodes.length,
      totalTokens,
      durationMs: diffMs(snapshot.run.createdAt, snapshot.run.finishedAt),
      metadata: {
        sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel",
        templateId: row.template_id,
        source: "meta_agent_session",
        curriculumTag,
        graphStats: outputPayload.graphStats,
      },
      createdAt: nowIso(),
    });

    collected++;
  }

  return collected;
}

// ── Collector: Agent SFT Samples (Enriched) ─────────────────────────────
//
// From PromptTrace: complete context snapshots with message history.
// This trains individual agent nodes with full conversational context.

/**
 * Collect agent SFT samples from all completed runs.
 * Enriched with: full message history, node role/name context, structured inputContext.
 */
export function collectFromPromptTraces(limit = 200): number {
  const runs = memoryStore.listRunSnapshotRows({ limit, runType: "workflow_run" });
  let collected = 0;

  for (const run of runs) {
    if (run.status !== "completed") continue;

    const exists = stmts.existsForRun.get(run.id, "agent_sft");
    if (exists) continue;

    const promptTraces = memoryStore.getPromptTraces(run.id);
    const snapshot = memoryStore.getRunSnapshot(run.id);
    if (!snapshot) continue;
    const goal = run.taskInput || run.name || "";

      // Fallback path: if prompt traces are unavailable, derive agent samples from node outputs.
    if (promptTraces.length === 0) {
      for (const node of snapshot.nodes) {
        if (node.role === "input" || node.role === "output") continue;
        if (!node.latestOutput || !node.latestOutput.trim()) continue;

        const nodeConfig = configService.getNodeConfig(run.id, node.id);
        const inputContext: AgentInputContext = {
          goal,
          systemPrompt: nodeConfig?.systemPrompt || "You are an AI agent in a multi-agent workflow.",
          userPrompt: nodeConfig?.description || node.name || goal,
          messageHistory: [],
          nodeRole: node.role,
          nodeName: node.name,
          round: 1,
        };

        const isSuccess = node.status === "completed";
        saveSample({
          id: makeId("ts"),
          sampleType: "agent_sft",
          goal,
          goalHash: computeGoalHash(goal),
          instruction: inputContext.systemPrompt,
          inputContext: JSON.stringify(inputContext),
          output: node.latestOutput,
          reward: isSuccess ? 0.65 : 0.35,
          runId: run.id,
          durationMs: run.finishedAt ? diffMs(run.createdAt, run.finishedAt) : undefined,
          metadata: {
            nodeId: node.id,
            nodeName: node.name,
            nodeRole: node.role,
            source: "node_output_fallback",
          },
          createdAt: nowIso(),
        });
        collected++;
      }
      continue;
    }

    for (const pt of promptTraces) {
      // Skip failed LLM calls or empty responses
      if (pt.error || !pt.completion) continue;
      if (!pt.systemPrompt && !pt.userPrompt) continue;

      // Find the node info for richer context
      const node = snapshot?.nodes.find((n) => n.id === pt.nodeId);
      const nodeName = node?.name || pt.nodeId;
      const nodeRole = node?.role || "worker";

      // Parse message history if available
      let messageHistory: unknown[] | undefined;
      if (pt.messageHistoryJson) {
        try { messageHistory = JSON.parse(pt.messageHistoryJson); } catch { /* ignore */ }
      }

      // Build structured input context
      const inputContext: AgentInputContext = {
        goal,
        systemPrompt: pt.systemPrompt || "你是一个 AI 助手。",
        userPrompt: pt.userPrompt || "",
        messageHistory,
        nodeRole,
        nodeName,
        round: pt.round,
      };

      const instruction = pt.systemPrompt || "你是一个 AI 助手。";
      const output = pt.completion;

      // Preliminary quality estimate (will be overridden by quality evaluator when available)
      const nodeTrace = memoryStore.getNodeTraces(run.id, pt.nodeId);
      const nodeSucceeded = nodeTrace.some((nt) => nt.status === "completed");
      const preliminaryReward = nodeSucceeded ? 0.7 : 0.3;

      saveSample({
        id: makeId("ts"),
        sampleType: "agent_sft",
        goal,
        goalHash: computeGoalHash(goal),
        instruction,
        inputContext: JSON.stringify(inputContext),
        output,
        reward: preliminaryReward,
        runId: run.id,
        totalTokens: pt.totalTokens,
        durationMs: pt.durationMs,
        metadata: {
          nodeId: pt.nodeId,
          nodeName,
          nodeRole,
          round: pt.round,
          provider: pt.provider,
          model: pt.model,
          source: "prompt_trace",
          hasMessageHistory: !!messageHistory,
          preliminaryScoring: true,
        },
        createdAt: nowIso(),
      });

      collected++;
    }
  }

  return collected;
}

// ── Collector: DPO Preference Pairs (Same-Goal) ─────────────────────────
//
// Only pairs orchestrator decisions for the SAME or highly-similar goals.
// This is critical for valid DPO training: chosen/rejected must respond to the same prompt.

/**
 * Generate DPO preference pairs from existing orchestrator samples.
 * Only pairs samples with the same or similar goal (Jaccard similarity > threshold).
 */
export function collectDPOPairs(scoreDiff = 0.2, similarityThreshold = 0.6): number {
  const samples = listSamplesByType("orchestrator_sft_v3", 500);
  if (samples.length < 2) return 0;

  // Group samples by goal hash for efficient same-goal lookup
  const goalGroups = new Map<string, TrainingSample[]>();
  for (const s of samples) {
    const hash = s.goalHash || computeGoalHash(s.goal);
    const group = goalGroups.get(hash) || [];
    group.push(s);
    goalGroups.set(hash, group);
  }

  let collected = 0;

  // Strategy 1: Exact same-goal pairs (highest quality DPO data)
  for (const [, group] of goalGroups) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => (b.reward ?? 0) - (a.reward ?? 0));
    let best = sorted[0];
    let worst = sorted[sorted.length - 1];

    // Prefer pairing different strategy/template runs for a fair same-goal preference comparison.
    const diversePair = findBestDiversePair(sorted, scoreDiff);
    if (diversePair) {
      best = diversePair.chosen;
      worst = diversePair.rejected;
    }

    if ((best.reward ?? 0) - (worst.reward ?? 0) < scoreDiff) continue;

    const pairKey = `dpo_${best.runId}_${worst.runId}`;
    const exists = stmts.existsForRun.get(pairKey, "orchestrator_dpo_v3_chosen");
    if (exists) continue;

    saveDPOPair(best, worst, pairKey, "exact_goal_match");
    collected += 2;
    if (collected > 200) return collected;
  }

  // Strategy 2: Similar-goal pairs (Jaccard word similarity)
  const goalHashes = Array.from(goalGroups.keys());
  for (let i = 0; i < goalHashes.length && collected <= 200; i++) {
    for (let j = i + 1; j < goalHashes.length && collected <= 200; j++) {
      const groupA = goalGroups.get(goalHashes[i])!;
      const groupB = goalGroups.get(goalHashes[j])!;

      // Check similarity between representative goals
      const similarity = jaccardSimilarity(groupA[0].goal, groupB[0].goal);
      if (similarity < similarityThreshold) continue;

      // Find the best from each group and pair if reward differs enough
      const bestA = groupA.reduce((a, b) => ((a.reward ?? 0) > (b.reward ?? 0) ? a : b));
      const bestB = groupB.reduce((a, b) => ((a.reward ?? 0) > (b.reward ?? 0) ? a : b));

      const chosen = (bestA.reward ?? 0) >= (bestB.reward ?? 0) ? bestA : bestB;
      const rejected = chosen === bestA ? bestB : bestA;

      if ((chosen.reward ?? 0) - (rejected.reward ?? 0) < scoreDiff) continue;

      const pairKey = `dpo_sim_${chosen.runId}_${rejected.runId}`;
      const exists = stmts.existsForRun.get(pairKey, "orchestrator_dpo_v3_chosen");
      if (exists) continue;

      saveDPOPair(chosen, rejected, pairKey, "similar_goal_match");
      collected += 2;
    }
  }

  return collected;
}

function findBestDiversePair(sortedByRewardDesc: TrainingSample[], minDiff: number) {
  let bestPair: { chosen: TrainingSample; rejected: TrainingSample; diff: number } | null = null;
  for (let i = 0; i < sortedByRewardDesc.length; i++) {
    for (let j = sortedByRewardDesc.length - 1; j > i; j--) {
      const chosen = sortedByRewardDesc[i];
      const rejected = sortedByRewardDesc[j];
      const diff = (chosen.reward ?? 0) - (rejected.reward ?? 0);
      if (diff < minDiff) continue;

      const chosenTpl = extractTemplateId(chosen);
      const rejectedTpl = extractTemplateId(rejected);
      if (chosenTpl && rejectedTpl && chosenTpl !== rejectedTpl) {
        if (!bestPair || diff > bestPair.diff) {
          bestPair = { chosen, rejected, diff };
        }
      }
    }
  }
  return bestPair ? { chosen: bestPair.chosen, rejected: bestPair.rejected } : null;
}

function extractTemplateId(sample: TrainingSample): string | undefined {
  return typeof sample.metadata?.templateId === "string"
    ? (sample.metadata.templateId as string)
    : undefined;
}

function saveDPOPair(chosen: TrainingSample, rejected: TrainingSample, pairKey: string, matchType: string): void {
  saveSample({
    id: makeId("ts"),
    sampleType: "orchestrator_dpo_v3_chosen",
    goal: chosen.goal,
    goalHash: chosen.goalHash,
    instruction: ORCHESTRATOR_INSTRUCTION,
    inputContext: chosen.inputContext,
    output: chosen.output,
    reward: chosen.reward,
    runId: pairKey,
    metadata: {
      pairType: "chosen",
      matchType,
      originalRunId: chosen.runId,
      rejectedRunId: rejected.runId,
      rewardDiff: (chosen.reward ?? 0) - (rejected.reward ?? 0),
    },
    createdAt: nowIso(),
  });

  saveSample({
    id: makeId("ts"),
    sampleType: "orchestrator_dpo_v3_rejected",
    goal: rejected.goal,
    goalHash: rejected.goalHash,
    instruction: ORCHESTRATOR_INSTRUCTION,
    inputContext: rejected.inputContext,
    output: rejected.output,
    reward: rejected.reward,
    runId: pairKey,
    metadata: {
      pairType: "rejected",
      matchType,
      originalRunId: rejected.runId,
      chosenRunId: chosen.runId,
      rewardDiff: (chosen.reward ?? 0) - (rejected.reward ?? 0),
    },
    createdAt: nowIso(),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface SnapshotLike {
  run: { id: string; status?: string; createdAt: string; finishedAt?: string };
  nodes: Array<{ id: string; name: string; role: string; latestOutput?: string; error?: string; status?: string; executionOrder?: number }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; type?: string }>;
}

/**
 * Build enriched blueprint from a run snapshot, including systemPrompt from node_config.
 * This produces much richer training targets than the v1 skeleton.
 */
function buildEnrichedBlueprintFromSnapshot(snapshot: SnapshotLike, runId: string, goal: string) {
  if (!snapshot.nodes.length) return null;

  return {
    nodes: snapshot.nodes.map((n) => {
      // Fetch the actual systemPrompt and responsibility from node_config
      const nodeConfig = configService.getNodeConfig(runId, n.id);

      const resolvedTools = toolService
        .listBindings("node_instance", `${runId}:${n.id}`)
        .filter((binding) => binding.enabled)
        .map((binding) => binding.toolId);

      return {
        id: n.id,
        name: n.name,
        role: n.role,
        taskSummary: nodeConfig?.description || nodeConfig?.name || n.name,
        responsibilitySummary: nodeConfig?.responsibility || "",
        systemPrompt: nodeConfig?.systemPrompt || "",
        toolIds: resolvedTools,
      };
    }),
    edges: snapshot.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      type: e.type || "task_flow",
    })),
    rootTask: goal,
  };
}

function normalizeTaskFeatures(taskAnalysis: TaskAnalysisLike, nodeCount: number, goal: string) {
  const estimatedWorkItems = inferEstimatedWorkItems(goal, nodeCount, taskAnalysis);
  const itemIndependence = inferItemIndependence(goal, taskAnalysis);
  const crossItemDependency: "low" | "medium" | "high" =
    itemIndependence === "high" ? "low" : itemIndependence === "medium" ? "medium" : "high";
  const costSensitivity: "low" | "medium" | "high" =
    estimatedWorkItems >= 50 ? "high" : estimatedWorkItems >= 20 ? "medium" : "low";
  const riskLevel: "low" | "medium" | "high" = Boolean(taskAnalysis.needsReview) ? "high" : "medium";
  const needsTools = Boolean(taskAnalysis.needsTools) || detectToolHeavyGoal(goal);
  return {
    taskType: taskAnalysis.taskType ?? "other",
    estimatedWorkItems,
    workItemType: inferWorkItemType(goal),
    itemIndependence,
    crossItemDependency,
    globalAggregationNeeded: true,
    latencyBudgetMs: inferLatencyBudgetMs(goal, estimatedWorkItems),
    costSensitivity,
    riskLevel,
    domains: Array.isArray(taskAnalysis.domains) ? taskAnalysis.domains.filter((d): d is string => typeof d === "string") : [],
    toolsNeeded: needsTools
      ? (Array.isArray(taskAnalysis.toolsNeeded)
          ? taskAnalysis.toolsNeeded.filter((d): d is string => typeof d === "string")
          : ["tool_search_or_retrieval"])
      : [],
  };
}

function inferExpectedPattern(goal: string, taskAnalysis: TaskAnalysisLike): "serial" | "fan_out_fan_in" | "map_reduce" {
  const lower = goal.toLowerCase();
  if (/summar|综述|汇总|aggregate|synthesis/.test(lower)) return "fan_out_fan_in";
  if (/cluster|分类|聚类|reduce|map/.test(lower)) return "map_reduce";
  if (Boolean(taskAnalysis.parallelizable)) return "fan_out_fan_in";
  return "serial";
}

function selectCurriculumTag(goal: string): "explicit_parallel_teaching" | "implicit_parallel_trigger" | "serial_anchor" {
  const lower = goal.toLowerCase();
  if (/并行|parallel|fan[-_ ]?out|fan[-_ ]?in/.test(lower)) return "explicit_parallel_teaching";
  const hashNum = Math.abs(hashStringToInt(goal)) % 100;
  if (hashNum < 45) return "implicit_parallel_trigger";
  if (hashNum < 85) return "explicit_parallel_teaching";
  return "serial_anchor";
}

function buildOrchestratorOutputV2(
  snapshot: SnapshotLike,
  runId: string,
  goal: string,
  meta: { reward?: number; templateId?: string; source: string; sessionId?: string },
): OrchestratorOutputV2 {
  const blueprint = buildEnrichedBlueprintFromSnapshot(snapshot, runId, goal);
  if (!blueprint) {
    return {
      sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel",
      orchestrationDecision: {
        shouldParallelize: false,
        decisionReason: ["No executable nodes found in snapshot."],
        strategyType: "serial",
      },
      workloadPlan: {
        splitUnit: "task",
        splitMethod: "single_flow",
        batchCount: 1,
        batchSize: 1,
        workerAssignment: [],
      },
      parallelStructure: {
        splitter: { nodeId: "splitter_none", outputShards: 1 },
        parallelGroup: { groupId: "serial_group", workerCount: 1, workers: [] },
        fanIn: { joinType: "single_path", mergeNodeId: "merge_none" },
      },
      joinPolicy: {
        mergeStrategy: "single_stream",
        conflictResolution: "none",
        finalVerifier: "none",
        outputContract: ["Provide coherent final answer."],
      },
      graphStats: {
        nodeCount: 0,
        edgeCount: 0,
        dagDepth: 0,
        maxParallelWidth: 0,
        hasParallel: false,
        hasReviewer: false,
        hasSummarizer: false,
        hasResearch: false,
        rootTask: goal,
      },
      nodeSpecs: [],
      edgeSpecs: [],
      executionStats: {
        runStatus: snapshot.run.status ?? "unknown",
        durationMs: diffMs(snapshot.run.createdAt, snapshot.run.finishedAt) ?? 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        llmRoundCount: 0,
        toolCallCount: 0,
        failedNodeCount: 0,
        completedNodeCount: 0,
        retryCount: 0,
      },
      strategyMeta: {
        source: meta.source,
        runId,
        reward: meta.reward,
        templateId: meta.templateId,
        sessionId: meta.sessionId,
      },
    };
  }

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const node of blueprint.nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }
  for (const edge of blueprint.edges) {
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
    outDegree.set(edge.sourceNodeId, (outDegree.get(edge.sourceNodeId) ?? 0) + 1);
  }

  const topo = computeTopologyMetrics(blueprint.nodes.map((n) => n.id), blueprint.edges);
  const nodeTraces = memoryStore.getNodeTraces(runId);
  const toolTraces = memoryStore.getToolTraces(runId);
  const promptTraces = memoryStore.getPromptTraces(runId);

  const promptTokens = promptTraces.reduce((s, t) => s + (t.promptTokens ?? 0), 0);
  const completionTokens = promptTraces.reduce((s, t) => s + (t.completionTokens ?? 0), 0);
  const totalTokens = promptTraces.reduce((s, t) => s + (t.totalTokens ?? 0), 0);
  const llmRoundCount = promptTraces.length;
  const retryCount = nodeTraces.reduce((sum, trace) => sum + Math.max(0, (trace.attempt ?? 1) - 1), 0);
  const decision = buildOrchestrationDecision(goal, blueprint.nodes.length, topo);
  const workloadPlan = buildWorkloadPlan(blueprint.nodes, topo, goal);
  const parallelStructure = buildParallelStructure(blueprint.nodes, blueprint.edges, topo, goal);
  const joinPolicy = buildJoinPolicy(blueprint.nodes, topo);

  return {
    sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel",
    orchestrationDecision: decision,
    workloadPlan,
    parallelStructure,
    joinPolicy,
    graphStats: {
      nodeCount: blueprint.nodes.length,
      edgeCount: blueprint.edges.length,
      dagDepth: topo.dagDepth,
      maxParallelWidth: topo.maxParallelWidth,
      hasParallel: topo.hasParallel,
      hasReviewer: blueprint.nodes.some((n) => n.role === "reviewer"),
      hasSummarizer: blueprint.nodes.some((n) => n.role === "summarizer"),
      hasResearch: blueprint.nodes.some((n) => n.role === "research"),
      rootTask: goal,
    },
    nodeSpecs: blueprint.nodes.map((node) => ({
      nodeId: node.id,
      nodeName: node.name,
      nodeRole: node.role,
      taskSummary: node.taskSummary,
      responsibilitySummary: node.responsibilitySummary,
      systemPrompt: node.systemPrompt,
      toolIds: Array.isArray(node.toolIds) ? node.toolIds : [],
      inDegree: inDegree.get(node.id) ?? 0,
      outDegree: outDegree.get(node.id) ?? 0,
      executionOrder: snapshot.nodes.find((n) => n.id === node.id)?.executionOrder,
    })),
    edgeSpecs: blueprint.edges.map((edge) => ({
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      type: edge.type,
    })),
    executionStats: {
      runStatus: snapshot.run.status ?? "unknown",
      durationMs: diffMs(snapshot.run.createdAt, snapshot.run.finishedAt) ?? 0,
      promptTokens,
      completionTokens,
      totalTokens,
      llmRoundCount,
      toolCallCount: toolTraces.length,
      failedNodeCount: snapshot.nodes.filter((n) => n.status === "failed").length,
      completedNodeCount: snapshot.nodes.filter((n) => n.status === "completed").length,
      retryCount,
    },
    strategyMeta: {
      source: meta.source,
      runId,
      reward: meta.reward,
      templateId: meta.templateId,
      sessionId: meta.sessionId,
    },
  };
}

function computeTopologyMetrics(
  nodeIds: string[],
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
): TopologyMetrics {
  if (nodeIds.length === 0) {
    return { dagDepth: 0, maxParallelWidth: 0, hasParallel: false };
  }
  const indeg = new Map<string, number>();
  const level = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    indeg.set(id, 0);
    adj.set(id, []);
  }
  for (const edge of edges) {
    indeg.set(edge.targetNodeId, (indeg.get(edge.targetNodeId) ?? 0) + 1);
    const list = adj.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    adj.set(edge.sourceNodeId, list);
  }

  const queue: string[] = [];
  for (const id of nodeIds) {
    if ((indeg.get(id) ?? 0) === 0) {
      queue.push(id);
      level.set(id, 1);
    }
  }
  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    const curLevel = level.get(current) ?? 1;
    for (const next of adj.get(current) ?? []) {
      const nextLevel = Math.max(level.get(next) ?? 1, curLevel + 1);
      level.set(next, nextLevel);
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  // Cyclic case fallback.
  if (processed < nodeIds.length) {
    return {
      dagDepth: 1,
      maxParallelWidth: 1,
      hasParallel: edges.length > nodeIds.length - 1,
    };
  }

  const levelCounts = new Map<number, number>();
  for (const id of nodeIds) {
    const l = level.get(id) ?? 1;
    levelCounts.set(l, (levelCounts.get(l) ?? 0) + 1);
  }
  const maxParallelWidth = Math.max(...Array.from(levelCounts.values()), 1);
  const dagDepth = Math.max(...Array.from(levelCounts.keys()), 1);
  return {
    dagDepth,
    maxParallelWidth,
    hasParallel: maxParallelWidth > 1,
  };
}

function buildOrchestrationDecision(goal: string, nodeCount: number, topo: TopologyMetrics) {
  const reasons: string[] = [];
  if (topo.hasParallel) reasons.push(`Graph has parallel width ${topo.maxParallelWidth}.`);
  if (nodeCount >= 6) reasons.push(`Node count ${nodeCount} indicates decomposed workload.`);
  const estimatedItems = inferEstimatedWorkItems(goal, nodeCount, {});
  if (estimatedItems >= 20) reasons.push(`Estimated work items ${estimatedItems} are large.`);
  const shouldParallelize = topo.hasParallel || estimatedItems >= 20;
  if (!shouldParallelize) reasons.push("Task appears compact with stronger serial dependency.");
  return {
    shouldParallelize,
    decisionReason: reasons,
    strategyType: (shouldParallelize ? "fan_out_fan_in" : "serial") as "serial" | "fan_out_fan_in" | "map_reduce",
  };
}

function buildWorkloadPlan(
  nodes: Array<{ id: string; role: string; toolIds?: string[] }>,
  topo: TopologyMetrics,
  goal: string,
) {
  const workers = nodes.filter((n) => n.role !== "input" && n.role !== "output");
  const estimatedItems = inferEstimatedWorkItems(goal, nodes.length, {});
  const shouldParallelize = topo.hasParallel || estimatedItems >= 20;
  const inferredParallelCount = Math.min(8, Math.max(2, Math.ceil(estimatedItems / 20)));
  const batchCount = shouldParallelize ? inferredParallelCount : 1;
  const batchSize = Math.max(1, Math.ceil(estimatedItems / batchCount));
  const workerAssignment = Array.from({ length: batchCount }).map((_, idx) => {
    const mapped = workers[idx % Math.max(1, workers.length)];
    return {
      workerId: `worker_${idx + 1}`,
      nodeId: mapped?.id ?? "worker_virtual",
      role: mapped?.role ?? "worker",
      batchSelector: shouldParallelize ? `batch_${idx + 1}` : "full",
      toolBindings: Array.isArray(mapped?.toolIds) ? mapped.toolIds : [],
    };
  });
  return {
    splitUnit: inferWorkItemType(goal),
    splitMethod: (shouldParallelize ? "equal_batch" : "single_flow") as "equal_batch" | "semantic_cluster" | "single_flow",
    batchCount,
    batchSize,
    workerAssignment,
  };
}

function buildParallelStructure(
  nodes: Array<{ id: string; role: string }>,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
  topo: TopologyMetrics,
  goal: string,
) {
  const workers = nodes
    .filter((n) => n.role !== "input" && n.role !== "output")
    .map((n) => n.id);
  const splitterEdge = edges.find((e) => workers.includes(e.targetNodeId));
  const mergeEdge = edges.find((e) => workers.includes(e.sourceNodeId));
  const estimatedItems = inferEstimatedWorkItems(goal, nodes.length, {});
  const shouldParallelize = topo.hasParallel || estimatedItems >= 20;
  const workerCount = shouldParallelize ? Math.min(8, Math.max(2, Math.ceil(estimatedItems / 20))) : 1;
  return {
    splitter: {
      nodeId: splitterEdge?.sourceNodeId ?? "splitter_inferred",
      outputShards: workerCount,
    },
    parallelGroup: {
      groupId: "parallel_group_main",
      workerCount,
      workers: Array.from({ length: workerCount }).map((_, idx) => workers[idx % Math.max(1, workers.length)] ?? "worker_virtual"),
    },
    fanIn: {
      joinType: (shouldParallelize ? "wait_all" : "single_path") as "wait_all" | "single_path",
      mergeNodeId: mergeEdge?.targetNodeId ?? "merge_inferred",
    },
  };
}

function buildJoinPolicy(nodes: Array<{ id: string; role: string }>, topo: TopologyMetrics) {
  const reviewer = nodes.find((n) => n.role === "reviewer");
  return {
    mergeStrategy: (topo.hasParallel ? "evidence_weighted" : "single_stream") as "evidence_weighted" | "single_stream",
    conflictResolution: (reviewer ? "reviewer_tiebreak" : "none") as "reviewer_tiebreak" | "none",
    finalVerifier: reviewer?.id ?? "none",
    outputContract: [
      "Final output must be directly actionable.",
      "Final output must preserve key evidence from upstream workers.",
    ],
  };
}

/**
 * Build a synthetic reasoning chain from execution data.
 * This provides the CoT that the model should learn to produce.
 */
function buildReasoningChain(
  snapshot: SnapshotLike,
  taskAnalysis: Record<string, unknown> | null,
  goal: string,
): string {
  const parts: string[] = [];

  // Step 1: Task analysis reasoning
  const nodeCount = snapshot.nodes.length;
  const hasReviewer = snapshot.nodes.some((n) => n.role === "reviewer");
  const hasResearch = snapshot.nodes.some((n) => n.role === "research");
  const hasParallel = detectParallelTopology(snapshot);

  parts.push(`分析目标「${goal}」：`);

  if (taskAnalysis) {
    const ta = taskAnalysis as Record<string, unknown>;
    parts.push(`- 任务类型：${ta.taskType || "通用"}，复杂度：${ta.complexity || 3}/5`);
    if (ta.parallelizable) parts.push("- 判断可并行化：多个子任务相互独立");
    if (ta.needsReview) parts.push("- 需要审核环节：输出质量要求高");
  }

  // Step 2: Topology decision reasoning
  parts.push(`\n拓扑设计决策：`);
  parts.push(`- 选择 ${nodeCount} 节点工作流`);
  if (hasParallel) parts.push("- 采用并行拓扑：多个 worker 同时处理不同子任务");
  if (hasReviewer) parts.push("- 加入 reviewer 节点：确保输出质量");
  if (hasResearch) parts.push("- 加入 research 节点：需要信息收集");

  // Step 3: Role assignment reasoning
  parts.push(`\n角色分配：`);
  for (const node of snapshot.nodes) {
    if (node.role === "input" || node.role === "output") continue;
    parts.push(`- ${node.name}（${node.role}）：负责处理相关子任务`);
  }

  return parts.join("\n");
}

void buildReasoningChain;

/**
 * Detect if the snapshot has parallel topology (multiple nodes sharing same source).
 */
function detectParallelTopology(snapshot: SnapshotLike): boolean {
  const sourceCount = new Map<string, number>();
  for (const edge of snapshot.edges) {
    sourceCount.set(edge.sourceNodeId, (sourceCount.get(edge.sourceNodeId) || 0) + 1);
  }
  return Array.from(sourceCount.values()).some((count) => count > 1);
}

/**
 * Compute a simple hash of the goal for same-goal lookups.
 * Normalizes whitespace, punctuation, and case.
 */
function computeGoalHash(goal: string): string {
  const normalized = goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // Simple djb2 hash
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `gh_${(hash >>> 0).toString(36)}`;
}

/**
 * Jaccard word similarity between two goal strings.
 * Used for approximate same-goal DPO pairing.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean),
  );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function inferEstimatedWorkItems(goal: string, nodeCount: number, taskAnalysis: TaskAnalysisLike): number {
  const byAnalysis = clampInt(taskAnalysis.subtaskCount, 1, 500, 0);
  const explicitNumber = extractLargestInt(goal);
  if (byAnalysis > 0 || explicitNumber > 0) {
    return Math.max(byAnalysis, clampInt(explicitNumber, 1, 500, 0));
  }
  return Math.max(1, (nodeCount - 2) * 3);
}

function inferItemIndependence(goal: string, taskAnalysis: TaskAnalysisLike): "low" | "medium" | "high" {
  if (Boolean(taskAnalysis.parallelizable)) return "high";
  const lower = goal.toLowerCase();
  if (/each|每个|逐个|批量|batch|多个/.test(lower)) return "high";
  if (/pipeline|流程|依赖|顺序|串行/.test(lower)) return "low";
  return "medium";
}

function inferWorkItemType(goal: string): string {
  const lower = goal.toLowerCase();
  if (/论文|paper/.test(lower)) return "paper";
  if (/工单|ticket/.test(lower)) return "ticket";
  if (/文件|file/.test(lower)) return "file";
  if (/需求|requirement/.test(lower)) return "requirement";
  return "task";
}

function inferLatencyBudgetMs(goal: string, estimatedWorkItems: number): number {
  const lower = goal.toLowerCase();
  if (/实时|real[- ]?time|秒级/.test(lower)) return 30_000;
  if (estimatedWorkItems >= 100) return 900_000;
  if (estimatedWorkItems >= 30) return 420_000;
  return 180_000;
}

function detectToolHeavyGoal(goal: string): boolean {
  return /检索|search|crawl|抓取|api|工具|tool/.test(goal.toLowerCase());
}

function extractLargestInt(input: string): number {
  const matches = input.match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  return matches.map((s) => Number.parseInt(s, 10)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
}

function hashStringToInt(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function diffMs(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const val = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(val) && val >= 0 ? val : undefined;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : fallback;
  const rounded = Math.round(num);
  if (!Number.isFinite(rounded)) return fallback;
  return Math.max(min, Math.min(max, rounded));
}

function safeParseTaskAnalysis(raw?: string): TaskAnalysisLike {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as TaskAnalysisLike;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function tryParseField(json: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed[field] === "string" ? parsed[field] : undefined;
  } catch {
    return undefined;
  }
}
