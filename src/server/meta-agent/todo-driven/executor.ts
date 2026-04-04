import { nowIso } from "@/lib/utils";
import { outputManager } from "@/server/runtime/output-manager";
import { callLLMWithUsage } from "../llm-helper";
import { sanitizeJsonLikeText, sanitizeModelText } from "../text-cleaner";
import type { TodoExecutionContext, TodoExecutor } from "./types";

function sanitizeFileName(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "todo_output";
}

function tryParseJson(raw: string) {
  const clean = sanitizeJsonLikeText(raw);
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const singleLlmTodoExecutor: TodoExecutor = async (context, _state, _todo) => {
  void _state;
  void _todo;
  const prompt = [
    "You are a single-step supervisor executor.",
    "Complete the current todo using the provided local context.",
    "Use tools or resource-center skills only when they materially help the task.",
    "Return ONLY valid JSON in this schema:",
    "{",
    '  "summary": "short summary",',
    '  "output": "full output",',
    '  "criteria_evidence": ["evidence string"],',
    '  "artifact_type": "todo_result",',
    '  "artifact_summary": "artifact summary"',
    "}",
    "",
    `Goal: ${context.goal}`,
    `Todo Title: ${context.current_todo.title}`,
    `Todo Description: ${context.current_todo.description}`,
    `Acceptance Criteria: ${context.current_todo.acceptance_criteria.join("; ")}`,
    `Input Artifacts: ${JSON.stringify(context.input_artifacts)}`,
    `History Summary: ${JSON.stringify(context.history_summary)}`,
    `Recovery Context: ${JSON.stringify(context.recovery_context ?? {})}`,
    `Resource Center Skills: ${JSON.stringify(context.resource_center?.skills ?? [])}`,
  ].join("\n");

  try {
    const llm = await callLLMWithUsage([
      { role: "system", content: "You are a strict JSON generator." },
      { role: "user", content: prompt },
    ]);
    const raw = sanitizeModelText(llm.content);

    const parsed = tryParseJson(raw);
    const summary = sanitizeModelText(
      typeof parsed?.summary === "string" ? parsed.summary : "todo execution summary",
    );
    const output = sanitizeModelText(typeof parsed?.output === "string" ? parsed.output : raw);
    const criteriaEvidence = Array.isArray(parsed?.criteria_evidence)
      ? parsed.criteria_evidence
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeModelText(item))
      : [];
    const artifactType = typeof parsed?.artifact_type === "string" ? parsed.artifact_type : "todo_result";
    const artifactSummary = sanitizeModelText(
      typeof parsed?.artifact_summary === "string" ? parsed.artifact_summary : summary,
    );

    const fileName = outputManager.createRunScopedFileName(sanitizeFileName(context.current_todo.title), ".md");
    const filePath = outputManager.normalizeOutputPath(
      context.run_id,
      context.current_todo.id,
      fileName,
      fileName,
    );

    return {
      status: "success",
      summary,
      output,
      token_usage: llm.usage,
      criteria_evidence: criteriaEvidence,
      artifact: {
        path: filePath,
        type: artifactType,
        summary: artifactSummary,
      },
      notes: [`generated_at=${nowIso()}`],
    };
  } catch (error) {
    return {
      status: "error",
      output: "",
      error_message: error instanceof Error ? error.message : String(error),
      notes: [`executor_error_at=${nowIso()}`],
    };
  }
};
