"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Database,
  Download,
  FileText,
  GitBranch,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface WorkflowBlueprint {
  nodes: Array<{ id: string; name: string; role: string; taskSummary: string }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>;
  rootTask: string;
}

interface Iteration {
  step?: number;
  iteration: number;
  phase: string;
  workflowSnapshot?: WorkflowBlueprint;
  runId?: string;
  runStatus?: string;
  runDurationMs?: number;
  runTotalTokens?: number;
  observationSummary?: string;
  reflectionScore?: number;
  reflectionVerdict?: string;
  reflectionFeedback?: string;
  adaptations?: string[];
  error?: string;
  banditTemplateId?: string;
  banditIsExploration?: boolean;
  planningPrompt?: string;
  planningRawResponse?: string;
  nodeQualityScores?: Array<{
    nodeId: string;
    nodeName: string;
    nodeRole: string;
    relevance: number;
    completeness: number;
    accuracy: number;
    coherence: number;
    overallScore: number;
    feedback: string;
  }>;
  startedAt: string;
  finishedAt?: string;
}

interface BanditStats {
  totalPulls: number;
  alpha: number;
  totalExperiences: number;
  templates: Array<{
    id: string;
    name: string;
    description: string;
    topology: string;
    pullCount: number;
  }>;
}

interface MetaAgentResult {
  status: "success" | "failed" | "max_steps_reached" | "max_iterations_reached";
  goal: string;
  finalOutput?: string;
  finalSummary?: string;
  finalRunId?: string;
  finalScore?: number;
  steps?: Iteration[];
  iterations: Iteration[];
  totalDurationMs: number;
  totalTokensUsed: number;
  workflowEvolution: Array<{ iteration: number; adaptations: string[] }>;
}

interface SupervisorRunStateView {
  run_id: string;
  status: "pending" | "running" | "idle" | "reviewing" | "completed" | "failed" | "blocked";
  current_todo_id: string | null;
  current_wave_id?: string | null;
  wave_count?: number;
  parallel_execution_metadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  todos: Array<{
    id: string;
    title: string;
    description?: string;
    capability_type?: string;
    priority?: string;
    assignee?: string;
    depends_on?: string[];
    acceptance_criteria?: string[];
    input_refs?: string[];
    output_ref?: string;
    retry_count?: number;
    reroute_count?: number;
    delegation_status?: string;
    assignee_history?: string[];
    notes?: string[];
    last_failure_reason?: string;
    last_missing_criteria?: string[];
    last_recovery_action?: string;
    forced_target_agent_id?: string;
    retry_improvement_directive?: string;
    recovery_history?: Array<{
      timestamp: string;
      action: string;
      reason: string;
      target_agent_id?: string;
      wave_id?: string | null;
    }>;
    status: string;
    review_result?: string;
  }>;
  artifacts?: Array<{
    id: string;
    path: string;
    type: string;
    producer: string;
    related_todo: string;
    summary: string;
  }>;
  workspace_files?: Array<{
    file_id: string;
    path: string;
    kind: string;
    related_todo: string;
    producer: string;
    content_summary: string;
    scope?: string;
    retention?: string;
  }>;
  execution_log?: Array<{
    timestamp: string;
    todo_id: string;
    actor: string;
    action: string;
    message: string;
  }>;
  wave_history?: Array<{
    wave_id: string;
    todo_ids: string[];
    created_at: string;
    completed_at?: string;
    selection_reason_summary: string[];
    execution_mode_per_todo: Array<{
      todo_id: string;
      mode: "self" | "delegate" | "split";
      reason: string;
      target_agent_id?: string;
    }>;
    result_summary_per_todo: Array<{
      todo_id: string;
      status: "success" | "error";
      summary: string;
      error_message?: string;
    }>;
    review_outcome_per_todo: Array<{
      todo_id: string;
      status: "pass" | "revise" | "split" | "fail";
      reason: string;
    }>;
  }>;
  issues: Array<{
    id: string;
    todo_id?: string;
    type: string;
    message: string;
    status: string;
  }>;
}

interface TrainingStats {
  counts: Record<string, number>;
  availableExports: Array<{
    format: string;
    description: string;
    sampleCount: number;
  }>;
}

interface MetaAgentSession {
  status: "running" | "done" | "error";
  goal: string;
  startedAt: string;
  currentPhase?: string;
  currentStep?: number;
  currentIteration?: number;
  errorMessage?: string;
  steps?: Iteration[];
  iterations: Iteration[];
  supervisorRunState?: SupervisorRunStateView;
  projectId?: string;
  runConfig?: {
    projectId: string;
    maxPlanningRounds: number;
    maxStepLimit: number;
    qualityThreshold: number;
    workflowTemplateId?: string;
  };
  planningContextSummary?: {
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
  };
  controlPlaneSummary?: {
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
      mode: "none";
      summary: string;
    };
    checkpointCount: number;
    replayCandidateCount: number;
    currentTodoId: string | null;
    currentWaveId: string | null;
  };
  checkpoints?: Array<{
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
  }>;
  replayCandidates?: Array<{
    replayId: string;
    checkpointId: string;
    step: number;
    label: string;
    scope: "full" | "partial";
    preservedArtifactCount: number;
    incompleteTodoIds: string[];
  }>;
  pendingInput?: {
    awaiting: boolean;
    prompt: string;
    requestedAt: string;
    timeoutAt: string;
    inputToken?: string;
  };
  memoryWritebackSummary?: {
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
  };
  result: MetaAgentResult | null;
}

interface SessionListItem {
  sessionId: string;
  status: "running" | "done" | "error";
  resultStatus?: "success" | "failed" | "max_steps_reached" | "max_iterations_reached";
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
}

type MetaAgentStreamConnectionState =
  | "idle"
  | "connecting"
  | "streaming"
  | "reconnecting"
  | "closed"
  | "error";

interface MetaAgentLogLineEvent {
  type: "log_line";
  sessionId: string;
  seq: number;
  timestamp: string;
  todo_id: string;
  actor: string;
  action: string;
  message: string;
}

interface MetaAgentStepProgressEvent {
  type: "step_progress";
  sessionId: string;
  seq: number;
  step: number;
  phase: string;
  reflectionScore?: number;
  reflectionVerdict?: string;
  todoSummary: Array<{
    id: string;
    title: string;
    status: string;
    retry_count: number;
  }>;
  totalTokens: number;
  llmCallCount: number;
}

interface MetaAgentSessionStateEvent {
  type: "session_state";
  sessionId: string;
  seq: number;
  status: "running" | "done" | "failed" | "awaiting_input";
  inputPrompt?: string;
  inputToken?: string;
}

type MetaAgentSessionEvent =
  | MetaAgentLogLineEvent
  | MetaAgentStepProgressEvent
  | MetaAgentSessionStateEvent;

interface MetaAgentStreamRecord {
  receivedAt: string;
  event: MetaAgentSessionEvent;
}

interface PendingHumanInputState {
  prompt: string;
  token: string;
  requestedAt: string;
}

const sectionCard =
  "rounded-3xl border border-black/[0.06] bg-white/80 shadow-sm backdrop-blur dark:border-white/[0.06] dark:bg-white/[0.03]";

function getStreamConnectionLabel(state: MetaAgentStreamConnectionState) {
  switch (state) {
    case "connecting":
      return "连接中";
    case "streaming":
      return "流式同步中";
    case "reconnecting":
      return "重连中";
    case "closed":
      return "已关闭";
    case "error":
      return "连接异常";
    default:
      return "待连接";
  }
}

function getStreamSessionStateLabel(status: MetaAgentSessionStateEvent["status"]) {
  switch (status) {
    case "awaiting_input":
      return "等待人工输入";
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "failed":
      return "已失败";
    default:
      return status;
  }
}

const phaseLabels: Record<string, string> = {
  plan: "规划",
  execute: "执行",
  observe: "观测",
  reflect: "反思",
  adapt: "调整",
};

const verdictColors: Record<string, string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-rose-600 dark:text-rose-400",
};

const TRACE_ACTION_LABELS: Record<string, string> = {
  plan_initial_todos: "生成初始 Todo",
  plan_failed: "初始规划失败",
  select_todo: "选择当前 Todo",
  decide_mode: "执行模式决策",
  self_execute: "主管理器自执行",
  delegate: "委派子 Agent",
  split: "拆分 Todo",
  subagent_return: "子 Agent 返回结果",
  review_pass: "评审通过",
  review_revise: "评审要求修订",
  review_split: "评审要求拆分",
  review_fail: "评审失败",
  review_retry_scheduled: "评审失败后自动重试",
  wave_created: "创建并行波次",
  wave_item_started: "波次任务启动",
  wave_item_completed: "波次任务完成",
  wave_review_completed: "波次评审完成",
  wave_review_retry_scheduled: "波次评审失败后自动重试",
  wave_guard_triggered: "并行保护触发",
  terminal_state_determined: "判定运行终态",
  idle: "本轮空转",
  step_exception: "运行步骤异常",
  execution_exception: "执行异常",
  review_exception: "评审异常",
  wave_item_failed: "波次任务失败",
};

Object.assign(TRACE_ACTION_LABELS, {
  replan_applied: "重规划已应用",
  replan_skipped: "跳过重规划",
  context_compacted: "执行上下文压缩",
  offload_decided: "结果外卸决策",
  workspace_file_written: "写入工作区文件",
  inline_artifact_written: "写入内联产物",
  workspace_readback: "工作区内容回读",
  final_synthesis: "最终结果总结",
  llm_usage: "LLM 用量记录",
  delegate_prompt_profile: "委派 Prompt 画像",
});

const CAPABILITY_LABELS: Record<string, string> = {
  planning: "规划",
  research: "调研",
  collection: "收集",
  writing: "交付",
  analysis: "分析",
  review: "评审",
  verification: "校验",
  merge: "合并",
  browser_ops: "浏览器操作",
  terminal_ops: "终端操作",
  general: "通用",
};

const TRACE_ISSUE_LABELS: Record<string, string> = {
  todo_planning_failed: "Todo 规划失败",
  todo_review_failed: "Todo 评审失败",
  run_blocked: "运行阻塞",
  critical_failure: "关键失败",
  run_failed_no_recovery: "运行失败且无恢复路径",
  max_iterations_reached: "达到最大步骤上限",
  max_steps_reached: "达到最大步骤上限",
  critical_executor_error: "执行器关键异常",
  critical_review_error: "评审关键异常",
  critical_wave_review_error: "并行评审关键异常",
  critical_wave_guard: "并行所有权保护触发",
  critical_state_transition_error: "状态流转异常",
  critical_orchestrator_runtime_error: "编排器运行时异常",
  critical_orchestrator_step_error: "编排步骤异常",
};

const TRACE_REASON_LABELS: Record<string, string> = {
  self: "自执行",
  delegate: "委派执行",
  split: "先拆分再执行",
  pass: "通过",
  revise: "需修订",
  fail: "失败",
  running: "运行中",
  completed: "已完成",
  blocked: "已阻塞",
  idle: "空转中",
  pending: "等待启动",
  ready: "就绪",
  reviewing: "评审中",
  done: "完成",
  delegated: "已委派",
  returned_success: "子 Agent 成功返回",
  returned_error: "子 Agent 返回失败",
  all_todos_done_and_no_pending_pointer: "所有 Todo 均完成且不存在未清理的当前指针",
  max_iterations_reached_before_terminal_state: "达到最大步骤上限前未进入最终终态",
  max_step_limit_reached_before_terminal_state: "达到最大步骤上限前未进入最终终态",
  critical_open_issue_and_no_actionable_todos: "存在关键未解决问题且没有可继续推进的 Todo",
  no_ready_or_running_todo_with_waiting_backlog: "没有 ready/running Todo，且仍有等待积压任务",
  waiting_backlog_but_idle_limit_not_reached: "仍有积压任务，但空转次数未超阈值",
  failed_todos_present_without_recoverable_path: "存在失败 Todo 且没有可恢复路径",
  transient_idle_no_action_in_this_step: "当前步没有可执行动作（短暂空转）",
  actionable_todos_available: "存在可执行 Todo，继续推进",
};

Object.assign(TRACE_REASON_LABELS, {
  no_change: "无需重规划",
  add_todos: "补充 Todo",
  prune_todos: "剪枝 Todo",
  replace_plan: "替换计划",
  workspace_summary: "读取工作区摘要",
  workspace_full: "读取工作区全文",
  inline: "内联存储",
  workspace: "工作区存储",
});

const TRACE_TEXT_REPLACEMENTS: Array<{ from: RegExp; to: string }> = [
  { from: /Most acceptance criteria are not satisfied\./gi, to: "大多数验收标准未满足。" },
  { from: /Partially satisfied; revision required\./gi, to: "部分满足，需要修订。" },
  { from: /All acceptance criteria are satisfied\./gi, to: "所有验收标准均已满足。" },
  { from: /Execution raised multiple open questions; splitting todo is recommended\./gi, to: "执行中出现多个开放问题，建议拆分 Todo。" },
  { from: /Executor returned error status\./gi, to: "执行器返回错误状态。" },
  { from: /Todo should be split into smaller steps\./gi, to: "该 Todo 建议拆分为更小步骤。" },
];

function localizeTraceText(raw: string | null | undefined) {
  const text = String(raw ?? "").trim();
  if (!text) return "-";

  if (TRACE_REASON_LABELS[text]) return TRACE_REASON_LABELS[text];
  if (TRACE_ISSUE_LABELS[text]) return TRACE_ISSUE_LABELS[text];

  let translated = text;
  for (const rule of TRACE_TEXT_REPLACEMENTS) {
    translated = translated.replace(rule.from, rule.to);
  }

  if (TRACE_REASON_LABELS[translated]) return TRACE_REASON_LABELS[translated];
  if (TRACE_ISSUE_LABELS[translated]) return TRACE_ISSUE_LABELS[translated];

  if (/^[a-z0-9_]+$/i.test(translated) && translated.includes("_")) {
    const key = translated.toLowerCase();
    if (TRACE_REASON_LABELS[key]) return TRACE_REASON_LABELS[key];
    if (TRACE_ISSUE_LABELS[key]) return TRACE_ISSUE_LABELS[key];
    return translated.replace(/_/g, " ");
  }
  return translated;
}

function localizeAction(action: string) {
  return TRACE_ACTION_LABELS[action] ?? action;
}

function localizeIssueType(type: string) {
  return TRACE_ISSUE_LABELS[type] ?? type;
}

function localizeCapability(value: string | null | undefined) {
  const key = String(value ?? "").trim();
  if (!key) return "-";
  return CAPABILITY_LABELS[key] ?? localizeTraceText(key);
}

function localizeTraceValue(value: unknown): unknown {
  if (typeof value === "string") return localizeTraceText(value);
  if (Array.isArray(value)) return value.map((item) => localizeTraceValue(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = localizeTraceValue(v);
    }
    return out;
  }
  return value;
}

export default function MetaAgentPage() {
  return (
    <Suspense fallback={<MetaAgentPageFallback />}>
      <MetaAgentPageContent />
    </Suspense>
  );
}

function MetaAgentPageContent() {
  const searchParams = useSearchParams();
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("default_project");
  const [maxPlanningRounds, setMaxPlanningRounds] = useState(3);
  const [maxStepLimit, setMaxStepLimit] = useState(12);
  const [threshold, setThreshold] = useState(0.7);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [livePhase, setLivePhase] = useState<string | undefined>();
  const [liveIteration, setLiveIteration] = useState<number | undefined>();
  const [liveSteps, setLiveSteps] = useState<Iteration[]>([]);
  const [liveRunState, setLiveRunState] = useState<SupervisorRunStateView | null>(null);
  const [finalRunState, setFinalRunState] = useState<SupervisorRunStateView | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [traceLogLimit, setTraceLogLimit] = useState(120);
  const [result, setResult] = useState<MetaAgentResult | null>(null);
  const [error, setError] = useState("");
  const [expandedIter, setExpandedIter] = useState<Set<number>>(new Set());
  const [sessionSnapshot, setSessionSnapshot] = useState<MetaAgentSession | null>(null);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [sessionProjectFilter, setSessionProjectFilter] = useState("all");
  const [sessionSearch, setSessionSearch] = useState("");
  const [currentProjectOnly, setCurrentProjectOnly] = useState(false);
  const [sessionActionLoadingId, setSessionActionLoadingId] = useState<string | null>(null);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);
  const [banditStats, setBanditStats] = useState<BanditStats | null>(null);
  const [banditLoading, setBanditLoading] = useState(false);
  const [showBandit, setShowBandit] = useState(false);
  const [trainingStats, setTrainingStats] = useState<TrainingStats | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [showTraining, setShowTraining] = useState(false);
  const [streamRecords, setStreamRecords] = useState<MetaAgentStreamRecord[]>([]);
  const [streamConnectionState, setStreamConnectionState] = useState<MetaAgentStreamConnectionState>("idle");
  const [streamError, setStreamError] = useState("");
  const [streamLastSeq, setStreamLastSeq] = useState(-1);
  const [pendingHumanInput, setPendingHumanInput] = useState<PendingHumanInputState | null>(null);
  const [humanInputDraft, setHumanInputDraft] = useState("");
  const [submittingHumanInput, setSubmittingHumanInput] = useState(false);
  const autoLoadedSessionIdRef = useRef<string | null>(null);
  const streamLastSeqRef = useRef(-1);
  const streamSessionIdRef = useRef<string | null>(null);

  /** Fetch Bandit stats */
  const refreshBanditStats = useCallback(async () => {
    try {
      const res = await fetch("/api/meta-agent/bandit");
      if (res.ok) setBanditStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  /** Cold-start training */
  const onColdStart = useCallback(async () => {
    setBanditLoading(true);
    try {
      const res = await fetch("/api/meta-agent/bandit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cold_start", limit: 50 }),
      });
      if (res.ok) await refreshBanditStats();
    } catch { /* ignore */ }
    setBanditLoading(false);
  }, [refreshBanditStats]);

  /** Reset Bandit model */
  const onResetBandit = useCallback(async () => {
    setBanditLoading(true);
    try {
      await fetch("/api/meta-agent/bandit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      await refreshBanditStats();
    } catch { /* ignore */ }
    setBanditLoading(false);
  }, [refreshBanditStats]);

  /** Fetch training data stats */
  const refreshTrainingStats = useCallback(async () => {
    try {
      const res = await fetch("/api/meta-agent/training?action=stats");
      if (res.ok) setTrainingStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  /** Collect training data from all sources */
  const onCollectTraining = useCallback(async () => {
    setTrainingLoading(true);
    try {
      await fetch("/api/meta-agent/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "collect" }),
      });
      await refreshTrainingStats();
    } catch { /* ignore */ }
    setTrainingLoading(false);
  }, [refreshTrainingStats]);

  /** Export training data in a specific format */
  const onExportTraining = useCallback(async (format: string) => {
    setTrainingLoading(true);
    try {
      const res = await fetch("/api/meta-agent/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export", format, minReward: 0.5 }),
      });
      if (!res.ok) return;
      const data = await res.json();

      // Download as file
      if (data.jsonl) {
        const blob = new Blob([data.jsonl], { type: "application/jsonl" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename || `${format}.jsonl`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (data.exports) {
        for (const exp of data.exports) {
          if (!exp.jsonl || exp.sampleCount === 0) continue;
          const blob = new Blob([exp.jsonl], { type: "application/jsonl" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = exp.filename || `${exp.format}.jsonl`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch { /* ignore */ }
    setTrainingLoading(false);
  }, []);

  /** Clear all training data */
  const onClearTraining = useCallback(async () => {
    if (!confirm("确定清空所有训练数据？此操作不可撤销。")) return;
    setTrainingLoading(true);
    try {
      await fetch("/api/meta-agent/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      await refreshTrainingStats();
    } catch { /* ignore */ }
    setTrainingLoading(false);
  }, [refreshTrainingStats]);

  // Load Bandit stats on mount
  useEffect(() => { void refreshBanditStats(); }, [refreshBanditStats]);

  // Load training stats on mount
  useEffect(() => { void refreshTrainingStats(); }, [refreshTrainingStats]);

  const applySessionToView = useCallback((nextSessionId: string, session: MetaAgentSession) => {
    const resolvedProjectId =
      session.runConfig?.projectId
      ?? session.projectId
      ?? (typeof session.supervisorRunState?.metadata?.project_id === "string"
        ? session.supervisorRunState.metadata.project_id
        : "default_project");
    setSessionId(nextSessionId);
    setSessionSnapshot(session);
    setGoal(session.goal);
    setProjectId(resolvedProjectId);
    setLivePhase(session.currentPhase);
    setLiveIteration(session.currentStep ?? session.currentIteration);

    const nextSteps = Array.isArray(session.steps)
      ? session.steps
      : (Array.isArray(session.iterations) ? session.iterations : []);
    setLiveSteps(nextSteps);
    setLiveRunState(session.status === "running" ? (session.supervisorRunState ?? null) : null);
    setFinalRunState(session.status === "running" ? null : (session.supervisorRunState ?? null));
    setResult(session.result ?? null);
    setSelectedCheckpointId(session.checkpoints?.[session.checkpoints.length - 1]?.checkpointId ?? null);
    setExpandedIter(new Set((session.result?.steps ?? session.result?.iterations ?? nextSteps).map((it) => it.step ?? it.iteration)));
    setRunning(session.status === "running");
    setShowTrace(true);
    setPendingHumanInput(session.pendingInput?.awaiting
      ? {
          prompt: session.pendingInput.prompt,
          token: session.pendingInput.inputToken || "",
          requestedAt: session.pendingInput.requestedAt,
        }
      : null);
    setError(session.status === "error" ? (session.errorMessage || "Meta-Agent 执行失败") : "");
  }, []);

  const refreshSessionList = useCallback(async () => {
    setSessionListLoading(true);
    try {
      const res = await fetch("/api/meta-agent");
      if (!res.ok) return;
      const data = await res.json();
      setSessionList(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      // ignore
    } finally {
      setSessionListLoading(false);
    }
  }, []);

  const loadSessionSnapshot = useCallback(async (targetSessionId: string) => {
    try {
      const res = await fetch(`/api/meta-agent?sessionId=${encodeURIComponent(targetSessionId)}`);
      const data: MetaAgentSession | { error?: string } = await res.json();
      if (!res.ok) {
        const message = "error" in data && data.error ? data.error : `HTTP ${res.status}`;
        throw new Error(message);
      }
      applySessionToView(targetSessionId, data as MetaAgentSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 Session 失败");
    }
  }, [applySessionToView]);

  const refreshPendingHumanInput = useCallback(async (targetSessionId: string) => {
    try {
      const res = await fetch(`/api/meta-agent/input?sessionId=${encodeURIComponent(targetSessionId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      if (data?.awaiting && typeof data.inputToken === "string") {
        setPendingHumanInput((current) => ({
          prompt: typeof data.prompt === "string" && data.prompt.trim()
            ? data.prompt
            : (current?.prompt || "Planner 已暂停，等待你确认计划或补充说明后继续执行。"),
          token: data.inputToken,
          requestedAt: typeof data.requestedAt === "string" && data.requestedAt
            ? data.requestedAt
            : (current?.requestedAt || new Date().toISOString()),
        }));
      } else {
        setPendingHumanInput(null);
        setHumanInputDraft("");
      }
    } catch {
      // ignore
    }
  }, []);

  const appendStreamRecord = useCallback((event: MetaAgentSessionEvent) => {
    if (typeof event.seq === "number" && event.seq >= 0) {
      streamLastSeqRef.current = Math.max(streamLastSeqRef.current, event.seq);
      setStreamLastSeq(streamLastSeqRef.current);
    }

    setStreamRecords((current) => {
      if (current.some((item) => item.event.seq === event.seq && item.event.type === event.type)) {
        return current;
      }
      const next = [...current, { receivedAt: new Date().toISOString(), event }]
        .sort((left, right) => left.event.seq - right.event.seq);
      return next.slice(-180);
    });

    if (event.type === "log_line") {
      return;
    }

    if (event.type === "step_progress") {
      setLivePhase(event.phase);
      setLiveIteration(event.step);
      return;
    }

    if (event.status === "awaiting_input") {
      setPendingHumanInput({
        prompt: event.inputPrompt || "Planner 已暂停，等待你确认计划或补充说明后继续执行。",
        token: event.inputToken || "",
        requestedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.status === "running") {
      setPendingHumanInput(null);
      setHumanInputDraft("");
      return;
    }

    if (event.status === "done" || event.status === "failed") {
      setPendingHumanInput(null);
      setHumanInputDraft("");
    }
  }, []);

  const onSubmitHumanInput = useCallback(async (value: string) => {
    if (!sessionId || !pendingHumanInput?.token || submittingHumanInput) return;

    setSubmittingHumanInput(true);
    setError("");
    try {
      const res = await fetch("/api/meta-agent/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          inputToken: pendingHumanInput.token,
          value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setPendingHumanInput(null);
      setHumanInputDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交人工输入失败");
    } finally {
      setSubmittingHumanInput(false);
    }
  }, [pendingHumanInput?.token, sessionId, submittingHumanInput]);

  const availableSessionProjects = useMemo(
    () => Array.from(new Set(sessionList.map((session) => session.projectId).filter(Boolean))).sort(),
    [sessionList],
  );

  const filteredSessionList = useMemo(() => {
    const needle = sessionSearch.trim().toLowerCase();
    return sessionList.filter((session) => {
      if (currentProjectOnly && session.projectId !== projectId) {
        return false;
      }
      if (sessionProjectFilter !== "all" && session.projectId !== sessionProjectFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [
        session.sessionId,
        session.goal,
        session.projectId,
        session.currentPhase,
        session.runStatus,
      ]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [currentProjectOnly, projectId, sessionList, sessionProjectFilter, sessionSearch]);

  const onCopySessionLink = useCallback(async (targetSessionId: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("sessionId", targetSessionId);
      await navigator.clipboard.writeText(url.toString());
    } catch {
      setError("复制 Session 链接失败");
    }
  }, []);

  const onExportSession = useCallback(async (targetSessionId: string) => {
    setSessionActionLoadingId(targetSessionId);
    try {
      const res = await fetch(`/api/meta-agent?sessionId=${encodeURIComponent(targetSessionId)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meta_agent_session_${targetSessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出 Session 失败");
    } finally {
      setSessionActionLoadingId((current) => (current === targetSessionId ? null : current));
    }
  }, []);

  const onDeleteSession = useCallback(async (targetSessionId: string) => {
    const confirmed = window.confirm(`确认删除历史运行 ${targetSessionId} 吗？`);
    if (!confirmed) return;

    setSessionActionLoadingId(targetSessionId);
    try {
      const res = await fetch(`/api/meta-agent?sessionId=${encodeURIComponent(targetSessionId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      if (sessionId === targetSessionId) {
        setSessionId(null);
        setSessionSnapshot(null);
        setResult(null);
        setLiveSteps([]);
        setLiveRunState(null);
        setFinalRunState(null);
        setLivePhase(undefined);
        setLiveIteration(undefined);
        setShowTrace(false);
        setSelectedCheckpointId(null);
      }

      setSessionList((prev) => prev.filter((session) => session.sessionId !== targetSessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除 Session 失败");
    } finally {
      setSessionActionLoadingId((current) => (current === targetSessionId ? null : current));
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshSessionList();
    const timer = setInterval(() => {
      void refreshSessionList();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshSessionList]);

  useEffect(() => {
    if (!sessionSnapshot?.checkpoints?.length) return;
    const stillExists = sessionSnapshot.checkpoints.some((item) => item.checkpointId === selectedCheckpointId);
    if (stillExists) return;
    setSelectedCheckpointId(sessionSnapshot.checkpoints[sessionSnapshot.checkpoints.length - 1]?.checkpointId ?? null);
  }, [sessionSnapshot, selectedCheckpointId]);

  useEffect(() => {
    const requestedSessionId = searchParams.get("sessionId");
    if (!requestedSessionId) return;
    if (requestedSessionId === sessionId) {
      autoLoadedSessionIdRef.current = requestedSessionId;
      return;
    }
    if (autoLoadedSessionIdRef.current === requestedSessionId) return;
    autoLoadedSessionIdRef.current = requestedSessionId;
    void loadSessionSnapshot(requestedSessionId);
  }, [loadSessionSnapshot, searchParams, sessionId]);

  useEffect(() => {
    const requestedProjectId = searchParams.get("projectId");
    if (!requestedProjectId) return;
    if (sessionId) return;
    setProjectId(requestedProjectId);
  }, [searchParams, sessionId]);

  useEffect(() => {
    if (streamSessionIdRef.current === sessionId) return;

    streamSessionIdRef.current = sessionId;
    streamLastSeqRef.current = -1;
    setStreamLastSeq(-1);
    setStreamRecords([]);
    setStreamError("");
    setPendingHumanInput(null);
    setHumanInputDraft("");
    setSubmittingHumanInput(false);
    setStreamConnectionState(sessionId ? "connecting" : "idle");
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !running) return;

    let cancelled = false;

    const syncGateState = async () => {
      await refreshPendingHumanInput(sessionId);
    };

    void syncGateState();
    const timer = setInterval(() => {
      if (cancelled) return;
      void syncGateState();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshPendingHumanInput, running, sessionId]);

  useEffect(() => {
    if (!sessionId || !running) return;

    let closed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let source: EventSource | null = null;

    const cleanup = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      source?.close();
      source = null;
    };

    const connect = () => {
      if (closed) return;

      const afterSeq = streamLastSeqRef.current;
      const url = `/api/meta-agent/stream?sessionId=${encodeURIComponent(sessionId)}&afterSeq=${afterSeq}`;
      setStreamConnectionState(reconnectAttempts > 0 ? "reconnecting" : "connecting");
      source = new EventSource(url);

      source.onopen = () => {
        if (closed) return;
        reconnectAttempts = 0;
        setStreamConnectionState("streaming");
        setStreamError("");
      };

      source.onmessage = (message) => {
        if (closed) return;
        try {
          const event = JSON.parse(message.data) as MetaAgentSessionEvent;
          appendStreamRecord(event);

          if (event.type === "session_state" && (event.status === "done" || event.status === "failed")) {
            closed = true;
            cleanup();
            setStreamConnectionState("closed");
            setRunning(false);
            void loadSessionSnapshot(sessionId);
            void refreshSessionList();
          }
        } catch {
          // ignore malformed stream frame
        }
      };

      source.onerror = () => {
        cleanup();
        if (closed) return;

        if (reconnectAttempts >= 6) {
          setStreamConnectionState("error");
          setStreamError("流式连接已中断，页面会继续依赖快照轮询。");
          return;
        }

        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10_000);
        reconnectAttempts += 1;
        setStreamConnectionState("reconnecting");
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      cleanup();
    };
  }, [appendStreamRecord, loadSessionSnapshot, refreshSessionList, running, sessionId]);

  const toggleIter = useCallback((n: number) => {
    setExpandedIter((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const onRun = useCallback(async () => {
    if (!goal.trim() || running) return;
    setRunning(true);
    setSessionId(null);
    setLivePhase("plan");
    setLiveIteration(1);
    setLiveSteps([]);
    setLiveRunState(null);
    setFinalRunState(null);
    setShowTrace(true);
    setTraceLogLimit(120);
    setResult(null);
    setError("");
    setExpandedIter(new Set());
    setSessionSnapshot(null);
    setSelectedCheckpointId(null);

    try {
      const res = await fetch("/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          projectId: projectId.trim() || "default_project",
          maxPlanningRounds,
          maxStepLimit,
          maxIterations: maxPlanningRounds,
          qualityThreshold: threshold,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (!data.sessionId || typeof data.sessionId !== "string") {
        throw new Error("Meta-Agent 未返回有效 sessionId");
      }

      setSessionId(data.sessionId);
      void refreshSessionList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meta-Agent 执行失败");
      setRunning(false);
    }
  }, [goal, projectId, maxPlanningRounds, maxStepLimit, threshold, running, refreshSessionList]);

  useEffect(() => {
    if (!running || !sessionId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/meta-agent?sessionId=${encodeURIComponent(sessionId)}`);
        const data: MetaAgentSession | { error?: string } = await res.json();
        if (!res.ok) {
          const message = "error" in data && data.error ? data.error : `HTTP ${res.status}`;
          throw new Error(message);
        }
        if (cancelled) return;

        const session = data as MetaAgentSession;
        setSessionSnapshot(session);
        setLivePhase(session.currentPhase);
        setLiveIteration(session.currentStep ?? session.currentIteration);
        setLiveSteps(Array.isArray(session.steps) ? session.steps : (Array.isArray(session.iterations) ? session.iterations : []));
        setLiveRunState(session.supervisorRunState ?? null);
        setPendingHumanInput(session.pendingInput?.awaiting
          ? {
              prompt: session.pendingInput.prompt,
              token: session.pendingInput.inputToken || "",
              requestedAt: session.pendingInput.requestedAt,
            }
          : null);

        if (session.status === "done" || session.status === "error") {
          setRunning(false);
          setLivePhase(undefined);
          setLiveIteration(undefined);
          setFinalRunState(session.supervisorRunState ?? null);
          if (session.result) {
            setResult(session.result);
            setExpandedIter(new Set((session.result.steps ?? session.result.iterations).map((it) => it.step ?? it.iteration)));
          }
          if (session.status === "error") {
            setError(session.errorMessage || "Meta-Agent 执行失败");
          }
        }
      } catch (err) {
        if (cancelled) return;
        setRunning(false);
        setError(err instanceof Error ? err.message : "轮询 Meta-Agent 状态失败");
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, sessionId]);

  const displayIterations = useMemo(
    () => (running ? liveSteps : (result?.steps ?? result?.iterations ?? [])),
    [running, liveSteps, result],
  );

  const traceRunState = useMemo(
    () => (running ? liveRunState : (finalRunState ?? liveRunState)),
    [running, liveRunState, finalRunState],
  );

  const traceExecutionLogs = useMemo(() => {
    const logs = Array.isArray(traceRunState?.execution_log) ? traceRunState.execution_log : [];
    return logs.slice(Math.max(0, logs.length - traceLogLimit));
  }, [traceRunState, traceLogLimit]);

  const traceWaves = useMemo(
    () => (Array.isArray(traceRunState?.wave_history) ? traceRunState.wave_history : []),
    [traceRunState],
  );

  const parseTraceMessage = useCallback((raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, []);

  const onDownloadTrace = useCallback(() => {
    if (!traceRunState) return;
    const payload = {
      exported_at: new Date().toISOString(),
      session_id: sessionId,
      goal,
      run_state: traceRunState,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meta_agent_trace_${traceRunState.run_id || "unknown"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [traceRunState, sessionId, goal]);

  const onDownloadCheckpoint = useCallback(() => {
    const checkpoint =
      sessionSnapshot?.checkpoints?.find((item) => item.checkpointId === selectedCheckpointId)
      ?? null;
    if (!checkpoint) return;
    const payload = {
      exported_at: new Date().toISOString(),
      session_id: sessionId,
      goal,
      checkpoint,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meta_agent_checkpoint_${checkpoint.step}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessionSnapshot, selectedCheckpointId, sessionId, goal]);

  const traceFlowOrder = useMemo(() => {
    if (!traceRunState) return [] as SupervisorRunStateView["todos"];
    const todos = traceRunState.todos ?? [];
    const todoMap = new Map(todos.map((todo) => [todo.id, todo]));
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();

    for (const todo of todos) {
      indegree.set(todo.id, todo.depends_on?.length ?? 0);
      outgoing.set(todo.id, []);
    }
    for (const todo of todos) {
      for (const dep of todo.depends_on ?? []) {
        if (!outgoing.has(dep)) continue;
        outgoing.get(dep)!.push(todo.id);
      }
    }

    const queue = todos
      .filter((todo) => (indegree.get(todo.id) ?? 0) === 0)
      .map((todo) => todo.id);
    const ordered: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      for (const next of outgoing.get(current) ?? []) {
        const val = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, val);
        if (val === 0) queue.push(next);
      }
    }

    if (ordered.length !== todos.length) return todos;
    return ordered.map((id) => todoMap.get(id)).filter(Boolean) as SupervisorRunStateView["todos"];
  }, [traceRunState]);

  const traceDelegationView = useMemo(() => {
    if (!traceRunState) return [] as Array<{ todoId: string; target: string; status: string; reason: string }>;
    const rows: Array<{ todoId: string; target: string; status: string; reason: string }> = [];

    for (const log of traceRunState.execution_log ?? []) {
      if (log.action !== "delegate") continue;
      const parsed = parseTraceMessage(log.message);
      const target = typeof parsed?.target_agent_id === "string" ? parsed.target_agent_id : "unknown_agent";
      const reason = typeof parsed?.reason === "string" ? parsed.reason : log.message;
      rows.push({
        todoId: log.todo_id,
        target,
        status: "delegated",
        reason: localizeTraceText(reason),
      });
    }

    for (const log of traceRunState.execution_log ?? []) {
      if (log.action !== "subagent_return") continue;
      const parsed = parseTraceMessage(log.message);
      const status = typeof parsed?.status === "string" ? parsed.status : "unknown";
      const matched = rows.find((item) => item.todoId === log.todo_id && item.status === "delegated");
      if (matched) {
        matched.status = status === "success" ? "returned_success" : "returned_error";
      } else {
        rows.push({
          todoId: log.todo_id,
          target: log.actor || "unknown_agent",
          status: status === "success" ? "returned_success" : "returned_error",
          reason: localizeTraceText(typeof parsed?.error_message === "string" ? parsed.error_message : ""),
        });
      }
    }
    return rows;
  }, [traceRunState, parseTraceMessage]);

  const traceTimelineView = useMemo(() => {
    return traceExecutionLogs.map((log) => {
      const parsed = parseTraceMessage(log.message);
      const localizedPayload = parsed ? localizeTraceValue(parsed) as Record<string, unknown> : null;
      return {
        ...log,
        actionLabel: localizeAction(log.action),
        rawMessageLocalized: localizeTraceText(log.message),
        localizedPayload,
      };
    });
  }, [traceExecutionLogs, parseTraceMessage]);

  const runtimeSignals = useMemo(() => {
    if (!traceRunState) return null;

    const todos = traceRunState.todos ?? [];
    const currentTodo = traceRunState.current_todo_id
      ? todos.find((todo) => todo.id === traceRunState.current_todo_id)
      : undefined;
    const stepBudget = sessionSnapshot?.runConfig?.maxStepLimit ?? maxStepLimit;
    const stepUsed =
      sessionSnapshot?.currentStep
      ?? liveIteration
      ?? displayIterations[displayIterations.length - 1]?.step
      ?? displayIterations.length;

    return {
      controlFocus:
        currentTodo?.assignee
        ?? (traceRunState.current_wave_id ? "parallel_wave_controller" : "supervisor"),
      stepBudget,
      stepUsed,
      stepRemaining: Math.max(0, stepBudget - stepUsed),
      todoCount: todos.length,
      doneTodos: todos.filter((todo) => todo.status === "done").length,
      readyTodos: todos.filter((todo) => todo.status === "ready").length,
      activeTodos: todos.filter((todo) => todo.status === "in_progress").length,
      failedTodos: todos.filter((todo) => todo.status === "failed").length,
      delegatedTodos: todos.filter((todo) => todo.delegation_status === "delegated").length,
      splitTodos: todos.filter((todo) => todo.delegation_status === "split").length,
      retryTotal: todos.reduce((sum, todo) => sum + Number(todo.retry_count ?? 0), 0),
      rerouteTotal: todos.reduce((sum, todo) => sum + Number(todo.reroute_count ?? 0), 0),
      recoveryTotal: todos.reduce((sum, todo) => sum + Number(todo.recovery_history?.length ?? 0), 0),
      openIssues: traceRunState.issues.filter((issue) => issue.status === "open").length,
      llmCalls: Number(traceRunState.metadata?.llm_call_count ?? 0),
      totalTokens: Number(traceRunState.metadata?.llm_total_tokens ?? result?.totalTokensUsed ?? 0),
      replans: Number(traceRunState.metadata?.replan_count ?? 0),
      currentTodoTitle: currentTodo?.title,
      currentTodoAssignee: currentTodo?.assignee,
    };
  }, [traceRunState, sessionSnapshot, maxStepLimit, liveIteration, displayIterations, result]);

  const latestStreamStep = useMemo(() => {
    for (let index = streamRecords.length - 1; index >= 0; index -= 1) {
      const candidate = streamRecords[index]?.event;
      if (candidate?.type === "step_progress") {
        return candidate;
      }
    }
    return null;
  }, [streamRecords]);

  const latestStreamSessionState = useMemo(() => {
    for (let index = streamRecords.length - 1; index >= 0; index -= 1) {
      const candidate = streamRecords[index]?.event;
      if (candidate?.type === "session_state") {
        return candidate;
      }
    }
    return null;
  }, [streamRecords]);

  const liveConsoleStats = useMemo(() => {
    const stepEvent = latestStreamStep;
    const sessionState = latestStreamSessionState?.status;
    const doneCount = stepEvent?.todoSummary.filter((todo) => todo.status === "done").length ?? runtimeSignals?.doneTodos ?? 0;
    const todoCount = stepEvent?.todoSummary.length ?? runtimeSignals?.todoCount ?? 0;

    return {
      sessionStateLabel: sessionState ? getStreamSessionStateLabel(sessionState) : (running ? "运行中" : "待机"),
      todoProgress: todoCount > 0 ? `${doneCount}/${todoCount}` : (runtimeSignals ? `${runtimeSignals.doneTodos}/${runtimeSignals.todoCount}` : "-"),
      totalTokens: stepEvent?.totalTokens ?? runtimeSignals?.totalTokens ?? 0,
      llmCalls: stepEvent?.llmCallCount ?? runtimeSignals?.llmCalls ?? 0,
      latestStep: stepEvent?.step ?? liveIteration ?? sessionSnapshot?.currentStep ?? null,
      latestPhase: stepEvent?.phase ?? livePhase ?? sessionSnapshot?.currentPhase ?? null,
      openIssues: runtimeSignals?.openIssues ?? 0,
    };
  }, [latestStreamSessionState, latestStreamStep, liveIteration, livePhase, running, runtimeSignals, sessionSnapshot]);

  const liveLogLines = useMemo(() => {
    return streamRecords
      .map((item) => item.event)
      .filter((event): event is MetaAgentLogLineEvent => event.type === "log_line")
      .slice(-8)
      .reverse()
      .map((event) => {
        const parsed = parseTraceMessage(event.message);
        return {
          ...event,
          actionLabel: localizeAction(event.action),
          payload: parsed ? localizeTraceValue(parsed) : null,
          messageText: localizeTraceText(event.message),
        };
      });
  }, [parseTraceMessage, streamRecords]);

  const liveStreamTimeline = useMemo(() => {
    return streamRecords
      .slice(-24)
      .reverse()
      .map((record) => {
        const { event } = record;

        if (event.type === "log_line") {
          const parsed = parseTraceMessage(event.message);
          return {
            key: `${event.type}_${event.seq}`,
            timestamp: event.timestamp || record.receivedAt,
            label: localizeAction(event.action),
            accent: "violet" as const,
            summary: `${event.actor} · Todo ${event.todo_id}`,
            detail: parsed
              ? JSON.stringify(localizeTraceValue(parsed), null, 2)
              : localizeTraceText(event.message),
          };
        }

        if (event.type === "step_progress") {
          const doneCount = event.todoSummary.filter((todo) => todo.status === "done").length;
          return {
            key: `${event.type}_${event.seq}`,
            timestamp: record.receivedAt,
            label: `Step ${event.step}`,
            accent: "sky" as const,
            summary: `${phaseLabels[event.phase] ?? event.phase} · ${doneCount}/${event.todoSummary.length} Todo 已完成`,
            detail: `tokens=${event.totalTokens.toLocaleString()} · llmCalls=${event.llmCallCount}`,
          };
        }

        return {
          key: `${event.type}_${event.seq}`,
          timestamp: record.receivedAt,
          label: getStreamSessionStateLabel(event.status),
          accent: event.status === "awaiting_input" ? ("amber" as const) : ("emerald" as const),
          summary: event.status === "awaiting_input"
            ? "等待人工确认或补充说明"
            : "会话状态更新",
          detail: event.inputPrompt || "",
        };
      });
  }, [parseTraceMessage, streamRecords]);

  const tokenBreakdown = useMemo(() => {
    if (!traceRunState?.execution_log?.length) return [] as Array<{
      source: string;
      label: string;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      calls: number;
    }>;

    const labels: Record<string, string> = {
      delegate: "子 Agent 执行",
      llm_review: "评审",
      failure_analysis: "失败分析",
      final_synthesis: "最终综合",
      final_summary: "最终总结",
      replan: "重规划",
    };

    const buckets = new Map<string, {
      source: string;
      label: string;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      calls: number;
    }>();

    for (const log of traceRunState.execution_log) {
      if (log.action !== "llm_usage") continue;
      const parsed = parseTraceMessage(log.message);
      const source = typeof parsed?.source === "string" ? parsed.source : "unknown";
      const bucket = buckets.get(source) ?? {
        source,
        label: labels[source] ?? source,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        calls: 0,
      };
      bucket.totalTokens += Number(parsed?.total_tokens ?? 0);
      bucket.promptTokens += Number(parsed?.prompt_tokens ?? 0);
      bucket.completionTokens += Number(parsed?.completion_tokens ?? 0);
      bucket.calls += 1;
      buckets.set(source, bucket);
    }

    return [...buckets.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  }, [traceRunState, parseTraceMessage]);

  const delegateDiagnostics = useMemo(() => {
    if (!traceRunState?.execution_log?.length) return [] as Array<{
      todoId: string;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      calls: number;
      promptChars?: number;
      estimatedPromptTokens?: number;
      toolCount?: number;
      skillCount?: number;
      topSections: Array<{ label: string; estimatedTokens: number }>;
    }>;

    const llmByTodo = new Map<string, {
      todoId: string;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      calls: number;
    }>();
    const profileByTodo = new Map<string, {
      promptChars?: number;
      estimatedPromptTokens?: number;
      toolCount?: number;
      skillCount?: number;
      topSections: Array<{ label: string; estimatedTokens: number }>;
    }>();

    for (const log of traceRunState.execution_log) {
      const parsed = parseTraceMessage(log.message);
      if (log.action === "llm_usage") {
        const source = typeof parsed?.source === "string" ? parsed.source : "unknown";
        if (source !== "delegate") continue;
        const bucket = llmByTodo.get(log.todo_id) ?? {
          todoId: log.todo_id,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          calls: 0,
        };
        bucket.totalTokens += Number(parsed?.total_tokens ?? 0);
        bucket.promptTokens += Number(parsed?.prompt_tokens ?? 0);
        bucket.completionTokens += Number(parsed?.completion_tokens ?? 0);
        bucket.calls += 1;
        llmByTodo.set(log.todo_id, bucket);
      }

      if (log.action === "delegate_prompt_profile") {
        const sectionMetrics = Array.isArray(parsed?.sectionMetrics) ? parsed.sectionMetrics : [];
        profileByTodo.set(log.todo_id, {
          promptChars: Number(parsed?.totalPromptChars ?? 0),
          estimatedPromptTokens: Number(parsed?.estimatedPromptTokens ?? 0),
          toolCount: Number(parsed?.toolCount ?? 0),
          skillCount: Number(parsed?.skillCount ?? 0),
          topSections: sectionMetrics
            .filter((item): item is { label?: unknown; estimatedTokens?: unknown } => Boolean(item && typeof item === "object"))
            .map((item) => ({
              label: typeof item.label === "string" ? item.label : "-",
              estimatedTokens: Number(item.estimatedTokens ?? 0),
            }))
            .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
            .slice(0, 3),
        });
      }
    }

    return [...llmByTodo.values()]
      .map((item) => ({
        ...item,
        ...(profileByTodo.get(item.todoId) ?? { topSections: [] }),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [traceRunState, parseTraceMessage]);

  const executionMap = useMemo(() => {
    if (!traceRunState) {
      return {
        columns: [] as Array<{
          depth: number;
          label: string;
          nodes: Array<{
            id: string;
            title: string;
            status: string;
            capability: string;
            assignee: string;
            reviewResult: string | null;
            dependsOn: string[];
            waveId: string | null;
            isActive: boolean;
            isCurrentWave: boolean;
            retryCount: number;
            rerouteCount: number;
            recoveryCount: number;
          }>;
        }>,
        edgeCount: 0,
        waveCount: 0,
        currentTodoId: null as string | null,
        currentWaveId: null as string | null,
      };
    }

    const todos = traceFlowOrder;
    const todoMap = new Map(todos.map((todo) => [todo.id, todo]));
    const depthById = new Map<string, number>();
    const waveByTodoId = new Map<string, string>();

    for (const wave of traceWaves) {
      for (const todoId of wave.todo_ids) {
        if (!waveByTodoId.has(todoId)) {
          waveByTodoId.set(todoId, wave.wave_id);
        }
      }
    }

    for (const todo of todos) {
      let depth = 0;
      for (const dep of todo.depends_on ?? []) {
        depth = Math.max(depth, (depthById.get(dep) ?? 0) + 1);
      }
      depthById.set(todo.id, depth);
    }

    const columnsMap = new Map<number, Array<{
      id: string;
      title: string;
      status: string;
      capability: string;
      assignee: string;
      reviewResult: string | null;
      dependsOn: string[];
      waveId: string | null;
      isActive: boolean;
      isCurrentWave: boolean;
      retryCount: number;
      rerouteCount: number;
      recoveryCount: number;
    }>>();

    for (const todo of todos) {
      const depth = depthById.get(todo.id) ?? 0;
      const dependsOn = (todo.depends_on ?? []).map((depId) => todoMap.get(depId)?.title ?? depId);
      const waveId = waveByTodoId.get(todo.id) ?? null;
      const node = {
        id: todo.id,
        title: todo.title,
        status: todo.status,
        capability: todo.capability_type ?? "general",
        assignee: todo.assignee ?? todo.forced_target_agent_id ?? "supervisor",
        reviewResult: todo.review_result ?? null,
        dependsOn,
        waveId,
        isActive: traceRunState.current_todo_id === todo.id,
        isCurrentWave: Boolean(traceRunState.current_wave_id && waveId === traceRunState.current_wave_id),
        retryCount: Number(todo.retry_count ?? 0),
        rerouteCount: Number(todo.reroute_count ?? 0),
        recoveryCount: Number(todo.recovery_history?.length ?? 0),
      };
      const bucket = columnsMap.get(depth) ?? [];
      bucket.push(node);
      columnsMap.set(depth, bucket);
    }

    return {
      columns: [...columnsMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, nodes]) => ({
          depth,
          label: depth === 0 ? "起始层" : `第 ${depth + 1} 层`,
          nodes,
        })),
      edgeCount: todos.reduce((sum, todo) => sum + Number(todo.depends_on?.length ?? 0), 0),
      waveCount: traceWaves.length,
      currentTodoId: traceRunState.current_todo_id ?? null,
      currentWaveId: traceRunState.current_wave_id ?? null,
    };
  }, [traceFlowOrder, traceRunState, traceWaves]);

  const recoveryTimeline = useMemo(() => {
    if (!traceRunState) return [] as Array<{
      timestamp: string;
      todoId: string;
      actionLabel: string;
      actor: string;
      message: string;
    }>;

    return (traceRunState.execution_log ?? [])
      .filter((log) =>
        /retry_|reroute_|replan_|wave_guard_triggered|context_compacted|review_retry_scheduled/.test(log.action),
      )
      .slice(-10)
      .reverse()
      .map((log) => {
        const parsed = parseTraceMessage(log.message);
        return {
          timestamp: log.timestamp,
          todoId: log.todo_id,
          actionLabel: localizeAction(log.action),
          actor: log.actor,
          message: parsed
            ? JSON.stringify(localizeTraceValue(parsed), null, 2)
            : localizeTraceText(log.message),
        };
      });
  }, [traceRunState, parseTraceMessage]);

  const routingHotspots = useMemo(() => {
    if (!traceRunState) return [] as Array<{ agentId: string; count: number }>;
    const counts = new Map<string, number>();
    for (const todo of traceRunState.todos ?? []) {
      for (const agentId of todo.assignee_history ?? []) {
        counts.set(agentId, Number(counts.get(agentId) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([agentId, count]) => ({ agentId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [traceRunState]);

  const recoveredTodos = useMemo(() => {
    if (!traceRunState) return [] as SupervisorRunStateView["todos"];
    return [...(traceRunState.todos ?? [])]
      .filter((todo) =>
        Number(todo.retry_count ?? 0) > 0
        || Number(todo.reroute_count ?? 0) > 0
        || Number(todo.recovery_history?.length ?? 0) > 0
        || Boolean(todo.forced_target_agent_id),
      )
      .sort((a, b) =>
        (Number(b.recovery_history?.length ?? 0) + Number(b.retry_count ?? 0) + Number(b.reroute_count ?? 0))
        - (Number(a.recovery_history?.length ?? 0) + Number(a.retry_count ?? 0) + Number(a.reroute_count ?? 0)),
      )
      .slice(0, 8);
  }, [traceRunState]);

  const selectedCheckpoint = useMemo(() => {
    if (!sessionSnapshot?.checkpoints?.length) return null;
    return sessionSnapshot.checkpoints.find((item) => item.checkpointId === selectedCheckpointId)
      ?? sessionSnapshot.checkpoints[sessionSnapshot.checkpoints.length - 1]
      ?? null;
  }, [sessionSnapshot, selectedCheckpointId]);

  const replayCandidatesForSelectedCheckpoint = useMemo(() => {
    if (!sessionSnapshot?.replayCandidates?.length || !selectedCheckpoint) return [];
    return sessionSnapshot.replayCandidates.filter((item) => item.checkpointId === selectedCheckpoint.checkpointId);
  }, [sessionSnapshot, selectedCheckpoint]);

  const artifactOutputs = useMemo(() => {
    if (!traceRunState) {
      return {
        artifacts: [] as NonNullable<SupervisorRunStateView["artifacts"]>,
        workspaceFiles: [] as NonNullable<SupervisorRunStateView["workspace_files"]>,
      };
    }
    const dedupedArtifacts = new Map<string, NonNullable<SupervisorRunStateView["artifacts"]>[number]>();
    for (const artifact of [...(traceRunState.artifacts ?? [])].reverse()) {
      const key = `${artifact.type}:${artifact.path}`;
      if (!dedupedArtifacts.has(key)) {
        dedupedArtifacts.set(key, artifact);
      }
    }
    const dedupedFiles = new Map<string, NonNullable<SupervisorRunStateView["workspace_files"]>[number]>();
    for (const file of [...(traceRunState.workspace_files ?? [])].reverse()) {
      if (!dedupedFiles.has(file.path)) {
        dedupedFiles.set(file.path, file);
      }
    }
    return {
      artifacts: [...dedupedArtifacts.values()].slice(0, 16),
      workspaceFiles: [...dedupedFiles.values()].slice(0, 12),
    };
  }, [traceRunState]);

  const keyDeliverables = useMemo(() => {
    return artifactOutputs.artifacts.filter((artifact) =>
      /final_delivery|manifest_final|merged_paper_manifest|verification|report|manifest/i.test(artifact.path)
      || /manifest|report|verification/i.test(artifact.type),
    ).slice(0, 10);
  }, [artifactOutputs]);

  const controlTrajectory = useMemo(() => {
    if (!sessionSnapshot?.checkpoints?.length) return [] as Array<{
      checkpointId: string;
      step: number;
      createdAt: string;
      phase: string;
      runStatus: string;
      owner: string;
      currentTodoId: string | null;
      currentWaveId: string | null;
      issueCount: number;
      artifactCount: number;
      todoProgress: string;
      stateChanged: boolean;
      ownerChanged: boolean;
      todoChanged: boolean;
    }>;

    return sessionSnapshot.checkpoints.map((checkpoint, index, all) => {
      const previous = index > 0 ? all[index - 1] : null;
      return {
        checkpointId: checkpoint.checkpointId,
        step: checkpoint.step,
        createdAt: checkpoint.createdAt,
        phase: checkpoint.phase,
        runStatus: checkpoint.runStatus,
        owner: checkpoint.owner,
        currentTodoId: checkpoint.currentTodoId,
        currentWaveId: checkpoint.currentWaveId,
        issueCount: checkpoint.summary.issueCount,
        artifactCount: checkpoint.summary.artifactCount + checkpoint.summary.workspaceFileCount,
        todoProgress: `${checkpoint.summary.doneTodoCount}/${checkpoint.summary.todoCount}`,
        stateChanged: !previous || previous.runStatus !== checkpoint.runStatus || previous.phase !== checkpoint.phase,
        ownerChanged: !previous || previous.owner !== checkpoint.owner,
        todoChanged: !previous || previous.currentTodoId !== checkpoint.currentTodoId || previous.currentWaveId !== checkpoint.currentWaveId,
      };
    }).slice(-10).reverse();
  }, [sessionSnapshot]);

  const ownerHandoffs = useMemo(() => {
    if (!sessionSnapshot?.checkpoints?.length) return [] as Array<{
      checkpointId: string;
      step: number;
      createdAt: string;
      phase: string;
      summary: string;
    }>;

    const changes: Array<{
      checkpointId: string;
      step: number;
      createdAt: string;
      phase: string;
      summary: string;
    }> = [];

    for (let index = 0; index < sessionSnapshot.checkpoints.length; index += 1) {
      const checkpoint = sessionSnapshot.checkpoints[index];
      const previous = index > 0 ? sessionSnapshot.checkpoints[index - 1] : null;
      if (!previous) {
        changes.push({
          checkpointId: checkpoint.checkpointId,
          step: checkpoint.step,
          createdAt: checkpoint.createdAt,
          phase: checkpoint.phase,
          summary: `controller initialized with owner=${checkpoint.owner}`,
        });
        continue;
      }

      const tokens: string[] = [];
      if (previous.owner !== checkpoint.owner) {
        tokens.push(`${previous.owner} -> ${checkpoint.owner}`);
      }
      if (previous.currentTodoId !== checkpoint.currentTodoId) {
        tokens.push(`todo ${previous.currentTodoId ?? "-"} -> ${checkpoint.currentTodoId ?? "-"}`);
      }
      if (previous.currentWaveId !== checkpoint.currentWaveId) {
        tokens.push(`wave ${previous.currentWaveId ?? "-"} -> ${checkpoint.currentWaveId ?? "-"}`);
      }
      if (tokens.length === 0) continue;

      changes.push({
        checkpointId: checkpoint.checkpointId,
        step: checkpoint.step,
        createdAt: checkpoint.createdAt,
        phase: checkpoint.phase,
        summary: tokens.join(" | "),
      });
    }

    return changes.slice(-8).reverse();
  }, [sessionSnapshot]);

  const guardrailSignals = useMemo(() => {
    if (!sessionSnapshot?.controlPlaneSummary && !traceRunState) return null;
    const control = sessionSnapshot?.controlPlaneSummary;
    const openIssues = (traceRunState?.issues ?? []).filter((issue) => issue.status === "open");
    const sideEffects = [
      ...(traceRunState?.artifacts ?? []).map((artifact) => ({
        key: `artifact_${artifact.id}`,
        label: artifact.type,
        todoId: artifact.related_todo,
        summary: artifact.summary,
        producer: artifact.producer,
      })),
      ...(traceRunState?.workspace_files ?? []).map((file) => ({
        key: `workspace_${file.file_id}`,
        label: file.kind,
        todoId: file.related_todo,
        summary: file.content_summary,
        producer: file.producer,
      })),
    ].slice(-8).reverse();

    const stopSignals: string[] = [];
    if ((control?.budget.remainingSteps ?? runtimeSignals?.stepRemaining ?? 1) <= 0) {
      stopSignals.push("step budget exhausted");
    }
    if (openIssues.some((issue) => /failed_no_recovery|recovery_failed|validation_failed/.test(issue.type))) {
      stopSignals.push("open recovery blockers");
    }
    if ((traceRunState?.status ?? "") === "failed") {
      stopSignals.push("runtime already failed");
    }

    return {
      approvalMode: control?.approvalMode.mode ?? "none",
      approvalSummary: control?.approvalMode.summary ?? "No explicit approval queue has been emitted by runtime.",
      pendingApprovals: 0,
      terminateAvailable: Boolean(control?.allowedActions.includes("terminate")),
      retryAvailable: Boolean(control?.allowedActions.includes("retry")),
      rerouteAvailable: Boolean(control?.allowedActions.includes("reroute")),
      stopSignal: stopSignals[0] ?? "none",
      openIssues: openIssues.slice(0, 4),
      sideEffects,
    };
  }, [sessionSnapshot, traceRunState, runtimeSignals]);

  const missionControlSummary = useMemo(() => {
    if (!sessionSnapshot && !traceRunState && !result) return null;
    const control = sessionSnapshot?.controlPlaneSummary;
    const openIssues = (traceRunState?.issues ?? []).filter((issue) => issue.status === "open").length;
    const outputCount = (traceRunState?.artifacts?.length ?? 0) + (traceRunState?.workspace_files?.length ?? 0);
    const maxSteps = control?.budget.maxSteps ?? runtimeSignals?.stepBudget ?? maxStepLimit;
    const usedSteps = control?.budget.usedSteps ?? runtimeSignals?.stepUsed ?? displayIterations.length;
    const budgetUsage = maxSteps > 0 ? Math.min(100, Math.round((usedSteps / maxSteps) * 100)) : 0;

    return {
      statusLabel: sessionSnapshot?.status ?? (running ? "running" : result?.status ?? "idle"),
      owner: control?.owner ?? runtimeSignals?.controlFocus ?? "supervisor",
      currentTodoId: control?.currentTodoId ?? traceRunState?.current_todo_id ?? null,
      currentWaveId: control?.currentWaveId ?? traceRunState?.current_wave_id ?? null,
      todoProgress: runtimeSignals ? `${runtimeSignals.doneTodos}/${runtimeSignals.todoCount}` : "-",
      stepSummary: `${usedSteps}/${maxSteps}`,
      budgetUsage,
      remainingSteps: control?.budget.remainingSteps ?? runtimeSignals?.stepRemaining ?? Math.max(0, maxSteps - usedSteps),
      checkpoints: control?.checkpointCount ?? sessionSnapshot?.checkpoints?.length ?? 0,
      llmCalls: control?.budget.llmCalls ?? runtimeSignals?.llmCalls ?? 0,
      openIssues,
      outputCount,
    };
  }, [sessionSnapshot, traceRunState, result, running, runtimeSignals, maxStepLimit, displayIterations]);

  const quickNavSections = useMemo(() => {
    const sections: Array<{ id: string; label: string }> = [];
    if (sessionList.length > 0) sections.push({ id: "session-center", label: "历史运行" });
    if (sessionId && (running || streamRecords.length > 0)) {
      sections.push({ id: "live-console", label: "实时中控" });
      sections.push({ id: "human-loop", label: "人在回路" });
      sections.push({ id: "stream-feed", label: "流式过程" });
    }
    if (missionControlSummary) sections.push({ id: "mission-control", label: "运行概览" });
    if (executionMap.columns.length > 0) sections.push({ id: "execution-map", label: "任务流转" });
    if (runtimeSignals) sections.push({ id: "runtime-signals", label: "运行信号" });
    if (recoveryTimeline.length > 0 || recoveredTodos.length > 0 || routingHotspots.length > 0) {
      sections.push({ id: "recovery-routing", label: "恢复与路由" });
    }
    if (keyDeliverables.length > 0 || artifactOutputs.workspaceFiles.length > 0) {
      sections.push({ id: "artifacts-workspace", label: "关键交付物" });
    }
    if (result) sections.push({ id: "execution-summary", label: "最终结果" });
    if (displayIterations.length > 0) sections.push({ id: "execution-steps", label: "步骤回放" });
    if (showAdvancedDetails && sessionSnapshot?.controlPlaneSummary) {
      sections.push({ id: "control-plane", label: "控制平面" });
    }
    if (showAdvancedDetails && (controlTrajectory.length > 0 || guardrailSignals)) {
      sections.push({ id: "control-trajectory", label: "控制轨迹" });
    }
    if (showAdvancedDetails && sessionSnapshot?.checkpoints?.length) {
      sections.push({ id: "checkpoints-replay", label: "检查点" });
    }
    if (showAdvancedDetails && sessionSnapshot && (sessionSnapshot.planningContextSummary || sessionSnapshot.memoryWritebackSummary)) {
      sections.push({ id: "memory-context", label: "项目记忆" });
    }
    if (showAdvancedDetails && traceRunState) sections.push({ id: "execution-trace", label: "执行轨迹" });
    return sections;
  }, [
    sessionList,
    missionControlSummary,
    executionMap,
    sessionSnapshot,
    controlTrajectory,
    guardrailSignals,
    runtimeSignals,
    recoveryTimeline,
    recoveredTodos,
    routingHotspots,
    artifactOutputs,
    keyDeliverables,
    traceRunState,
    result,
    displayIterations,
    showAdvancedDetails,
    sessionId,
    running,
    streamRecords.length,
  ]);

  const onJumpToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Brain className="h-7 w-7 text-violet-500" />
          Meta-Agent
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          输入一个高层目标，Meta-Agent 会自动完成规划、执行、评估与步骤推进。
        </p>
      </div>

      {/* ── Bandit Strategy Panel ── */}
      <Card className={sectionCard} id="session-center">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <button className="flex items-center gap-2" onClick={() => setShowBandit(!showBandit)}>
              {showBandit ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              <Target className="h-4 w-4 text-indigo-500" />
              策略决策模型 (Bandit)
            </button>
            {banditStats && (
              <span className="ml-auto text-xs font-normal text-slate-500">
                已训练 {banditStats.totalPulls} 次 / {banditStats.totalExperiences} 条经验
              </span>
            )}
          </CardTitle>
        </CardHeader>
        {showBandit && (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={onColdStart} disabled={banditLoading}>
                {banditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                从运行中心冷启动训练
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={refreshBanditStats} disabled={banditLoading}>
                <BarChart3 className="h-3 w-3" />
                刷新统计
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs text-rose-500 hover:text-rose-600" onClick={onResetBandit} disabled={banditLoading}>
                <RotateCcw className="h-3 w-3" />
                重置模型
              </Button>
            </div>
            {banditStats && banditStats.templates.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-500">策略模板 ({banditStats.templates.length} 个)</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {banditStats.templates.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg border border-black/[0.04] px-3 py-2 text-xs dark:border-white/[0.06]">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
                      <span className="text-[10px] text-slate-400">{t.topology}</span>
                      <span className="ml-auto rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {t.pullCount}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">
                  alpha={banditStats.alpha.toFixed(3)}（探索参数，越小越倾向利用已知最优）
                </p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Training Data Factory Panel ── */}
      <Card className={sectionCard} id="session-center">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <button className="flex items-center gap-2" onClick={() => setShowTraining(!showTraining)}>
              {showTraining ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              <FileText className="h-4 w-4 text-emerald-500" />
              训练数据工厂
            </button>
            {trainingStats && (
              <span className="ml-auto text-xs font-normal text-slate-500">
                共 {trainingStats.counts._total ?? 0} 条样本
              </span>
            )}
          </CardTitle>
        </CardHeader>
        {showTraining && (
          <CardContent className="space-y-3">
            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={onCollectTraining} disabled={trainingLoading}>
                {trainingLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                采集训练数据
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={refreshTrainingStats} disabled={trainingLoading}>
                <BarChart3 className="h-3 w-3" />
                刷新统计
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs text-rose-500 hover:text-rose-600" onClick={onClearTraining} disabled={trainingLoading}>
                <Trash2 className="h-3 w-3" />
                清空数据
              </Button>
            </div>

            {/* Sample counts */}
            {trainingStats && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">样本统计</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {trainingStats.availableExports.map((exp) => (
                    <div key={exp.format} className="rounded-lg border border-black/[0.04] px-3 py-2 dark:border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          {exp.sampleCount}
                        </span>
                        {exp.sampleCount > 0 && (
                          <button
                            className="flex items-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                            onClick={() => onExportTraining(exp.format)}
                            disabled={trainingLoading}
                          >
                            <Download className="h-2.5 w-2.5" />
                            导出
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">{exp.description}</p>
                    </div>
                  ))}
                </div>

                {/* Export all button */}
                {(trainingStats.counts._total ?? 0) > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => onExportTraining("all")}
                    disabled={trainingLoading}
                  >
                    <Download className="h-3 w-3" />
                    导出全部格式 (JSONL)
                  </Button>
                )}

                <p className="text-[10px] text-slate-400">
                  导出为 JSONL 格式，可直接用于 LLaMA-Factory / Axolotl 等框架进行 LoRA/SFT/DPO 训练。
                </p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card className={sectionCard}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" />
            目标设定
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="例如：下载 20 篇 Agent RL 论文，并要求 2 个子 Agent 并行完成、最终交付可校验结果"
            className="min-h-[88px] rounded-2xl"
            disabled={running}
          />
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">项目 ID</span>
              <Input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-9 w-40"
                disabled={running}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">最大规划轮次</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxPlanningRounds}
                onChange={(e) => setMaxPlanningRounds(Number(e.target.value) || 3)}
                className="h-9 w-24"
                disabled={running}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">最大步骤上限</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxStepLimit}
                onChange={(e) => setMaxStepLimit(Number(e.target.value) || 12)}
                className="h-9 w-24"
                disabled={running}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">质量阈值 (0-1)</span>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) || 0.7)}
                className="h-9 w-24"
                disabled={running}
              />
            </label>
            <Button
              onClick={onRun}
              disabled={running || !goal.trim()}
              className="h-9 gap-2 bg-violet-600 hover:bg-violet-700"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Meta-Agent 运行中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  启动 Meta-Agent
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            说明：规划轮次控制 Todo 规划/重规划尝试次数；步骤上限控制运行时最多推进多少个 step。
          </p>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </CardContent>
      </Card>

      <Card className={sectionCard}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-sky-500" />
            历史运行
            <span className="ml-auto text-xs font-normal text-slate-500">
              {sessionListLoading ? "刷新中..." : `${filteredSessionList.length}/${sessionList.length} 条`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500">
            点击任意历史运行，可恢复查看该次 Meta-Agent 的完整过程、checkpoint、trace 与最终结果。
          </p>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
            <Input
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="搜索 sessionId / 目标 / projectId"
              className="h-9"
            />
            <select
              value={sessionProjectFilter}
              onChange={(e) => setSessionProjectFilter(e.target.value)}
              className="h-9 rounded-md border border-black/[0.08] bg-white px-3 text-sm outline-none transition focus:border-violet-300 dark:border-white/[0.08] dark:bg-slate-950"
            >
              <option value="all">全部项目</option>
              {availableSessionProjects.map((project) => (
                <option key={project} value={project}>{project}</option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={currentProjectOnly ? "default" : "outline"}
                className="h-9"
                onClick={() => setCurrentProjectOnly((prev) => !prev)}
              >
                当前项目
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => {
                  setSessionSearch("");
                  setSessionProjectFilter("all");
                  setCurrentProjectOnly(false);
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                重置筛选
              </Button>
            </div>
          </div>
          {filteredSessionList.length === 0 ? (
            <p className="text-sm text-slate-500">暂无可回看的 Meta-Agent 历史运行。</p>
          ) : (
            <div className="grid gap-2">
              {filteredSessionList.map((session) => {
                const isActive = session.sessionId === sessionId;
                const actionBusy = sessionActionLoadingId === session.sessionId;
                return (
                  <div
                    key={session.sessionId}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30"
                        : "border-black/[0.05] bg-slate-50 hover:bg-slate-100 dark:border-white/[0.06] dark:bg-slate-900 dark:hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex gap-3 max-md:flex-col">
                      <button
                        type="button"
                        onClick={() => void loadSessionSnapshot(session.sessionId)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500">{session.sessionId}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {session.status}
                          </span>
                          {session.runStatus && (
                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              run={localizeTraceText(session.runStatus)}
                            </span>
                          )}
                          <span className="ml-auto text-[11px] text-slate-500">{session.startedAt}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">{session.goal}</p>
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                          <span>project: {session.projectId}</span>
                          <span>step: {session.currentStep ?? "-"}</span>
                          <span>todos: {session.doneTodoCount}/{session.todoCount}</span>
                          <span>issues: {session.issueCount}</span>
                          <span>tokens: {session.totalTokens.toLocaleString()}</span>
                          {session.currentPhase && <span>phase: {session.currentPhase}</span>}
                        </div>
                      </button>
                      <div className="flex shrink-0 flex-wrap items-start gap-2 max-md:pt-1 md:w-[220px] md:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8"
                          onClick={() => void loadSessionSnapshot(session.sessionId)}
                        >
                          <FileText className="mr-2 h-3.5 w-3.5" />
                          查看
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8"
                          onClick={() => void onCopySessionLink(session.sessionId)}
                        >
                          <GitBranch className="mr-2 h-3.5 w-3.5" />
                          链接
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8"
                          disabled={actionBusy}
                          onClick={() => void onExportSession(session.sessionId)}
                        >
                          <Download className="mr-2 h-3.5 w-3.5" />
                          导出
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 text-rose-600 hover:text-rose-700 dark:text-rose-300"
                          disabled={actionBusy || session.status === "running"}
                          onClick={() => void onDeleteSession(session.sessionId)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {running && (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/30">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <span className="text-sm text-violet-700 dark:text-violet-300">
            Meta-Agent 正在执行
            {typeof liveIteration === "number" ? `第 ${liveIteration} 轮` : ""}，
            阶段：{livePhase ? (phaseLabels[livePhase] ?? livePhase) : "处理中"}。
          </span>
        </div>
      )}

      {sessionId && (running || streamRecords.length > 0 || pendingHumanInput) && (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className={sectionCard} id="live-console">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-sky-500" />
                运行中控台
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {getStreamConnectionLabel(streamConnectionState)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">会话状态</p>
                  <p className="mt-1 text-sm font-semibold">{liveConsoleStats.sessionStateLabel}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">当前进度</p>
                  <p className="mt-1 text-sm font-semibold">{liveConsoleStats.todoProgress}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {liveConsoleStats.latestPhase ? (phaseLabels[liveConsoleStats.latestPhase] ?? liveConsoleStats.latestPhase) : "等待首个事件"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">Token / 调用</p>
                  <p className="mt-1 text-sm font-semibold">
                    {liveConsoleStats.totalTokens.toLocaleString()} / {liveConsoleStats.llmCalls}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">流式事件</p>
                  <p className="mt-1 text-sm font-semibold">{streamRecords.length}</p>
                  <p className="mt-1 text-[11px] text-slate-500">lastSeq={streamLastSeq >= 0 ? streamLastSeq : "-"}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-black/[0.05] bg-slate-50/80 p-3 dark:border-white/[0.06] dark:bg-slate-900/70">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{sessionId}</span>
                  {latestStreamSessionState && (
                    <span className={`rounded-full px-2 py-0.5 ${
                      latestStreamSessionState.status === "awaiting_input"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : latestStreamSessionState.status === "done"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : latestStreamSessionState.status === "failed"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                    }`}>
                      {getStreamSessionStateLabel(latestStreamSessionState.status)}
                    </span>
                  )}
                  <span>openIssues={liveConsoleStats.openIssues}</span>
                </div>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                  {runtimeSignals?.currentTodoTitle
                    ? `当前焦点 Todo：${runtimeSignals.currentTodoTitle}${runtimeSignals.currentTodoAssignee ? ` · ${runtimeSignals.currentTodoAssignee}` : ""}`
                    : "当前还没有可展示的焦点 Todo，页面会随着 SSE 事件实时补齐。"}
                </p>
                {streamError && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">{streamError}</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">最新执行片段</p>
                <div className="space-y-2">
                  {liveLogLines.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-black/[0.06] px-3 py-4 text-xs text-slate-500 dark:border-white/[0.08]">
                      暂时还没有流式日志，连接建立后会在这里实时滚动展示。
                    </div>
                  ) : (
                    liveLogLines.map((log) => (
                      <div key={`${log.seq}_${log.todo_id}`} className="rounded-xl border border-black/[0.05] bg-white px-3 py-3 text-xs dark:border-white/[0.06] dark:bg-slate-950/60">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-mono">{log.timestamp}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{log.actionLabel}</span>
                          <span>Todo={log.todo_id}</span>
                          <span>Actor={log.actor}</span>
                        </div>
                        {log.payload ? (
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        ) : (
                          <p className="mt-2 break-words text-slate-600 dark:text-slate-300">{log.messageText}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={sectionCard} id="human-loop">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="h-4 w-4 text-amber-500" />
                人在回路
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-normal ${
                  pendingHumanInput
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}>
                  {pendingHumanInput ? "待处理" : "自动通过"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`rounded-2xl border p-4 ${
                pendingHumanInput
                  ? "border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20"
                  : "border-black/[0.05] bg-slate-50/80 dark:border-white/[0.06] dark:bg-slate-900/70"
              }`}>
                <p className="text-xs font-medium text-slate-500">当前状态</p>
                <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {pendingHumanInput
                    ? "Planner 已暂停，等待你确认初始 Todo 计划"
                    : "当前没有待审批的计划节点，Meta-Agent 会沿既有链路继续运行。"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {pendingHumanInput
                    ? `触发时间：${pendingHumanInput.requestedAt}`
                    : "当规划器产出初始计划时，这里会自动切换为确认面板。"}
                </p>
                {pendingHumanInput?.prompt && (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-6 text-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    {pendingHumanInput.prompt}
                  </pre>
                )}
              </div>

              <Textarea
                value={humanInputDraft}
                onChange={(event) => setHumanInputDraft(event.target.value)}
                placeholder="可输入修改建议、约束说明或审批意见。留空提交表示直接确认继续。"
                className="min-h-[132px] rounded-2xl"
                disabled={!pendingHumanInput || submittingHumanInput}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-9 gap-2 bg-amber-600 hover:bg-amber-700"
                  disabled={!pendingHumanInput || submittingHumanInput}
                  onClick={() => void onSubmitHumanInput(humanInputDraft)}
                >
                  {submittingHumanInput ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  提交意见并继续
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!pendingHumanInput || submittingHumanInput}
                  onClick={() => void onSubmitHumanInput("")}
                >
                  直接确认继续
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!sessionId}
                  onClick={() => sessionId ? void refreshPendingHumanInput(sessionId) : undefined}
                >
                  刷新待处理状态
                </Button>
              </div>

              <p className="text-xs text-slate-500">
                这一步只负责人工确认，不会改动 Meta-Agent 的通用主链路。空白提交表示接受当前计划，带文本提交则把你的备注写入执行上下文后继续。
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {sessionId && (running || streamRecords.length > 0) && (
        <Card className={sectionCard} id="stream-feed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-violet-500" />
              过程流式展示
              <span className="ml-auto text-xs font-normal text-slate-500">
                {streamRecords.length} 条实时事件
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {liveStreamTimeline.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/[0.06] px-4 py-5 text-sm text-slate-500 dark:border-white/[0.08]">
                流式连接已准备好，新的调度、日志与 HITL 事件会在这里按时间滚动出现。
              </div>
            ) : (
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {liveStreamTimeline.map((item) => (
                  <div key={item.key} className="rounded-xl border border-black/[0.05] bg-slate-50/80 px-3 py-3 text-xs dark:border-white/[0.06] dark:bg-slate-900/70">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{item.timestamp}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                        item.accent === "amber"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : item.accent === "emerald"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : item.accent === "sky"
                              ? "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                              : "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      }`}>
                        {item.label}
                      </span>
                      <span className="text-slate-500">{item.summary}</span>
                    </div>
                    {item.detail && (
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[11px] text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                        {item.detail}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {running && liveSteps.length > 0 && (
        <Card className={sectionCard}>
          <CardHeader>
            <CardTitle className="text-base">实时步骤进度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
            {liveSteps.map((iter) => (
              <div key={iter.step ?? iter.iteration} className="rounded-lg border border-black/[0.04] px-3 py-2 dark:border-white/[0.06]">
                第 {iter.iteration} 轮 - 阶段：{phaseLabels[iter.phase] ?? iter.phase}
                {iter.error ? ` - 错误：${iter.error}` : ""}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {missionControlSummary && (
        <Card className={sectionCard} id="mission-control">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-violet-500" />
              运行概览
              <Button
                type="button"
                size="sm"
                variant={showAdvancedDetails ? "default" : "outline"}
                className="ml-auto h-8 rounded-full px-3 text-xs"
                onClick={() => setShowAdvancedDetails((prev) => !prev)}
              >
                {showAdvancedDetails ? "收起高级调试" : "展开高级调试"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">运行状态</p>
                <p className="mt-1 text-sm font-semibold">{localizeTraceText(missionControlSummary.statusLabel)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">当前控制者</p>
                <p className="mt-1 text-sm font-semibold">{missionControlSummary.owner}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">当前焦点 Todo</p>
                <p className="mt-1 text-sm font-semibold">{missionControlSummary.currentTodoId ?? "-"}</p>
                <p className="mt-1 text-[11px] text-slate-500">波次：{missionControlSummary.currentWaveId ?? "-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">Todo 进度</p>
                <p className="mt-1 text-sm font-semibold">{missionControlSummary.todoProgress}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">步骤预算</p>
                <p className="mt-1 text-sm font-semibold">{missionControlSummary.stepSummary}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${missionControlSummary.budgetUsage}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">剩余步骤：{missionControlSummary.remainingSteps}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">问题 / 输出</p>
                <p className="mt-1 text-sm font-semibold">{missionControlSummary.openIssues} / {missionControlSummary.outputCount}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  checkpoints={missionControlSummary.checkpoints} calls={missionControlSummary.llmCalls}
                </p>
              </div>
            </div>

            {tokenBreakdown.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">Token 消耗分布</p>
                <div className="grid gap-2 lg:grid-cols-2">
                  {tokenBreakdown.slice(0, 6).map((item) => (
                    <div key={item.source} className="rounded-xl border border-black/[0.05] bg-slate-50 px-3 py-3 text-xs dark:border-white/[0.06] dark:bg-slate-900">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                        <span className="ml-auto text-slate-500">{item.totalTokens.toLocaleString()} tokens</span>
                      </div>
                      <p className="mt-1 text-slate-500">
                        prompt {item.promptTokens.toLocaleString()} / completion {item.completionTokens.toLocaleString()} / calls {item.calls}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {delegateDiagnostics.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">委派执行成本诊断</p>
                <div className="space-y-2">
                  {delegateDiagnostics.slice(0, 6).map((item) => (
                    <div key={item.todoId} className="rounded-xl border border-black/[0.05] bg-slate-50 px-3 py-3 text-xs dark:border-white/[0.06] dark:bg-slate-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{item.todoId}</span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">{item.totalTokens.toLocaleString()} tokens</span>
                        <span className="text-slate-500">calls={item.calls}</span>
                        {typeof item.promptChars === "number" && <span className="text-slate-500">promptChars={item.promptChars}</span>}
                        {typeof item.skillCount === "number" && <span className="text-slate-500">skills={item.skillCount}</span>}
                        {typeof item.toolCount === "number" && <span className="text-slate-500">tools={item.toolCount}</span>}
                      </div>
                      <p className="mt-1 text-slate-500">
                        prompt {item.promptTokens.toLocaleString()} / completion {item.completionTokens.toLocaleString()}
                        {typeof item.estimatedPromptTokens === "number" ? ` / prompt≈${item.estimatedPromptTokens} tokens` : ""}
                      </p>
                      {item.topSections.length > 0 && (
                        <p className="mt-1 text-slate-500">
                          top sections: {item.topSections.map((section) => `${section.label}≈${section.estimatedTokens}`).join(" | ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {quickNavSections.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">快速跳转</p>
                <div className="flex flex-wrap gap-2">
                  {quickNavSections.map((section) => (
                    <Button
                      key={section.id}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 rounded-full px-3 text-xs"
                      onClick={() => onJumpToSection(section.id)}
                    >
                      {section.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {executionMap.columns.length > 0 && (
        <Card className={sectionCard} id="execution-map">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-indigo-500" />
              任务流转图
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">依赖层级</p>
                <p className="mt-1 text-sm font-semibold">{executionMap.columns.length}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">Todo 节点</p>
                <p className="mt-1 text-sm font-semibold">{runtimeSignals?.todoCount ?? 0}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">依赖关系</p>
                <p className="mt-1 text-sm font-semibold">{executionMap.edgeCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">当前指针</p>
                <p className="mt-1 text-sm font-semibold">{executionMap.currentTodoId ?? "-"}</p>
                <p className="mt-1 text-[11px] text-slate-500">波次：{executionMap.currentWaveId ?? "-"}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="flex min-w-max gap-4 pb-1">
                {executionMap.columns.map((column, columnIndex) => (
                  <div key={column.label} className="flex w-[280px] shrink-0 items-stretch gap-3">
                    <div className="w-full rounded-2xl border border-black/[0.05] bg-slate-50/70 p-3 dark:border-white/[0.06] dark:bg-slate-900/60">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{column.label}</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800">
                          {column.nodes.length} 个节点
                        </span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {column.nodes.map((node) => (
                          <div
                            key={node.id}
                            className={`rounded-xl border px-3 py-3 shadow-sm transition ${
                              node.isActive
                                ? "border-violet-300 bg-violet-50/80 dark:border-violet-700 dark:bg-violet-950/25"
                                : node.status === "done"
                                  ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/20"
                                  : node.status === "failed"
                                    ? "border-rose-200 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/20"
                                    : node.status === "in_progress"
                                      ? "border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/20"
                                      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{node.title}</p>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {localizeCapability(node.capability)} / {node.assignee}
                                </p>
                              </div>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {localizeTraceText(node.status)}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                              {node.waveId && (
                                <span className={`rounded-full px-2 py-0.5 ${
                                  node.isCurrentWave
                                    ? "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"
                                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                }`}>
                                  波次 {node.waveId}
                                </span>
                              )}
                              {node.reviewResult && (
                                <span className="rounded-full bg-white px-2 py-0.5 dark:bg-slate-800">
                                  评审 {localizeTraceText(node.reviewResult)}
                                </span>
                              )}
                              {(node.retryCount > 0 || node.rerouteCount > 0 || node.recoveryCount > 0) && (
                                <span className="rounded-full bg-white px-2 py-0.5 dark:bg-slate-800">
                                  重试 {node.retryCount} / 改派 {node.rerouteCount} / 恢复 {node.recoveryCount}
                                </span>
                              )}
                            </div>

                            <div className="mt-3 rounded-lg border border-dashed border-black/[0.06] px-2.5 py-2 text-[11px] text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
                              <p className="font-medium text-slate-600 dark:text-slate-300">依赖边界</p>
                              <p className="mt-1">
                                {node.dependsOn.length > 0
                                  ? `依赖：${node.dependsOn.join(", ")}`
                                  : "根节点，无上游依赖"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {columnIndex < executionMap.columns.length - 1 && (
                      <div className="flex shrink-0 items-center text-slate-300 dark:text-slate-700">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-current">
                          <GitBranch className="h-4 w-4" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-black/[0.04] px-3 py-2 text-xs text-slate-600 dark:border-white/[0.06] dark:text-slate-300">
              这是一张只读任务流转图，用来查看 Todo 依赖、波次归属与恢复痕迹，不会改变当前 Meta-Agent 的执行语义。
            </div>
          </CardContent>
        </Card>
      )}

      {showAdvancedDetails && sessionSnapshot?.controlPlaneSummary && (
        <Card className={sectionCard} id="control-plane">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-violet-500" />
              控制平面
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">当前状态</p>
                <p className="mt-1 text-sm font-semibold">{localizeTraceText(sessionSnapshot.controlPlaneSummary.currentState)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">持有者</p>
                <p className="mt-1 text-sm font-semibold">{sessionSnapshot.controlPlaneSummary.owner}</p>
                <p className="mt-1 text-[11px] text-slate-500">{sessionSnapshot.controlPlaneSummary.ownerReason}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">步骤预算</p>
                <p className="mt-1 text-sm font-semibold">
                  {sessionSnapshot.controlPlaneSummary.budget.usedSteps} / {sessionSnapshot.controlPlaneSummary.budget.maxSteps} 步
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  剩余={sessionSnapshot.controlPlaneSummary.budget.remainingSteps}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">检查点 / 回放候选</p>
                <p className="mt-1 text-sm font-semibold">
                  {sessionSnapshot.controlPlaneSummary.checkpointCount} / {sessionSnapshot.controlPlaneSummary.replayCandidateCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">检查点 / 回放候选数</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">审批模式</p>
                <p className="mt-1 text-sm font-semibold">{sessionSnapshot.controlPlaneSummary.approvalMode.mode}</p>
                <p className="mt-1 text-[11px] text-slate-500">{sessionSnapshot.controlPlaneSummary.approvalMode.summary}</p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">允许的操作</p>
                <div className="flex flex-wrap gap-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                  {sessionSnapshot.controlPlaneSummary.allowedActions.map((action) => (
                    <span key={action} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {localizeTraceText(action)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">恢复策略</p>
                <div className="rounded-xl border border-black/[0.04] p-3 text-xs text-slate-600 dark:border-white/[0.06] dark:text-slate-300">
                  <p>每 Todo 最大重试数: {sessionSnapshot.controlPlaneSummary.recoveryPolicy.maxRetryPerTodo}</p>
                  <p className="mt-1">每 Todo 最大改派数: {sessionSnapshot.controlPlaneSummary.recoveryPolicy.maxReroutePerTodo}</p>
                  <p className="mt-1">每 Todo 恢复历史上限: {sessionSnapshot.controlPlaneSummary.recoveryPolicy.maxRecoveryHistoryPerTodo}</p>
                  <p className="mt-1">评审失败重试预算: {sessionSnapshot.controlPlaneSummary.recoveryPolicy.reviewFailRetryBudget}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showAdvancedDetails && (controlTrajectory.length > 0 || guardrailSignals) && (
        <Card className={sectionCard} id="control-trajectory">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4 text-sky-500" />
              控制轨迹与护栏
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">状态机轨迹</p>
              <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                {controlTrajectory.length === 0 ? (
                  <p className="text-xs text-slate-500">暂无控制检查点。</p>
                ) : controlTrajectory.map((item) => (
                  <div key={item.checkpointId} className="rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500">步骤 {item.step}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {localizeTraceText(item.runStatus)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {localizeTraceText(item.phase)}
                      </span>
                      <span className="ml-auto text-[11px] text-slate-500">{item.createdAt}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>持有者={item.owner}</span>
                      <span>Todo={item.currentTodoId ?? "-"}</span>
                      <span>波次={item.currentWaveId ?? "-"}</span>
                      <span>progress={item.todoProgress}</span>
                      <span>issues={item.issueCount}</span>
                      <span>outputs={item.artifactCount}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.stateChanged && (
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                          state changed
                        </span>
                      )}
                      {item.ownerChanged && (
                        <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300">
                          owner handoff
                        </span>
                      )}
                      {item.todoChanged && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                          focus changed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">控制权转移记录</p>
                <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                  {ownerHandoffs.length === 0 ? (
                    <p className="text-xs text-slate-500">暂无控制权转移记录。</p>
                  ) : ownerHandoffs.map((item) => (
                    <div key={item.checkpointId} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">步骤 {item.step}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {localizeTraceText(item.phase)}
                        </span>
                        <span className="ml-auto text-[11px] text-slate-500">{item.createdAt}</span>
                      </div>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">{localizeTraceText(item.summary)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {guardrailSignals && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500">护栏</p>
                  <div className="rounded-xl border border-black/[0.04] p-3 text-xs text-slate-600 dark:border-white/[0.06] dark:text-slate-300">
                    <p>审批模式: {guardrailSignals.approvalMode}</p>
                    <p className="mt-1">待审批数: {guardrailSignals.pendingApprovals}</p>
                    <p className="mt-1">强停信号: {localizeTraceText(guardrailSignals.stopSignal)}</p>
                    <p className="mt-1">
                      可重试 / 可改派 / 可终止: {guardrailSignals.retryAvailable ? "是" : "否"} / {guardrailSignals.rerouteAvailable ? "是" : "否"} / {guardrailSignals.terminateAvailable ? "是" : "否"}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-500">{guardrailSignals.approvalSummary}</p>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-slate-500">未解决问题</p>
                      <div className="space-y-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                        {guardrailSignals.openIssues.length === 0 ? (
                          <p className="text-xs text-slate-500">当前无阻塞性问题。</p>
                        ) : guardrailSignals.openIssues.map((issue) => (
                          <div key={issue.id} className="rounded-lg bg-rose-50/60 px-3 py-2 text-xs dark:bg-rose-950/20">
                            <p className="font-medium text-rose-700 dark:text-rose-300">{localizeIssueType(issue.type)}</p>
                            <p className="mt-1 text-rose-700/80 dark:text-rose-300/80">{localizeTraceText(issue.message)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-slate-500">最近产生的副作用</p>
                      <div className="space-y-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                        {guardrailSignals.sideEffects.length === 0 ? (
                          <p className="text-xs text-slate-500">暂无产物或工作区文件产生。</p>
                        ) : guardrailSignals.sideEffects.map((effect) => (
                          <div key={effect.key} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-700 dark:text-slate-200">{effect.label}</span>
                              <span className="text-slate-500">Todo={effect.todoId}</span>
                              <span className="ml-auto text-slate-500">{effect.producer}</span>
                            </div>
                            <p className="mt-1 text-slate-600 dark:text-slate-300">{effect.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {showAdvancedDetails && sessionSnapshot?.checkpoints && sessionSnapshot.checkpoints.length > 0 && (
        <Card className={sectionCard} id="checkpoints-replay">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4 text-cyan-500" />
              检查点与回放候选
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={onDownloadCheckpoint} disabled={!selectedCheckpoint}>
                  <Download className="h-3 w-3" />
                  下载选中 Checkpoint
                </Button>
              </div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                {sessionSnapshot.checkpoints.slice().reverse().map((checkpoint) => {
                  const selected = checkpoint.checkpointId === selectedCheckpoint?.checkpointId;
                  return (
                    <button
                      key={checkpoint.checkpointId}
                      type="button"
                      onClick={() => setSelectedCheckpointId(checkpoint.checkpointId)}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                        selected
                          ? "border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30"
                          : "border-black/[0.05] bg-slate-50 dark:border-white/[0.06] dark:bg-slate-900"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">步骤 {checkpoint.step}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {localizeTraceText(checkpoint.runStatus)}
                        </span>
                        <span className="ml-auto text-[11px] text-slate-500">{checkpoint.createdAt}</span>
                      </div>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">
                        阶段={checkpoint.phase} · 持有者={checkpoint.owner}
                      </p>
                      <p className="mt-1 text-slate-500">
                        todos {checkpoint.summary.doneTodoCount}/{checkpoint.summary.todoCount} · 问题 {checkpoint.summary.issueCount} · 产物 {checkpoint.summary.artifactCount}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedCheckpoint && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">检查点</p>
                    <p className="mt-1 text-sm font-semibold">步骤 {selectedCheckpoint.step}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">持有者</p>
                    <p className="mt-1 text-sm font-semibold">{selectedCheckpoint.owner}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">Token / 调用次数</p>
                    <p className="mt-1 text-sm font-semibold">
                      {selectedCheckpoint.summary.totalTokens.toLocaleString()} / {selectedCheckpoint.summary.llmCalls}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">产物 / 工作区文件</p>
                    <p className="mt-1 text-sm font-semibold">
                      {selectedCheckpoint.summary.artifactCount} / {selectedCheckpoint.summary.workspaceFileCount}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">Todo 快照</p>
                    <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                      {selectedCheckpoint.snapshot.todos.map((todo) => (
                        <div key={todo.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-500">{todo.id}</span>
                            <span className="font-medium text-slate-700 dark:text-slate-200">{localizeTraceText(todo.title)}</span>
                            <span className="ml-auto text-slate-500">{localizeTraceText(todo.status)}</span>
                          </div>
                          <p className="mt-1 text-slate-500">
                            执行者={todo.assignee} · 委派={todo.delegationStatus} · 重试={todo.retryCount} · 改派={todo.rerouteCount}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">回放候选</p>
                    <div className="space-y-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                      {replayCandidatesForSelectedCheckpoint.length === 0 ? (
                        <p className="text-xs text-slate-500">当前 checkpoint 暂无单独 replay candidate。</p>
                      ) : replayCandidatesForSelectedCheckpoint.map((candidate) => (
                        <div key={candidate.replayId} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-700 dark:text-slate-200">{candidate.label}</span>
                            <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {candidate.scope}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-500">
                            保留产物={candidate.preservedArtifactCount}
                          </p>
                          <p className="mt-1 text-slate-500">
                            未完成 Todo={candidate.incompleteTodoIds.join(", ") || "-"}
                          </p>
                        </div>
                      ))}

                      <p className="text-[11px] text-slate-500">
                        这批 replay candidate 目前还是运行时建议点，前端先支持查看与导出，真正的 checkpoint replay action 还需要下一轮接执行入口。
                      </p>
                    </div>
                  </div>
                </div>

                {(selectedCheckpoint.snapshot.issues.length > 0 || selectedCheckpoint.snapshot.artifacts.length > 0 || selectedCheckpoint.snapshot.workspaceFiles.length > 0) && (
                  <div className="grid gap-4 xl:grid-cols-3">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-500">运行问题</p>
                      <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                        {selectedCheckpoint.snapshot.issues.length === 0 ? (
                          <p className="text-xs text-slate-500">无运行问题。</p>
                        ) : selectedCheckpoint.snapshot.issues.map((issue) => (
                          <div key={issue.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                            <p className="font-medium text-slate-700 dark:text-slate-200">{localizeIssueType(issue.type)}</p>
                            <p className="mt-1 text-slate-500">{localizeTraceText(issue.message)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-500">产物</p>
                      <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                        {selectedCheckpoint.snapshot.artifacts.length === 0 ? (
                          <p className="text-xs text-slate-500">无产物。</p>
                        ) : selectedCheckpoint.snapshot.artifacts.map((artifact) => (
                          <div key={artifact.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                            <p className="font-medium text-slate-700 dark:text-slate-200">{artifact.type}</p>
                            <p className="mt-1 text-slate-500">{artifact.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-500">工作区文件</p>
                      <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                        {selectedCheckpoint.snapshot.workspaceFiles.length === 0 ? (
                          <p className="text-xs text-slate-500">无工作区文件。</p>
                        ) : selectedCheckpoint.snapshot.workspaceFiles.map((file) => (
                          <div key={file.fileId} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                            <p className="font-medium text-slate-700 dark:text-slate-200">{file.kind}</p>
                            <p className="mt-1 break-all text-slate-500">{file.path}</p>
                            <p className="mt-1 text-slate-500">{file.contentSummary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {runtimeSignals && (
        <Card className={sectionCard} id="runtime-signals">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-amber-500" />
              运行信号
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">控制焦点</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{runtimeSignals.controlFocus}</p>
                {runtimeSignals.currentTodoAssignee && (
                <p className="mt-1 text-[11px] text-slate-500">执行者={runtimeSignals.currentTodoAssignee}</p>
                )}
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">步骤预算</p>
                <p className="mt-1 text-sm font-semibold">{runtimeSignals.stepUsed} / {runtimeSignals.stepBudget}</p>
                <p className="mt-1 text-[11px] text-slate-500">剩余={runtimeSignals.stepRemaining}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">Todo 进度</p>
                <p className="mt-1 text-sm font-semibold">{runtimeSignals.doneTodos} / {runtimeSignals.todoCount}</p>
                <p className="mt-1 text-[11px] text-slate-500">就绪={runtimeSignals.readyTodos} 执行中={runtimeSignals.activeTodos}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">恢复压力</p>
                <p className="mt-1 text-sm font-semibold">重试 {runtimeSignals.retryTotal} / 改派 {runtimeSignals.rerouteTotal}</p>
                <p className="mt-1 text-[11px] text-slate-500">恢复记录={runtimeSignals.recoveryTotal}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">委派情况</p>
                <p className="mt-1 text-sm font-semibold">委派 {runtimeSignals.delegatedTodos} / 拆分 {runtimeSignals.splitTodos}</p>
                <p className="mt-1 text-[11px] text-slate-500">失败={runtimeSignals.failedTodos}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-[11px] text-slate-500">LLM 用量</p>
                <p className="mt-1 text-sm font-semibold">{runtimeSignals.totalTokens.toLocaleString()} tokens</p>
                <p className="mt-1 text-[11px] text-slate-500">调用={runtimeSignals.llmCalls} 重规划={runtimeSignals.replans} 未解问题={runtimeSignals.openIssues}</p>
              </div>
            </div>
            {runtimeSignals.currentTodoTitle && (
              <div className="rounded-2xl border border-black/[0.05] bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-white/[0.06] dark:bg-slate-900 dark:text-slate-300">
                当前执行焦点：{localizeTraceText(runtimeSignals.currentTodoTitle)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showAdvancedDetails && sessionSnapshot && (sessionSnapshot.planningContextSummary || sessionSnapshot.memoryWritebackSummary) && (
        <Card className={sectionCard} id="memory-context">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-cyan-500" />
              项目记忆与规划上下文
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sessionSnapshot.planningContextSummary && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">项目</p>
                    <p className="mt-1 text-sm font-semibold">{sessionSnapshot.planningContextSummary.projectId}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">规划提示数</p>
                    <p className="mt-1 text-sm font-semibold">{sessionSnapshot.planningContextSummary.hints.length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">可复用引用</p>
                    <p className="mt-1 text-sm font-semibold">
                      {sessionSnapshot.planningContextSummary.selectedContext.reusableWorkspaceRefs.length}
                      <span className="ml-1 text-xs text-slate-400">/ {sessionSnapshot.planningContextSummary.inventory.reusableRefCount}</span>
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">规划记忆</p>
                    <p className="mt-1 text-sm font-semibold">
                      {sessionSnapshot.planningContextSummary.selectedContext.plannerMemories.length}
                      <span className="ml-1 text-xs text-slate-400">/ {sessionSnapshot.planningContextSummary.inventory.plannerMemoryCount}</span>
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                    <p className="text-[11px] text-slate-500">失败模式</p>
                    <p className="mt-1 text-sm font-semibold">
                      {sessionSnapshot.planningContextSummary.selectedContext.recurringFailurePatterns.length}
                      <span className="ml-1 text-xs text-slate-400">/ {sessionSnapshot.planningContextSummary.inventory.failurePatternCount}</span>
                    </p>
                  </div>
                </div>

                {sessionSnapshot.planningContextSummary.hints.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-500">注入规划器的提示</p>
                    <div className="space-y-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                      {sessionSnapshot.planningContextSummary.hints.map((hint, idx) => (
                        <p key={`${hint}_${idx}`} className="text-xs text-slate-600 dark:text-slate-300">{hint}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">已选用的项目上下文</p>
                    <div className="space-y-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                      {sessionSnapshot.planningContextSummary.selectedContext.successfulTodoSkeletons.map((item, idx) => (
                        <div key={`skeleton_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{item.goalHint}</p>
                          <p className="mt-1 text-slate-500">flow: {item.capabilityFlow.join(" -> ") || "-"}</p>
                        </div>
                      ))}
                      {sessionSnapshot.planningContextSummary.selectedContext.reusableWorkspaceRefs.map((item, idx) => (
                        <div key={`ref_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{item.kind}</p>
                          <p className="mt-1 text-slate-500">{item.summary}</p>
                        </div>
                      ))}
                      {sessionSnapshot.planningContextSummary.selectedContext.recurringFailurePatterns.map((item, idx) => (
                        <div key={`failure_${idx}`} className="rounded-lg bg-rose-50/60 px-3 py-2 text-xs dark:bg-rose-950/20">
                          <p className="font-medium text-rose-700 dark:text-rose-300">{item.type}</p>
                          <p className="mt-1 text-rose-600/90 dark:text-rose-300/90">{item.signal}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">运行时可用的记忆信号</p>
                    <div className="space-y-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                      {sessionSnapshot.planningContextSummary.memorySignals.routingMemories.map((item, idx) => (
                        <div key={`routing_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                          <p className="font-medium text-slate-700 dark:text-slate-200">
                            {item.capabilityType} {"->"} {item.preferredMode}
                            {item.preferredAgentId ? ` (${item.preferredAgentId})` : ""}
                          </p>
                          <p className="mt-1 text-slate-500">{item.reason}</p>
                        </div>
                      ))}
                      {sessionSnapshot.planningContextSummary.memorySignals.reviewMemories.map((item, idx) => (
                        <div key={`review_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                          <p className="font-medium text-slate-700 dark:text-slate-200">{item.capabilityType ?? "review"}</p>
                          <p className="mt-1 text-slate-500">{item.frequentMissingCriteria.join(" | ") || item.reason}</p>
                        </div>
                      ))}
                      {sessionSnapshot.planningContextSummary.memorySignals.recoveryMemories.map((item, idx) => (
                        <div key={`recovery_${idx}`} className="rounded-lg bg-amber-50/60 px-3 py-2 text-xs dark:bg-amber-950/20">
                          <p className="font-medium text-amber-700 dark:text-amber-300">
                            {item.capabilityType ?? "general"} {"->"} {item.preferredAction}
                            {item.preferredTargetAgentId ? ` (${item.preferredTargetAgentId})` : ""}
                          </p>
                          <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">{item.triggerPattern}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {sessionSnapshot.memoryWritebackSummary && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70">运行摘要数</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">{sessionSnapshot.memoryWritebackSummary.runSummaryCount}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70">引用 / 骨架</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                      {sessionSnapshot.memoryWritebackSummary.reusableRefCount} / {sessionSnapshot.memoryWritebackSummary.skeletonCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70">路由 / 评审记忆</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                      {sessionSnapshot.memoryWritebackSummary.routingMemoryCount} / {sessionSnapshot.memoryWritebackSummary.reviewMemoryCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70">恢复记忆数</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">{sessionSnapshot.memoryWritebackSummary.recoveryMemoryCount}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70">稳定来源数</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">{sessionSnapshot.memoryWritebackSummary.stableSourceProfileCount}</p>
                  </div>
                </div>
                {sessionSnapshot.memoryWritebackSummary.latestRunSummary && (
                  <div className="mt-4 rounded-xl bg-white/70 p-3 text-xs text-emerald-900 dark:bg-slate-900/60 dark:text-emerald-100">
                    <p className="font-medium">
                      最近运行: {sessionSnapshot.memoryWritebackSummary.latestRunSummary.terminalStatus}
                      {" · "}
                      {sessionSnapshot.memoryWritebackSummary.latestRunSummary.doneTodoCount}/
                      {sessionSnapshot.memoryWritebackSummary.latestRunSummary.todoCount} todos
                      {" · "}
                      恢复次数={sessionSnapshot.memoryWritebackSummary.latestRunSummary.recoveryCount}
                    </p>
                    {sessionSnapshot.memoryWritebackSummary.latestRunSummary.majorArtifacts.length > 0 && (
                      <p className="mt-1 text-emerald-800/80 dark:text-emerald-200/80">
                        主要产物: {sessionSnapshot.memoryWritebackSummary.latestRunSummary.majorArtifacts.map((item) => item.summary).join(" | ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(recoveryTimeline.length > 0 || recoveredTodos.length > 0 || routingHotspots.length > 0) && (
        <Card className={sectionCard} id="recovery-routing">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4 text-rose-500" />
              恢复与路由
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">最近恢复事件</p>
              <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                {recoveryTimeline.length === 0 ? (
                  <p className="text-xs text-slate-500">暂无 recovery timeline。</p>
                ) : recoveryTimeline.map((event, idx) => (
                  <div key={`${event.timestamp}_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{event.timestamp}</span>
                      <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{event.actionLabel}</span>
                      <span className="text-[11px] text-slate-500">Todo={event.todoId}</span>
                      <span className="text-[11px] text-slate-500">执行者={event.actor}</span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap rounded-md bg-white p-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{event.message}</pre>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">路由热点</p>
                <div className="flex flex-wrap gap-2 rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                  {routingHotspots.length === 0 ? (
                    <p className="text-xs text-slate-500">暂无 assignee history。</p>
                  ) : routingHotspots.map((item) => (
                    <span key={item.agentId} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {item.agentId} · {item.count}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">已恢复 / 已改派的 Todo</p>
                <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                  {recoveredTodos.length === 0 ? (
                    <p className="text-xs text-slate-500">暂无需要展示的 recovery todo。</p>
                  ) : recoveredTodos.map((todo) => (
                    <div key={todo.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{todo.id}</span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">{localizeTraceText(todo.title)}</span>
                        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {localizeTraceText(todo.status)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                        <span>重试={todo.retry_count ?? 0}</span>
                        <span>改派={todo.reroute_count ?? 0}</span>
                        <span>恢复={todo.recovery_history?.length ?? 0}</span>
                        <span>执行者={todo.assignee ?? "-"}</span>
                        {todo.forced_target_agent_id && <span>强制指派={todo.forced_target_agent_id}</span>}
                      </div>
                      {todo.last_failure_reason && (
                        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{localizeTraceText(todo.last_failure_reason)}</p>
                      )}
                      {todo.retry_improvement_directive && (
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{todo.retry_improvement_directive}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(keyDeliverables.length > 0 || (showAdvancedDetails && artifactOutputs.workspaceFiles.length > 0)) && (
        <Card className={sectionCard} id="artifacts-workspace">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-emerald-500" />
              关键交付物
            </CardTitle>
          </CardHeader>
          <CardContent className={`grid gap-4 ${showAdvancedDetails && artifactOutputs.workspaceFiles.length > 0 ? "xl:grid-cols-2" : ""}`}>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">最终产物</p>
              <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                {keyDeliverables.map((artifact) => (
                  <div key={artifact.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{artifact.type}</span>
                      <span className="text-slate-500">Todo={artifact.related_todo}</span>
                      <span className="ml-auto text-slate-500">{artifact.producer}</span>
                    </div>
                    <p className="mt-1 break-all text-slate-500">{artifact.path}</p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">{artifact.summary}</p>
                  </div>
                ))}
              </div>
            </div>

            {showAdvancedDetails && artifactOutputs.workspaceFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">工作区文件</p>
                <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-3 dark:border-white/[0.06]">
                  {artifactOutputs.workspaceFiles.map((file) => (
                    <div key={file.file_id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{file.kind}</span>
                        <span className="text-slate-500">Todo={file.related_todo}</span>
                        {file.retention && <span className="text-slate-500">保留策略={file.retention}</span>}
                      </div>
                      <p className="mt-1 break-all text-slate-500">{file.path}</p>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">{file.content_summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showAdvancedDetails && traceRunState && (
        <Card className={sectionCard} id="execution-trace">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <button className="flex items-center gap-2" onClick={() => setShowTrace((v) => !v)}>
                {showTrace ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                <FileText className="h-4 w-4 text-cyan-500" />
                执行轨迹面板
              </button>
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                run: {traceRunState.run_id}
              </span>
            </CardTitle>
          </CardHeader>
          {showTrace && (
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={onDownloadTrace}>
                  <Download className="h-3 w-3" />
                  下载 Trace JSON
                </Button>
                <span className="text-xs text-slate-500">日志展示上限</span>
                <Button size="sm" variant={traceLogLimit === 50 ? "default" : "secondary"} className="h-7 px-2 text-xs" onClick={() => setTraceLogLimit(50)}>50</Button>
                <Button size="sm" variant={traceLogLimit === 120 ? "default" : "secondary"} className="h-7 px-2 text-xs" onClick={() => setTraceLogLimit(120)}>120</Button>
                <Button size="sm" variant={traceLogLimit === 300 ? "default" : "secondary"} className="h-7 px-2 text-xs" onClick={() => setTraceLogLimit(300)}>300</Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">运行状态</p>
                  <p className="mt-1 text-sm font-semibold">{localizeTraceText(traceRunState.status)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">当前 Todo</p>
                  <p className="mt-1 text-sm font-semibold">{traceRunState.current_todo_id ?? "-"}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">当前波次</p>
                  <p className="mt-1 text-sm font-semibold">{traceRunState.current_wave_id ?? "-"}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">Todo 数 / 波次数</p>
                  <p className="mt-1 text-sm font-semibold">{traceRunState.todos.length} / {traceRunState.wave_count ?? 0}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-[11px] text-slate-500">日志条数 / 问题数</p>
                  <p className="mt-1 text-sm font-semibold">{traceRunState.execution_log?.length ?? 0} / {traceRunState.issues.length}</p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">规划流程（按依赖顺序）</p>
                <div className="max-h-[220px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-2 dark:border-white/[0.06]">
                  {traceFlowOrder.map((todo) => (
                    <div key={todo.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{todo.id}</span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">{localizeTraceText(todo.title)}</span>
                        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{localizeTraceText(todo.status)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                        <span>能力: {todo.capability_type ?? "-"}</span>
                        <span>委派: {localizeTraceText(todo.delegation_status ?? "-")}</span>
                        <span>评审: {localizeTraceText(todo.review_result ?? "-")}</span>
                        <span>重试: {todo.retry_count ?? 0}</span>
                        <span>依赖: {(todo.depends_on ?? []).join(", ") || "-"}</span>
                        <span>输出: {todo.output_ref ?? "-"}</span>
                      </div>
                      {todo.description ? (
                        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                          {localizeTraceText(todo.description)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {traceDelegationView.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">子 Agent 委派轨迹</p>
                  <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-2 dark:border-white/[0.06]">
                    {traceDelegationView.map((row, idx) => (
                      <div key={`${row.todoId}_${row.target}_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500">{row.todoId}</span>
                          <span className="text-slate-700 dark:text-slate-200">{row.target}</span>
                          <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {localizeTraceText(row.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{row.reason || "-"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {traceWaves.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">并行波次轨迹</p>
                  <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-xl border border-black/[0.04] p-2 dark:border-white/[0.06]">
                    {traceWaves.slice().reverse().map((wave) => (
                      <div key={wave.wave_id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500">{wave.wave_id}</span>
                          <span className="text-slate-600 dark:text-slate-300">{wave.todo_ids.join(", ")}</span>
                          <span className="ml-auto text-[11px] text-slate-500">{wave.created_at}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          {wave.execution_mode_per_todo.map((item) => (
                            <span key={`${wave.wave_id}_${item.todo_id}_mode`} className="rounded-md bg-white px-1.5 py-0.5 dark:bg-slate-800">
                              {item.todo_id}: {localizeTraceText(item.mode)}{item.target_agent_id ? `(${item.target_agent_id})` : ""}
                            </span>
                          ))}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          {wave.review_outcome_per_todo.map((item) => (
                            <span key={`${wave.wave_id}_${item.todo_id}_review`} className="rounded-md bg-white px-1.5 py-0.5 dark:bg-slate-800">
                              {item.todo_id}: {localizeTraceText(item.status)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">执行时间线</p>
                <div className="max-h-[280px] overflow-y-auto rounded-xl border border-black/[0.04] p-2 dark:border-white/[0.06]">
                  {traceTimelineView.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-500">暂无 execution log。</p>
                  ) : (
                    <div className="space-y-2">
                      {traceTimelineView.map((log, idx) => {
                        return (
                          <div key={`${log.timestamp}_${log.todo_id}_${idx}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] text-slate-500">{log.timestamp}</span>
                              <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{log.actionLabel}</span>
                              <span className="text-[11px] text-slate-500">Todo={log.todo_id}</span>
                              <span className="text-[11px] text-slate-500">执行者={log.actor}</span>
                            </div>
                            {log.localizedPayload ? (
                              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-white p-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {JSON.stringify(log.localizedPayload, null, 2)}
                              </pre>
                            ) : (
                              <p className="mt-1 break-words text-[11px] text-slate-600 dark:text-slate-300">{log.rawMessageLocalized}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {traceRunState.issues.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-500">运行问题</p>
                  <div className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-rose-200 bg-rose-50/40 p-2 dark:border-rose-900 dark:bg-rose-950/20">
                    {traceRunState.issues.map((issue) => (
                      <div key={issue.id} className="rounded-md bg-white px-3 py-2 text-xs dark:bg-slate-900">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">{issue.type}</span>
                          <span className="text-[11px] text-rose-600 dark:text-rose-300">{localizeIssueType(issue.type)}</span>
                          <span className="text-[11px] text-slate-500">{issue.status}</span>
                          {issue.todo_id && <span className="text-[11px] text-slate-500">Todo={issue.todo_id}</span>}
                        </div>
                        <p className="mt-1 break-words text-[12px] text-slate-700 dark:text-slate-200">{localizeTraceText(issue.message)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {result && (
        <>
          <Card className={sectionCard} id="execution-summary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {result.status === "success" ? (
                  <CircleCheck className="h-5 w-5 text-emerald-500" />
                ) : result.status === "max_steps_reached" || result.status === "max_iterations_reached" ? (
                  <RotateCcw className="h-5 w-5 text-amber-500" />
                ) : (
                  <CircleX className="h-5 w-5 text-rose-500" />
                )}
                {result.status === "success"
                  ? "目标达成"
                  : result.status === "max_steps_reached" || result.status === "max_iterations_reached"
                    ? "达到最大步骤上限"
                    : "执行失败"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">执行步数</p>
                  <p className="mt-1 text-lg font-semibold">{(result.steps ?? result.iterations).length}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">最终评分</p>
                  <p className="mt-1 text-lg font-semibold">{result.finalScore?.toFixed(2) ?? "-"}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">总耗时</p>
                  <p className="mt-1 text-lg font-semibold">{(result.totalDurationMs / 1000).toFixed(1)}s</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">Token 总量</p>
                  <p className="mt-1 text-lg font-semibold">{result.totalTokensUsed.toLocaleString()}</p>
                </div>
              </div>

              {result.finalOutput && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">最终输出</p>
                  <div className="max-h-[300px] overflow-y-auto rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <pre className="whitespace-pre-wrap font-sans">{result.finalOutput}</pre>
                  </div>
                </div>
              )}

              {result.finalSummary && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">LLM 最终总结（独立于 Trace）</p>
                  <div className="max-h-[240px] overflow-y-auto rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-sm leading-relaxed text-slate-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-slate-200">
                    <pre className="whitespace-pre-wrap font-sans">{result.finalSummary}</pre>
                  </div>
                </div>
              )}

              {result.finalRunId && (
                <p className="mt-3 text-xs text-slate-500">
                  最终运行 ID:{" "}
                  <span className="font-mono text-slate-700 dark:text-slate-300">{result.finalRunId}</span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={sectionCard} id="execution-steps">
            <CardHeader>
              <CardTitle className="text-base">执行步骤</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {displayIterations.map((iter) => (
                <div key={iter.iteration} className="rounded-xl border border-black/[0.04] dark:border-white/[0.06]">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
                    onClick={() => toggleIter(iter.iteration)}
                  >
                    {expandedIter.has(iter.iteration) ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <span className="font-medium">第 {iter.iteration} 轮</span>
                    <span className="text-xs text-slate-500">{phaseLabels[iter.phase] ?? iter.phase}</span>
                    {typeof iter.reflectionScore === "number" && (
                      <span
                        className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                          verdictColors[iter.reflectionVerdict ?? ""] ?? "text-slate-500"
                        }`}
                      >
                        {iter.reflectionScore.toFixed(2)} ({iter.reflectionVerdict})
                      </span>
                    )}
                    {iter.error && <span className="ml-auto text-xs text-rose-500">错误</span>}
                  </button>

                  {expandedIter.has(iter.iteration) && (
                    <div className="space-y-3 border-t border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
                      {iter.workflowSnapshot && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">工作流快照</p>
                          <div className="flex flex-wrap items-center gap-1 text-xs">
                            {iter.workflowSnapshot.nodes.map((n, i) => (
                              <span key={n.id} className="flex items-center gap-1">
                                {i > 0 && <span className="text-slate-300">→</span>}
                                <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                  {n.name}
                                  <span className="ml-1 text-[10px] text-violet-400">({n.role})</span>
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {iter.banditTemplateId && (
                        <div className="flex items-center gap-2 text-xs">
                          <Target className="h-3 w-3 text-indigo-500" />
                          <span className="text-slate-500">
                            Bandit 选择：
                            <span className="font-medium text-indigo-600 dark:text-indigo-400">{iter.banditTemplateId}</span>
                          </span>
                          {iter.banditIsExploration && (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                              探索
                            </span>
                          )}
                        </div>
                      )}

                      {iter.runId && (
                        <div className="flex flex-wrap gap-4 text-xs">
                          <span className="text-slate-500">
                            状态: <span className="font-medium text-slate-700 dark:text-slate-200">{iter.runStatus}</span>
                          </span>
                          {iter.runDurationMs != null && (
                            <span className="text-slate-500">
                              耗时: <span className="font-medium">{(iter.runDurationMs / 1000).toFixed(1)}s</span>
                            </span>
                          )}
                          {iter.runTotalTokens != null && (
                            <span className="text-slate-500">
                              Token: <span className="font-medium">{iter.runTotalTokens.toLocaleString()}</span>
                            </span>
                          )}
                        </div>
                      )}

                      {showAdvancedDetails && iter.planningPrompt && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">规划提示词</p>
                          <pre className="max-h-[220px] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {iter.planningPrompt}
                          </pre>
                        </div>
                      )}

                      {showAdvancedDetails && iter.planningRawResponse && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">规划原始响应</p>
                          <pre className="max-h-[220px] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                            {iter.planningRawResponse}
                          </pre>
                        </div>
                      )}

                      {showAdvancedDetails && iter.nodeQualityScores && iter.nodeQualityScores.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">节点质量评估</p>
                          <div className="space-y-2">
                            {iter.nodeQualityScores.map((node) => (
                              <div key={node.nodeId} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-slate-700 dark:text-slate-200">{node.nodeName}</span>
                                  <span className="text-slate-500">role={node.nodeRole}</span>
                                  <span className="ml-auto text-slate-500">overall={node.overallScore.toFixed(2)}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                                  <span>rel={node.relevance.toFixed(2)}</span>
                                  <span>comp={node.completeness.toFixed(2)}</span>
                                  <span>acc={node.accuracy.toFixed(2)}</span>
                                  <span>coh={node.coherence.toFixed(2)}</span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{node.feedback}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {iter.observationSummary && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">观测结果</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">{iter.observationSummary}</p>
                        </div>
                      )}

                      {iter.reflectionFeedback && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">反思反馈</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">{iter.reflectionFeedback}</p>
                        </div>
                      )}

                      {iter.adaptations && iter.adaptations.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">调整策略</p>
                          <ul className="list-inside list-disc text-xs text-slate-600 dark:text-slate-300">
                            {iter.adaptations.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {iter.error && (
                        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
                          {iter.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {result.workflowEvolution.length > 0 && (
            <Card className={sectionCard}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-amber-500" />
                  工作流演化历程
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.workflowEvolution.map((evo) => (
                  <div key={evo.iteration} className="flex gap-3 text-xs">
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      第 {evo.iteration} 轮
                    </span>
                    <ul className="list-inside list-disc text-slate-600 dark:text-slate-300">
                      {evo.adaptations.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function MetaAgentPageFallback() {
  return (
    <div className="rounded-3xl border border-black/[0.06] bg-white/80 px-5 py-6 text-sm text-slate-500 shadow-sm backdrop-blur dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300">
      Meta-Agent 加载中...
    </div>
  );
}
