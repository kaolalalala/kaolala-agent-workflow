import { nowIso } from "@/lib/utils";
import { existsSync, readFileSync, statSync } from "node:fs";
import { outputManager } from "@/server/runtime/output-manager";
import { toolExecutor } from "@/server/tools/tool-executor";
import { toolService } from "@/server/tools/tool-service";
import {
  callLLMWithUsage,
  callLLMWithTools,
  LLMToolLoopError,
  type LLMWithToolsResult,
  type LLMToolCallRequest,
} from "../llm-helper";
import { executeMetaAgentSkillResource } from "../skill-resource-center";
import {
  addExecutionLog,
  type RunState,
  type SubagentAutonomyLevel,
  type TodoItem,
  type WorkspaceFileKind,
} from "../supervisor-runtime-state";
import { sanitizeJsonLikeText, sanitizeModelText } from "../text-cleaner";
import type { DelegationBrief, SubagentDefinition, SubagentExecutionResult } from "./types";
import {
  collectProfileArtifactCriteriaEvidence,
  collectProfileStructuredCriteriaEvidence,
  normalizeArtifactsWithProfiles,
  scoreRecoveredToolCallWithProfiles,
  summarizeRecoveredToolResultWithProfiles,
} from "./result-profiles";
import { getDelegationBriefRuntimeProfiles } from "./runtime-profiles";
import { findSubagentByCapability } from "./subagent-registry";
import {
  getAutonomyMaxRounds,
  injectAutonomyTools,
} from "./subagent-workspace-tools";
import {
  readWorkspaceFile,
  writeWorkspaceFileForArtifact,
} from "./workspace-files";

function sanitizeFileStem(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "subagent_result";
}

function cleanJson(raw: string) {
  return sanitizeJsonLikeText(raw);
}

function safeParseJson(raw: string) {
  try {
    return JSON.parse(cleanJson(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => sanitizeModelText(item));
}

function pushUniqueEvidence(target: string[], seen: Set<string>, entry: unknown) {
  if (entry === undefined || entry === null) return;
  const text = sanitizeModelText(String(entry)).trim();
  if (!text || seen.has(text)) return;
  seen.add(text);
  target.push(text);
}

function collectStructuredCriteriaEvidence(result?: Record<string, unknown> | null) {
  return collectStructuredCriteriaEvidenceForProfiles([], result);
}

function collectStructuredCriteriaEvidenceForProfiles(
  activeProfiles: string[],
  result?: Record<string, unknown> | null,
) {
  if (!result) return [] as string[];

  const evidence: string[] = [];
  const seen = new Set<string>();
  const fields: Array<[string, string]> = [
    ["duplicateCount", "duplicateCount"],
    ["missingCount", "missingCount"],
    ["requiredCount", "requiredCount"],
    ["checkedCount", "checkedCount"],
    ["passedCount", "passedCount"],
    ["manifestPath", "manifestPath"],
    ["reportPath", "reportPath"],
    ["filePath", "filePath"],
    ["outputDir", "outputDir"],
  ];

  for (const [field, label] of fields) {
    const value = result[field];
    if (typeof value === "number") {
      pushUniqueEvidence(evidence, seen, `${label}=${value}`);
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      pushUniqueEvidence(evidence, seen, `${label}=${value.trim()}`);
    }
  }

  for (const item of collectProfileStructuredCriteriaEvidence(activeProfiles, result)) {
    pushUniqueEvidence(evidence, seen, item);
  }

  return evidence;
}

function collectArtifactCriteriaEvidence(
  artifacts: Array<{ path: string; type: string; summary: string }>,
) {
  return collectArtifactCriteriaEvidenceForProfiles([], artifacts);
}

function collectArtifactCriteriaEvidenceForProfiles(
  activeProfiles: string[],
  artifacts: Array<{ path: string; type: string; summary: string }>,
) {
  const evidence: string[] = [];
  const seen = new Set<string>();

  for (const artifact of artifacts) {
    const artifactPath = sanitizeModelText(artifact.path).trim();
    if (!artifactPath) continue;

    if (artifact.type === "manifest") {
      pushUniqueEvidence(evidence, seen, `artifactManifestPath=${artifactPath}`);
    } else if (artifact.type === "report") {
      pushUniqueEvidence(evidence, seen, `artifactReportPath=${artifactPath}`);
    }

    for (const item of collectProfileArtifactCriteriaEvidence(activeProfiles, [{ path: artifactPath, type: artifact.type, summary: artifact.summary }])) {
      pushUniqueEvidence(evidence, seen, item);
    }

    try {
      if (!artifactPath.toLowerCase().endsWith(".json") || !existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
        continue;
      }
      const parsed = safeParseJson(readFileSync(artifactPath, "utf8"));
      for (const item of collectStructuredCriteriaEvidenceForProfiles(activeProfiles, parsed)) {
        pushUniqueEvidence(evidence, seen, item);
      }
    } catch {
      continue;
    }
  }

  return evidence;
}

function collectToolCallCriteriaEvidence(
  toolCalls: LLMWithToolsResult["tool_calls_made"],
) {
  return collectToolCallCriteriaEvidenceForProfiles([], toolCalls);
}

function collectToolCallCriteriaEvidenceForProfiles(
  activeProfiles: string[],
  toolCalls: LLMWithToolsResult["tool_calls_made"],
) {
  const evidence: string[] = [];
  const seen = new Set<string>();
  for (const call of toolCalls) {
    for (const item of collectStructuredCriteriaEvidenceForProfiles(activeProfiles, call.result)) {
      pushUniqueEvidence(evidence, seen, item);
    }
  }
  return evidence;
}

function mergeCriteriaEvidence(...lists: Array<string[] | undefined>) {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list ?? []) {
      pushUniqueEvidence(merged, seen, item);
    }
  }
  return merged;
}

function summarizeRecoveredToolResult(toolName: string, result: Record<string, unknown>) {
  return summarizeRecoveredToolResultForProfiles([], toolName, result);
}

function summarizeRecoveredToolResultForProfiles(
  activeProfiles: string[],
  toolName: string,
  result: Record<string, unknown>,
) {
  const profileSummary = summarizeRecoveredToolResultWithProfiles(activeProfiles, toolName, result);
  if (profileSummary) {
    return profileSummary;
  }
  if (typeof result.missingCount === "number") {
    return `Recovered successful tool output from ${toolName}: missing ${result.missingCount} item(s) after merge.`;
  }
  if (typeof result.ok === "boolean") {
    return `Recovered successful tool output from ${toolName}.`;
  }
  return `Recovered partial tool output from ${toolName}.`;
}

function inferArtifactTypeFromPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) return "manifest";
  if (lower.endsWith(".md")) return "report";
  if (lower.endsWith(".pdf")) return "pdf";
  if (existsSync(filePath) && statSync(filePath).isDirectory()) return "output_dir";
  return "file";
}

function collectToolResultArtifacts(
  result: Record<string, unknown>,
  summary: string,
) {
  const artifacts: Array<{ path: string; type: string; summary: string }> = [];
  const seen = new Set<string>();
  const pathFields: Array<[string, string]> = [
    ["manifestPath", "manifest"],
    ["reportPath", "report"],
    ["filePath", "file"],
    ["outputDir", "output_dir"],
  ];

  for (const [field, type] of pathFields) {
    const value = result[field];
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        artifacts.push({
          path: trimmed,
          type,
          summary,
        });
      }
    }
  }

  const outputFiles = Array.isArray(result.outputFiles)
    ? result.outputFiles.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  for (const filePath of outputFiles.slice(0, 40)) {
    const trimmed = filePath.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      artifacts.push({
        path: trimmed,
        type: inferArtifactTypeFromPath(trimmed),
        summary,
      });
    }
  }

  return artifacts;
}

function collectRecoveredArtifacts(
  result: Record<string, unknown>,
  fallbackPath: string,
  fallbackSummary: string,
) {
  const artifacts = collectToolResultArtifacts(result, fallbackSummary);
  if (artifacts.length > 0) {
    return artifacts;
  }

  return [
    {
      path: fallbackPath,
      type: "tool_recovery",
      summary: fallbackSummary,
    },
  ];
}

function collectArtifactsFromSuccessfulToolCalls(
  toolCalls: LLMWithToolsResult["tool_calls_made"],
  agent: SubagentDefinition,
  brief: DelegationBrief,
  activeProfiles: string[],
) {
  const aggregated: Array<{ path: string; type: string; summary: string }> = [];
  const seen = new Set<string>();
  let fallbackIndex = 0;

  for (const call of toolCalls) {
    if ((call.result as { error?: unknown }).error) {
      continue;
    }
    const summary = summarizeRecoveredToolResultForProfiles(activeProfiles, call.tool_name, call.result);
    const fallbackPath = outputManager.normalizeOutputPath(
      brief.run_id,
      brief.todo_id,
      `${agent.id}_${sanitizeFileStem(brief.todo_title)}_tool_${fallbackIndex + 1}.md`,
    );
    fallbackIndex += 1;
    for (const artifact of collectRecoveredArtifacts(call.result, fallbackPath, summary)) {
      if (!seen.has(artifact.path)) {
        seen.add(artifact.path);
        aggregated.push(artifact);
      }
    }
  }

  return aggregated;
}

function scoreRecoveredToolCall(
  call: LLMWithToolsResult["tool_calls_made"][number],
  index: number,
) {
  return scoreRecoveredToolCallForProfiles([], call, index);
}

function scoreRecoveredToolCallForProfiles(
  activeProfiles: string[],
  call: LLMWithToolsResult["tool_calls_made"][number],
  index: number,
) {
  const profileScore = scoreRecoveredToolCallWithProfiles(activeProfiles, call, index);
  if (typeof profileScore === "number") {
    return profileScore;
  }

  const manifestPath = typeof call.result.manifestPath === "string"
    ? call.result.manifestPath.toLowerCase()
    : "";
  const reportPath = typeof call.result.reportPath === "string"
    ? call.result.reportPath.toLowerCase()
    : "";

  if (typeof call.result.passedCount === "number" || typeof call.result.checkedCount === "number") {
    return 3000 + index;
  }
  if (manifestPath || reportPath) {
    return 500 + index;
  }
  if (typeof call.result.ok === "boolean") {
    return 100 + index;
  }
  return index;
}

function pickRecoveredSummaryCall(
  successfulCalls: LLMWithToolsResult["tool_calls_made"],
) {
  return successfulCalls.reduce((best, call, index) => {
    if (!best) {
      return call;
    }
    const bestIndex = successfulCalls.indexOf(best);
    return scoreRecoveredToolCall(call, index) >= scoreRecoveredToolCall(best, bestIndex)
      ? call
      : best;
  }, successfulCalls[0]);
}

function recoverFromToolLoopError(
  error: LLMToolLoopError,
  agent: SubagentDefinition,
  brief: DelegationBrief,
): SubagentExecutionResult | null {
  const activeProfiles = getDelegationBriefRuntimeProfiles(brief);
  const successfulCalls = error.tool_calls_made.filter((item) => !(item.result as { error?: unknown }).error);
  if (successfulCalls.length === 0) {
    return null;
  }

  // Aggregate criteria_evidence from ALL successful calls, not just the last one.
  // This is critical when the subagent calls a skill (e.g. delivery-skill 鈫?manifestPath)
  // and then calls generic tools (e.g. tool_save_local_report) afterward 鈥?the skill's
  // output paths must not be lost just because a later tool ran last.
  const recoveredArtifacts = normalizeArtifactsWithProfiles(
    brief,
    collectArtifactsFromSuccessfulToolCalls(successfulCalls, agent, brief, activeProfiles),
  );
  const bestCall = successfulCalls.reduce((best, call, index) => {
    if (!best) return call;
    const bestIndex = successfulCalls.indexOf(best);
    return scoreRecoveredToolCallForProfiles(activeProfiles, call, index) >=
      scoreRecoveredToolCallForProfiles(activeProfiles, best, bestIndex)
      ? call
      : best;
  }, successfulCalls[0]);
  const summary = summarizeRecoveredToolResultForProfiles(activeProfiles, bestCall.tool_name, bestCall.result);
  const criteriaEvidence = mergeCriteriaEvidence(
    collectToolCallCriteriaEvidenceForProfiles(activeProfiles, successfulCalls),
    collectArtifactCriteriaEvidenceForProfiles(activeProfiles, recoveredArtifacts),
  );

  return {
    status: "success",
    summary,
    token_usage: error.usage,
    artifacts: recoveredArtifacts,
    open_questions: [],
    completion_notes: [
      "Recovered from tool-loop final-response failure using successful tool outputs.",
      `tool_loop_error=${error.message}`,
    ],
    criteria_evidence: criteriaEvidence,
    raw_output: sanitizeModelText(JSON.stringify({
      recovered_from_tool_loop_error: true,
      latest_text: error.latest_text,
      tool_calls_made: successfulCalls,
    }, null, 2)),
  };
}

function buildRetryAnalysisBlock(brief: DelegationBrief): string {
  const ra = brief.retry_analysis;
  if (!ra) return "";

  const lines: string[] = [
    "",
    "== RETRY IMPROVEMENT DIRECTIVE ==",
    "This is a RETRY attempt. Your previous output was reviewed and found insufficient.",
    "You MUST address the issues below. Do NOT repeat the same mistakes.",
    "",
  ];

  if (ra.directive_text) {
    lines.push(ra.directive_text);
  }

  if (ra.previous_review_judgments && ra.previous_review_judgments.length > 0) {
    lines.push("");
    lines.push("PREVIOUS REVIEWER JUDGMENTS (per criterion):");
    for (const judgment of ra.previous_review_judgments) {
      const mark = judgment.satisfied ? "PASS" : "FAIL";
      lines.push(`  [${mark}] "${judgment.criterion}" (confidence: ${judgment.confidence})`);
      lines.push(`    Reviewer: ${judgment.reason}`);
    }
  }

  lines.push("");
  lines.push("== END RETRY DIRECTIVE ==");
  lines.push("");

  return lines.join("\n");
}

function buildWaveContextBlock(brief: DelegationBrief): string {
  const wc = brief.wave_context;
  if (!wc) return "";

  const peerLines = wc.peers.map(
    (peer) => `  - [${peer.agent_id}] "${peer.todo_title}" => scope: ${peer.scope_boundary}`,
  );

  return [
    "",
    "== PARALLEL WAVE CONTEXT ==",
    `You are agent ${wc.peer_index + 1} of ${wc.total_peers} running in parallel.`,
    `Wave ID: ${wc.wave_id}`,
    "",
    "Your peers in this wave:",
    ...peerLines,
    "",
    `YOUR SCOPE BOUNDARY: ${wc.my_scope_boundary}`,
    "You MUST stay strictly within your scope boundary.",
    "Do NOT duplicate work that your peers are responsible for.",
    "",
    ...(wc.excluded_scopes.length > 0
      ? [
          "Explicitly excluded from your scope (handled by peers):",
          ...wc.excluded_scopes.map((scope) => `  - ${scope}`),
          "",
        ]
      : []),
    "== END WAVE CONTEXT ==",
    "",
  ].join("\n");
}

function mergeResolvedTools(
  agent: SubagentDefinition,
  brief: DelegationBrief,
  runtime?: { state: RunState; todo: TodoItem; nesting_depth?: number; parent_agent_id?: string },
) {
  const baseTools = brief.resolved_tools ?? [];
  if (!runtime) return baseTools;
  const autonomyTools = injectAutonomyTools(
    brief.autonomy_level ?? agent.autonomy_level,
    brief.nesting_depth ?? runtime.nesting_depth ?? 0,
  );
  const merged = new Map<string, (typeof baseTools)[number]>();
  for (const tool of [...baseTools, ...autonomyTools]) {
    merged.set(tool.toolId, tool);
  }
  return Array.from(merged.values());
}

function buildAutonomyBlock(
  agent: SubagentDefinition,
  brief: DelegationBrief,
  autonomyLevel: SubagentAutonomyLevel,
) {
  return [
    "",
    "Autonomy configuration:",
    `- autonomy_level: ${autonomyLevel}`,
    `- nesting_depth: ${brief.nesting_depth ?? 0}`,
    `- readable workspace_file_ids: ${brief.workspace_file_ids?.join(", ") || "none"}`,
    autonomyLevel === "basic"
      ? "- Keep execution compact. Do not create nested delegations."
      : autonomyLevel === "enhanced"
        ? "- You may use workspace_read/workspace_write and think_and_plan for multi-step work."
        : "- You may use workspace_read/workspace_write, think_and_plan, and limited one-level delegate_subtask.",
    `- default agent autonomy from registry: ${agent.autonomy_level}`,
    "",
  ].join("\n");
}

function buildNestedDelegationBrief(
  parentBrief: DelegationBrief,
  agent: SubagentDefinition,
  taskDescription: string,
  preferredCapability: string,
) {
  return {
    ...parentBrief,
    todo_title: `${parentBrief.todo_title} / nested ${preferredCapability}`,
    todo_description: taskDescription,
    acceptance_criteria: [
      "Return a concise useful result for the delegated child subtask",
      "Preserve evidence or reasoning relevant to the parent task",
    ],
    constraints: [
      ...parentBrief.constraints,
      `Nested delegation from parent todo ${parentBrief.todo_id}`,
      `Parent requested capability: ${preferredCapability}`,
    ],
    expected_output_schema: agent.output_schema_description,
    resolved_tools: undefined,
    autonomy_level: "basic" as const,
    nesting_depth: (parentBrief.nesting_depth ?? 0) + 1,
    wave_context: undefined,
    retry_analysis: undefined,
  } satisfies DelegationBrief;
}

function formatArtifactSummaries(artifacts: DelegationBrief["artifact_summaries"], brief?: DelegationBrief) {
  if (!artifacts.length) return "none";
  const lines = artifacts
    .slice(0, 8)
    .map((artifact) => `- ${artifact.type}: ${sanitizeModelText(artifact.summary)} @ ${artifact.path}`);

  // For merge/collection todos, append an explicit "ALL inputs" block so the subagent
  // cannot accidentally process only the first artifact it encounters.
  const isMerge = brief && /(?:merge|合并|collect|收集)/i.test(
    [brief.todo_title, brief.todo_description, ...(brief.acceptance_criteria ?? [])].join(" "),
  );
  if (isMerge && artifacts.length > 1) {
    lines.push("");
    lines.push(`MERGE DIRECTIVE: You MUST merge ALL ${artifacts.length} input artifact(s) listed above.`);
    lines.push("Input paths to merge (do NOT skip any):");
    for (const artifact of artifacts.slice(0, 8)) {
      if (artifact.path && artifact.path !== "context://compacted-artifacts") {
        lines.push(`  鈥?${artifact.path}`);
      }
    }
    lines.push("Do NOT stop after processing the first item. Process every path before producing output.");
  }

  return lines.join("\n");
}

function formatRecoveryContext(brief: DelegationBrief) {
  const recovery = brief.recovery_context;
  if (!recovery) return "none";
  const lines = [
    `retry=${recovery.retry_count}`,
    `reroute=${recovery.reroute_count}`,
  ];
  if (recovery.last_failure_reason) {
    lines.push(`last_failure=${sanitizeModelText(recovery.last_failure_reason)}`);
  }
  if (recovery.last_missing_criteria.length > 0) {
    lines.push(`missing=${recovery.last_missing_criteria.join(" | ")}`);
  }
  if (recovery.guidance_notes.length > 0) {
    lines.push(`guidance=${recovery.guidance_notes.join(" | ")}`);
  }
  if (recovery.forced_target_agent_id) {
    lines.push(`forced_target=${recovery.forced_target_agent_id}`);
  }
  return lines.join("\n");
}

function formatResourceSkillHints(brief: DelegationBrief) {
  const skills = brief.resource_center?.skills ?? [];
  if (skills.length === 0) return "none";
  return skills
    .slice(0, 5)
    .map((skill, index) => {
      const parts = [
        `${skill.name} (${skill.id})`,
        skill.description ? `鐢ㄩ€? ${sanitizeModelText(skill.description)}` : "",
        skill.output_description ? `杈撳嚭: ${sanitizeModelText(skill.output_description)}` : "",
        // Always inject guide_content for the top-ranked skill; for others inject a short excerpt.
        // This ensures subagent knows WHEN and HOW to call the skill, not just that it exists.
        skill.guide_content
          ? `浣跨敤鎸囧崡: ${sanitizeModelText(index === 0 ? skill.guide_content : skill.guide_content.slice(0, 300))}`
          : "",
      ].filter(Boolean);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

function estimateTokensFromChars(chars: number) {
  return Math.max(0, Math.ceil(chars / 4));
}

function buildPromptProfile(
  agent: SubagentDefinition,
  brief: DelegationBrief,
  resolvedTools: Array<{
    toolId: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>,
  promptSections: Array<{ label: string; content: string }>,
) {
  const sectionMetrics = promptSections
    .filter((section) => section.content.trim().length > 0)
    .map((section) => {
      const charCount = section.content.length;
      return {
        label: section.label,
        charCount,
        estimatedTokens: estimateTokensFromChars(charCount),
      };
    });

  const toolDescriptionChars = resolvedTools.reduce((sum, tool) => sum + tool.description.length, 0);
  const toolSchemaChars = resolvedTools.reduce(
    (sum, tool) => sum + JSON.stringify(tool.inputSchema ?? {}).length,
    0,
  );
  const skillGuideChars = (brief.resource_center?.skills ?? []).reduce(
    (sum, skill) => sum + String(skill.guide_content ?? "").length,
    0,
  );

  const totalPromptChars = sectionMetrics.reduce((sum, section) => sum + section.charCount, 0);

  return {
    agentId: agent.id,
    todoId: brief.todo_id,
    totalPromptChars,
    estimatedPromptTokens: estimateTokensFromChars(totalPromptChars),
    toolCount: resolvedTools.length,
    toolDescriptionChars,
    toolSchemaChars,
    skillCount: brief.resource_center?.skills?.length ?? 0,
    skillGuideChars,
    acceptanceCriteriaCount: brief.acceptance_criteria.length,
    artifactSummaryCount: brief.artifact_summaries.length,
    constraintCount: brief.constraints.length,
    retryCount: brief.recovery_context?.retry_count ?? 0,
    rerouteCount: brief.recovery_context?.reroute_count ?? 0,
    hasWaveContext: Boolean(brief.wave_context),
    hasRetryAnalysis: Boolean(brief.retry_analysis),
    sectionMetrics,
  };
}

function logDelegatePromptProfile(
  runtime: {
    state: RunState;
    todo: TodoItem;
    nesting_depth?: number;
    parent_agent_id?: string;
  } | undefined,
  agent: SubagentDefinition,
  brief: DelegationBrief,
  resolvedTools: Array<{
    toolId: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>,
  promptSections: Array<{ label: string; content: string }>,
) {
  if (!runtime) return;
  const profile = buildPromptProfile(agent, brief, resolvedTools, promptSections);
  addExecutionLog(runtime.state, {
    timestamp: nowIso(),
    todo_id: brief.todo_id,
    actor: agent.id,
    action: "delegate_prompt_profile",
    message: JSON.stringify(profile),
  });
}

/**
 * Adapter that reuses current LLM chain for delegated subagent execution.
 */
export async function runSubagentTodo(
  agent: SubagentDefinition,
  brief: DelegationBrief,
  runtime?: {
    state: RunState;
    todo: TodoItem;
    nesting_depth?: number;
    parent_agent_id?: string;
  },
): Promise<SubagentExecutionResult> {
  const activeProfiles = getDelegationBriefRuntimeProfiles(brief);
  const autonomyLevel = brief.autonomy_level ?? agent.autonomy_level;
  const resolvedTools = mergeResolvedTools(agent, brief, runtime);
  const hasTools = resolvedTools.length > 0;
  const readableWorkspaceIds = new Set<string>(brief.workspace_file_ids ?? []);

  const toolInfoBlock = hasTools
    ? `Available tools: ${resolvedTools.map((tool) => `${tool.name} (${tool.toolId})`).join(", ")}. Use them when needed to complete the task.`
    : "Allowed tools: none";

  const promptSections = [
    {
      label: "agent_identity",
      content: [
        `Agent: ${agent.name} (${agent.id})`,
        `Description: ${agent.description}`,
        `Execution boundary: ${agent.execution_boundary}`,
        `Capabilities: ${agent.capability_types.join(", ")}`,
        `Output contract: ${agent.output_contract}`,
      ].join("\n"),
    },
    {
      label: "tooling_and_policy",
      content: [
        toolInfoBlock,
        hasTools
          ? "Tool-use policy: when a resource-center skill directly matches the todo, use that skill before trying manual workspace writes. Use workspace_write mainly for notes or summaries after tool execution."
          : "Tool-use policy: no external tools are available for this task.",
        hasTools
          ? "Completion policy: do not stop at a partial result. If tool outputs still indicate unmet requirements, incomplete artifacts, or missing evidence, continue using the relevant skills until the acceptance criteria are satisfied or you can clearly explain why no further recovery is possible."
          : "Completion policy: ensure every acceptance criterion is substantively satisfied before finalizing.",
      ].join("\n"),
    },
    {
      label: "autonomy_block",
      content: buildAutonomyBlock(agent, brief, autonomyLevel),
    },
    {
      label: "task_brief",
      content: [
        "Task brief:",
        `Goal: ${brief.goal}`,
        `Todo title: ${brief.todo_title}`,
        `Todo description: ${brief.todo_description}`,
        `Acceptance criteria: ${brief.acceptance_criteria.join("; ")}`,
        `Input refs: ${brief.input_refs.join(", ") || "none"}`,
        `Artifact summaries:\n${formatArtifactSummaries(brief.artifact_summaries, brief)}`,
        `Recovery context:\n${formatRecoveryContext(brief)}`,
        `Resource center skills:\n${formatResourceSkillHints(brief)}`,
        `Constraints: ${brief.constraints.join("; ")}`,
      ].join("\n"),
    },
    {
      label: "retry_analysis",
      content: buildRetryAnalysisBlock(brief),
    },
    {
      label: "wave_context",
      content: buildWaveContextBlock(brief),
    },
    {
      label: "output_contract_json",
      content: [
        hasTools
          ? "When you have gathered enough information via tools, return your FINAL answer as strict JSON:"
          : "Return ONLY strict JSON:",
        "{",
        '  "summary": "short summary (max 200 chars)",',
        '  "artifacts": [{"path":"...", "type":"...", "summary":"..."}],',
        '  "open_questions": ["..."],',
        '  "completion_notes": ["..."],',
        '  "criteria_evidence": ["..."]',
        "}",
      ].join("\n"),
    },
  ];

  const prompt = promptSections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n\n");
  logDelegatePromptProfile(runtime, agent, brief, resolvedTools, promptSections);

  try {
    let raw: string;
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; source?: string };
    let toolCallsMade: LLMWithToolsResult["tool_calls_made"] = [];

    if (hasTools) {
      const executeToolCall = async (call: LLMToolCallRequest): Promise<Record<string, unknown>> => {
        if (call.name === "workspace_read") {
          if (!runtime) {
            return { error: true, message: "workspace_read requires runtime context" };
          }
          const fileId = typeof call.arguments.file_id === "string" ? call.arguments.file_id : "";
          const maxChars = Number(call.arguments.max_chars ?? 4500);
          if (!fileId || !readableWorkspaceIds.has(fileId)) {
            return { error: true, message: `workspace file is not authorized: ${fileId || "unknown"}` };
          }
          const result = readWorkspaceFile(runtime.state, fileId, Number.isFinite(maxChars) ? maxChars : 4500);
          return result ?? { error: true, message: `workspace file not found: ${fileId}` };
        }

        if (call.name === "workspace_write") {
          if (!runtime) {
            return { error: true, message: "workspace_write requires runtime context" };
          }
          const filename = typeof call.arguments.filename === "string" ? call.arguments.filename : "workspace-note.md";
          const content = typeof call.arguments.content === "string" ? call.arguments.content : "";
          const kind = typeof call.arguments.kind === "string"
            ? (call.arguments.kind as WorkspaceFileKind)
            : "intermediate_summary";
          if (!content.trim()) {
            return { error: true, message: "workspace_write requires non-empty content" };
          }
          const file = writeWorkspaceFileForArtifact(
            runtime.state,
            runtime.todo,
            agent.id,
            kind,
            content,
            filename,
            content.slice(0, 200),
          );
          readableWorkspaceIds.add(file.file_id);
          return {
            file_id: file.file_id,
            path: file.path,
            size: content.length,
            kind,
          };
        }

        if (call.name === "think_and_plan") {
          const steps = asStringArray(call.arguments.steps).slice(0, 4);
          return {
            status: "planned",
            steps,
          };
        }

        if (call.name === "delegate_subtask") {
          if (!runtime) {
            return { error: true, message: "delegate_subtask requires runtime context" };
          }
          const nestingDepth = brief.nesting_depth ?? runtime.nesting_depth ?? 0;
          if (nestingDepth >= 1) {
            return { error: true, message: "nested delegation depth limit reached" };
          }
          const taskDescription = typeof call.arguments.task_description === "string"
            ? call.arguments.task_description
            : "";
          const preferredCapability = typeof call.arguments.preferred_capability === "string"
            ? call.arguments.preferred_capability
            : "";
          const childAgent = findSubagentByCapability(preferredCapability);
          if (!childAgent) {
            return { error: true, message: `no child subagent found for capability ${preferredCapability || "unknown"}` };
          }
          const childBrief = buildNestedDelegationBrief(
            brief,
            childAgent,
            taskDescription || `Nested subtask from ${brief.todo_title}`,
            preferredCapability,
          );
          const childResult = await runSubagentTodo(childAgent, childBrief, {
            ...runtime,
            nesting_depth: nestingDepth + 1,
            parent_agent_id: agent.id,
          });
          return {
            status: childResult.status,
            summary: childResult.summary,
            open_questions: childResult.open_questions,
          };
        }

        if (call.name.startsWith("skill:")) {
          return await executeMetaAgentSkillResource(call.name, call.arguments, {
            runId: brief.run_id,
            todoId: brief.todo_id,
          });
        }

        const realTool = toolService.getTool(call.name);
        if (!realTool || !realTool.enabled) {
          return { error: true, message: `Tool not found or disabled: ${call.name}` };
        }
        const resolved = {
          ...realTool,
          effectiveEnabled: true,
          effectivePriority: 100,
          resolvedFrom: "platform_pool" as const,
          effectiveConfig: { ...realTool.sourceConfig },
        };
        const result = await toolExecutor.execute(
          resolved,
          call.arguments,
          { runId: brief.run_id, nodeId: brief.todo_id },
        );
        return result.ok
          ? (result.data ?? { ok: true })
          : { error: true, message: result.error?.message ?? "Tool execution failed" };
      };

      const llmResult = await callLLMWithTools(
        [
          { role: "system", content: agent.system_prompt },
          { role: "user", content: prompt },
        ],
        resolvedTools.map((tool) => ({
          toolId: tool.toolId,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        executeToolCall,
        {
          maxRounds: getAutonomyMaxRounds(autonomyLevel),
          contextBudgetTokens: autonomyLevel === "full" ? 12000 : autonomyLevel === "enhanced" ? 9000 : 7000,
          compactionTriggerRatio: 0.7,
          keepRecentCount: 3,
        },
      );
      raw = sanitizeModelText(llmResult.content);
      usage = llmResult.usage;
      toolCallsMade = llmResult.tool_calls_made;
    } else {
      const llm = await callLLMWithUsage([
        { role: "system", content: agent.system_prompt },
        { role: "user", content: prompt },
      ]);
      raw = sanitizeModelText(llm.content);
      usage = llm.usage;
    }

    const parsed = safeParseJson(raw);
    const summary = sanitizeModelText(typeof parsed?.summary === "string" ? parsed.summary : raw.slice(0, 200));
    const parsedArtifacts =
      Array.isArray(parsed?.artifacts) && parsed?.artifacts.length > 0
        ? parsed.artifacts
            .filter((item): item is { path?: unknown; type?: unknown; summary?: unknown } =>
              Boolean(item && typeof item === "object"),
            )
            .map((item, index) => ({
              path:
                typeof item.path === "string" && item.path.trim()
                  ? (() => {
                      const requestedPath = item.path.trim();
                      if (existsSync(requestedPath)) {
                        return requestedPath;
                      }
                      return outputManager.normalizeOutputPath(brief.run_id, brief.todo_id, requestedPath);
                    })()
                  : outputManager.normalizeOutputPath(
                      brief.run_id,
                      brief.todo_id,
                      `${agent.id}_${sanitizeFileStem(brief.todo_title)}_${index + 1}.md`,
                    ),
              type: typeof item.type === "string" && item.type.trim() ? item.type : "subagent_result",
              summary: sanitizeModelText(
                typeof item.summary === "string" && item.summary.trim() ? item.summary : summary,
              ),
            }))
        : [];
    const toolArtifacts = collectArtifactsFromSuccessfulToolCalls(toolCallsMade, agent, brief, activeProfiles);
    const mergedArtifacts = [...parsedArtifacts];
    const seenArtifactPaths = new Set(mergedArtifacts.map((artifact) => artifact.path));
    for (const artifact of toolArtifacts) {
      if (!seenArtifactPaths.has(artifact.path)) {
        seenArtifactPaths.add(artifact.path);
        mergedArtifacts.push(artifact);
      }
    }
    const artifacts =
      mergedArtifacts.length > 0
        ? mergedArtifacts
        : [
            {
              path: outputManager.normalizeOutputPath(
                brief.run_id,
                brief.todo_id,
                `${agent.id}_${sanitizeFileStem(brief.todo_title)}.md`,
              ),
              type: "subagent_result",
              summary,
            },
          ];
    const normalizedArtifacts = normalizeArtifactsWithProfiles(brief, artifacts);
    const criteriaEvidence = mergeCriteriaEvidence(
      asStringArray(parsed?.criteria_evidence),
      collectStructuredCriteriaEvidenceForProfiles(activeProfiles, parsed),
      collectToolCallCriteriaEvidenceForProfiles(activeProfiles, toolCallsMade),
      collectArtifactCriteriaEvidenceForProfiles(activeProfiles, normalizedArtifacts),
    );

    return {
      status: "success",
      summary,
      token_usage: usage,
      artifacts: normalizedArtifacts,
      open_questions: asStringArray(parsed?.open_questions),
      completion_notes: asStringArray(parsed?.completion_notes),
      criteria_evidence: criteriaEvidence,
      raw_output: sanitizeModelText(raw),
    };
  } catch (error) {
    if (error instanceof LLMToolLoopError) {
      const recovered = recoverFromToolLoopError(error, agent, brief);
      if (recovered) {
        return recovered;
      }
    }
    return {
      status: "error",
      summary: "Subagent execution failed.",
      artifacts: [],
      open_questions: [],
      completion_notes: [`error_at=${nowIso()}`],
      criteria_evidence: [],
      error_message: error instanceof Error ? error.message : String(error),
    };
  }
}

