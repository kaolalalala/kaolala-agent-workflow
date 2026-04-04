import { nowIso } from "@/lib/utils";
import { callLLMWithUsage, type LLMCallResult } from "../llm-helper";
import {
  addExecutionLog,
  addIssue,
  addTodo,
  type RunState,
  type TodoDraft,
  type TodoItem,
  updateTodoStatus,
} from "../supervisor-runtime-state";
import { sanitizeJsonLikeText, sanitizeModelText } from "../text-cleaner";
import type { RecoveryDecision, TodoReviewResult } from "./types";
import { validateAndNormalizeTodoDrafts } from "./todo-draft-validator";

export interface ReplanDecision {
  action: "no_change" | "add_todos" | "prune_todos" | "replace_plan";
  reason: string;
  new_todos?: TodoDraft[];
  prune_todo_ids?: string[];
  token_usage?: LLMCallResult["usage"];
}

export interface ReplanContext {
  goal: string;
  completed_todos: Array<{ title: string; summary: string; key_findings?: string[] }>;
  failed_todos: Array<{ title: string; failure_reason: string }>;
  pending_todos: Array<{ id: string; title: string; status: TodoItem["status"] }>;
  new_discoveries: string[];
  open_issues: string[];
  step_count: number;
  remaining_steps: number;
}

function parseJson(raw: string) {
  return JSON.parse(sanitizeJsonLikeText(raw)) as Record<string, unknown>;
}

function extractTodoSummary(state: RunState, todo: TodoItem) {
  const linkedArtifacts = state.artifacts.filter(
    (artifact) => artifact.related_todo === todo.id || artifact.id === todo.output_ref,
  );
  const summary = linkedArtifacts.map((artifact) => artifact.summary).join(" | ")
    || todo.notes.slice(-2).join(" | ")
    || todo.description;
  return sanitizeModelText(summary).slice(0, 320);
}

function collectNewDiscoveries(state: RunState) {
  const discoveryRegex = /(discover|new issue|new finding|need follow|需要额外|发现|新增问题|追加调研|follow-up)/i;
  return state.todos
    .flatMap((todo) => todo.notes ?? [])
    .filter((note) => discoveryRegex.test(note))
    .slice(-6);
}

export function buildReplanContext(
  state: RunState,
  maxSteps: number,
  currentStep: number,
): ReplanContext {
  return {
    goal: state.goal,
    completed_todos: state.todos
      .filter((todo) => todo.status === "done")
      .slice(-6)
      .map((todo) => ({
        title: todo.title,
        summary: extractTodoSummary(state, todo),
        key_findings: todo.notes.slice(-3),
      })),
    failed_todos: state.todos
      .filter((todo) => todo.status === "failed")
      .slice(-4)
      .map((todo) => ({
        title: todo.title,
        failure_reason: todo.last_failure_reason ?? todo.notes.slice(-1)[0] ?? "unknown_failure",
      })),
    pending_todos: state.todos
      .filter((todo) => todo.status === "todo" || todo.status === "ready" || todo.status === "blocked")
      .slice(0, 8)
      .map((todo) => ({
        id: todo.id,
        title: todo.title,
        status: todo.status,
      })),
    new_discoveries: collectNewDiscoveries(state),
    open_issues: state.issues.filter((issue) => issue.status === "open").slice(-6).map((issue) => issue.message),
    step_count: currentStep,
    remaining_steps: Math.max(0, maxSteps - currentStep),
  };
}

function buildReplanPrompt(context: ReplanContext) {
  return [
    "You are a project manager supervising a todo-driven agent workflow.",
    "Decide whether the plan should be adjusted. Return strict JSON only.",
    "Do not include markdown, comments, or reasoning traces.",
    "",
    "Original goal:",
    context.goal,
    "",
    "Completed work:",
    JSON.stringify(context.completed_todos),
    "",
    "Failed work:",
    JSON.stringify(context.failed_todos),
    "",
    "Pending plan:",
    JSON.stringify(context.pending_todos),
    "",
    "New discoveries:",
    JSON.stringify(context.new_discoveries),
    "",
    "Open issues:",
    JSON.stringify(context.open_issues),
    "",
    `Budget used: ${context.step_count}, remaining steps: ${context.remaining_steps}`,
    "",
    "Hard constraints for new_todos:",
    "- Return 1 to 3 new todos only when action is add_todos or replace_plan.",
    "- Every new todo must include title, description, priority, capability_type, assignee, depends_on, and acceptance_criteria.",
    "- Always set input_refs to [] (empty array). Never guess artifact paths. The runtime resolves inputs from depends_on at execution time.",
    "- Descriptions must be specific and executable, not generic placeholders.",
    "- Every todo must include at least 2 measurable acceptance criteria.",
    "- If you return multiple new todos, at least one of them must depend on previous work or another new todo.",
    "",
    "Return JSON:",
    "{",
    '  "action": "no_change" | "add_todos" | "prune_todos" | "replace_plan",',
    '  "reason": "why",',
    '  "new_todos": [optional 1-3 todo objects with same schema as planner],',
    '  "prune_todo_ids": ["todo_x"]',
    "}",
  ].join("\n");
}

function defaultAcceptanceCriteria(capability: TodoItem["capability_type"]) {
  if (capability === "research") {
    return [
      "follow-up research produces concrete findings",
      "result can be consumed by downstream synthesis",
    ];
  }
  if (capability === "writing") {
    return [
      "output is readable and complete",
      "output reflects the latest validated findings",
    ];
  }
  if (capability === "planning") {
    return [
      "scope and dependency changes are explicit",
      "updated plan is actionable by the runtime",
    ];
  }
  if (capability === "review") {
    return [
      "review identifies pass/fail outcomes clearly",
      "review points to concrete next actions",
    ];
  }
  return [
    "analysis captures the required findings clearly",
    "analysis output can unblock the next execution step",
  ];
}

function inferCapabilityFromDraft(title: string, description: string): TodoItem["capability_type"] {
  const text = `${title} ${description}`.toLowerCase();
  if (/research|paper|source|evidence/.test(text)) return "research";
  if (/write|draft|deliver|report|summary/.test(text)) return "writing";
  if (/plan|scope|decompose|replan/.test(text)) return "planning";
  if (/review|verify|judge|validate/.test(text)) return "review";
  return "analysis";
}

function repairReplanTodos(
  state: RunState,
  decision: ReplanDecision,
  currentStep: number,
) {
  const drafts = Array.isArray(decision.new_todos) ? decision.new_todos : [];
  if (drafts.length === 0) {
    return [];
  }

  // Pick the most semantically relevant anchor for replan todos that lack explicit depends_on.
  // Prefer the direct "done" predecessor of a failed todo over just "last done" —
  // the last-done todo is often review/verification, not a data-producing step.
  const failedTodos = state.todos.filter((t) => t.status === "failed");
  const failedDepIds = new Set(failedTodos.flatMap((t) => t.depends_on));
  const dependencyAnchor =
    state.todos.find((t) => t.status === "done" && failedDepIds.has(t.id))?.id ??
    state.todos.filter((t) => t.status === "done" && t.capability_type !== "review" && t.capability_type !== "planning").slice(-1)[0]?.id ??
    state.todos.filter((t) => t.status === "done").slice(-1)[0]?.id;

  return drafts.slice(0, 3).map((draft, index) => {
    const title = typeof draft.title === "string" && draft.title.trim().length > 0
      ? draft.title.trim()
      : `Replan follow-up ${currentStep}-${index + 1}`;
    const capability = inferCapabilityFromDraft(title, typeof draft.description === "string" ? draft.description : "");
    const fallbackDescription =
      capability === "research"
        ? `Investigate the follow-up branch created by replanning and produce concrete findings that unblock the remaining work. Replan reason: ${decision.reason}.`
        : capability === "writing"
          ? `Produce the updated deliverable required by the replanned path and incorporate the latest validated findings. Replan reason: ${decision.reason}.`
          : capability === "planning"
            ? `Clarify the replanned scope, dependencies, and execution order so the remaining runtime path is concrete. Replan reason: ${decision.reason}.`
            : `Execute the replanned follow-up task and produce a concrete output that can be consumed by the remaining plan. Replan reason: ${decision.reason}.`;
    const description = typeof draft.description === "string" && draft.description.trim().length >= 14
      ? draft.description.trim()
      : fallbackDescription;
    const acceptance = Array.isArray(draft.acceptance_criteria)
      ? draft.acceptance_criteria.filter((item): item is string => typeof item === "string" && item.trim().length >= 6)
      : [];
    const repairedAcceptance = acceptance.length >= 2
      ? acceptance
      : [...acceptance, ...defaultAcceptanceCriteria(capability)].slice(0, 3);
    const repairedDependsOn = Array.isArray(draft.depends_on)
      ? draft.depends_on.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    if (repairedDependsOn.length === 0) {
      if (index === 0 && dependencyAnchor) {
        repairedDependsOn.push(dependencyAnchor);
      } else if (index > 0) {
        const previousDraft = drafts[index - 1];
        const previousId =
          typeof previousDraft?.id === "string" && previousDraft.id.trim().length > 0
            ? previousDraft.id.trim()
            : `todo_replan_${currentStep}_${index}`;
        repairedDependsOn.push(previousId);
      }
    }

    return {
      ...draft,
      id: typeof draft.id === "string" && draft.id.trim().length > 0
        ? draft.id.trim()
        : `todo_replan_${currentStep}_${index + 1}`,
      title,
      description,
      priority:
        draft.priority === "critical" || draft.priority === "high" || draft.priority === "medium" || draft.priority === "low"
          ? draft.priority
          : index === 0 ? "high" : "medium",
      capability_type: capability,
      assignee: typeof draft.assignee === "string" && draft.assignee.trim().length > 0
        ? draft.assignee.trim()
        : "single_executor",
      depends_on: repairedDependsOn,
      acceptance_criteria: repairedAcceptance,
      input_refs: Array.isArray(draft.input_refs)
        ? draft.input_refs.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
    } satisfies TodoDraft;
  });
}

export async function evaluateReplan(
  state: RunState,
  maxSteps: number,
  currentStep: number,
  options?: {
    invokeLlm?: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<LLMCallResult>;
  },
): Promise<ReplanDecision> {
  const context = buildReplanContext(state, maxSteps, currentStep);
  const invoke = options?.invokeLlm ?? callLLMWithUsage;

  const llmResult = await invoke([
    {
      role: "system",
      content: "You are a strict JSON-only replanning supervisor. Return only JSON.",
    },
    {
      role: "user",
      content: buildReplanPrompt(context),
    },
  ]);
  const parsed = parseJson(llmResult.content);
  const action = parsed.action;
  if (action !== "no_change" && action !== "add_todos" && action !== "prune_todos" && action !== "replace_plan") {
    throw new Error(`Replanner returned invalid action: ${String(action)}`);
  }
  return {
    action,
    reason: typeof parsed.reason === "string" ? parsed.reason : "llm_replan_decision",
    new_todos: Array.isArray(parsed.new_todos) ? (parsed.new_todos as TodoDraft[]) : undefined,
    prune_todo_ids: Array.isArray(parsed.prune_todo_ids)
      ? (parsed.prune_todo_ids as unknown[]).filter((item): item is string => typeof item === "string")
      : undefined,
    token_usage: llmResult.usage,
  };
}

export function checkReplanTrigger(
  state: RunState,
  review: TodoReviewResult | undefined,
  recoveryDecision: RecoveryDecision | undefined,
  options: {
    currentStep: number;
    minStepsBetweenReplans?: number;
  },
) {
  const openIssueCount = state.issues.filter((issue) => issue.status === "open").length;
  const hasDiscoverySignal = collectNewDiscoveries(state).length > 0;
  const lastReplanStep = Number(state.metadata.last_replan_step ?? 0);
  const minGap = Math.max(1, options.minStepsBetweenReplans ?? 3);
  const reasons: string[] = [];

  if (options.currentStep - lastReplanStep < minGap) {
    return { shouldReplan: false, reasons: ["replan_gap_not_reached"] };
  }
  if (review?.status === "fail" && recoveryDecision?.action === "fail") {
    reasons.push("review_fail_with_terminal_recovery_fail");
  }
  if (hasDiscoverySignal) {
    reasons.push("new_discovery_signal_detected");
  }
  if (openIssueCount >= 3) {
    reasons.push("issue_count_threshold_reached");
  }

  return {
    shouldReplan: reasons.length > 0,
    reasons,
  };
}

export function applyReplanDecision(
  state: RunState,
  decision: ReplanDecision,
  currentStep: number,
) {
  if (decision.action === "no_change") {
    return { addedTodoIds: [] as string[], prunedTodoIds: [] as string[] };
  }

  const prunedTodoIds: string[] = [];
  const pruneTargets = new Set<string>(decision.prune_todo_ids ?? []);
  if (decision.action === "replace_plan") {
    for (const todo of state.todos) {
      if (todo.status === "todo" || todo.status === "ready") {
        pruneTargets.add(todo.id);
      }
    }
  }

  for (const todoId of pruneTargets) {
    const todo = state.todos.find((item) => item.id === todoId);
    if (!todo) continue;
    if (todo.status === "todo" || todo.status === "ready") {
      updateTodoStatus(state, todo.id, "pruned");
      prunedTodoIds.push(todo.id);
    }
  }

  const addedTodoIds: string[] = [];
  if (decision.new_todos && decision.new_todos.length > 0) {
    const repairedDrafts = repairReplanTodos(state, decision, currentStep);
    const validation = validateAndNormalizeTodoDrafts(repairedDrafts, {
      minCount: 1,
      maxCount: 3,
      allowAllTodosDependent: true,
      allowExternalDependencies: true,
      allowMissingDependencyEdge: repairedDrafts.length <= 1,
    });
    if (!validation.ok) {
      addIssue(state, {
        todo_id: "replanner",
        type: "replan_validation_failed",
        message: validation.errors.join(" | "),
        status: "open",
      });
    } else {
      for (const todo of validation.todos) {
        addTodo(state, todo);
        addedTodoIds.push(todo.id);
      }
    }
  }

  state.metadata.replan_count = Number(state.metadata.replan_count ?? 0) + 1;
  state.metadata.last_replan_step = currentStep;

  // Record which failed todos triggered this replan and which new todos were added to
  // recover them. terminal-state uses this map to determine whether every failed todo
  // has been fully resolved by a subsequent replan.
  if (addedTodoIds.length > 0) {
    const currentMap = (state.metadata.replan_recovery_map ?? {}) as Record<string, string[]>;
    const failedAtReplan = state.todos
      .filter((todo) => todo.status === "failed")
      .map((todo) => todo.id);
    for (const failedId of failedAtReplan) {
      currentMap[failedId] = [...(currentMap[failedId] ?? []), ...addedTodoIds];
    }
    state.metadata.replan_recovery_map = currentMap;
  }

  addExecutionLog(state, {
    timestamp: nowIso(),
    todo_id: "replanner",
    actor: "replanner",
    action: "replan_applied",
    message: JSON.stringify({
      action: decision.action,
      reason: decision.reason,
      added_todo_ids: addedTodoIds,
      pruned_todo_ids: prunedTodoIds,
      step: currentStep,
    }),
  });

  return { addedTodoIds, prunedTodoIds };
}
