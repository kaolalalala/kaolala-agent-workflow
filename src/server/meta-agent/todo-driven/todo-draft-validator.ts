import { makeId } from "@/lib/utils";
import type { TodoCapabilityType, TodoItem, TodoPriority } from "../supervisor-runtime-state";
import { getSubagentById } from "./subagent-registry";

export interface TodoDraftValidationResult {
  ok: boolean;
  todos: TodoItem[];
  errors: string[];
}

interface LlmTodoDraft {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  assignee?: unknown;
  capability_type?: unknown;
  depends_on?: unknown;
  acceptance_criteria?: unknown;
  input_refs?: unknown;
  extra_tools?: unknown;
  output_ref?: unknown;
  retry_count?: unknown;
  notes?: unknown;
  autonomy_override?: unknown;
}

interface TodoDraftValidationOptions {
  minCount?: number;
  maxCount?: number;
  allowAllTodosDependent?: boolean;
  allowExternalDependencies?: boolean;
  allowMissingDependencyEdge?: boolean;
}

const ALLOWED_PRIORITIES: TodoPriority[] = ["low", "medium", "high", "critical"];
const ALLOWED_CAPABILITIES: TodoCapabilityType[] = [
  "planning",
  "research",
  "collection",
  "writing",
  "analysis",
  "review",
  "verification",
  "merge",
  "browser_ops",
  "terminal_ops",
];
const VAGUE_PHRASES = [
  "complete task",
  "do work",
  "澶勭悊浠诲姟",
  "瀹屾垚浠诲姟",
  "缁х画浼樺寲",
  "further improve",
];
const DEFAULT_ASSIGNEE_BY_CAPABILITY: Record<TodoCapabilityType, string> = {
  planning: "planner_agent",
  research: "research_agent",
  collection: "collector_agent",
  writing: "writer_agent",
  analysis: "analyst_agent",
  review: "reviewer_agent",
  verification: "verification_agent",
  merge: "merge_agent",
  browser_ops: "browser_operator_agent",
  terminal_ops: "terminal_operator_agent",
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeReferenceText(value: string) {
  return value
    .toLowerCase()
    .replace(/^(title|id|todo)\s*:\s*/g, "")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReferenceAliases(id: string, title: string) {
  const aliases = new Set<string>();
  const base = normalizeReferenceText(id);
  if (base) aliases.add(base);

  const baseTokens = base.split(" ").filter(Boolean);
  if (baseTokens.length > 1) {
    aliases.add([...baseTokens].sort().join(" "));
  }

  const titleNormalized = normalizeReferenceText(title);
  if (titleNormalized) {
    aliases.add(titleNormalized);
    const titleTokens = titleNormalized
      .split(" ")
      .filter((token) => token.length > 1 || /^\d+$/.test(token))
      .slice(0, 8);
    if (titleTokens.length > 1) {
      aliases.add([...titleTokens].sort().join(" "));
    }
  }

  return aliases;
}

function resolveDependencyId(
  dep: string,
  aliasToId: Map<string, string>,
  idSet: Set<string>,
) {
  if (idSet.has(dep)) {
    return dep;
  }
  const normalized = normalizeReferenceText(dep);
  if (!normalized) {
    return dep;
  }
  return aliasToId.get(normalized)
    ?? aliasToId.get(normalized.split(" ").filter(Boolean).sort().join(" "))
    ?? dep;
}

function normalizePriority(value: unknown): TodoPriority {
  const text = asString(value).toLowerCase() as TodoPriority;
  return ALLOWED_PRIORITIES.includes(text) ? text : "medium";
}

function normalizeCapabilityType(value: unknown): TodoCapabilityType {
  const text = asString(value).toLowerCase() as TodoCapabilityType;
  if (ALLOWED_CAPABILITIES.includes(text)) return text;
  return "analysis";
}

function normalizeAssignee(value: unknown, capability: TodoCapabilityType) {
  const raw = asString(value);
  const normalized = normalizeReferenceText(raw);
  const fallback = DEFAULT_ASSIGNEE_BY_CAPABILITY[capability];
  if (!normalized) {
    return fallback;
  }
  if (normalized === "meta agent" || normalized === "metaagent" || normalized === "agent") {
    return fallback;
  }
  const candidate = getSubagentById(raw);
  if (!candidate || !candidate.capability_types.includes(capability)) {
    return fallback;
  }
  return raw;
}

function hasCycle(todos: TodoItem[]) {
  const graph = new Map<string, string[]>();
  for (const todo of todos) {
    graph.set(todo.id, [...todo.depends_on]);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (id: string): boolean => {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const next = graph.get(id) ?? [];
    for (const dep of next) {
      if (dfs(dep)) return true;
    }
    inStack.delete(id);
    return false;
  };

  for (const todo of todos) {
    if (dfs(todo.id)) return true;
  }
  return false;
}

function titleLooksWeak(title: string) {
  return title.length < 4;
}

function descriptionLooksWeak(description: string) {
  const lower = description.toLowerCase();
  if (description.length < 14) return true;
  return VAGUE_PHRASES.some((phrase) => lower.includes(phrase));
}

export function validateAndNormalizeTodoDrafts(
  raw: unknown,
  options?: TodoDraftValidationOptions,
): TodoDraftValidationResult {
  const minCount = Math.max(1, options?.minCount ?? 3);
  const maxCount = Math.max(minCount, options?.maxCount ?? 5);
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      todos: [],
      errors: ["LLM output must be an array of todo objects."],
    };
  }

  if (raw.length < minCount || raw.length > maxCount) {
    return {
      ok: false,
      todos: [],
      errors: [`Todo count must be between ${minCount} and ${maxCount}, got ${raw.length}.`],
    };
  }

  const todos: TodoItem[] = raw.map((item, index) => {
    const draft = (item ?? {}) as LlmTodoDraft;
    const capability = normalizeCapabilityType(draft.capability_type);
    const assignee = normalizeAssignee(draft.assignee, capability);
    return {
      id: asString(draft.id) || `todo_${index + 1}_${makeId("p").slice(-4)}`,
      title: asString(draft.title),
      description: asString(draft.description),
      status: "todo",
      priority: normalizePriority(draft.priority),
      assignee,
      capability_type: capability,
      depends_on: Array.from(new Set(asStringArray(draft.depends_on))),
      acceptance_criteria: asStringArray(draft.acceptance_criteria),
      input_refs: asStringArray(draft.input_refs),
      extra_tools: asStringArray(draft.extra_tools).length > 0 ? asStringArray(draft.extra_tools) : undefined,
      output_ref: asString(draft.output_ref) || undefined,
      retry_count: 0,
      delegation_status: "none",
      assignee_history: [assignee],
      review_result: undefined,
      notes: asStringArray(draft.notes),
      autonomy_override:
        draft.autonomy_override === "basic" ||
        draft.autonomy_override === "enhanced" ||
        draft.autonomy_override === "full"
          ? draft.autonomy_override
          : undefined,
    };
  });

  const errors: string[] = [];
  const idSet = new Set<string>();
  const aliasToId = new Map<string, string>();

  for (const [index, todo] of todos.entries()) {
    const prefix = `todo[${index}]`;
    if (!todo.id) errors.push(`${prefix}: missing id`);
    if (idSet.has(todo.id)) errors.push(`${prefix}: duplicated id "${todo.id}"`);
    idSet.add(todo.id);
    for (const alias of buildReferenceAliases(todo.id, todo.title)) {
      if (!aliasToId.has(alias)) {
        aliasToId.set(alias, todo.id);
      }
    }

    if (!todo.title) errors.push(`${prefix}: missing title`);
    if (titleLooksWeak(todo.title)) errors.push(`${prefix}: title too short or vague`);
    if (!todo.description) errors.push(`${prefix}: missing description`);
    if (descriptionLooksWeak(todo.description)) errors.push(`${prefix}: description too weak/too generic`);
    if (todo.acceptance_criteria.length < 2) {
      errors.push(`${prefix}: at least 2 acceptance criteria required`);
    }
    for (const [criterionIndex, criterion] of todo.acceptance_criteria.entries()) {
      if (criterion.length < 6) {
        errors.push(`${prefix}: acceptance_criteria[${criterionIndex}] too short`);
      }
    }
  }

  for (const todo of todos) {
    todo.depends_on = Array.from(new Set(todo.depends_on.map((dep) => resolveDependencyId(dep, aliasToId, idSet))));
  }

  for (const todo of todos) {
    for (const dep of todo.depends_on) {
      if (!idSet.has(dep) && !options?.allowExternalDependencies) {
        errors.push(`todo "${todo.id}" has invalid dependency "${dep}"`);
      }
      if (dep === todo.id) {
        errors.push(`todo "${todo.id}" cannot depend on itself`);
      }
    }
  }

  const rootCount = todos.filter((todo) => todo.depends_on.length === 0).length;
  if (rootCount === 0 && !options?.allowAllTodosDependent) {
    errors.push("at least one todo must have no dependencies");
  }

  const dependentCount = todos.filter((todo) => todo.depends_on.length > 0).length;
  if (dependentCount === 0 && !options?.allowMissingDependencyEdge) {
    errors.push("at least one todo must depend on previous work");
  }

  if (hasCycle(todos)) {
    errors.push("dependency graph has cycle");
  }

  return {
    ok: errors.length === 0,
    todos,
    errors,
  };
}
