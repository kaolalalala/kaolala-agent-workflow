import type { RunStatus, TodoCapabilityType, TodoItem } from "../../supervisor-runtime-state";
import type {
  SubagentRunner,
  TodoExecutionContext,
  TodoExecutor,
  TodoExecutorResult,
  TodoPlanningContext,
  TodoReviewResult,
} from "../types";

export type QualitySuiteName = "planner" | "routing" | "review" | "e2e";

export interface QualityCaseResult {
  case_id: string;
  pass: boolean;
  overall_score: number;
  per_dimension_scores: Record<string, number>;
  issues: string[];
  suggestions: string[];
  details?: Record<string, unknown>;
}

export interface QualitySuiteResult<TCaseResult extends QualityCaseResult = QualityCaseResult> {
  suite: QualitySuiteName;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  aggregate_scores: Record<string, number>;
  per_case_results: TCaseResult[];
  major_failure_patterns: string[];
}

export interface PlannerBenchmarkCase {
  id: string;
  goal: string;
  category: "research" | "summary" | "writing" | "coding" | "analysis";
  expected_capabilities: TodoCapabilityType[];
  expected_todo_skeleton: string[];
  notes?: string;
  planning_context?: TodoPlanningContext;
  llm_responses?: string[];
}

export interface PlannerCaseResult extends QualityCaseResult {
  generated_todo_count: number;
  generated_capabilities: TodoCapabilityType[];
}

export interface PlannerBenchmarkOptions {
  case_ids?: string[];
  planner_cases?: PlannerBenchmarkCase[];
  plan_todos?: (benchmarkCase: PlannerBenchmarkCase) => Promise<TodoItem[]>;
}

export interface PlannerBenchmarkResult extends QualitySuiteResult<PlannerCaseResult> {
  suite: "planner";
}

export interface RoutingBenchmarkCase {
  id: string;
  todo_title: string;
  todo_description: string;
  capability_type: TodoCapabilityType;
  expected_mode: "self" | "delegate" | "split";
  expected_agent?: "research_agent" | "writer_agent";
  rationale: string;
  depends_on?: Array<{ id: string; status: "done" | "todo" }>;
  input_refs?: string[];
  artifacts?: Array<{
    id: string;
    path: string;
    type: string;
    summary: string;
    related_todo?: string;
  }>;
  notes?: string;
}

export interface RoutingCaseResult extends QualityCaseResult {
  actual_mode: "self" | "delegate" | "split";
  actual_agent?: string;
}

export interface RoutingBenchmarkOptions {
  case_ids?: string[];
  routing_cases?: RoutingBenchmarkCase[];
}

export interface RoutingBenchmarkResult extends QualitySuiteResult<RoutingCaseResult> {
  suite: "routing";
}

export interface ReviewBenchmarkCase {
  id: string;
  todo_title: string;
  todo_description: string;
  acceptance_criteria: string[];
  execution_result_sample: TodoExecutorResult;
  expected_review_status: TodoReviewResult["status"];
  expected_missing_criteria?: string[];
  notes?: string;
}

export interface ReviewCaseResult extends QualityCaseResult {
  actual_status: TodoReviewResult["status"];
  actual_missing_criteria: string[];
}

export interface ReviewBenchmarkOptions {
  case_ids?: string[];
  review_cases?: ReviewBenchmarkCase[];
}

export interface ReviewBenchmarkResult extends QualitySuiteResult<ReviewCaseResult> {
  suite: "review";
}

export interface E2EBenchmarkCase {
  id: string;
  goal: string;
  expected_high_level_flow: string[];
  expected_key_todos: string[];
  expected_terminal_state: RunStatus;
  notes?: string;
  max_steps?: number;
  idle_step_limit?: number;
  build_initial_state: () => import("../../supervisor-runtime-state").RunState;
  build_step_executor?: () => TodoExecutor;
  build_subagent_runner?: () => SubagentRunner;
}

export interface E2ECaseResult extends QualityCaseResult {
  terminal_state: RunStatus;
  observed_actions: string[];
}

export interface E2EBenchmarkOptions {
  case_ids?: string[];
  e2e_cases?: E2EBenchmarkCase[];
  default_step_executor?: TodoExecutor;
  default_subagent_runner?: SubagentRunner;
}

export interface E2EBenchmarkResult extends QualitySuiteResult<E2ECaseResult> {
  suite: "e2e";
}

export interface SupervisorQualityBenchmarkResult {
  planner: PlannerBenchmarkResult;
  routing: RoutingBenchmarkResult;
  review: ReviewBenchmarkResult;
  e2e: E2EBenchmarkResult;
  summary: {
    total_cases: number;
    passed_cases: number;
    failed_cases: number;
    suite_scores: Record<QualitySuiteName, number>;
    overall_score: number;
    major_failure_patterns: string[];
  };
}

export type ExecutionContextFactory = (
  todo: TodoItem,
  context: TodoExecutionContext,
) => TodoExecutionContext;
