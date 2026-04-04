/**
 * Bandit Strategy Module — unified entry point.
 *
 * Manages the LinUCB bandit lifecycle:
 * - Initialize (cold-start from run center data)
 * - Select (pick best template for a given task)
 * - Update (learn from execution reward)
 * - Persist (save/load model state)
 */
import { makeId, nowIso } from "@/lib/utils";
import { spawnWorkflow } from "./agent-spawner";
import {
  countExperiences,
  generateColdStartData,
  listExperiences,
  loadModelState,
  saveExperience,
  saveModelState,
} from "./experience-store";
import { getTemplateIds, STRATEGY_TEMPLATES } from "./prompt-skeletons";
import { StrategyBandit } from "./strategy-bandit";
import { analyzeTask } from "./task-analyzer";
import type { BanditDecision, ExperienceRecord } from "./types";
import type { WorkflowBlueprint } from "../types";

// ── Singleton Bandit Instance ────────────────────────────────────────────

let banditInstance: StrategyBandit | null = null;

function getBandit(): StrategyBandit {
  if (banditInstance) return banditInstance;

  // Try loading persisted state
  const saved = loadModelState();
  if (saved) {
    banditInstance = StrategyBandit.fromState(saved);
    // Ensure all current templates have arms
    for (const id of getTemplateIds()) {
      banditInstance.addArm(id);
    }
  } else {
    // Fresh start
    banditInstance = new StrategyBandit(getTemplateIds(), 1.5);
  }

  return banditInstance;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Plan a workflow using the Bandit strategy system.
 *
 * Full pipeline:
 * 1. Analyze task (LLM → structured features)
 * 2. Bandit selects best template
 * 3. LLM fills template variables (spawn agents)
 * 4. Return ready-to-execute blueprint
 */
export async function banditPlan(goal: string): Promise<{
  decision: BanditDecision;
  blueprint: WorkflowBlueprint;
}> {
  const bandit = getBandit();

  // Step 1: Analyze task
  const { taskAnalysis, features } = await analyzeTask(goal);

  // Step 2: Bandit selects template
  const decision = bandit.select(features, taskAnalysis);

  // Step 3: Spawn workflow from template
  const { blueprint } = await spawnWorkflow(decision, goal);

  // Persist model state (in case of server restart)
  saveModelState(bandit.getState());

  return { decision, blueprint };
}

/**
 * Record a reward signal and update the Bandit model.
 * Called after a Meta-Agent iteration completes with a reflect score.
 */
export function banditReward(
  decision: BanditDecision,
  reward: number,
  metadata?: {
    runId?: string;
    sessionId?: string;
    runDurationMs?: number;
    totalTokens?: number;
    nodeCount?: number;
    goal?: string;
  },
): void {
  const bandit = getBandit();

  // Update bandit model
  bandit.update(decision.templateId, decision.features, reward);

  // Decay exploration over time
  bandit.decayAlpha();

  // Save experience record
  const record: ExperienceRecord = {
    id: makeId("exp"),
    source: "meta_agent",
    goal: metadata?.goal || "",
    taskAnalysis: decision.taskAnalysis,
    features: decision.features,
    templateId: decision.templateId,
    reward,
    runId: metadata?.runId,
    sessionId: metadata?.sessionId,
    runDurationMs: metadata?.runDurationMs,
    totalTokens: metadata?.totalTokens,
    nodeCount: metadata?.nodeCount,
    createdAt: nowIso(),
  };
  saveExperience(record);

  // Persist model state
  saveModelState(bandit.getState());
}

/**
 * Cold-start: train the Bandit from historical run center data.
 * Returns the number of experience records generated and used for training.
 */
export function coldStartTrain(limit = 50): {
  generated: number;
  trained: number;
  totalExperiences: number;
} {
  const bandit = getBandit();

  // Generate training data from run center
  const records = generateColdStartData(limit);

  // Save experience records
  for (const record of records) {
    try {
      saveExperience(record);
    } catch {
      // Skip duplicates
    }
  }

  // Train bandit on all new records
  const { updated } = bandit.batchUpdate(records);

  // Persist
  saveModelState(bandit.getState());

  return {
    generated: records.length,
    trained: updated,
    totalExperiences: countExperiences(),
  };
}

/**
 * Get current Bandit model statistics (for UI display).
 */
export function getBanditStats() {
  const bandit = getBandit();
  const stats = bandit.getStats();

  return {
    ...stats,
    totalExperiences: countExperiences(),
    templates: STRATEGY_TEMPLATES.map((t) => {
      const arm = stats.arms.find((a) => a.templateId === t.id);
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        topology: t.topology,
        pullCount: arm?.pullCount ?? 0,
      };
    }),
    recentExperiences: listExperiences(10),
  };
}

/**
 * Reset the Bandit model (for debugging/testing).
 */
export function resetBandit(): void {
  banditInstance = new StrategyBandit(getTemplateIds(), 1.5);
  saveModelState(banditInstance.getState());
}

// Re-export types for convenience
export type { BanditDecision } from "./types";
