/**
 * Training Module unified API:
 * collect (raw) -> quality evaluation -> DPO pairing -> export
 */
import { nowIso } from "@/lib/utils";
import { memoryStore } from "@/server/store/memory-store";
import { metaAgentService } from "../meta-agent-service";
import {
  clearAllSamples,
  collectDPOPairs,
  collectFromMetaAgentSessions,
  collectFromPromptTraces,
  getSampleCounts,
  listHighQualitySamples,
  listSamples,
  listSamplesByType,
  updateSampleQuality,
  type TrainingSample,
} from "./data-collector";
import {
  exportAgentSFT,
  exportAll,
  exportDPO,
  exportOrchestratorSFT,
  exportShareGPT,
  getExportStats,
  getTrainingExportBaseDir,
  writeExportToFile,
  writeExportsToFiles,
  type AlpacaSFTRecord,
  type DPORecord,
  type ExportResult,
  type ExportStats,
  type ShareGPTRecord,
} from "./data-exporter";
import {
  evaluateAgentOutput,
  evaluateWorkflow,
} from "./quality-evaluator";
import type { AgentOutputEvaluation } from "../types";

export interface CollectTrainingOptions {
  runLimit?: number;
  scoreDiff?: number;
  similarityThreshold?: number;
  enableQualityScoring?: boolean;
  qualityAgentLimit?: number;
  qualityWorkflowLimit?: number;
}

export interface CollectTrainingResult {
  collected: {
    orchestratorSft: number;
    agentSft: number;
    dpoPairs: number;
  };
  qualityScored: {
    agentSamples: number;
    workflowSamples: number;
  };
  counts: Record<string, number>;
}

export interface TrainingPipelineOptions {
  goals?: string[];
  maxIterations?: number;
  qualityThreshold?: number;
  workflowTemplateId?: string;
  continueOnError?: boolean;
  clearBeforeRun?: boolean;
  collectOptions?: CollectTrainingOptions;
  exportAfterCollect?: boolean;
  exportMinReward?: number;
  exportOutputSubdir?: string;
  exportOutputType?: "json" | "jsonl";
}

export interface TrainingPipelineResult {
  runSummary: {
    totalGoals: number;
    success: number;
    failed: number;
    items: Array<{
      goal: string;
      status: "success" | "failed" | "max_steps_reached" | "max_iterations_reached";
      finalScore?: number;
      error?: string;
      iterations: number;
    }>;
  };
  collect?: CollectTrainingResult;
  exportFiles?: Array<{
    format: string;
    filename: string;
    filePath: string;
    sampleCount: number;
    bytes: number;
  }>;
}

const DEFAULT_PIPELINE_GOALS = [
  "调研多 Agent 协作模式，并给出三种可落地架构对比",
  "设计一套 Agent Workflow 平台的可观测性与调试方案",
  "总结 baseline/replay 评测方法并给出公平性改进建议",
  "输出一份面向工程团队的 Agent 工具治理与权限策略",
];

function parseJson(input?: string): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getAgentEvalInput(sample: TrainingSample) {
  const ctx = parseJson(sample.inputContext);
  const metadataRole = typeof sample.metadata?.nodeRole === "string" ? sample.metadata.nodeRole : undefined;
  return {
    goal: (ctx?.goal as string) || sample.goal,
    nodeRole: (ctx?.nodeRole as string) || metadataRole || "worker",
    systemPrompt: (ctx?.systemPrompt as string) || sample.instruction,
    userPrompt: (ctx?.userPrompt as string) || sample.goal,
    completion: sample.output,
  };
}

async function qualityScoreAgentSamples(limit = 120): Promise<number> {
  const samples = listSamplesByType("agent_sft", Math.max(limit * 2, 200))
    .filter((s) => !s.qualityScores)
    .slice(0, limit);
  let scored = 0;

  for (const sample of samples) {
    const input = getAgentEvalInput(sample);
    const evaluation = await evaluateAgentOutput(
      input.nodeRole,
      input.systemPrompt,
      input.userPrompt,
      input.completion,
      input.goal,
    );

    updateSampleQuality(
      sample.id,
      evaluation.score,
      { agent: evaluation },
      {
        ...(sample.metadata ?? {}),
        qualityMode: "llm_judge_agent_role_specific",
        qualityEvaluatedAt: nowIso(),
      },
    );
    scored++;
  }

  return scored;
}

async function qualityScoreWorkflowSamples(limit = 60): Promise<number> {
  const samples = listSamplesByType("orchestrator_sft_v3", Math.max(limit * 2, 120))
    .filter((s) => !s.qualityScores && typeof s.runId === "string")
    .slice(0, limit);
  let scored = 0;

  for (const sample of samples) {
    if (!sample.runId) continue;
    const snapshot = memoryStore.getRunSnapshot(sample.runId);
    if (!snapshot) continue;

    const nodeOutputs = snapshot.nodes
      .filter((n) => n.latestOutput && n.latestOutput.trim().length > 0)
      .map((n) => ({
        nodeId: n.id,
        nodeName: n.name,
        nodeRole: n.role,
        output: n.latestOutput ?? "",
      }));
    if (nodeOutputs.length === 0) continue;

    const traceSummary = {
      totalNodes: snapshot.nodes.length,
      successfulNodes: snapshot.nodes.filter((n) => n.status === "completed").length,
      failedNodes: snapshot.nodes.filter((n) => n.status === "failed").length,
      durationMs: (() => {
        if (!snapshot.run.createdAt || !snapshot.run.finishedAt) return 0;
        const ms = new Date(snapshot.run.finishedAt).getTime() - new Date(snapshot.run.createdAt).getTime();
        return Number.isFinite(ms) && ms >= 0 ? ms : 0;
      })(),
    };

    const evaluation = await evaluateWorkflow(sample.goal, nodeOutputs, traceSummary);

    updateSampleQuality(
      sample.id,
      evaluation.aggregateScore,
      { workflow: evaluation },
      {
        ...(sample.metadata ?? {}),
        qualityMode: "llm_judge_workflow_multidim",
        qualityEvaluatedAt: nowIso(),
      },
    );
    scored++;
  }

  return scored;
}

export async function collectQualityScoredTrainingData(
  options: CollectTrainingOptions = {},
): Promise<CollectTrainingResult> {
  const runLimit = options.runLimit ?? 200;
  const scoreDiff = options.scoreDiff ?? 0.2;
  const similarityThreshold = options.similarityThreshold ?? 0.6;
  const enableQualityScoring = options.enableQualityScoring ?? true;
  const qualityAgentLimit = options.qualityAgentLimit ?? 120;
  const qualityWorkflowLimit = options.qualityWorkflowLimit ?? 60;

  const orchestratorSft = collectFromMetaAgentSessions();
  const agentSft = collectFromPromptTraces(runLimit);

  let workflowSamples = 0;
  let agentSamples = 0;
  if (enableQualityScoring) {
    workflowSamples = await qualityScoreWorkflowSamples(qualityWorkflowLimit);
    agentSamples = await qualityScoreAgentSamples(qualityAgentLimit);
  }

  // DPO pairs should be generated after quality scoring because reward may be updated by LLM-as-Judge.
  const dpoPairs = collectDPOPairs(scoreDiff, similarityThreshold);

  return {
    collected: {
      orchestratorSft,
      agentSft,
      dpoPairs,
    },
    qualityScored: {
      agentSamples,
      workflowSamples,
    },
    counts: getSampleCounts(),
  };
}

export async function runMetaAgentTrainingPipeline(
  options: TrainingPipelineOptions = {},
): Promise<TrainingPipelineResult> {
  const goals = (options.goals && options.goals.length > 0 ? options.goals : DEFAULT_PIPELINE_GOALS)
    .map((goal) => goal.trim())
    .filter((goal) => goal.length > 0);

  if (goals.length === 0) {
    throw new Error("No valid goals provided for training pipeline.");
  }

  if (options.clearBeforeRun) {
    clearAllSamples();
  }

  const continueOnError = options.continueOnError ?? true;
  const runItems: TrainingPipelineResult["runSummary"]["items"] = [];

  for (const goal of goals) {
    try {
      const result = await metaAgentService.run({
        goal,
        maxIterations: options.maxIterations ?? 2,
        qualityThreshold: options.qualityThreshold ?? 0.7,
        workflowTemplateId: options.workflowTemplateId,
      });
      runItems.push({
        goal,
        status: result.status,
        finalScore: result.finalScore,
        iterations: result.iterations.length,
      });
    } catch (error) {
      runItems.push({
        goal,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        iterations: 0,
      });
      if (!continueOnError) {
        break;
      }
    }
  }

  const success = runItems.filter((item) => item.status !== "failed").length;
  const failed = runItems.length - success;

  const result: TrainingPipelineResult = {
    runSummary: {
      totalGoals: goals.length,
      success,
      failed,
      items: runItems,
    },
  };

  const collect = await collectQualityScoredTrainingData(options.collectOptions ?? {});
  result.collect = collect;

  if (options.exportAfterCollect ?? true) {
    const exports = exportAll(options.exportMinReward ?? 0);
    result.exportFiles = writeExportsToFiles(exports, {
      subdir: options.exportOutputSubdir ?? `pipeline_${new Date().toISOString().slice(0, 10)}`,
      outputType: options.exportOutputType ?? "json",
    });
  }

  return result;
}

export {
  collectFromMetaAgentSessions,
  collectFromPromptTraces,
  collectDPOPairs,
  listSamples,
  listSamplesByType,
  listHighQualitySamples,
  getSampleCounts,
  clearAllSamples,
  updateSampleQuality,
  exportOrchestratorSFT,
  exportAgentSFT,
  exportShareGPT,
  exportDPO,
  exportAll,
  getExportStats,
  getTrainingExportBaseDir,
  writeExportToFile,
  writeExportsToFiles,
  evaluateWorkflow,
  evaluateAgentOutput,
};

export type {
  TrainingSample,
  ExportResult,
  ExportStats,
  AlpacaSFTRecord,
  ShareGPTRecord,
  DPORecord,
  AgentOutputEvaluation,
};
