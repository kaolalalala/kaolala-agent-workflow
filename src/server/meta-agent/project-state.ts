import type {
  RunState,
  TodoCapabilityType,
  WorkspaceFileKind,
  WorkspaceFileRecord,
} from "./supervisor-runtime-state";
import type { MetaAgentResult } from "./types";
import {
  clampConfidence,
  computeTextRelevance,
  nowIsoSafe,
  takeRecent,
  uniqueStrings,
} from "./long-term-state-utils";

export interface ProjectRunSummary {
  source_run_id: string;
  goal: string;
  terminal_status: MetaAgentResult["status"];
  todo_count: number;
  done_todo_count: number;
  wave_count: number;
  recovery_count: number;
  issue_types: string[];
  major_artifacts: Array<{
    related_todo: string;
    kind?: WorkspaceFileKind;
    summary: string;
  }>;
  final_score?: number;
  created_at: string;
}

export interface ReusableWorkspaceRef {
  ref_id: string;
  source_run_id: string;
  workspace_file_id: string;
  path: string;
  kind: WorkspaceFileKind;
  related_todo: string;
  producer: string;
  summary: string;
  topic_hint: string;
  scope: "project";
  retention: "reusable" | "final";
  confidence: number;
  created_at: string;
}

export interface FailurePattern {
  pattern_id: string;
  type: string;
  signal: string;
  count: number;
  recent_run_ids: string[];
  confidence: number;
  updated_at: string;
}

export interface TodoSkeletonTemplate {
  template_id: string;
  source_run_id: string;
  goal_hint: string;
  todo_titles: string[];
  capability_flow: TodoCapabilityType[];
  dependency_edges: Array<{ from: string; to: string }>;
  confidence: number;
  usage_count: number;
  updated_at: string;
}

export interface SourceProfile {
  source_key: string;
  success_count: number;
  failure_count: number;
  status: "stable" | "watch" | "unstable";
  notes: string[];
  updated_at: string;
}

export interface ProjectState {
  project_id: string;
  long_term_goal?: string;
  run_summaries: ProjectRunSummary[];
  reusable_workspace_refs: ReusableWorkspaceRef[];
  recurring_failure_patterns: FailurePattern[];
  successful_todo_skeletons: TodoSkeletonTemplate[];
  stable_source_profiles: SourceProfile[];
  project_notes?: string[];
  updated_at: string;
}

function relatedTodoStatus(state: RunState, todoId: string) {
  return state.todos.find((todo) => todo.id === todoId)?.status;
}

function relatedTodoReview(state: RunState, todoId: string) {
  return state.todos.find((todo) => todo.id === todoId)?.review_result;
}

function shouldPromoteWorkspaceFile(state: RunState, file: WorkspaceFileRecord) {
  const todoStatus = relatedTodoStatus(state, file.related_todo);
  const reviewResult = relatedTodoReview(state, file.related_todo);

  if (file.kind === "final_output") {
    return { promote: true, retention: "final" as const, confidence: 0.9 };
  }
  if (file.kind === "intermediate_summary" && todoStatus === "done") {
    return { promote: true, retention: "reusable" as const, confidence: 0.75 };
  }
  if (file.kind === "research_notes" && todoStatus === "done" && reviewResult === "pass") {
    return { promote: true, retention: "reusable" as const, confidence: 0.68 };
  }
  return { promote: false, retention: "reusable" as const, confidence: 0.4 };
}

function createRunSummary(state: RunState, result: MetaAgentResult): ProjectRunSummary {
  const recoveryCount = state.todos.reduce(
    (sum, todo) => sum + Number(todo.recovery_history?.length ?? 0),
    0,
  );
  return {
    source_run_id: state.run_id,
    goal: state.goal,
    terminal_status: result.status,
    todo_count: state.todos.length,
    done_todo_count: state.todos.filter((todo) => todo.status === "done").length,
    wave_count: state.wave_count,
    recovery_count: recoveryCount,
    issue_types: uniqueStrings(state.issues.map((issue) => issue.type)),
    major_artifacts: state.artifacts.slice(-5).map((artifact) => ({
      related_todo: artifact.related_todo,
      kind: artifact.kind,
      summary: artifact.summary,
    })),
    final_score: result.finalScore,
    created_at: nowIsoSafe(),
  };
}

function extractReusableWorkspaceRefs(state: RunState) {
  return state.workspace_files
    .map((file) => {
      const promotion = shouldPromoteWorkspaceFile(state, file);
      if (!promotion.promote) return null;
      return {
        ref_id: `${state.run_id}:${file.file_id}`,
        source_run_id: state.run_id,
        workspace_file_id: file.file_id,
        path: file.path,
        kind: file.kind,
        related_todo: file.related_todo,
        producer: file.producer,
        summary: file.content_summary,
        topic_hint: state.goal.slice(0, 220),
        scope: "project" as const,
        retention: promotion.retention,
        confidence: promotion.confidence,
        created_at: file.created_at,
      };
    })
    .filter((item): item is ReusableWorkspaceRef => item !== null);
}

function extractFailurePatternCandidates(state: RunState) {
  return state.issues
    .filter((issue) => issue.status === "open")
    .map((issue) => ({
      type: issue.type,
      signal: issue.message.slice(0, 180),
    }));
}

function extractSuccessfulSkeletonCandidate(state: RunState, result: MetaAgentResult) {
  const doneRatio =
    state.todos.length === 0 ? 0 : state.todos.filter((todo) => todo.status === "done").length / state.todos.length;
  if (result.status !== "success" || doneRatio < 0.6 || Number(result.finalScore ?? 0) < 0.55) {
    return null;
  }

  return {
    template_id: `skeleton:${state.run_id}`,
    source_run_id: state.run_id,
    goal_hint: state.goal.slice(0, 220),
    todo_titles: state.todos.map((todo) => todo.title),
    capability_flow: state.todos.map((todo) => todo.capability_type),
    dependency_edges: state.todos.flatMap((todo) =>
      todo.depends_on.map((depId) => ({
        from: depId,
        to: todo.id,
      })),
    ),
    confidence: clampConfidence(Number(result.finalScore ?? doneRatio), 0.65),
    usage_count: 1,
    updated_at: nowIsoSafe(),
  } satisfies TodoSkeletonTemplate;
}

function extractSourceProfileCandidates(state: RunState) {
  return state.workspace_files.map((file) => {
    const todoStatus = relatedTodoStatus(state, file.related_todo);
    const success = todoStatus === "done";
    return {
      source_key: `${file.producer}:${file.kind}`,
      success_count: success ? 1 : 0,
      failure_count: success ? 0 : 1,
      notes: [`related_todo=${file.related_todo}`],
    };
  });
}

export function createProjectState(projectId: string, longTermGoal?: string): ProjectState {
  return {
    project_id: projectId,
    long_term_goal: longTermGoal,
    run_summaries: [],
    reusable_workspace_refs: [],
    recurring_failure_patterns: [],
    successful_todo_skeletons: [],
    stable_source_profiles: [],
    project_notes: [],
    updated_at: nowIsoSafe(),
  };
}

export function summarizeRunForProjectState(state: RunState, result: MetaAgentResult) {
  return createRunSummary(state, result);
}

export function updateProjectStateFromRun(
  current: ProjectState,
  state: RunState,
  result: MetaAgentResult,
): ProjectState {
  const next: ProjectState = {
    ...current,
    long_term_goal: current.long_term_goal ?? state.goal,
    run_summaries: [...current.run_summaries],
    reusable_workspace_refs: [...current.reusable_workspace_refs],
    recurring_failure_patterns: [...current.recurring_failure_patterns],
    successful_todo_skeletons: [...current.successful_todo_skeletons],
    stable_source_profiles: [...current.stable_source_profiles],
    project_notes: [...(current.project_notes ?? [])],
    updated_at: nowIsoSafe(),
  };

  next.run_summaries.push(createRunSummary(state, result));
  next.run_summaries = takeRecent(next.run_summaries, 30);

  for (const ref of extractReusableWorkspaceRefs(state)) {
    const existingIndex = next.reusable_workspace_refs.findIndex(
      (item) => item.path === ref.path || item.workspace_file_id === ref.workspace_file_id,
    );
    if (existingIndex >= 0) {
      next.reusable_workspace_refs[existingIndex] = {
        ...next.reusable_workspace_refs[existingIndex],
        summary: ref.summary,
        retention: ref.retention,
        confidence: Math.max(next.reusable_workspace_refs[existingIndex].confidence, ref.confidence),
        created_at: ref.created_at,
      };
    } else {
      next.reusable_workspace_refs.push(ref);
    }
  }
  next.reusable_workspace_refs = takeRecent(next.reusable_workspace_refs, 24);

  for (const candidate of extractFailurePatternCandidates(state)) {
    const key = `${candidate.type}:${candidate.signal}`;
    const existing = next.recurring_failure_patterns.find(
      (item) => `${item.type}:${item.signal}` === key,
    );
    if (existing) {
      existing.count += 1;
      existing.confidence = clampConfidence(existing.confidence + 0.08, existing.confidence);
      existing.recent_run_ids = uniqueStrings([...existing.recent_run_ids, state.run_id]).slice(-5);
      existing.updated_at = nowIsoSafe();
    } else {
      next.recurring_failure_patterns.push({
        pattern_id: `fp:${candidate.type}:${next.recurring_failure_patterns.length + 1}`,
        type: candidate.type,
        signal: candidate.signal,
        count: 1,
        recent_run_ids: [state.run_id],
        confidence: 0.55,
        updated_at: nowIsoSafe(),
      });
    }
  }
  next.recurring_failure_patterns = takeRecent(next.recurring_failure_patterns, 20);

  const skeleton = extractSuccessfulSkeletonCandidate(state, result);
  if (skeleton) {
    const key = `${skeleton.todo_titles.join(" > ")}|${skeleton.capability_flow.join(">")}`;
    const existing = next.successful_todo_skeletons.find(
      (item) => `${item.todo_titles.join(" > ")}|${item.capability_flow.join(">")}` === key,
    );
    if (existing) {
      existing.usage_count += 1;
      existing.confidence = clampConfidence((existing.confidence + skeleton.confidence) / 2, existing.confidence);
      existing.updated_at = nowIsoSafe();
      existing.source_run_id = skeleton.source_run_id;
      existing.goal_hint = skeleton.goal_hint;
    } else {
      next.successful_todo_skeletons.push(skeleton);
    }
  }
  next.successful_todo_skeletons = takeRecent(next.successful_todo_skeletons, 12);

  for (const candidate of extractSourceProfileCandidates(state)) {
    const existing = next.stable_source_profiles.find((item) => item.source_key === candidate.source_key);
    if (existing) {
      existing.success_count += candidate.success_count;
      existing.failure_count += candidate.failure_count;
      existing.status =
        existing.failure_count > existing.success_count
          ? "unstable"
          : existing.success_count >= existing.failure_count + 1
            ? "stable"
            : "watch";
      existing.notes = takeRecent(uniqueStrings([...existing.notes, ...candidate.notes]), 6);
      existing.updated_at = nowIsoSafe();
    } else {
      const status =
        candidate.failure_count > candidate.success_count
          ? "unstable"
          : candidate.success_count > 0
            ? "stable"
            : "watch";
      next.stable_source_profiles.push({
        source_key: candidate.source_key,
        success_count: candidate.success_count,
        failure_count: candidate.failure_count,
        status,
        notes: candidate.notes,
        updated_at: nowIsoSafe(),
      });
    }
  }
  next.stable_source_profiles = takeRecent(next.stable_source_profiles, 20);

  return next;
}

export function selectRelevantReusableWorkspaceRefs(
  projectState: ProjectState,
  goal: string,
  limit = 3,
) {
  const ranked = projectState.reusable_workspace_refs
    .map((item) => ({
      item,
      score: computeTextRelevance(goal, `${item.topic_hint} ${item.summary} ${item.kind}`) + item.confidence * 0.2,
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));

  for (const entry of ranked) {
    entry.item.confidence = clampConfidence(entry.item.confidence + 0.01, entry.item.confidence);
  }

  return ranked.map((entry) => entry.item);
}

export function selectRelevantTodoSkeletons(
  projectState: ProjectState,
  goal: string,
  limit = 2,
) {
  const ranked = projectState.successful_todo_skeletons
    .map((item) => ({
      item,
      score:
        computeTextRelevance(goal, `${item.goal_hint} ${item.todo_titles.join(" ")} ${item.capability_flow.join(" ")}`) +
        item.confidence * 0.2,
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));

  for (const entry of ranked) {
    entry.item.usage_count += 1;
    entry.item.updated_at = nowIsoSafe();
  }

  return ranked.map((entry) => entry.item);
}

export function selectRelevantFailurePatterns(
  projectState: ProjectState,
  goal: string,
  limit = 3,
) {
  return projectState.recurring_failure_patterns
    .map((item) => ({
      item,
      score: computeTextRelevance(goal, `${item.type} ${item.signal}`) + item.confidence * 0.1,
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.item);
}
