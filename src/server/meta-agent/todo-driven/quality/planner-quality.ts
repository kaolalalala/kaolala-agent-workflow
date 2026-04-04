import type { TodoCapabilityType, TodoItem } from "../../supervisor-runtime-state";
import { planInitialTodos, type TodoPlannerLlmInvoker } from "../planner";
import { validateAndNormalizeTodoDrafts } from "../todo-draft-validator";
import { aggregateDimensionScores, average, clamp01, pickCasesById, summarizeFailurePatterns } from "./shared";
import { plannerBenchmarkCases } from "./planner-benchmark-cases";
import type {
  PlannerBenchmarkCase,
  PlannerBenchmarkOptions,
  PlannerBenchmarkResult,
  PlannerCaseResult,
} from "./types";

const STAGE_KEYWORDS: Record<string, string[]> = {
  scope: ["scope", "范围", "边界", "需求", "约束", "目标"],
  collect: ["collect", "research", "gather", "调研", "收集", "资料", "数据"],
  analyze: ["analyze", "analysis", "分析", "评估", "归纳", "对比", "结论"],
  deliver: ["deliver", "write", "output", "产出", "报告", "方案", "文档", "草案"],
  review: ["review", "revise", "qa", "复核", "验收", "校验", "修订"],
  implement: ["implement", "refactor", "修改", "实现", "重构", "开发"],
  test: ["test", "验证", "回归", "单测", "检查"],
};

const VAGUE_REGEX = /(do work|complete task|处理任务|继续优化|调研一下|写一下)/i;
const TOO_FINE_REGEX = /(click|open page|open browser|复制粘贴|点击按钮|打开页面)/i;
const ACTION_REGEX = /(define|collect|analy|produce|review|implement|validate|明确|收集|分析|产出|复核|实现|验证)/i;
const MEASURABLE_REGEX = /(至少|不少于|包含|输出|完成|可追溯|可验证|with|at least|must include|evidence)/i;

function normalize(text: string) {
  return text.toLowerCase();
}

function inferCapabilityFromText(todo: TodoItem): TodoCapabilityType {
  const text = normalize(`${todo.title} ${todo.description}`);
  if (/review|复核|验收|校验/.test(text)) return "review";
  if (/research|调研|收集|资料/.test(text)) return "research";
  if (/write|writing|文档|报告|方案|草案|撰写/.test(text)) return "writing";
  if (/plan|planning|范围|边界|需求|约束/.test(text)) return "planning";
  return "analysis";
}

function hasDependencyCycle(todos: TodoItem[]) {
  const graph = new Map<string, string[]>();
  for (const todo of todos) graph.set(todo.id, todo.depends_on);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return todos.some((todo) => dfs(todo.id));
}

function scoreCoverage(todos: TodoItem[], skeleton: string[]) {
  if (skeleton.length === 0) return 1;
  const merged = todos.map((todo) => normalize(`${todo.title} ${todo.description}`));

  let matched = 0;
  for (const stage of skeleton) {
    const keywords = STAGE_KEYWORDS[stage] ?? [stage.toLowerCase()];
    const found = merged.some((text) => keywords.some((keyword) => text.includes(keyword.toLowerCase())));
    if (found) matched += 1;
  }
  return clamp01(matched / skeleton.length);
}

function scoreGranularity(todos: TodoItem[]) {
  const countPenalty = todos.length < 3 || todos.length > 5 ? 0.4 : 0;
  const coarseCount = todos.filter(
    (todo) => todo.title.trim().length < 4 || todo.description.trim().length < 16 || VAGUE_REGEX.test(todo.description),
  ).length;
  const tooFineCount = todos.filter(
    (todo) => TOO_FINE_REGEX.test(todo.title) || TOO_FINE_REGEX.test(todo.description),
  ).length;

  const coarsePenalty = (coarseCount / Math.max(1, todos.length)) * 0.4;
  const finePenalty = (tooFineCount / Math.max(1, todos.length)) * 0.35;
  return clamp01(1 - countPenalty - coarsePenalty - finePenalty);
}

function scoreExecutability(todos: TodoItem[]) {
  const valid = todos.filter(
    (todo) => ACTION_REGEX.test(`${todo.title} ${todo.description}`) && todo.description.trim().length >= 16,
  ).length;
  return clamp01(valid / Math.max(1, todos.length));
}

function scoreVerifiability(todos: TodoItem[]) {
  const todoScores = todos.map((todo) => {
    if (todo.acceptance_criteria.length < 2) return 0;
    const validCriteriaCount = todo.acceptance_criteria.filter(
      (criterion) => criterion.trim().length >= 8 && MEASURABLE_REGEX.test(criterion),
    ).length;
    return clamp01(validCriteriaCount / todo.acceptance_criteria.length);
  });
  return clamp01(average(todoScores));
}

function scoreDependencyQuality(todos: TodoItem[]) {
  const idSet = new Set(todos.map((todo) => todo.id));
  const hasInvalidDeps = todos.some((todo) => todo.depends_on.some((dep) => !idSet.has(dep) || dep === todo.id));
  const rootCount = todos.filter((todo) => todo.depends_on.length === 0).length;
  const dependentCount = todos.filter((todo) => todo.depends_on.length > 0).length;
  const cycle = hasDependencyCycle(todos);

  let score = 1;
  if (hasInvalidDeps) score -= 0.5;
  if (cycle) score -= 0.3;
  if (rootCount === 0) score -= 0.2;
  if (dependentCount === 0) score -= 0.2;
  return clamp01(score);
}

function scoreCapabilityQuality(todos: TodoItem[], expectedCapabilities: TodoCapabilityType[]) {
  const generated = new Set(todos.map((todo) => todo.capability_type));
  const expectedCoverage = expectedCapabilities.length === 0
    ? 1
    : expectedCapabilities.filter((capability) => generated.has(capability)).length / expectedCapabilities.length;
  const alignedCount = todos.filter((todo) => inferCapabilityFromText(todo) === todo.capability_type).length;
  const alignment = alignedCount / Math.max(1, todos.length);
  return clamp01((expectedCoverage + alignment) / 2);
}

function buildSuggestions(scores: Record<string, number>) {
  const suggestions: string[] = [];
  if ((scores.coverage ?? 0) < 0.7) suggestions.push("补齐关键阶段，避免缺少 scope/collect/analyze/deliver/review。");
  if ((scores.granularity ?? 0) < 0.7) suggestions.push("优化 todo 粒度，避免过粗或过细的步骤描述。");
  if ((scores.verifiability ?? 0) < 0.7) suggestions.push("强化 acceptance_criteria，可量化、可验收。");
  if ((scores.capability_quality ?? 0) < 0.7) suggestions.push("检查 capability_type 与任务语义是否匹配。");
  return suggestions;
}

function createPlannerInvoker(responses: string[]): TodoPlannerLlmInvoker {
  let cursor = 0;
  return async () => {
    const value = responses[Math.min(cursor, responses.length - 1)];
    cursor += 1;
    return value;
  };
}

async function defaultPlanTodos(benchmarkCase: PlannerBenchmarkCase) {
  const responses = benchmarkCase.llm_responses;
  if (!responses || responses.length === 0) {
    throw new Error(`Planner benchmark case "${benchmarkCase.id}" missing llm_responses.`);
  }
  return planInitialTodos(benchmarkCase.goal, benchmarkCase.planning_context, {
    maxAttempts: responses.length,
    invokeLlm: createPlannerInvoker(responses),
  });
}

export function evaluatePlannerQuality(benchmarkCase: PlannerBenchmarkCase, todos: TodoItem[]): PlannerCaseResult {
  const perDimensionScores: Record<string, number> = {
    coverage: scoreCoverage(todos, benchmarkCase.expected_todo_skeleton),
    granularity: scoreGranularity(todos),
    executability: scoreExecutability(todos),
    verifiability: scoreVerifiability(todos),
    dependency_quality: scoreDependencyQuality(todos),
    capability_quality: scoreCapabilityQuality(todos, benchmarkCase.expected_capabilities),
  };

  const overall = clamp01(average(Object.values(perDimensionScores)));
  const issues: string[] = [];
  if (perDimensionScores.coverage < 0.7) issues.push("coverage_low");
  if (perDimensionScores.granularity < 0.7) issues.push("granularity_low");
  if (perDimensionScores.executability < 0.7) issues.push("executability_low");
  if (perDimensionScores.verifiability < 0.7) issues.push("verifiability_low");
  if (perDimensionScores.dependency_quality < 0.7) issues.push("dependency_quality_low");
  if (perDimensionScores.capability_quality < 0.7) issues.push("capability_quality_low");

  const capabilities = Array.from(new Set(todos.map((todo) => todo.capability_type)));
  return {
    case_id: benchmarkCase.id,
    pass: overall >= 0.72 && issues.length <= 2,
    overall_score: overall,
    per_dimension_scores: perDimensionScores,
    issues,
    suggestions: buildSuggestions(perDimensionScores),
    generated_todo_count: todos.length,
    generated_capabilities: capabilities,
    details: {
      goal: benchmarkCase.goal,
      category: benchmarkCase.category,
    },
  };
}

export async function runPlannerBenchmark(options: PlannerBenchmarkOptions = {}): Promise<PlannerBenchmarkResult> {
  const selectedCases = pickCasesById(options.planner_cases ?? plannerBenchmarkCases, options.case_ids);
  const planner = options.plan_todos ?? defaultPlanTodos;
  const results: PlannerCaseResult[] = [];

  for (const benchmarkCase of selectedCases) {
    try {
      const todos = await planner(benchmarkCase);
      results.push(evaluatePlannerQuality(benchmarkCase, todos));
    } catch (error) {
      results.push({
        case_id: benchmarkCase.id,
        pass: false,
        overall_score: 0,
        per_dimension_scores: {
          coverage: 0,
          granularity: 0,
          executability: 0,
          verifiability: 0,
          dependency_quality: 0,
          capability_quality: 0,
        },
        issues: ["planner_execution_failed"],
        suggestions: ["检查 planner 产出 JSON 与 validator 约束是否一致。"],
        generated_todo_count: 0,
        generated_capabilities: [],
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const passed = results.filter((result) => result.pass).length;
  return {
    suite: "planner",
    total_cases: results.length,
    passed_cases: passed,
    failed_cases: results.length - passed,
    aggregate_scores: aggregateDimensionScores(results),
    per_case_results: results,
    major_failure_patterns: summarizeFailurePatterns(results),
  };
}

export function evaluatePlannerRawDraft(
  benchmarkCase: PlannerBenchmarkCase,
  rawDraft: unknown,
): PlannerCaseResult {
  const validation = validateAndNormalizeTodoDrafts(rawDraft);
  if (!validation.ok) {
    return {
      case_id: benchmarkCase.id,
      pass: false,
      overall_score: 0,
      per_dimension_scores: {
        coverage: 0,
        granularity: 0,
        executability: 0,
        verifiability: 0,
        dependency_quality: 0,
        capability_quality: 0,
      },
      issues: [...validation.errors.slice(0, 6)],
      suggestions: ["先通过 todo-draft-validator，再进入执行评测。"],
      generated_todo_count: 0,
      generated_capabilities: [],
    };
  }
  return evaluatePlannerQuality(benchmarkCase, validation.todos);
}
