import { addExecutionLog, type RunState, type TodoItem } from "../supervisor-runtime-state";
import type { MemoryState } from "../memory-state";
import { selectReviewMemories } from "../memory-state";
import type { TodoExecutionContext } from "./types";
import { compactExecutionContext } from "./context-compactor";
import { readWorkspaceFileContent } from "./workspace-files";
import { selectMetaAgentSkillResources } from "../skill-resource-center";

function toSkillGuideExcerpt(value?: string) {
  const text = value?.trim();
  if (!text) return undefined;
  return text.slice(0, 1200);
}

function pickInputArtifacts(state: RunState, todo: TodoItem) {
  // Primary: resolve via depends_on — this reflects the actual runtime data flow.
  // Each dependency todo may produce multiple artifacts over retries; keep only the
  // latest one per dependency todo (last entry in insertion order = most recent).
  const depSet = new Set(todo.depends_on);
  if (depSet.size > 0) {
    const latestByDep = new Map<string, (typeof state.artifacts)[0]>();
    for (const artifact of state.artifacts) {
      if (depSet.has(artifact.related_todo)) {
        latestByDep.set(artifact.related_todo, artifact);
      }
    }
    if (latestByDep.size > 0) {
      return [...latestByDep.values()];
    }
  }

  // Fallback: use explicit input_refs only when there are no depends_on artifacts.
  // input_refs are written by the LLM planner and may point to stale or incorrectly
  // guessed paths — do not let them override the authoritative depends_on chain.
  const refs = new Set(todo.input_refs);
  if (refs.size > 0) {
    const byRef = state.artifacts.filter(
      (artifact) => refs.has(artifact.id) || refs.has(artifact.path),
    );
    if (byRef.length > 0) return byRef;
  }

  return [];
}

function shouldReadWorkspaceFull(todo: TodoItem) {
  return todo.capability_type === "analysis" ||
    todo.capability_type === "merge" ||
    todo.capability_type === "verification" ||
    todo.capability_type === "writing";
}

function logWorkspaceReadback(
  state: RunState,
  todo: TodoItem,
  artifactId: string,
  workspaceFileId: string,
  readMode: "workspace_summary" | "workspace_full",
) {
  addExecutionLog(state, {
    timestamp: new Date().toISOString(),
    todo_id: todo.id,
    actor: "context_builder",
    action: "workspace_readback",
    message: JSON.stringify({
      artifact_id: artifactId,
      workspace_file_id: workspaceFileId,
      read_mode: readMode,
    }),
  });
}

/**
 * Build a local execution context for a single todo.
 * This context is intentionally compact instead of dumping full run history.
 * On retries the context is further reduced to avoid re-feeding the same large
 * skill guides and artifacts that didn't help on the previous attempt.
 */
export function buildTodoExecutionContext(
  state: RunState,
  todo: TodoItem,
  options?: { memoryState?: MemoryState },
): TodoExecutionContext {
  const isRetry = (todo.retry_count ?? 0) > 0 || (todo.reroute_count ?? 0) > 0;

  const recoveryQueryParts = [
    todo.last_failure_reason ?? "",
    ...(todo.last_missing_criteria ?? []),
    ...((todo.notes ?? [])
      .filter((note) => note.startsWith("recovery_feedback:") || note.startsWith("recovery_note:"))
      .slice(-4)),
  ];
  // On retries narrow skill selection to missing-criteria terms only and halve the limit.
  const skillQuery = isRetry
    ? [...(todo.last_missing_criteria ?? []), todo.last_failure_reason ?? "", todo.title].filter(Boolean).join("\n")
    : [state.goal, todo.capability_type, todo.title, todo.description, ...todo.acceptance_criteria, ...recoveryQueryParts].filter(Boolean).join("\n");
  const skillLimit = isRetry ? 4 : 8;
  const relevantSkills = selectMetaAgentSkillResources(skillQuery, skillLimit);
  const selectedArtifacts = pickInputArtifacts(state, todo);
  const needsFullRead = shouldReadWorkspaceFull(todo);
  let fullReadCount = 0;
  let fullReadChars = 0;
  const inputArtifacts = selectedArtifacts.map((artifact) => {
    if (artifact.storage_mode === "inline") {
      return {
        id: artifact.id,
        path: artifact.path,
        type: artifact.type,
        summary: artifact.summary,
        storage_mode: "inline" as const,
        workspace_file_id: artifact.workspace_file_id,
        inline_preview: artifact.inline_preview,
        kind: artifact.kind,
        content: artifact.inline_preview ?? artifact.summary,
        read_mode: "inline_preview" as const,
      };
    }

    let content: string | undefined;
    let readMode: "workspace_summary" | "workspace_full" = "workspace_summary";
    if (
      artifact.workspace_file_id &&
      needsFullRead &&
      fullReadCount < 2 &&
      fullReadChars < 4500
    ) {
      const fullContent = readWorkspaceFileContent(state, artifact.workspace_file_id, 2200);
      if (fullContent) {
        content = fullContent;
        readMode = "workspace_full";
        fullReadCount += 1;
        fullReadChars += fullContent.length;
      }
    }

    if (artifact.workspace_file_id) {
      logWorkspaceReadback(state, todo, artifact.id, artifact.workspace_file_id, readMode);
    }

    return {
      id: artifact.id,
      path: artifact.path,
      type: artifact.type,
      summary: artifact.summary,
      storage_mode: "workspace" as const,
      workspace_file_id: artifact.workspace_file_id,
      inline_preview: artifact.inline_preview,
      kind: artifact.kind,
      content,
      read_mode: readMode,
    };
  });

  const completedTodos = state.todos
    .filter((item) => item.status === "done")
    .slice(-5)
    .map((item) => ({ id: item.id, title: item.title }));

  const recentLogs = state.execution_log
    .slice(-5)
    .map((entry) => ({
      todo_id: entry.todo_id,
      action: entry.action,
      message: entry.message,
    }));

  const openIssues = state.issues
    .filter((issue) => issue.status === "open")
    .slice(-4)
    .map((issue) => ({
      id: issue.id,
      todo_id: issue.todo_id,
      message: issue.message,
    }));

  const guidanceNotes = [
    ...(todo.notes ?? []).filter((note) =>
      note.startsWith("recovery_feedback:") ||
      note.startsWith("recovery_note:") ||
      note.startsWith("split_reason:") ||
      note.startsWith("revise_reason:"),
    ),
  ].slice(-6);

  const reviewMemoryHints = options?.memoryState
    ? selectReviewMemories(options.memoryState, todo, 2).map((memory) => ({
        reason: memory.reason,
        weak_criteria_patterns: memory.weak_criteria_patterns,
        frequent_missing_criteria: memory.frequent_missing_criteria,
      }))
    : [];

  const context: TodoExecutionContext = {
    goal: state.goal,
    run_id: state.run_id,
    current_todo: {
      id: todo.id,
      title: todo.title,
      description: todo.description,
      acceptance_criteria: todo.acceptance_criteria,
    },
    input_artifacts: inputArtifacts,
    history_summary: {
      completed_todos: completedTodos,
      recent_logs: recentLogs,
      open_issues: openIssues,
    },
    memory_hints: {
      review: reviewMemoryHints,
    },
    recovery_context: {
      retry_count: todo.retry_count ?? 0,
      reroute_count: todo.reroute_count ?? 0,
      last_failure_reason: todo.last_failure_reason,
      last_review_status: todo.review_result,
      last_missing_criteria: [...(todo.last_missing_criteria ?? [])],
      guidance_notes: guidanceNotes,
      last_recovery_action: todo.last_recovery_action,
    },
    resource_center: {
      skills: relevantSkills.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        // On retries skip guide_content — the agent already had it on the first attempt.
        // Only the description and output_description are needed to re-select the right skill.
        guide_content: isRetry ? undefined : toSkillGuideExcerpt(item.guideContent),
        output_description: item.outputDescription,
      })),
    },
  };

  // Retries get a tighter char budget: the retry_analysis directive already carries the
  // actionable improvement instructions, so the surrounding context can be leaner.
  const compactBudget = isRetry ? 3500 : 6000;
  const compacted = compactExecutionContext(context, compactBudget);
  if (JSON.stringify(compacted).length < JSON.stringify(context).length) {
    addExecutionLog(state, {
      timestamp: new Date().toISOString(),
      todo_id: todo.id,
      actor: "context_builder",
      action: "context_compacted",
      message: JSON.stringify({
        before_chars: JSON.stringify(context).length,
        after_chars: JSON.stringify(compacted).length,
      }),
    });
  }
  return compacted;
}
