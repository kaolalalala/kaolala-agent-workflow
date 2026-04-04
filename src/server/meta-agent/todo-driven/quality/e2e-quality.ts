import { runTodoDrivenOrchestrator } from "../orchestrator";
import type { SubagentRunner, TodoExecutor } from "../types";
import { aggregateDimensionScores, average, clamp01, pickCasesById, summarizeFailurePatterns } from "./shared";
import { e2eBenchmarkCases } from "./e2e-benchmark-cases";
import type {
  E2EBenchmarkCase,
  E2EBenchmarkOptions,
  E2EBenchmarkResult,
  E2ECaseResult,
} from "./types";

function orderedCoverage(actual: string[], expected: string[]) {
  if (expected.length === 0) return 1;
  let hit = 0;
  let cursor = 0;
  for (const expectedAction of expected) {
    while (cursor < actual.length && actual[cursor] !== expectedAction) {
      cursor += 1;
    }
    if (cursor < actual.length) {
      hit += 1;
      cursor += 1;
    }
  }
  return clamp01(hit / expected.length);
}

function keyTodoCoverage(todoIds: string[], todoTitles: string[], expectedTokens: string[]) {
  if (expectedTokens.length === 0) return 1;
  const searchable = [...todoIds, ...todoTitles].join(" ").toLowerCase();
  const hit = expectedTokens.filter((token) => searchable.includes(token.toLowerCase())).length;
  return clamp01(hit / expectedTokens.length);
}

function parseJsonSafe(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function explainabilityScore(actionLogs: Array<{ action: string; message: string }>) {
  const keyLogs = actionLogs.filter(
    (entry) =>
      entry.action === "decide_mode" ||
      entry.action === "review_pass" ||
      entry.action === "review_revise" ||
      entry.action === "review_split" ||
      entry.action === "review_fail",
  );
  if (keyLogs.length === 0) return 0;
  const good = keyLogs.filter((entry) => {
    const payload = parseJsonSafe(entry.message);
    if (!payload) return false;
    const reason = payload.reason;
    return typeof reason === "string" && reason.trim().length > 0;
  }).length;
  return clamp01(good / keyLogs.length);
}

function defaultStepExecutor(): TodoExecutor {
  return async (_context, _state, todo) => ({
    status: "success",
    output: todo.acceptance_criteria.join(" "),
    criteria_evidence: [...todo.acceptance_criteria],
    artifact: {
      path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\benchmark_${todo.id}.md`,
      type: "benchmark_result",
      summary: `auto result for ${todo.id}`,
    },
  });
}

function defaultSubagentRunner(): SubagentRunner {
  return async (agent, brief) => ({
    status: "success",
    summary: `${agent.id} completed ${brief.todo_title}`,
    artifacts: [
      {
        path: `D:\\ai\\agent_workflow_v0_2\\.output\\v0_2\\benchmark_subagent_${agent.id}.md`,
        type: "subagent_result",
        summary: `subagent output by ${agent.id}`,
      },
    ],
    open_questions: [],
    completion_notes: [],
    criteria_evidence: [...brief.acceptance_criteria],
  });
}

export async function evaluateE2EQuality(
  benchmarkCase: E2EBenchmarkCase,
  options: Pick<E2EBenchmarkOptions, "default_step_executor" | "default_subagent_runner"> = {},
): Promise<E2ECaseResult> {
  const state = benchmarkCase.build_initial_state();
  const output = await runTodoDrivenOrchestrator(
    { goal: benchmarkCase.goal, maxIterations: Math.max(2, benchmarkCase.max_steps ?? 6) },
    {
      initialState: state,
      maxSteps: benchmarkCase.max_steps ?? 6,
      idleStepLimit: benchmarkCase.idle_step_limit ?? 2,
      stepExecutor: benchmarkCase.build_step_executor?.() ?? options.default_step_executor ?? defaultStepExecutor(),
      subagentRunner: benchmarkCase.build_subagent_runner?.() ?? options.default_subagent_runner ?? defaultSubagentRunner(),
    },
  );

  const actionLogs = output.state.execution_log.map((entry) => ({
    action: entry.action,
    message: entry.message,
  }));
  const actions = actionLogs.map((entry) => entry.action);
  const doneTodos = output.state.todos.filter((todo) => todo.status === "done");
  const reviewConsistent = doneTodos.length === 0
    ? 0
    : doneTodos.filter((todo) => Boolean(todo.review_result)).length / doneTodos.length;

  const perDimensionScores = {
    flow_coverage: orderedCoverage(actions, benchmarkCase.expected_high_level_flow),
    key_todo_coverage: keyTodoCoverage(
      output.state.todos.map((todo) => todo.id),
      output.state.todos.map((todo) => todo.title),
      benchmarkCase.expected_key_todos,
    ),
    terminal_state_accuracy: output.state.status === benchmarkCase.expected_terminal_state ? 1 : 0,
    review_consistency: clamp01(reviewConsistent),
    log_explainability: explainabilityScore(actionLogs),
  };
  const overall = clamp01(average(Object.values(perDimensionScores)));

  const issues: string[] = [];
  if (perDimensionScores.flow_coverage < 0.7) issues.push("flow_coverage_low");
  if (perDimensionScores.key_todo_coverage < 0.7) issues.push("key_todo_coverage_low");
  if (perDimensionScores.terminal_state_accuracy < 1) issues.push("terminal_state_mismatch");
  if (perDimensionScores.review_consistency < 0.8) issues.push("review_consistency_low");
  if (perDimensionScores.log_explainability < 0.7) issues.push("log_explainability_low");

  return {
    case_id: benchmarkCase.id,
    pass: perDimensionScores.terminal_state_accuracy === 1 && perDimensionScores.flow_coverage >= 0.7,
    overall_score: overall,
    per_dimension_scores: perDimensionScores,
    issues,
    suggestions: [
      ...(perDimensionScores.flow_coverage < 0.7 ? ["补强 orchestrator 流程稳定性，保证关键动作顺序可重现。"] : []),
      ...(perDimensionScores.terminal_state_accuracy < 1 ? ["检查终态判定与 case 预期是否一致。"] : []),
      ...(perDimensionScores.log_explainability < 0.7 ? ["为关键日志补充结构化 reason 字段。"] : []),
    ],
    terminal_state: output.state.status,
    observed_actions: actions,
    details: {
      result_status: output.result.status,
      done_todo_count: doneTodos.length,
      issue_count: output.state.issues.length,
    },
  };
}

export async function runE2EBenchmark(options: E2EBenchmarkOptions = {}): Promise<E2EBenchmarkResult> {
  const selectedCases = pickCasesById(options.e2e_cases ?? e2eBenchmarkCases, options.case_ids);
  const results: E2ECaseResult[] = [];

  for (const benchmarkCase of selectedCases) {
    try {
      const caseResult = await evaluateE2EQuality(benchmarkCase, {
        default_step_executor: options.default_step_executor,
        default_subagent_runner: options.default_subagent_runner,
      });
      results.push(caseResult);
    } catch (error) {
      results.push({
        case_id: benchmarkCase.id,
        pass: false,
        overall_score: 0,
        per_dimension_scores: {
          flow_coverage: 0,
          key_todo_coverage: 0,
          terminal_state_accuracy: 0,
          review_consistency: 0,
          log_explainability: 0,
        },
        issues: ["e2e_execution_failed"],
        suggestions: ["检查 case 初始化和执行器适配是否可运行。"],
        terminal_state: "failed",
        observed_actions: [],
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const passed = results.filter((result) => result.pass).length;
  return {
    suite: "e2e",
    total_cases: results.length,
    passed_cases: passed,
    failed_cases: results.length - passed,
    aggregate_scores: aggregateDimensionScores(results),
    per_case_results: results,
    major_failure_patterns: summarizeFailurePatterns(results),
  };
}
