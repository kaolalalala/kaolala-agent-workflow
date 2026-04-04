import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectQualityScoredTrainingData,
  clearAllSamples,
  listSamples,
  runMetaAgentTrainingPipeline,
} from "@/server/meta-agent/training";

function loadGoalsFromFile(goalFile?: string): string[] | undefined {
  if (!goalFile || !goalFile.trim()) return undefined;
  const baseDir = resolve(process.cwd(), "inupt");
  const requested = goalFile.trim().replace(/\\/g, "/");
  const targetPath = resolve(baseDir, requested);
  if (!targetPath.startsWith(baseDir)) {
    throw new Error("goalFile is outside allowed inupt directory.");
  }

  const content = readFileSync(targetPath, "utf8");
  if (targetPath.endsWith(".jsonl")) {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as { goal?: string };
        return (parsed.goal ?? "").trim();
      })
      .filter(Boolean);
  }

  if (targetPath.endsWith(".json")) {
    const parsed = JSON.parse(content) as { goals?: Array<{ goal?: string } | string> };
    const goals = Array.isArray(parsed.goals) ? parsed.goals : [];
    return goals
      .map((item) => (typeof item === "string" ? item.trim() : (item.goal ?? "").trim()))
      .filter(Boolean);
  }

  throw new Error("goalFile must be .json or .jsonl");
}
import {
  exportOrchestratorSFT,
  exportAgentSFT,
  exportShareGPT,
  exportDPO,
  exportAll,
  getExportStats,
  getTrainingExportBaseDir,
  writeExportToFile,
  writeExportsToFiles,
} from "@/server/meta-agent/training";

/**
 * GET /api/meta-agent/training — Get training data stats and export info
 *   ?action=stats (default) — sample counts + available exports
 *   ?action=samples&limit=50 — list recent samples
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "stats";

    if (action === "stats") {
      const exportStats = getExportStats();
      return NextResponse.json(exportStats);
    }

    if (action === "samples") {
      const limit = parseInt(searchParams.get("limit") || "50", 10);
      const samples = listSamples(limit);
      return NextResponse.json({ samples, count: samples.length });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get training stats" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/meta-agent/training — Collect or export training data
 *   Body: { action: "collect" | "export" | "clear", ... }
 *
 *   action: "collect"
 *     Runs all three collectors (meta-agent sessions, prompt traces, DPO pairs)
 *
 *   action: "export"
 *     format: "orchestrator_sft_v3" | "agent_sft" | "sharegpt" | "dpo" | "all"
 *     minReward?: number (default 0 for orchestrator_sft_v3)
 *     outputType?: "json" | "jsonl" (default "json")
 *     Returns JSON content by default
 *
 *   action: "clear"
 *     Deletes all training samples
 *
 *   action: "pipeline"
 *     Runs end-to-end pipeline:
 *     goals -> meta-agent runs -> quality-scored collection -> export to files
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "collect") {
      const result = await collectQualityScoredTrainingData({
        runLimit: body.limit ?? 200,
        scoreDiff: body.scoreDiff ?? 0.2,
        similarityThreshold: body.similarityThreshold ?? 0.6,
        enableQualityScoring: body.enableQualityScoring ?? true,
        qualityAgentLimit: body.qualityAgentLimit ?? 120,
        qualityWorkflowLimit: body.qualityWorkflowLimit ?? 60,
      });

      return NextResponse.json({
        ok: true,
        action: "collect",
        collected: {
          orchestrator_sft_v3: result.collected.orchestratorSft,
          agent_sft: result.collected.agentSft,
          dpo_pairs: result.collected.dpoPairs,
        },
        qualityScored: {
          agent_sft: result.qualityScored.agentSamples,
          orchestrator_sft_v3: result.qualityScored.workflowSamples,
        },
        totalCounts: result.counts,
      });
    }

    if (action === "export") {
      const format = body.format || "all";
      const minReward = body.minReward ?? 0;
      const saveToFile = body.saveToFile === true;
      const outputSubdir = typeof body.outputSubdir === "string" ? body.outputSubdir : undefined;
      const outputType: "json" | "jsonl" = body.outputType === "jsonl" ? "jsonl" : "json";

      if (format === "all") {
        const results = exportAll(minReward);
        if (saveToFile) {
          const files = writeExportsToFiles(results, { subdir: outputSubdir, outputType });
          return NextResponse.json({
            ok: true,
            action: "export",
            savedToFile: true,
            outputType,
            baseDir: getTrainingExportBaseDir(),
            files,
          });
        }
        return NextResponse.json({
          ok: true,
          action: "export",
          exports: results.map((r) => ({
            format: r.format,
            filename: r.filename,
            sampleCount: r.sampleCount,
            json: r.records,
          })),
        });
      }

      const exportFns: Record<string, (minReward?: number) => ReturnType<typeof exportOrchestratorSFT>> = {
        orchestrator_sft_v3: exportOrchestratorSFT,
        agent_sft: exportAgentSFT,
        sharegpt: exportShareGPT,
        dpo: () => exportDPO(),
      };

      const exportFn = exportFns[format];
      if (!exportFn) {
        return NextResponse.json(
          { error: `Unknown format: ${format}. Use: orchestrator_sft_v3, agent_sft, sharegpt, dpo, all` },
          { status: 400 },
        );
      }

      const result = exportFn(minReward);
      if (saveToFile) {
        const file = writeExportToFile(result, { subdir: outputSubdir, outputType });
        return NextResponse.json({
          ok: true,
          action: "export",
          savedToFile: true,
          outputType,
          baseDir: getTrainingExportBaseDir(),
          file,
        });
      }
      return NextResponse.json({
        ok: true,
        action: "export",
        format: result.format,
        filename: result.filename,
        sampleCount: result.sampleCount,
        json: result.records,
      });
    }

    if (action === "clear") {
      clearAllSamples();
      return NextResponse.json({ ok: true, action: "clear" });
    }

    if (action === "pipeline") {
      const fileGoals = loadGoalsFromFile(typeof body.goalFile === "string" ? body.goalFile : undefined);
      const inlineGoals = Array.isArray(body.goals) ? body.goals : undefined;
      const pipeline = await runMetaAgentTrainingPipeline({
        goals: fileGoals ?? inlineGoals,
        maxIterations: body.maxIterations,
        qualityThreshold: body.qualityThreshold,
        workflowTemplateId: body.workflowTemplateId,
        continueOnError: body.continueOnError,
        clearBeforeRun: body.clearBeforeRun,
        collectOptions: {
          runLimit: body.collectLimit,
          scoreDiff: body.scoreDiff,
          similarityThreshold: body.similarityThreshold,
          enableQualityScoring: body.enableQualityScoring,
          qualityAgentLimit: body.qualityAgentLimit,
          qualityWorkflowLimit: body.qualityWorkflowLimit,
        },
        exportAfterCollect: body.exportAfterCollect,
        exportMinReward: body.minReward,
        exportOutputSubdir: body.outputSubdir,
        exportOutputType: body.outputType === "jsonl" ? "jsonl" : "json",
      });

      return NextResponse.json({
        ok: true,
        action: "pipeline",
        ...pipeline,
      });
    }

    return NextResponse.json(
      { error: "Unknown action. Use 'collect', 'export', 'pipeline', or 'clear'." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Training operation failed" },
      { status: 500 },
    );
  }
}
