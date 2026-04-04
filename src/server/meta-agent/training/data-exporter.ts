/**
 * Data Exporter - converts collected training samples into standard FT formats.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  getSampleCounts,
  listHighQualitySamples,
  listSamplesByType,
  type TrainingSample,
} from "./data-collector";

export interface AlpacaSFTRecord {
  instruction: string;
  input: string;
  output: string;
  system?: string;
  history?: Array<[string, string]>;
}

export interface OrchestratorSFTV3Record {
  sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel";
  goal: string;
  instruction: string;
  inputContext: Record<string, unknown>;
  target: Record<string, unknown>;
  reward?: number;
  runId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ShareGPTRecord {
  conversations: Array<{
    from: "system" | "human" | "gpt";
    value: string;
  }>;
}

export interface DPORecord {
  prompt: string;
  chosen: string;
  rejected: string;
  system?: string;
}

export interface ExportResult {
  format: string;
  sampleCount: number;
  records: unknown[];
  json: string;
  jsonl: string;
  filename: string;
}

export interface ExportStats {
  counts: Record<string, number>;
  availableExports: Array<{
    format: string;
    description: string;
    sampleCount: number;
  }>;
}

export interface ExportFileResult {
  format: string;
  filename: string;
  filePath: string;
  sampleCount: number;
  bytes: number;
  outputType: "json" | "jsonl";
}

const TRAINING_EXPORT_BASE_DIR = resolve(process.cwd(), ".output", "v0_2", "training_exports");

function parseContext(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseOrchestratorInputContextV3(sample: TrainingSample): Record<string, unknown> | null {
  const ctx = parseContext(sample.inputContext);
  if (!ctx) return null;
  if (ctx.sampleSchemaVersion !== "orchestrator_sft_v3_decision_parallel") return null;
  if (!ctx.taskFeatures || !ctx.graphRequirements || !ctx.resourceContext || !ctx.runContext) return null;
  return ctx;
}

function parseOrchestratorTargetV3(sample: TrainingSample): Record<string, unknown> | null {
  const target = parseContext(sample.output);
  if (!target) return null;
  if (target.sampleSchemaVersion !== "orchestrator_sft_v3_decision_parallel") return null;
  if (!target.orchestrationDecision || !target.workloadPlan || !target.parallelStructure || !target.joinPolicy) return null;
  if (!target.graphStats || !Array.isArray(target.nodeSpecs) || !Array.isArray(target.edgeSpecs)) return null;
  return target;
}

function buildOrchestratorPromptFromV3Input(inputContext: Record<string, unknown>): string {
  const goal = typeof inputContext.goal === "string" ? inputContext.goal : "";
  const resourceContext =
    inputContext.resourceContext && typeof inputContext.resourceContext === "object"
      ? (inputContext.resourceContext as Record<string, unknown>)
      : {};
  const templates = Array.isArray(resourceContext.availableTemplates)
    ? (resourceContext.availableTemplates as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const tools = Array.isArray(resourceContext.availableToolIds)
    ? (resourceContext.availableToolIds as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const feedback = typeof inputContext.previousFeedback === "string" ? inputContext.previousFeedback : "";
  const lines = [
    `Goal: ${goal}`,
    `Available Templates: ${templates.length > 0 ? templates.join(" | ") : "(none)"}`,
    `Available Tools: ${tools.length > 0 ? tools.join(", ") : "(none)"}`,
  ];
  if (feedback) lines.push(`Previous Feedback: ${feedback}`);
  return lines.join("\n");
}

function buildAgentInput(sample: TrainingSample): { input: string; system?: string } {
  const ctx = parseContext(sample.inputContext);
  if (!ctx) return { input: sample.inputContext };
  return {
    input:
      typeof ctx.userPrompt === "string"
        ? ctx.userPrompt
        : typeof ctx.goal === "string"
          ? ctx.goal
          : sample.inputContext,
    system: typeof ctx.systemPrompt === "string" ? ctx.systemPrompt : undefined,
  };
}

export function exportOrchestratorSFT(minReward = 0): ExportResult {
  const samples = listSamplesByType("orchestrator_sft_v3", 5000).filter((s) => (s.reward ?? 0) >= minReward);
  const records = dedupeByKey(
    samples
      .map((sample) => {
        const inputContext = parseOrchestratorInputContextV3(sample);
        const target = parseOrchestratorTargetV3(sample);
        if (!inputContext || !target) return null;
        const record: OrchestratorSFTV3Record = {
          sampleSchemaVersion: "orchestrator_sft_v3_decision_parallel",
          goal: sample.goal,
          instruction: sample.instruction,
          inputContext,
          target,
          reward: sample.reward,
          runId: sample.runId,
          createdAt: sample.createdAt,
          metadata: sample.metadata,
        };
        return record;
      })
      .filter((record): record is OrchestratorSFTV3Record => Boolean(record)),
    (r) => `${r.runId ?? ""}|${r.goal}|${JSON.stringify(r.target.graphStats ?? {})}`,
  );

  const lines = records.map((record) => JSON.stringify(record));
  return {
    format: "orchestrator_sft_v3",
    sampleCount: lines.length,
    records,
    json: JSON.stringify(records, null, 2),
    jsonl: lines.join("\n"),
    filename: `orchestrator_sft_v3_${dateTag()}.json`,
  };
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function exportAgentSFT(minReward = 0.5): ExportResult {
  const samples = listSamplesByType("agent_sft", 5000).filter((s) => (s.reward ?? 0) >= minReward);
  const records = samples.map((s) => {
    const { input, system } = buildAgentInput(s);
    const record: AlpacaSFTRecord = {
      instruction: s.instruction,
      input,
      output: s.output,
      system,
    };
    return record;
  });
  const lines = records.map((record) => JSON.stringify(record));
  return {
    format: "alpaca_sft",
    sampleCount: lines.length,
    records,
    json: JSON.stringify(records, null, 2),
    jsonl: lines.join("\n"),
    filename: `agent_sft_${dateTag()}.json`,
  };
}

export function exportShareGPT(minReward = 0.5): ExportResult {
  const samples = listHighQualitySamples(minReward, 5000);
  const records = samples.map((s) =>
    ({
      conversations: [
        ...(s.instruction ? [{ from: "system" as const, value: s.instruction }] : []),
        {
          from: "human" as const,
          value: (() => {
            const ctx = parseContext(s.inputContext);
            if (!ctx) return s.inputContext || s.goal;
            return (ctx.userPrompt as string) || (ctx.goal as string) || s.goal;
          })(),
        },
        { from: "gpt" as const, value: s.output },
      ],
    } satisfies ShareGPTRecord),
  );
  const lines = records.map((record) => JSON.stringify(record));
  return {
    format: "sharegpt",
    sampleCount: lines.length,
    records,
    json: JSON.stringify(records, null, 2),
    jsonl: lines.join("\n"),
    filename: `sharegpt_all_${dateTag()}.json`,
  };
}

export function exportDPO(): ExportResult {
  const chosen = listSamplesByType("orchestrator_dpo_v3_chosen", 5000);
  const rejected = listSamplesByType("orchestrator_dpo_v3_rejected", 5000);
  const rejectedMap = new Map<string, TrainingSample>();
  for (const r of rejected) {
    if (r.runId) rejectedMap.set(r.runId, r);
  }

  const records: DPORecord[] = [];
  for (const c of chosen) {
    if (!c.runId) continue;
    const inputContext = parseOrchestratorInputContextV3(c);
    if (!inputContext) continue;
    const r = rejectedMap.get(c.runId);
    if (!r) continue;
    records.push({
      system: c.instruction,
      prompt: buildOrchestratorPromptFromV3Input(inputContext),
      chosen: c.output,
      rejected: r.output,
    } satisfies DPORecord);
  }
  const lines = records.map((record) => JSON.stringify(record));

  return {
    format: "dpo",
    sampleCount: lines.length,
    records,
    json: JSON.stringify(records, null, 2),
    jsonl: lines.join("\n"),
    filename: `dpo_pairs_${dateTag()}.json`,
  };
}

export function exportAll(minReward = 0): ExportResult[] {
  const results: ExportResult[] = [];
  const orch = exportOrchestratorSFT(minReward);
  if (orch.sampleCount > 0) results.push(orch);
  const agent = exportAgentSFT(minReward);
  if (agent.sampleCount > 0) results.push(agent);
  const share = exportShareGPT(minReward);
  if (share.sampleCount > 0) results.push(share);
  const dpo = exportDPO();
  if (dpo.sampleCount > 0) results.push(dpo);
  return results;
}

function safeDirName(name?: string) {
  if (!name || !name.trim()) return "";
  return name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80);
}

function safeFileName(name: string) {
  const base = basename(name);
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function ensureExportDir(subdir?: string) {
  const finalDir = subdir
    ? join(TRAINING_EXPORT_BASE_DIR, safeDirName(subdir))
    : TRAINING_EXPORT_BASE_DIR;
  mkdirSync(finalDir, { recursive: true });
  return finalDir;
}

export function writeExportToFile(
  result: ExportResult,
  options?: { subdir?: string; outputType?: "json" | "jsonl" },
): ExportFileResult {
  const dir = ensureExportDir(options?.subdir);
  const outputType = options?.outputType ?? "json";
  const filename = safeFileName(applyOutputExt(result.filename, outputType));
  const filePath = join(dir, filename);
  const content = outputType === "json" ? result.json : result.jsonl;
  writeFileSync(filePath, content, "utf8");
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    format: result.format,
    filename,
    filePath,
    sampleCount: result.sampleCount,
    bytes,
    outputType,
  };
}

export function writeExportsToFiles(
  results: ExportResult[],
  options?: { subdir?: string; outputType?: "json" | "jsonl" },
): ExportFileResult[] {
  return results.map((result) => writeExportToFile(result, options));
}

export function getExportStats(): ExportStats {
  const counts = getSampleCounts();
  return {
    counts,
    availableExports: [
      {
        format: "orchestrator_sft_v3",
        description: "Orchestrator SFT v3 decision-first parallel orchestration data (default JSON)",
        sampleCount: counts["orchestrator_sft_v3"] ?? 0,
      },
      {
        format: "agent_sft",
        description: "Agent SFT (Alpaca, default JSON)",
        sampleCount: counts["agent_sft"] ?? 0,
      },
      {
        format: "sharegpt",
        description: "Conversation format (ShareGPT, default JSON)",
        sampleCount: counts._total ?? 0,
      },
      {
        format: "dpo",
        description: "Preference pairs (DPO, default JSON)",
        sampleCount: Math.min(counts["orchestrator_dpo_v3_chosen"] ?? 0, counts["orchestrator_dpo_v3_rejected"] ?? 0),
      },
    ],
  };
}

export function getTrainingExportBaseDir() {
  return TRAINING_EXPORT_BASE_DIR;
}

function dateTag() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function applyOutputExt(filename: string, outputType: "json" | "jsonl") {
  const cleaned = filename.replace(/\.(jsonl|json)$/i, "");
  return `${cleaned}.${outputType}`;
}
