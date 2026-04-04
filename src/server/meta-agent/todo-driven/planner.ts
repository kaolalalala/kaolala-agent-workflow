import { toolService } from "@/server/tools/tool-service";
import { callLLM } from "../llm-helper";
import type { TodoItem } from "../supervisor-runtime-state";
import { validateAndNormalizeTodoDrafts } from "./todo-draft-validator";
import type { TodoPlanningContext } from "./types";

function getAvailableToolIds(): string[] {
  try {
    return toolService.listTools().filter((t) => t.enabled).map((t) => t.toolId);
  } catch {
    return [];
  }
}

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type TodoPlannerLlmInvoker = (messages: LlmMessage[]) => Promise<string>;

export interface TodoPlannerOptions {
  maxAttempts?: number;
  invokeLlm?: TodoPlannerLlmInvoker;
}

interface GoalPlanningHints {
  explicitParallel: boolean;
  requestedWorkerCount: number | null;
  shouldPreferParallel: boolean;
}

function hasParallelSiblingShape(todos: TodoItem[], hints: GoalPlanningHints) {
  if (!hints.shouldPreferParallel) return true;
  const expectedWorkers = Math.max(2, hints.requestedWorkerCount ?? 2);
  const candidates = todos.filter((todo) =>
    todo.capability_type === "collection" || todo.capability_type === "research",
  );
  return candidates.length >= expectedWorkers;
}

function stripMarkdownFence(raw: string) {
  const text = raw.trim();
  if (!text.startsWith("```")) return text;
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function stripThinkBlocks(raw: string) {
  return raw
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

function tryParseTodosPayload(text: string): unknown | null {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { todos?: unknown }).todos)) {
    return (parsed as { todos: unknown[] }).todos;
  }
  return null;
}

function extractBalancedJsonSlice(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const isOpening = (ch: string) => ch === "{" || ch === "[";
  const isPair = (open: string, close: string) =>
    (open === "{" && close === "}") || (open === "[" && close === "]");

  for (let start = 0; start < text.length; start++) {
    const first = text[start];
    if (!isOpening(first)) continue;

    const stack: string[] = [first];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }

      if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if (!open || !isPair(open, ch)) {
          break;
        }
        if (stack.length === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function parseTodosFromLlm(raw: string): unknown {
  const normalized = stripThinkBlocks(raw);
  const directCandidates = [
    stripMarkdownFence(normalized),
    normalized,
  ];

  for (const candidate of directCandidates) {
    if (!candidate.trim()) continue;
    try {
      const parsed = tryParseTodosPayload(candidate);
      if (parsed) return parsed;
    } catch {
      // continue
    }
  }

  const jsonSlice = extractBalancedJsonSlice(normalized);
  if (jsonSlice) {
    const parsed = tryParseTodosPayload(jsonSlice);
    if (parsed) return parsed;
  }

  throw new Error("LLM output JSON must be an array or { todos: [...] }.");
}

function normalizeCountWords(goal: string) {
  const replacements: Array<[RegExp, string]> = [
    // English
    [/\bone\b/gi, "1"],
    [/\btwo\b/gi, "2"],
    [/\bthree\b/gi, "3"],
    [/\bfour\b/gi, "4"],
    [/\bfive\b/gi, "5"],
    [/\bsix\b/gi, "6"],
    [/\bseven\b/gi, "7"],
    [/\beight\b/gi, "8"],
    [/\bnine\b/gi, "9"],
    [/\bten\b/gi, "10"],
    // Chinese
    [/一/g, "1"],
    [/两|二/g, "2"],
    [/三/g, "3"],
    [/四/g, "4"],
    [/五/g, "5"],
    [/六/g, "6"],
    [/七/g, "7"],
    [/八/g, "8"],
    [/九/g, "9"],
    [/十/g, "10"],
  ];
  return replacements.reduce((current, [pattern, value]) => current.replace(pattern, value), goal);
}

function analyzeGoal(goal: string): GoalPlanningHints {
  const normalizedGoal = normalizeCountWords(goal);
  const explicitParallel =
    /(?:\bparallel\b|\bconcurrent\b|\bsimultaneous(?:ly)?\b|\bin parallel\b)/i.test(normalizedGoal) ||
    /并行|同时|并发|分批并行|同步执行/.test(normalizedGoal);
  const requestedWorkerCountMatch =
    normalizedGoal.match(/\b(\d+)\s+(?:parallel\s+)?(?:subagents?|agents?|workers?)\b/i) ??
    normalizedGoal.match(/分(\d+)个(?:并行)?子任务/);
  const requestedWorkerCount = requestedWorkerCountMatch ? Number(requestedWorkerCountMatch[1]) : null;

  return {
    explicitParallel,
    requestedWorkerCount,
    shouldPreferParallel: explicitParallel || Boolean((requestedWorkerCount ?? 0) >= 2),
  };
}

function buildParallelHintBlock(goal: string, hints: GoalPlanningHints) {
  if (!hints.shouldPreferParallel) return "";

  const workerCount = hints.requestedWorkerCount ?? 2;
  return [
    "Parallel-first planning directive:",
    "- The user intent suggests parallel sibling todos when the work is truly independent.",
    "- Let the model decide the exact task family, semantics, and tool use from the original goal.",
    "- Prefer fan-out/fan-in structure instead of a single serial collect todo when independence is clear.",
    `- Create ${workerCount} sibling todos when possible.`,
    `- Because the user explicitly asked for parallelism, do not replace the ${workerCount} sibling collection todos with one bulk collection todo.`,
    "- Each sibling todo should own a clear independent subset of work items.",
    "- After the parallel siblings, create one merge/synthesis todo and then one delivery todo.",
    "- Do NOT collapse all collection work into one generic todo if the user explicitly asked for parallelism.",
    `- Goal analyzed: ${goal}`,
    "",
  ].join("\n");
}

function buildProjectContextBlock(context?: TodoPlanningContext) {
  const projectContext = context?.project_context;
  const resourceSkills = (context?.resource_center?.skills ?? [])
    .slice(0, 6)
    .map((item, index) =>
      `${index + 1}. ${item.name}: ${[
        item.description ?? item.output_description ?? "no description",
        item.guide_content ? `guide=${item.guide_content.slice(0, 220)}` : "",
      ].filter(Boolean).join("; ")}`,
    );

  if (!projectContext) {
    return resourceSkills.length > 0
      ? ["Resource center skills:", ...resourceSkills].join("\n")
      : "";
  }

  const skeletons = (projectContext.successful_todo_skeletons ?? [])
    .slice(0, 2)
    .map((item, index) =>
      `${index + 1}. flow=${item.capability_flow.join(" -> ")} titles=${item.todo_titles.join(" -> ")} goal_hint=${item.goal_hint}`,
    );
  const reusableRefs = (projectContext.reusable_workspace_refs ?? [])
    .slice(0, 3)
    .map((item, index) => `${index + 1}. kind=${item.kind} topic=${item.topic_hint} summary=${item.summary}`);
  const plannerMemories = (projectContext.planner_memories ?? [])
    .filter((item) => item.notes.some((note) => note.startsWith("successful_flow:")))
    .slice(0, 3)
    .map((item, index) =>
      `${index + 1}. goal_pattern=${item.goal_pattern}; flow=${item.recommended_capability_flow.join(" -> ")}; acceptance=${item.suggested_acceptance_patterns.join(" | ")}; notes=${item.notes.join(" | ")}`,
    );

  return [
    `Project memory context (project_id=${projectContext.project_id}):`,
    resourceSkills.length > 0 ? "Resource center skills:\n" + resourceSkills.join("\n") : "",
    skeletons.length > 0 ? "Successful todo skeletons:\n" + skeletons.join("\n") : "",
    reusableRefs.length > 0 ? "Reusable workspace refs:\n" + reusableRefs.join("\n") : "",
    plannerMemories.length > 0 ? "Successful planner memories:\n" + plannerMemories.join("\n") : "",
    "- Use only successful examples as loose hints. Do not copy them blindly if the current goal does not match.",
    "- Do not start with downstream verification, review, or delivery before prerequisite collection or production work exists.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(goal: string, context?: TodoPlanningContext, previousErrors: string[] = []) {
  const goalHints = analyzeGoal(goal);
  const goalType = context?.goalType ?? "generic";
  const constraints = (context?.constraints ?? []).join("; ") || "none";
  const contextHints = (context?.hints ?? []).join("; ") || "none";
  const feedbackBlock =
    previousErrors.length > 0
      ? [
          "Previous draft failed validator checks. You MUST fix these problems:",
          ...previousErrors.map((err, idx) => `${idx + 1}. ${err}`),
          "",
        ].join("\n")
      : "";

  return [
    "Generate initial supervisor todos for a todo-driven supervisor runtime.",
    "Return ONLY strict JSON. Do not include markdown or explanations.",
    "Do not include <think> tags, reasoning traces, or any non-JSON prefix/suffix.",
    "",
    "Output schema:",
    "{",
    '  "todos": [',
    "    {",
    '      "id": "todo_unique_id",',
    '      "title": "short actionable title",',
    '      "description": "clear executable description",',
    '      "priority": "critical|high|medium|low",',
    '      "capability_type": "planning|research|collection|writing|analysis|review|verification|merge|browser_ops|terminal_ops",',
    '      "assignee": "single_executor",',
    '      "depends_on": ["todo_x"],',
    '      "acceptance_criteria": ["measurable criterion 1", "measurable criterion 2"],',
    '      "input_refs": [],  // Always leave empty. Input artifacts are resolved at runtime via depends_on.',
    '      "extra_tools": ["tool_id_if_needed"],',
    '      "autonomy_override": "basic|enhanced|full"',
    "    }",
    "  ]",
    "}",
    "",
    "Hard constraints:",
    "- Must output 3 to 5 todos.",
    "- Every todo must include id/title/description/priority/capability_type/assignee/depends_on/acceptance_criteria.",
    "- extra_tools is optional: only add it when a todo needs specific platform tools beyond the assigned agent's defaults. Available tool IDs: " + getAvailableToolIds().join(", ") + ".",
    "- autonomy_override is optional: only add it when a todo explicitly needs enhanced/full agent autonomy.",
    "- Dependencies must reference existing todo ids only and must form a DAG (no cycle).",
    "- Todos must be concrete and reviewable, avoid vague generic steps.",
    "- Keep decomposition high-level but executable.",
    "- When the goal is naturally parallelizable, prefer explicit sibling todos that can run in parallel.",
    "- Do not start with verification/review/delivery before the prerequisite production work exists unless the user explicitly asked for pre-flight validation.",
    ...(goalHints.shouldPreferParallel
      ? [`- This goal explicitly requires parallel execution. Return at least ${Math.max(2, goalHints.requestedWorkerCount ?? 2)} sibling collection/research todos with non-overlapping scopes.`]
      : []),
    "- The final delivery/report todo should normally be capability_type=writing unless it is purely deterministic verification.",
    "- Always set input_refs to [] (empty array). Never guess artifact paths or ids. The runtime resolves inputs from depends_on at execution time.",
    "- Do NOT create a scope/requirements todo if the goal already specifies what to collect, how many items, and the delivery format. In that case, start directly with collection/download todos.",
    "",
    "Recommended flow patterns (choose the best fit for the goal):",
    "- For concrete collection/download goals with explicit parallelism: directly fan-out into parallel collection todos → merge → deliver.",
    "  Do NOT prepend a 'scope clarification' todo if the goal already specifies exactly what to collect and how.",
    "- For ambiguous or exploratory goals: scope/requirements → research/collection → analyze → produce result.",
    "- For generation/writing goals: research/gather inputs → write draft → review → finalize.",
    "- Always skip a step if the goal already provides the information that step would produce.",
    "",
    `Goal: ${goal}`,
    `Goal type hint: ${goalType}`,
    `Constraints: ${constraints}`,
    `Hints: ${contextHints}`,
    "",
    buildProjectContextBlock(context),
    buildParallelHintBlock(goal, goalHints),
    feedbackBlock,
  ].join("\n");
}

function defaultInvokeLlm(messages: LlmMessage[]) {
  return callLLM(messages);
}

/**
 * Hybrid planning strategy:
 * 1) LLM generates todo draft
 * 2) Script validator normalizes + validates structure/dependencies/granularity/count
 * 3) On validation failure, feed errors back to LLM and regenerate
 * 4) Only validated todos are returned to execution loop
 */
export async function planInitialTodos(
  goal: string,
  context?: TodoPlanningContext,
  options?: TodoPlannerOptions,
): Promise<TodoItem[]> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const invokeLlm = options?.invokeLlm ?? defaultInvokeLlm;
  const goalHints = analyzeGoal(goal);
  let lastErrors: string[] = [];
  let lastRaw = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt(goal, context, lastErrors);
    const raw = await invokeLlm([
      {
        role: "system",
        content: "You are a planning model. Return only strict JSON for todos.",
      },
      {
        role: "user",
        content: prompt,
      },
    ]);
    lastRaw = raw;

    let parsed: unknown;
    try {
      parsed = parseTodosFromLlm(raw);
    } catch (error) {
      lastErrors = [
        `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
      ];
      continue;
    }

    const validation = validateAndNormalizeTodoDrafts(parsed);
    if (validation.ok && hasParallelSiblingShape(validation.todos, goalHints)) {
      return validation.todos;
    }

    lastErrors = validation.ok
      ? [`Planner must preserve requested parallel sibling shape; expected at least ${Math.max(2, goalHints.requestedWorkerCount ?? 2)} collection/research sibling todos.`]
      : validation.errors.slice(0, 10);
  }

  throw new Error(
    `Hybrid todo planning failed after ${maxAttempts} attempts. Last validator errors: ${
      lastErrors.join(" | ") || "unknown"
    }. Last raw output preview: ${stripMarkdownFence(lastRaw).slice(0, 280)}`,
  );
}
