import { toolService } from "@/server/tools/tool-service";
import { selectMetaAgentSkillResources } from "../skill-resource-center";
import type { RunState, TodoItem } from "../supervisor-runtime-state";
import type { RetryAnalysis } from "./retry-analyzer";
import type { DelegationBrief, SubagentDefinition, WaveContext } from "./types";

function toSkillGuideExcerpt(value?: string) {
  const text = value?.trim();
  if (!text) return undefined;
  return text.slice(0, 1200);
}

function resolveToolsForSubagent(
  agent: SubagentDefinition,
  todo: TodoItem,
  relevantSkills: ReturnType<typeof selectMetaAgentSkillResources>,
): DelegationBrief["resolved_tools"] {
  const skillTools = relevantSkills.map((skill, index) => ({
    toolId: `skill:${skill.id}`,
    name: skill.name,
    description: [
      skill.description ?? skill.name,
      index < 2
        ? "Selection hint: this skill ranked highly for the current todo. Prefer it over manual workspace writes when it directly matches the task."
        : "",
      skill.guideContent ? `Skill guide:\n${toSkillGuideExcerpt(skill.guideContent)}` : "",
      skill.outputDescription ? `Expected output: ${skill.outputDescription}` : "",
    ].filter(Boolean).join("\n"),
    inputSchema: skill.parameterSchema,
  }));
  const toolIds = new Set([
    ...agent.allowed_tools,
    ...(todo.extra_tools ?? []),
  ]);

  if (toolIds.size === 0 && skillTools.length === 0) {
    return undefined;
  }

  const resolved: NonNullable<DelegationBrief["resolved_tools"]> = [];
  for (const toolId of toolIds) {
    try {
      const tool = toolService.getTool(toolId);
      if (!tool || !tool.enabled) continue;
      resolved.push({
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: tool.inputSchema,
      });
    } catch {
      // Skip unavailable tools silently.
    }
  }

  resolved.push(...skillTools);
  return resolved.length > 0 ? resolved : undefined;
}

function resolveReadableWorkspaceFiles(state: RunState, todo: TodoItem) {
  const dependencyIds = new Set(todo.depends_on);
  return state.workspace_files
    .filter((file) => dependencyIds.has(file.related_todo))
    .map((file) => file.file_id);
}

export function buildDelegationBrief(
  state: RunState,
  todo: TodoItem,
  agent: SubagentDefinition,
  waveContext?: WaveContext,
  retryAnalysis?: RetryAnalysis,
): DelegationBrief {
  const isRetry = (todo.retry_count ?? 0) > 0 || (todo.reroute_count ?? 0) > 0;

  const recoveryQueryParts = [
    todo.last_failure_reason ?? "",
    ...(todo.last_missing_criteria ?? []),
    ...((todo.notes ?? [])
      .filter((note) => note.startsWith("recovery_feedback:") || note.startsWith("recovery_note:"))
      .slice(-4)),
  ];
  // On retries narrow skill selection to what's actually missing, halve the limit.
  const skillQuery = isRetry
    ? [...(todo.last_missing_criteria ?? []), todo.last_failure_reason ?? "", todo.title].filter(Boolean).join("\n")
    : [state.goal, todo.capability_type, todo.title, todo.description, ...(todo.acceptance_criteria ?? []), ...recoveryQueryParts].join("\n");
  const skillLimit = isRetry ? 4 : 8;
  const relevantSkills = selectMetaAgentSkillResources(skillQuery, skillLimit);
  // Resolve artifact summaries via depends_on first (authoritative runtime data flow),
  // then fall back to input_refs only when no depends_on artifacts are found.
  // A dependency todo may produce multiple artifacts across retries; keep the last
  // 2 unique-path artifacts per dependency so the subagent sees both the primary
  // result and any supplementary outputs from retries.
  const depSet = new Set(todo.depends_on);
  let artifactSummaries: Array<{ id: string; path: string; type: string; summary: string }> = [];
  if (depSet.size > 0) {
    const byDep = new Map<string, (typeof state.artifacts)>();
    for (const artifact of state.artifacts) {
      if (depSet.has(artifact.related_todo)) {
        const list = byDep.get(artifact.related_todo) ?? [];
        list.push(artifact);
        byDep.set(artifact.related_todo, list);
      }
    }
    for (const list of byDep.values()) {
      const byPath = new Map<string, (typeof state.artifacts)[0]>();
      for (const artifact of list) {
        byPath.set(artifact.path, artifact);
      }
      const deduped = [...byPath.values()].slice(-2);
      for (const artifact of deduped) {
        artifactSummaries.push({
          id: artifact.id,
          path: artifact.path,
          type: artifact.type,
          summary: artifact.summary,
        });
      }
    }
  }
  if (artifactSummaries.length === 0 && todo.input_refs.length > 0) {
    const refSet = new Set(todo.input_refs);
    artifactSummaries = state.artifacts
      .filter((artifact) => refSet.has(artifact.id) || refSet.has(artifact.path))
      .slice(-8)
      .map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        type: artifact.type,
        summary: artifact.summary,
      }));
  }

  const constraints: string[] = [];
  if (Array.isArray(state.metadata.constraints)) {
    constraints.push(
      ...(state.metadata.constraints as unknown[])
        .filter((item): item is string => typeof item === "string"),
    );
  }
  constraints.push(`Allowed tools: ${agent.allowed_tools.join(", ") || "none"}`);
  constraints.push(`Assignee: ${agent.id}`);
  constraints.push("Prefer matching resource-center skills over manual workspace file generation when a skill can complete the task.");
  if (todo.serial_only) {
    constraints.push("Execution mode constraint: serial_only (downgraded from wave)");
  }

  if (waveContext) {
    constraints.push(`SCOPE BOUNDARY: ${waveContext.my_scope_boundary}`);
    for (const excluded of waveContext.excluded_scopes) {
      constraints.push(`DO NOT cover: ${excluded}`);
    }
  }

  const briefRetryAnalysis = retryAnalysis
    ? {
        failure_diagnosis: retryAnalysis.failure_diagnosis,
        improvement_directives: retryAnalysis.improvement_directives,
        criterion_fixes: retryAnalysis.criterion_fixes,
        directive_text: retryAnalysis.directive_text,
        previous_review_judgments: todo.last_review_judgments,
      }
    : undefined;

  const resourceSkills = relevantSkills.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    // On retries keep a short guide excerpt so the subagent still knows which skill to call
    // and when it is mandatory. The full guide is truncated to save tokens; the retry_analysis
    // directive carries the specific improvement instructions.
    guide_content: item.guideContent
      ? (isRetry ? item.guideContent.slice(0, 400) : toSkillGuideExcerpt(item.guideContent))
      : undefined,
    runtime_profile_id: item.runtimeProfileId,
    output_description: item.outputDescription,
  }));

  return {
    run_id: state.run_id,
    todo_id: todo.id,
    goal: state.goal,
    todo_title: todo.title,
    todo_description: todo.description,
    acceptance_criteria: [...todo.acceptance_criteria],
    input_refs: [...todo.input_refs],
    artifact_summaries: artifactSummaries,
    constraints,
    expected_output_schema: agent.output_schema_description,
    resource_center: {
      skills: resourceSkills,
    },
    nesting_depth: 0,
    autonomy_level: todo.autonomy_override ?? agent.autonomy_level,
    workspace_file_ids: resolveReadableWorkspaceFiles(state, todo),
    resolved_tools: resolveToolsForSubagent(agent, todo, relevantSkills),
    recovery_context: {
      retry_count: todo.retry_count ?? 0,
      reroute_count: todo.reroute_count ?? 0,
      last_failure_reason: todo.last_failure_reason,
      last_missing_criteria: [...(todo.last_missing_criteria ?? [])],
      guidance_notes: (todo.notes ?? [])
        .filter((note) => note.startsWith("recovery_feedback:") || note.startsWith("recovery_note:"))
        .slice(-6),
      forced_target_agent_id: todo.forced_target_agent_id,
    },
    wave_context: waveContext,
    retry_analysis: briefRetryAnalysis,
  };
}
