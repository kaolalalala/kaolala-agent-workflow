import { addArtifact, addTodo, createRunState, type RunState } from "../../supervisor-runtime-state";
import { decideTodoExecutionMode } from "../delegation-policy";
import { aggregateDimensionScores, average, clamp01, pickCasesById, summarizeFailurePatterns } from "./shared";
import { routingBenchmarkCases } from "./routing-benchmark-cases";
import type {
  RoutingBenchmarkCase,
  RoutingBenchmarkOptions,
  RoutingBenchmarkResult,
  RoutingCaseResult,
} from "./types";

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildRoutingState(benchmarkCase: RoutingBenchmarkCase): { state: RunState; todoId: string } {
  const state = createRunState(`routing_case:${benchmarkCase.id}`);

  const dependencyIds: string[] = [];
  for (const dependency of benchmarkCase.depends_on ?? []) {
    addTodo(state, {
      id: dependency.id,
      title: `${dependency.id} dependency`,
      description: "dependency todo for routing benchmark",
      status: dependency.status,
      capability_type: "analysis",
      acceptance_criteria: ["dependency_result_available", "dependency_trace_recorded"],
      depends_on: [],
    });
    dependencyIds.push(dependency.id);
  }

  const todo = addTodo(state, {
    id: `${benchmarkCase.id}_todo`,
    title: benchmarkCase.todo_title,
    description: benchmarkCase.todo_description,
    status: "ready",
    priority: "high",
    capability_type: benchmarkCase.capability_type,
    acceptance_criteria: [
      "result_is_actionable",
      "result_can_support_followup_execution",
    ],
    depends_on: dependencyIds,
    input_refs: benchmarkCase.input_refs ?? [],
  });

  for (const artifact of benchmarkCase.artifacts ?? []) {
    addArtifact(state, {
      id: artifact.id,
      path: artifact.path,
      type: artifact.type,
      producer: "benchmark_seed",
      related_todo: artifact.related_todo ?? todo.id,
      summary: artifact.summary,
    });
  }

  return { state, todoId: todo.id };
}

function evaluateExplanationQuality(reason: string, rationale: string) {
  const lengthScore =
    reason.trim().length >= 24 ? 1
      : reason.trim().length >= 12 ? 0.7
        : reason.trim().length >= 6 ? 0.4
          : 0;
  const rationaleTokens = new Set(tokenize(rationale));
  const reasonTokens = tokenize(reason);
  const overlap = reasonTokens.filter((token) => rationaleTokens.has(token)).length;
  const overlapScore = rationaleTokens.size === 0
    ? 1
    : clamp01(overlap / rationaleTokens.size);
  return clamp01((lengthScore + overlapScore) / 2);
}

export function evaluateRoutingQuality(benchmarkCase: RoutingBenchmarkCase): RoutingCaseResult {
  const { state, todoId } = buildRoutingState(benchmarkCase);
  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo) {
    return {
      case_id: benchmarkCase.id,
      pass: false,
      overall_score: 0,
      per_dimension_scores: {
        mode_accuracy: 0,
        agent_accuracy: 0,
        split_decision_accuracy: 0,
        explanation_quality: 0,
      },
      issues: ["routing_case_setup_failed"],
      suggestions: ["检查 routing benchmark case 的依赖配置。"],
      actual_mode: "self",
    };
  }

  const decision = decideTodoExecutionMode(state, todo);
  const modeAccuracy = decision.mode === benchmarkCase.expected_mode ? 1 : 0;
  const agentAccuracy =
    benchmarkCase.expected_mode === "delegate"
      ? benchmarkCase.expected_agent === decision.target_agent_id ? 1 : 0
      : 1;
  const splitDecisionAccuracy =
    benchmarkCase.expected_mode === "split"
      ? decision.mode === "split" ? 1 : 0
      : decision.mode !== "split" ? 1 : 0;
  const explanationQuality = evaluateExplanationQuality(decision.reason, benchmarkCase.rationale);

  const perDimensionScores = {
    mode_accuracy: modeAccuracy,
    agent_accuracy: agentAccuracy,
    split_decision_accuracy: splitDecisionAccuracy,
    explanation_quality: explanationQuality,
  };
  const overall = clamp01(average(Object.values(perDimensionScores)));
  const issues: string[] = [];
  if (modeAccuracy < 1) issues.push("mode_mismatch");
  if (agentAccuracy < 1) issues.push("agent_mismatch");
  if (splitDecisionAccuracy < 1) issues.push("split_decision_mismatch");
  if (explanationQuality < 0.6) issues.push("reason_quality_low");

  return {
    case_id: benchmarkCase.id,
    pass: modeAccuracy === 1 && agentAccuracy === 1,
    overall_score: overall,
    per_dimension_scores: perDimensionScores,
    issues,
    suggestions: [
      ...(modeAccuracy < 1 ? ["调整 delegation policy 的 mode 判定规则。"] : []),
      ...(agentAccuracy < 1 ? ["校准 delegate 场景下的 target_agent_id 选择。"] : []),
      ...(explanationQuality < 0.6 ? ["增强 decision reason 的可解释性。"] : []),
    ],
    actual_mode: decision.mode,
    actual_agent: decision.target_agent_id,
    details: {
      expected_mode: benchmarkCase.expected_mode,
      expected_agent: benchmarkCase.expected_agent ?? null,
      reason: decision.reason,
    },
  };
}

export function runRoutingBenchmark(options: RoutingBenchmarkOptions = {}): RoutingBenchmarkResult {
  const selectedCases = pickCasesById(options.routing_cases ?? routingBenchmarkCases, options.case_ids);
  const results = selectedCases.map((benchmarkCase) => evaluateRoutingQuality(benchmarkCase));
  const passed = results.filter((result) => result.pass).length;

  return {
    suite: "routing",
    total_cases: results.length,
    passed_cases: passed,
    failed_cases: results.length - passed,
    aggregate_scores: aggregateDimensionScores(results),
    per_case_results: results,
    major_failure_patterns: summarizeFailurePatterns(results),
  };
}
