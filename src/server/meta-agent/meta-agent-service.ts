import { makeId, nowIso } from "@/lib/utils";
import {
  coldStartTrain,
  getBanditStats,
  resetBandit,
} from "./bandit";
import { callLLMWithUsage } from "./llm-helper";
import {
  addExecutionLog,
  addIssue,
  createRunState,
  type RunState,
} from "./supervisor-runtime-state";
import {
  loadMemoryState,
  loadProjectState,
  saveMemoryState,
  saveProjectState,
} from "./project-memory-store";
import {
  selectRelevantFailurePatterns,
  selectRelevantReusableWorkspaceRefs,
  selectRelevantTodoSkeletons,
  updateProjectStateFromRun,
} from "./project-state";
import {
  selectPlannerMemories,
  updateMemoryStateFromRun,
} from "./memory-state";
import { normalizeProjectId } from "./long-term-state-utils";
import { sanitizeModelText } from "./text-cleaner";
import { selectMetaAgentSkillResources } from "./skill-resource-center";
import {
  runTodoDrivenDemo,
  runTodoDrivenOrchestrator,
  singleLlmTodoExecutor,
} from "./todo-driven";
import {
  listMetaAgentSessions,
  loadMetaAgentSession,
  removeMetaAgentSession,
  saveMetaAgentSession,
  type PersistedMetaAgentSession,
} from "./session-store";
import { getPendingInputInfo, isAwaitingInput, waitForInput } from "./interrupt-gate";
import type { TodoPlanningContext } from "./todo-driven/types";
import type {
  MetaAgentGoal,
  MetaAgentResult,
  MetaAgentStep,
} from "./types";

interface ActiveSession {
  result: MetaAgentResult | null;
  steps: MetaAgentStep[];
  iterations: MetaAgentStep[];
  status: "running" | "done" | "error";
  currentPhase?: string;
  currentStep?: number;
  currentIteration?: number;
  errorMessage?: string;
  goal: string;
  startedAt: string;
  projectId: string;
  runConfig: {
    projectId: string;
    maxPlanningRounds: number;
    maxStepLimit: number;
    qualityThreshold: number;
    workflowTemplateId?: string;
  };
  supervisorRunState?: RunState;
  planningContextSummary?: PlanningContextSummary;
  memoryWritebackSummary?: MemoryWritebackSummary;
  controlPlaneSummary?: ControlPlaneSummary;
  checkpoints?: SessionCheckpoint[];
  replayCandidates?: ReplayCandidate[];
  pendingInput?: PendingInputState;
}

const activeSessions = new Map<string, ActiveSession>();

interface PlanningContextSummary {
  projectId: string;
  hints: string[];
  inventory: {
    runSummaryCount: number;
    reusableRefCount: number;
    failurePatternCount: number;
    skeletonCount: number;
    plannerMemoryCount: number;
    routingMemoryCount: number;
    reviewMemoryCount: number;
    recoveryMemoryCount: number;
    stableSourceProfileCount: number;
  };
  selectedContext: {
    successfulTodoSkeletons: Array<{
      goalHint: string;
      capabilityFlow: string[];
      todoTitles: string[];
    }>;
    reusableWorkspaceRefs: Array<{
      kind: string;
      summary: string;
      topicHint: string;
    }>;
    plannerMemories: Array<{
      goalPattern: string;
      recommendedCapabilityFlow: string[];
      notes: string[];
    }>;
    recurringFailurePatterns: Array<{
      type: string;
      signal: string;
    }>;
  };
  memorySignals: {
    routingMemories: Array<{
      capabilityType: string;
      preferredMode: string;
      preferredAgentId?: string;
      reason: string;
    }>;
    reviewMemories: Array<{
      capabilityType?: string;
      frequentMissingCriteria: string[];
      reason: string;
    }>;
    recoveryMemories: Array<{
      capabilityType?: string;
      preferredAction: string;
      preferredTargetAgentId?: string;
      triggerPattern: string;
      outcome: string;
    }>;
  };
}

interface MemoryWritebackSummary {
  projectId: string;
  runSummaryCount: number;
  reusableRefCount: number;
  failurePatternCount: number;
  skeletonCount: number;
  plannerMemoryCount: number;
  routingMemoryCount: number;
  reviewMemoryCount: number;
  recoveryMemoryCount: number;
  stableSourceProfileCount: number;
  latestRunSummary?: {
    sourceRunId: string;
    terminalStatus: string;
    todoCount: number;
    doneTodoCount: number;
    waveCount: number;
    recoveryCount: number;
    finalScore?: number;
    issueTypes: string[];
    majorArtifacts: Array<{
      relatedTodo: string;
      kind?: string;
      summary: string;
    }>;
  };
}

interface SessionCheckpoint {
  checkpointId: string;
  step: number;
  phase: string;
  createdAt: string;
  runStatus: string;
  currentTodoId: string | null;
  currentWaveId: string | null;
  owner: string;
  summary: {
    todoCount: number;
    doneTodoCount: number;
    issueCount: number;
    artifactCount: number;
    workspaceFileCount: number;
    totalTokens: number;
    llmCalls: number;
    replans: number;
  };
  snapshot: {
    runStatus: string;
    currentTodoId: string | null;
    currentWaveId: string | null;
    todos: Array<{
      id: string;
      title: string;
      status: string;
      assignee: string;
      delegationStatus: string;
      retryCount: number;
      rerouteCount: number;
      reviewResult?: string;
    }>;
    issues: Array<{
      id: string;
      type: string;
      status: string;
      todoId: string;
      message: string;
    }>;
    artifacts: Array<{
      id: string;
      type: string;
      summary: string;
      relatedTodo: string;
      producer: string;
      path: string;
    }>;
    workspaceFiles: Array<{
      fileId: string;
      path: string;
      kind: string;
      relatedTodo: string;
      producer: string;
      contentSummary: string;
      scope?: string;
      retention?: string;
    }>;
  };
}

interface ReplayCandidate {
  replayId: string;
  checkpointId: string;
  step: number;
  label: string;
  scope: "full" | "partial";
  preservedArtifactCount: number;
  incompleteTodoIds: string[];
}

interface PendingInputState {
  awaiting: boolean;
  prompt: string;
  requestedAt: string;
  timeoutAt: string;
  inputToken?: string;
}

interface ControlPlaneSummary {
  currentState: string;
  owner: string;
  ownerReason: string;
  allowedActions: string[];
  budget: {
    maxSteps: number;
    usedSteps: number;
    remainingSteps: number;
    totalTokens: number;
    llmCalls: number;
    replans: number;
  };
  recoveryPolicy: {
    maxRetryPerTodo: number;
    maxReroutePerTodo: number;
    maxRecoveryHistoryPerTodo: number;
    reviewFailRetryBudget: number;
  };
  approvalMode: {
    mode: "none" | "plan_review_pending";
    summary: string;
  };
  checkpointCount: number;
  replayCandidateCount: number;
  currentTodoId: string | null;
  currentWaveId: string | null;
}

function buildProjectPlanningContext(
  goal: string,
  projectId: string,
  projectState: ReturnType<typeof loadProjectState>,
  memoryState: ReturnType<typeof loadMemoryState>,
): TodoPlanningContext {
  const skeletons = selectRelevantTodoSkeletons(projectState, goal, 2);
  const reusableRefs = selectRelevantReusableWorkspaceRefs(projectState, goal, 3);
  const plannerMemories = selectPlannerMemories(memoryState, goal, 3);
  const failurePatterns = selectRelevantFailurePatterns(projectState, goal, 3);

  const hints: string[] = [];
  if (skeletons.length > 0) {
    hints.push(
      `Project skeleton hints: ${skeletons.map((item) => item.capability_flow.join(" -> ")).join(" || ")}`,
    );
  }
  if (reusableRefs.length > 0) {
    hints.push(
      `Reusable project refs: ${reusableRefs.map((item) => `${item.kind}:${item.summary}`).join(" || ")}`,
    );
  }
  if (plannerMemories.length > 0) {
    hints.push(
      `Planner memories: ${plannerMemories.map((item) => item.notes.join(" | ")).join(" || ")}`,
    );
  }
  if (failurePatterns.length > 0) {
    hints.push(
      `Avoid repeated failure modes: ${failurePatterns.map((item) => `${item.type}:${item.signal}`).join(" || ")}`,
    );
  }
  const skillResources = selectMetaAgentSkillResources(goal, 8);
  if (skillResources.length > 0) {
    hints.push(
      `Resource center skills available: ${skillResources.map((item) => item.name).join(", ")}`,
    );
  }

  return {
    hints,
    resource_center: {
      skills: skillResources.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        guide_content: item.guideContent,
        planning_hint: item.planningHint,
        runtime_profile_id: item.runtimeProfileId,
        output_description: item.outputDescription,
      })),
    },
    project_context: {
      project_id: projectId,
      successful_todo_skeletons: skeletons.map((item) => ({
        goal_hint: item.goal_hint,
        todo_titles: item.todo_titles,
        capability_flow: item.capability_flow,
      })),
      reusable_workspace_refs: reusableRefs.map((item) => ({
        kind: item.kind,
        summary: item.summary,
        topic_hint: item.topic_hint,
      })),
      planner_memories: plannerMemories.map((item) => ({
        goal_pattern: item.goal_pattern,
        recommended_capability_flow: item.recommended_capability_flow,
        suggested_acceptance_patterns: item.suggested_acceptance_patterns,
        notes: item.notes,
      })),
      recurring_failure_patterns: failurePatterns.map((item) => ({
        type: item.type,
        signal: item.signal,
      })),
    },
  };
}

function buildPlanningContextSummary(
  goal: string,
  projectId: string,
  projectState: ReturnType<typeof loadProjectState>,
  memoryState: ReturnType<typeof loadMemoryState>,
): PlanningContextSummary {
  const planningContext = buildProjectPlanningContext(goal, projectId, projectState, memoryState);
  const planningHints = planningContext.hints ?? [];
  const projectContext = planningContext.project_context;
  const successfulTodoSkeletons = projectContext?.successful_todo_skeletons ?? [];
  const reusableWorkspaceRefs = projectContext?.reusable_workspace_refs ?? [];
  const plannerMemories = projectContext?.planner_memories ?? [];
  const recurringFailurePatterns = projectContext?.recurring_failure_patterns ?? [];

  return {
    projectId,
    hints: planningHints.slice(0, 6),
    inventory: {
      runSummaryCount: projectState.run_summaries.length,
      reusableRefCount: projectState.reusable_workspace_refs.length,
      failurePatternCount: projectState.recurring_failure_patterns.length,
      skeletonCount: projectState.successful_todo_skeletons.length,
      plannerMemoryCount: memoryState.planner_memories.length,
      routingMemoryCount: memoryState.routing_memories.length,
      reviewMemoryCount: memoryState.review_memories.length,
      recoveryMemoryCount: memoryState.recovery_memories.length,
      stableSourceProfileCount: projectState.stable_source_profiles.length,
    },
    selectedContext: {
      successfulTodoSkeletons: successfulTodoSkeletons.map((item) => ({
        goalHint: item.goal_hint,
        capabilityFlow: item.capability_flow,
        todoTitles: item.todo_titles,
      })),
      reusableWorkspaceRefs: reusableWorkspaceRefs.map((item) => ({
        kind: item.kind,
        summary: item.summary,
        topicHint: item.topic_hint,
      })),
      plannerMemories: plannerMemories.map((item) => ({
        goalPattern: item.goal_pattern,
        recommendedCapabilityFlow: item.recommended_capability_flow,
        notes: item.notes,
      })),
      recurringFailurePatterns: recurringFailurePatterns.map((item) => ({
        type: item.type,
        signal: item.signal,
      })),
    },
    memorySignals: {
      routingMemories: memoryState.routing_memories.slice(-3).reverse().map((item) => ({
        capabilityType: item.capability_type,
        preferredMode: item.preferred_mode,
        preferredAgentId: item.preferred_agent_id,
        reason: item.reason,
      })),
      reviewMemories: memoryState.review_memories.slice(-3).reverse().map((item) => ({
        capabilityType: item.capability_type,
        frequentMissingCriteria: item.frequent_missing_criteria.slice(0, 3),
        reason: item.reason,
      })),
      recoveryMemories: memoryState.recovery_memories.slice(-3).reverse().map((item) => ({
        capabilityType: item.capability_type,
        preferredAction: item.preferred_action,
        preferredTargetAgentId: item.preferred_target_agent_id,
        triggerPattern: item.trigger_pattern,
        outcome: item.outcome,
      })),
    },
  };
}

function buildMemoryWritebackSummary(
  projectId: string,
  projectState: ReturnType<typeof loadProjectState>,
  memoryState: ReturnType<typeof loadMemoryState>,
): MemoryWritebackSummary {
  const latestRun = projectState.run_summaries[projectState.run_summaries.length - 1];

  return {
    projectId,
    runSummaryCount: projectState.run_summaries.length,
    reusableRefCount: projectState.reusable_workspace_refs.length,
    failurePatternCount: projectState.recurring_failure_patterns.length,
    skeletonCount: projectState.successful_todo_skeletons.length,
    plannerMemoryCount: memoryState.planner_memories.length,
    routingMemoryCount: memoryState.routing_memories.length,
    reviewMemoryCount: memoryState.review_memories.length,
    recoveryMemoryCount: memoryState.recovery_memories.length,
    stableSourceProfileCount: projectState.stable_source_profiles.length,
    latestRunSummary: latestRun
      ? {
          sourceRunId: latestRun.source_run_id,
          terminalStatus: latestRun.terminal_status,
          todoCount: latestRun.todo_count,
          doneTodoCount: latestRun.done_todo_count,
          waveCount: latestRun.wave_count,
          recoveryCount: latestRun.recovery_count,
          finalScore: latestRun.final_score,
          issueTypes: [...latestRun.issue_types],
          majorArtifacts: latestRun.major_artifacts.map((artifact) => ({
            relatedTodo: artifact.related_todo,
            kind: artifact.kind,
            summary: artifact.summary,
          })),
        }
      : undefined,
  };
}

function syncPendingInputState(sessionId: string, session: ActiveSession) {
  const pendingInput = getPendingInputInfo(sessionId);
  session.pendingInput = pendingInput
    ? {
        awaiting: true,
        prompt: pendingInput.prompt,
        requestedAt: pendingInput.requestedAt,
        timeoutAt: pendingInput.timeoutAt,
        inputToken: pendingInput.token,
      }
    : undefined;

  if (pendingInput && session.status === "running") {
    session.currentPhase = "awaiting_input";
  }

  return session.pendingInput;
}

function resolveSessionOwner(sessionId: string, session: Pick<ActiveSession, "status" | "supervisorRunState" | "pendingInput">) {
  if (isAwaitingInput(sessionId)) {
    return {
      owner: "human_reviewer",
      reason: "runtime is paused until the operator confirms the initial todo plan",
    };
  }

  const state = session.supervisorRunState;
  if (!state) {
    return {
      owner: session.status === "running" ? "supervisor_controller" : "runtime_terminal",
      reason: "session has no supervisor run state yet",
    };
  }

  const currentTodo = state.current_todo_id
    ? state.todos.find((todo) => todo.id === state.current_todo_id)
    : undefined;

  if (state.current_wave_id) {
    return {
      owner: `parallel_wave:${state.current_wave_id}`,
      reason: "parallel wave runtime owns current execution window",
    };
  }

  if (currentTodo?.assignee) {
    return {
      owner: currentTodo.assignee,
      reason:
        currentTodo.capability_type === "planning" || currentTodo.capability_type === "review"
          ? "planning/review todos stay under supervisor ownership"
          : "current todo assignee owns the active execution slot",
    };
  }

  if (state.status === "idle") {
    return {
      owner: "runtime_idle",
      reason: "runtime is waiting for the next actionable todo",
    };
  }

  return {
    owner: "supervisor_controller",
    reason: "supervisor controller is responsible for next-step selection",
  };
}

function buildAllowedActions(sessionId: string, session: ActiveSession, state?: RunState) {
  if (!state) {
    return ["boot", "inspect_session"];
  }

  const currentTodo = state.current_todo_id
    ? state.todos.find((todo) => todo.id === state.current_todo_id)
    : undefined;
  const readyTodos = state.todos.filter((todo) => todo.status === "ready").length;
  const recoverableTodos = state.todos.filter(
    (todo) => (todo.status === "failed" || todo.review_result === "revise")
      && ((todo.retry_count ?? 0) < 2 || (todo.reroute_count ?? 0) < 2),
  ).length;
  const actions = new Set<string>();

  actions.add("inspect_trace");
  actions.add("inspect_issues");

  if (isAwaitingInput(sessionId)) {
    actions.add("submit_human_input");
    actions.add("confirm_initial_plan");
    actions.add("terminate_run");
    return [...actions];
  }

  if (state.current_wave_id) {
    actions.add("observe_wave");
    actions.add("review_wave_results");
    actions.add("downgrade_to_serial");
  }

  if (currentTodo) {
    if (currentTodo.status === "in_progress") {
      actions.add(currentTodo.delegation_status === "delegated" ? "await_subagent_return" : "await_executor_result");
    }
    if (currentTodo.status === "reviewing") {
      actions.add("review_current_todo");
    }
    if ((currentTodo.retry_count ?? 0) < 2) actions.add("retry_current_todo");
    if ((currentTodo.reroute_count ?? 0) < 2) actions.add("reroute_current_todo");
    actions.add("split_current_todo");
  }

  if (readyTodos > 0 && !state.current_todo_id && !state.current_wave_id) {
    actions.add("select_next_todo");
    actions.add("dispatch_ready_todo");
  }

  if (recoverableTodos > 0) {
    actions.add("recover_failed_todo");
  }

  if (state.todos.length > 0 && state.todos.every((todo) => todo.status === "done")) {
    actions.add("final_synthesis");
  }

  if (session.status !== "running") {
    actions.add("compare_checkpoints");
  }

  actions.add("terminate_run");
  return [...actions];
}

function buildCheckpointFromState(
  session: ActiveSession,
  state: RunState,
  step: number,
  phase: string,
): SessionCheckpoint {
  const sessionId = typeof state.metadata?.session_id === "string" ? state.metadata.session_id : "";
  const owner = resolveSessionOwner(sessionId, session);

  return {
    checkpointId: `cp_${state.run_id}_${step}`,
    step,
    phase,
    createdAt: nowIso(),
    runStatus: state.status,
    currentTodoId: state.current_todo_id,
    currentWaveId: state.current_wave_id ?? null,
    owner: owner.owner,
    summary: {
      todoCount: state.todos.length,
      doneTodoCount: state.todos.filter((todo) => todo.status === "done").length,
      issueCount: state.issues.length,
      artifactCount: state.artifacts.length,
      workspaceFileCount: state.workspace_files.length,
      totalTokens: Number(state.metadata.llm_total_tokens ?? 0),
      llmCalls: Number(state.metadata.llm_call_count ?? 0),
      replans: Number(state.metadata.replan_count ?? 0),
    },
    snapshot: {
      runStatus: state.status,
      currentTodoId: state.current_todo_id,
      currentWaveId: state.current_wave_id ?? null,
      todos: state.todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        status: todo.status,
        assignee: todo.assignee,
        delegationStatus: todo.delegation_status,
        retryCount: todo.retry_count,
        rerouteCount: Number(todo.reroute_count ?? 0),
        reviewResult: todo.review_result,
      })),
      issues: state.issues.map((issue) => ({
        id: issue.id,
        type: issue.type,
        status: issue.status,
        todoId: issue.todo_id,
        message: issue.message,
      })),
      artifacts: state.artifacts.slice(-10).map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        summary: artifact.summary,
        relatedTodo: artifact.related_todo,
        producer: artifact.producer,
        path: artifact.path,
      })),
      workspaceFiles: state.workspace_files.slice(-10).map((file) => ({
        fileId: file.file_id,
        path: file.path,
        kind: file.kind,
        relatedTodo: file.related_todo,
        producer: file.producer,
        contentSummary: file.content_summary,
        scope: file.scope,
        retention: file.retention,
      })),
    },
  };
}

function buildReplayCandidates(checkpoints: SessionCheckpoint[] = []): ReplayCandidate[] {
  return checkpoints.slice(-8).map((checkpoint) => ({
    replayId: `replay_${checkpoint.step}`,
    checkpointId: checkpoint.checkpointId,
    step: checkpoint.step,
    label: `Replay candidate from step ${checkpoint.step}`,
    scope: checkpoint.step === 1 ? "full" : "partial",
    preservedArtifactCount: checkpoint.summary.artifactCount,
    incompleteTodoIds: checkpoint.snapshot.todos
      .filter((todo) => todo.status !== "done")
      .map((todo) => todo.id)
      .slice(0, 8),
  }));
}

function buildControlPlaneSummary(sessionId: string, session: ActiveSession): ControlPlaneSummary {
  const state = session.supervisorRunState;
  const owner = resolveSessionOwner(sessionId, session);
  const pendingInput = session.pendingInput;
  const usedSteps = Math.max(
    0,
    session.currentStep
    ?? session.steps[session.steps.length - 1]?.step
    ?? session.iterations[session.iterations.length - 1]?.step
    ?? 0,
  );

  return {
    currentState: pendingInput?.awaiting ? "awaiting_input" : (state?.status ?? session.status),
    owner: owner.owner,
    ownerReason: owner.reason,
    allowedActions: buildAllowedActions(sessionId, session, state),
    budget: {
      maxSteps: session.runConfig.maxStepLimit,
      usedSteps,
      remainingSteps: Math.max(0, session.runConfig.maxStepLimit - usedSteps),
      totalTokens: Number(state?.metadata?.llm_total_tokens ?? session.result?.totalTokensUsed ?? 0),
      llmCalls: Number(state?.metadata?.llm_call_count ?? 0),
      replans: Number(state?.metadata?.replan_count ?? 0),
    },
    recoveryPolicy: {
      maxRetryPerTodo: 2,
      maxReroutePerTodo: 2,
      maxRecoveryHistoryPerTodo: 8,
      reviewFailRetryBudget: 0,
    },
    approvalMode: {
      mode: pendingInput?.awaiting ? "plan_review_pending" : "none",
      summary: pendingInput?.awaiting
        ? "Initial todo plan is waiting for operator confirmation before execution continues."
        : "No human approval is currently pending for this session.",
    },
    checkpointCount: session.checkpoints?.length ?? 0,
    replayCandidateCount: session.replayCandidates?.length ?? 0,
    currentTodoId: state?.current_todo_id ?? null,
    currentWaveId: state?.current_wave_id ?? null,
  };
}

function refreshSessionRuntimeDerived(sessionId: string, session: ActiveSession) {
  syncPendingInputState(sessionId, session);
  session.replayCandidates = buildReplayCandidates(session.checkpoints);
  session.controlPlaneSummary = buildControlPlaneSummary(sessionId, session);
  return session;
}

function toPersistedSession(sessionId: string, session: ActiveSession): PersistedMetaAgentSession {
  const hydrated = hydrateSession(sessionId, session);
  return {
    sessionId,
    status: hydrated.status,
    goal: hydrated.goal,
    startedAt: hydrated.startedAt,
    currentPhase: hydrated.currentPhase,
    currentStep: hydrated.currentStep,
    currentIteration: hydrated.currentIteration,
    errorMessage: hydrated.errorMessage,
    steps: hydrated.steps,
    iterations: hydrated.iterations,
    supervisorRunState: hydrated.supervisorRunState as unknown as Record<string, unknown> | undefined,
    projectId: hydrated.projectId,
    runConfig: hydrated.runConfig,
    planningContextSummary: hydrated.planningContextSummary,
    controlPlaneSummary: hydrated.controlPlaneSummary,
    checkpoints: hydrated.checkpoints,
    replayCandidates: hydrated.replayCandidates,
    memoryWritebackSummary: hydrated.memoryWritebackSummary,
    pendingInput: hydrated.pendingInput,
    result: hydrated.result,
    lastUpdatedAt:
      typeof hydrated.supervisorRunState?.metadata?.updated_at === "string"
        ? hydrated.supervisorRunState.metadata.updated_at
        : nowIso(),
  };
}

function persistSessionSnapshot(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  return saveMetaAgentSession(toPersistedSession(sessionId, session));
}

function hydrateSession(sessionId: string, session: ActiveSession) {
  if (!session.planningContextSummary) {
    const projectState = loadProjectState(session.projectId, session.goal);
    const memoryState = loadMemoryState(session.projectId);
    session.planningContextSummary = buildPlanningContextSummary(
      session.goal,
      session.projectId,
      projectState,
      memoryState,
    );
  }
  if (!session.memoryWritebackSummary && session.status !== "running") {
    const projectState = loadProjectState(session.projectId, session.goal);
    const memoryState = loadMemoryState(session.projectId);
    session.memoryWritebackSummary = buildMemoryWritebackSummary(
      session.projectId,
      projectState,
      memoryState,
    );
  }
  const hydrated = refreshSessionRuntimeDerived(sessionId, session);
  if (!hydrated.pendingInput?.awaiting && hydrated.currentPhase === "awaiting_input") {
    hydrated.currentPhase = hydrated.steps.length > 0 ? "step_running" : "bootstrapping";
  }
  return hydrated;
}

function buildFinalSummaryPrompt(result: MetaAgentResult, state: RunState) {
  const todosBrief = state.todos.slice(0, 12).map((todo) => ({
    id: todo.id,
    title: todo.title,
    status: todo.status,
    capability_type: todo.capability_type,
    review_result: todo.review_result ?? null,
  }));
  const issuesBrief = state.issues.slice(0, 8).map((issue) => ({
    type: issue.type,
    todo_id: issue.todo_id,
    message: issue.message,
    status: issue.status,
  }));
  const outputPreview = sanitizeModelText(String(result.finalOutput ?? "")).slice(0, 6000);

  return [
    "请基于以下 Agent 运行结果，输出中文总结。",
    "要求：",
    "1) 给出 3-6 条要点，先结论后细节；",
    "2) 明确是否达成目标、主要质量风险、可执行下一步；",
    "3) 不要输出 markdown 代码块，不要输出英文长段落；",
    "",
    `运行状态: ${result.status}`,
    `总耗时(ms): ${result.totalDurationMs}`,
    `总Token: ${result.totalTokensUsed}`,
    `最终得分: ${result.finalScore ?? "-"}`,
    "",
    "Todo 概览:",
    JSON.stringify(todosBrief),
    "",
    "Issues 概览:",
    JSON.stringify(issuesBrief),
    "",
    "最终输出预览:",
    outputPreview || "(无)",
  ].join("\n");
}

async function generateFinalSummary(result: MetaAgentResult, state: RunState) {
  if (!result.finalOutput || !result.finalOutput.trim()) return;
  try {
    const llm = await callLLMWithUsage([
      {
        role: "system",
        content: "你是资深 Agent 评审。请严格输出简洁中文总结。",
      },
      {
        role: "user",
        content: buildFinalSummaryPrompt(result, state),
      },
    ]);
    const summary = sanitizeModelText(llm.content.trim());
    if (summary) {
      result.finalSummary = summary;
    }

    const prompt = Number(llm.usage.prompt_tokens ?? 0);
    const completion = Number(llm.usage.completion_tokens ?? 0);
    const total = Number(llm.usage.total_tokens ?? 0);
    state.metadata.llm_prompt_tokens_total = Number(state.metadata.llm_prompt_tokens_total ?? 0) + prompt;
    state.metadata.llm_completion_tokens_total =
      Number(state.metadata.llm_completion_tokens_total ?? 0) + completion;
    state.metadata.llm_total_tokens = Number(state.metadata.llm_total_tokens ?? 0) + total;
    state.metadata.llm_call_count = Number(state.metadata.llm_call_count ?? 0) + 1;
    result.totalTokensUsed = Number(result.totalTokensUsed ?? 0) + total;

    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: "summary",
      actor: "supervisor_summarizer",
      action: "final_summary_generated",
      message: JSON.stringify({
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        usage_source: llm.usage.source ?? "unknown",
      }),
    });
  } catch (error) {
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: "summary",
      actor: "supervisor_summarizer",
      action: "final_summary_failed",
      message: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }
}

void generateFinalSummary;

function buildFinalSummaryPromptV2(result: MetaAgentResult, state: RunState) {
  const todosBrief = state.todos.slice(0, 12).map((todo) => ({
    id: todo.id,
    title: todo.title,
    status: todo.status,
    capability_type: todo.capability_type,
    review_result: todo.review_result ?? null,
  }));
  const issuesBrief = state.issues.slice(0, 8).map((issue) => ({
    type: issue.type,
    todo_id: issue.todo_id,
    message: issue.message,
    status: issue.status,
  }));

  return [
    "Please summarize this agent run in concise Chinese.",
    "Requirements:",
    "1) Give 3-6 clear points in plain text, starting with the conclusion.",
    "2) Explicitly state whether the goal was achieved, the main quality risks, and the next actionable step.",
    "3) Do not output markdown code fences or <think> tags. Avoid long English passages.",
    "",
    `Run status: ${result.status}`,
    `Total duration (ms): ${result.totalDurationMs}`,
    `Total tokens: ${result.totalTokensUsed}`,
    `Final score: ${result.finalScore ?? "-"}`,
    "",
    "Todo overview:",
    JSON.stringify(todosBrief),
    "",
    "Issues overview:",
    JSON.stringify(issuesBrief),
    "",
    "Final output preview:",
    sanitizeModelText(String(result.finalOutput ?? "")).slice(0, 6000) || "(empty)",
  ].join("\n");
}

async function generateFinalSummaryV2(result: MetaAgentResult, state: RunState) {
  if (!result.finalOutput || !result.finalOutput.trim()) return;
  try {
    const llm = await callLLMWithUsage([
      {
        role: "system",
        content: "You are a senior agent evaluator. Return concise Chinese only, with no reasoning trace or <think> tags.",
      },
      {
        role: "user",
        content: buildFinalSummaryPromptV2(result, state),
      },
    ]);
    const summary = sanitizeModelText(llm.content.trim());
    if (summary) {
      result.finalSummary = summary;
    }

    const prompt = Number(llm.usage.prompt_tokens ?? 0);
    const completion = Number(llm.usage.completion_tokens ?? 0);
    const total = Number(llm.usage.total_tokens ?? 0);
    state.metadata.llm_prompt_tokens_total = Number(state.metadata.llm_prompt_tokens_total ?? 0) + prompt;
    state.metadata.llm_completion_tokens_total =
      Number(state.metadata.llm_completion_tokens_total ?? 0) + completion;
    state.metadata.llm_total_tokens = Number(state.metadata.llm_total_tokens ?? 0) + total;
    state.metadata.llm_call_count = Number(state.metadata.llm_call_count ?? 0) + 1;
    result.totalTokensUsed = Number(result.totalTokensUsed ?? 0) + total;

    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: "summary",
      actor: "supervisor_summarizer",
      action: "final_summary_generated",
      message: JSON.stringify({
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        usage_source: llm.usage.source ?? "unknown",
        version: "v2",
      }),
    });
  } catch (error) {
    addExecutionLog(state, {
      timestamp: nowIso(),
      todo_id: "summary",
      actor: "supervisor_summarizer",
      action: "final_summary_failed",
      message: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        version: "v2",
      }),
    });
  }
}

export function getSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session) {
    return hydrateSession(sessionId, session);
  }
  const persisted = loadMetaAgentSession(sessionId);
  return persisted ? hydrateSession(sessionId, persisted as ActiveSession) : undefined;
}

export function listSessions() {
  const merged = new Map<string, {
    sessionId: string;
    status: string;
    resultStatus?: string;
    goal: string;
    startedAt: string;
    currentPhase?: string;
    currentStep?: number;
    projectId: string;
    runStatus?: string;
    todoCount: number;
    doneTodoCount: number;
    issueCount: number;
    totalTokens: number;
    durationMs?: number;
    lastUpdatedAt?: string;
  }>();

  for (const persisted of listMetaAgentSessions()) {
    const session = hydrateSession(persisted.sessionId, persisted as ActiveSession);
    const state = session.supervisorRunState;
    merged.set(persisted.sessionId, {
      sessionId: persisted.sessionId,
      status: session.status,
      resultStatus: session.result?.status,
      goal: session.goal,
      startedAt: session.startedAt,
      currentPhase: session.currentPhase,
      currentStep: session.currentStep,
      projectId: session.projectId,
      runStatus: state?.status,
      todoCount: state?.todos.length ?? 0,
      doneTodoCount: state?.todos?.filter((todo) => todo.status === "done").length ?? 0,
      issueCount: state?.issues?.length ?? 0,
      totalTokens: Number(state?.metadata?.llm_total_tokens ?? session.result?.totalTokensUsed ?? 0),
      durationMs: session.result?.totalDurationMs,
      lastUpdatedAt:
        typeof state?.metadata?.updated_at === "string"
          ? state.metadata.updated_at
          : persisted.lastUpdatedAt ?? session.startedAt,
    });
  }

  const list: Array<{
    sessionId: string;
    status: string;
    resultStatus?: string;
    goal: string;
    startedAt: string;
    currentPhase?: string;
    currentStep?: number;
    projectId: string;
    runStatus?: string;
    todoCount: number;
    doneTodoCount: number;
    issueCount: number;
    totalTokens: number;
    durationMs?: number;
    lastUpdatedAt?: string;
  }> = [];
  for (const [id, session] of activeSessions) {
    const hydrated = hydrateSession(id, session);
    const state = hydrated.supervisorRunState;
    merged.set(id, {
      sessionId: id,
      status: hydrated.status,
      resultStatus: hydrated.result?.status,
      goal: hydrated.goal,
      startedAt: hydrated.startedAt,
      currentPhase: hydrated.currentPhase,
      currentStep: hydrated.currentStep,
      projectId: hydrated.projectId,
      runStatus: state?.status,
      todoCount: state?.todos.length ?? 0,
      doneTodoCount: state?.todos?.filter((todo) => todo.status === "done").length ?? 0,
      issueCount: state?.issues?.length ?? 0,
      totalTokens: Number(state?.metadata?.llm_total_tokens ?? hydrated.result?.totalTokensUsed ?? 0),
      durationMs: hydrated.result?.totalDurationMs,
      lastUpdatedAt:
        typeof state?.metadata?.updated_at === "string"
          ? state.metadata.updated_at
          : hydrated.startedAt,
    });
  }
  list.push(...merged.values());
  return list.sort((a, b) => {
    const leftTs = Date.parse(b.lastUpdatedAt ?? b.startedAt);
    const rightTs = Date.parse(a.lastUpdatedAt ?? a.startedAt);
    return leftTs - rightTs;
  });
}

export function deleteSession(sessionId: string) {
  const active = activeSessions.get(sessionId);
  if (active?.status === "running") {
    throw new Error("Running session cannot be deleted");
  }
  if (active) {
    activeSessions.delete(sessionId);
  }
  const persisted = loadMetaAgentSession(sessionId);
  if (!persisted && !active) {
    return { deleted: false };
  }
  removeMetaAgentSession(sessionId);
  // Release any pending Human-in-the-Loop gate so the orchestrator
  // doesn't hang indefinitely after the session is cleaned up.
  Promise.all([
    import("./interrupt-gate").then(({ abortGate }) => abortGate(sessionId)),
    import("./session-event-bus").then(({ destroySessionBus }) => destroySessionBus(sessionId)),
  ]).catch(() => { /* non-critical cleanup */ });
  return { deleted: true };
}

async function runMetaAgentTodoDrivenPrimary(
  input: MetaAgentGoal,
  sessionId = makeId("meta"),
): Promise<MetaAgentResult> {
  const startedAtMs = Date.now();
  const projectId = normalizeProjectId(input.projectId);
  const projectState = loadProjectState(projectId, input.goal);
  const memoryState = loadMemoryState(projectId);
  const planningContext = buildProjectPlanningContext(input.goal, projectId, projectState, memoryState);
  const planningContextSummary = buildPlanningContextSummary(
    input.goal,
    projectId,
    projectState,
    memoryState,
  );
  const existing = activeSessions.get(sessionId);
  const startedAt = existing?.startedAt ?? nowIso();
  const supervisorRunState = existing?.supervisorRunState ?? createRunState(input.goal, { projectId });
  supervisorRunState.metadata.project_id = projectId;
  // Bind sessionId into RunState so addExecutionLog can emit SSE events without
  // needing it passed through every call site.
  supervisorRunState.metadata.session_id = sessionId;

  activeSessions.set(sessionId, {
    result: null,
    steps: existing?.steps ?? existing?.iterations ?? [],
    iterations: existing?.iterations ?? existing?.steps ?? [],
    status: "running",
    currentPhase: "bootstrapping",
    currentStep: 1,
    currentIteration: 1,
    errorMessage: undefined,
    goal: input.goal,
    startedAt,
    projectId,
    runConfig: existing?.runConfig ?? {
      projectId,
      maxPlanningRounds: Math.max(1, input.maxPlanningRounds ?? input.maxIterations ?? 3),
      maxStepLimit: Math.max(
        1,
        input.maxStepLimit ?? Math.max(12, (input.maxPlanningRounds ?? input.maxIterations ?? 3) * 4),
      ),
      qualityThreshold: input.qualityThreshold ?? 0.7,
      workflowTemplateId: input.workflowTemplateId,
    },
    supervisorRunState,
    planningContextSummary: existing?.planningContextSummary ?? planningContextSummary,
    memoryWritebackSummary: existing?.memoryWritebackSummary,
    checkpoints: existing?.checkpoints ?? [],
    replayCandidates: existing?.replayCandidates ?? [],
    controlPlaneSummary: existing?.controlPlaneSummary,
  });
  persistSessionSnapshot(sessionId);

  try {
    const orchestrated = await runTodoDrivenOrchestrator(input, {
      sessionId,
      initialState: supervisorRunState,
      planningContext,
      memoryState,
      stepExecutor: singleLlmTodoExecutor,
      planningMaxAttempts: Math.max(1, input.maxPlanningRounds ?? input.maxIterations ?? 3),
      maxSteps: Math.max(
        1,
        input.maxStepLimit ?? Math.max(12, (input.maxPlanningRounds ?? input.maxIterations ?? 3) * 4),
      ),
      idleStepLimit: 2,
      recoveryPolicy: {
        max_retry_per_todo: 2,
        max_reroute_per_todo: 2,
        max_recovery_history_per_todo: 8,
      },
      // Human-in-the-Loop: pause after planner generates initial todos,
      // emit awaiting_input SSE event so the user can confirm or modify the plan.
      onPlanReady: (todos) => {
        const todoList = todos
          .map((t, i) => `  ${i + 1}. [${t.id}] ${t.title}`)
          .join("\n");
        const prompt = `Planner generated ${todos.length} todos:\n${todoList}\n\nReply to confirm (press Enter / leave blank), or type a note to log. Execution resumes in 5 minutes if no response.`;
        return waitForInput(sessionId, prompt, "", 5 * 60 * 1000);
      },
      onProgress: (event) => {
        const session = activeSessions.get(sessionId);
        if (!session) return;

        session.currentPhase = event.phase;
        session.currentStep = Math.max(1, event.step);
        session.currentIteration = Math.max(1, event.step);
        session.supervisorRunState = event.state;

        // Emit real-time step_progress event to SSE subscribers.
        import("./session-event-bus").then(({ emitSessionEvent }) => {
          const state = event.state;
          emitSessionEvent(sessionId, {
            type: "step_progress",
            step: event.step,
            phase: event.phase,
            reflectionScore: event.stepRecord?.reflectionScore,
            reflectionVerdict: event.stepRecord?.reflectionVerdict,
            todoSummary: (state.todos ?? []).map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              retry_count: t.retry_count ?? 0,
            })),
            totalTokens: Number(state.metadata?.llm_total_tokens ?? 0),
            llmCallCount: Number(state.metadata?.llm_call_count ?? 0),
          });
        }).catch(() => { /* non-critical */ });

        const stepRecord = event.stepRecord ?? event.iteration;
        if (stepRecord) {
          const next = session.steps.filter((item) => item.step !== stepRecord.step);
          next.push(stepRecord);
          next.sort((a, b) => a.step - b.step);
          session.steps = next;
          session.iterations = next;

          const checkpoint = buildCheckpointFromState(session, event.state, stepRecord.step, event.phase);
          session.checkpoints = [
            ...(session.checkpoints ?? []).filter((item) => item.step !== stepRecord.step),
            checkpoint,
          ].sort((a, b) => a.step - b.step).slice(-18);
        }

        refreshSessionRuntimeDerived(sessionId, session);
        persistSessionSnapshot(sessionId);
      },
    });

    await generateFinalSummaryV2(orchestrated.result, orchestrated.state);
    const updatedProjectState = updateProjectStateFromRun(projectState, orchestrated.state, orchestrated.result);
    const updatedMemoryState = updateMemoryStateFromRun(memoryState, orchestrated.state, orchestrated.result);
    saveProjectState(updatedProjectState);
    saveMemoryState(updatedMemoryState);

    const session = activeSessions.get(sessionId);
    if (session) {
      session.result = orchestrated.result;
      session.steps = orchestrated.result.steps;
      session.iterations = orchestrated.result.steps;
      session.status = "done";
      session.currentPhase = undefined;
      session.currentStep = undefined;
      session.currentIteration = undefined;
      session.supervisorRunState = orchestrated.state;
      session.memoryWritebackSummary = buildMemoryWritebackSummary(
        projectId,
        updatedProjectState,
        updatedMemoryState,
      );
      refreshSessionRuntimeDerived(sessionId, session);
      persistSessionSnapshot(sessionId);
      // Notify SSE subscribers that the session has completed.
      import("./session-event-bus").then(({ emitSessionEvent }) => {
        emitSessionEvent(sessionId, { type: "session_state", status: "done" });
      }).catch(() => { /* non-critical */ });
    }

    return orchestrated.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tokenTotal = Number(activeSessions.get(sessionId)?.supervisorRunState?.metadata?.llm_total_tokens ?? 0);
    const failedResult: MetaAgentResult = {
      status: "failed",
      goal: input.goal,
      steps: activeSessions.get(sessionId)?.steps ?? activeSessions.get(sessionId)?.iterations ?? [],
      iterations: activeSessions.get(sessionId)?.iterations ?? activeSessions.get(sessionId)?.steps ?? [],
      totalDurationMs: Date.now() - startedAtMs,
      totalTokensUsed: tokenTotal,
      workflowEvolution: [],
    };

    const session = activeSessions.get(sessionId);
    if (session) {
      session.status = "error";
      session.errorMessage = message;
      session.result = failedResult;
      session.currentPhase = undefined;
      session.currentStep = undefined;
      session.currentIteration = undefined;
      if (session.supervisorRunState) {
        session.supervisorRunState.metadata.project_id = projectId;
        addIssue(session.supervisorRunState, {
          todo_id: "orchestrator",
          type: "critical_orchestrator_runtime_error",
          message,
          status: "open",
        });
        addExecutionLog(session.supervisorRunState, {
          timestamp: nowIso(),
          todo_id: "orchestrator",
          actor: "orchestrator",
          action: "step_exception",
          message: JSON.stringify({
            error: message,
            fallback: "disabled",
            runtime: "todo_driven_only",
          }),
        });
        const updatedProjectState = updateProjectStateFromRun(projectState, session.supervisorRunState, failedResult);
        const updatedMemoryState = updateMemoryStateFromRun(memoryState, session.supervisorRunState, failedResult);
        saveProjectState(updatedProjectState);
        saveMemoryState(updatedMemoryState);
        session.memoryWritebackSummary = buildMemoryWritebackSummary(
          projectId,
          updatedProjectState,
          updatedMemoryState,
        );
        refreshSessionRuntimeDerived(sessionId, session);
        persistSessionSnapshot(sessionId);
      }
      // Notify SSE subscribers that the session has failed.
      import("./session-event-bus").then(({ emitSessionEvent }) => {
        emitSessionEvent(sessionId, { type: "session_state", status: "failed" });
      }).catch(() => { /* non-critical */ });
    }

    return failedResult;
  }
}

/**
 * Backward-compatible API symbol.
 * `runMetaAgent` now always executes the todo-driven orchestrator mainline.
 */
export async function runMetaAgent(
  input: MetaAgentGoal,
  sessionId = makeId("meta"),
): Promise<MetaAgentResult> {
  return runMetaAgentTodoDrivenPrimary(input, sessionId);
}

export const metaAgentService = {
  run(input: MetaAgentGoal) {
    return runMetaAgentTodoDrivenPrimary(input);
  },
  runTodoDemo: runTodoDrivenDemo,
  start(input: MetaAgentGoal) {
    const sessionId = makeId("meta");
    const startedAt = nowIso();
    const projectId = normalizeProjectId(input.projectId);
    const projectState = loadProjectState(projectId, input.goal);
    const memoryState = loadMemoryState(projectId);

    activeSessions.set(sessionId, {
      result: null,
      steps: [],
      iterations: [],
      status: "running",
      currentPhase: "bootstrapping",
      currentStep: 1,
      currentIteration: 1,
      goal: input.goal,
      startedAt,
      projectId,
      runConfig: {
        projectId,
        maxPlanningRounds: Math.max(1, input.maxPlanningRounds ?? input.maxIterations ?? 3),
        maxStepLimit: Math.max(
          1,
          input.maxStepLimit ?? Math.max(12, (input.maxPlanningRounds ?? input.maxIterations ?? 3) * 4),
        ),
        qualityThreshold: input.qualityThreshold ?? 0.7,
        workflowTemplateId: input.workflowTemplateId,
      },
      supervisorRunState: createRunState(input.goal, { projectId }),
      planningContextSummary: buildPlanningContextSummary(input.goal, projectId, projectState, memoryState),
      checkpoints: [],
      replayCandidates: [],
    });
    persistSessionSnapshot(sessionId);

    void runMetaAgentTodoDrivenPrimary(input, sessionId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const current = activeSessions.get(sessionId);
      if (current) {
        current.status = "error";
        current.errorMessage = message;
        current.currentPhase = undefined;
        current.currentStep = undefined;
        current.currentIteration = undefined;
        persistSessionSnapshot(sessionId);
      }
    });

    return { sessionId, startedAt };
  },
  getSession,
  listSessions,
  deleteSession,
  getBanditStats,
  coldStartTrain,
  resetBandit,
  __resetInMemorySessionsForTests() {
    activeSessions.clear();
  },
};
