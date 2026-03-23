import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { makeId, nowIso } from "@/lib/utils";
import { configService } from "@/server/config/config-service";
import type { StoredWorkflowEdge, StoredWorkflowNode, StoredWorkflowTask } from "@/server/domain";
import { db } from "@/server/persistence/sqlite";
import { outputManager } from "@/server/runtime/output-manager";
import { runtimeEngine } from "@/server/runtime/runtime-engine";
import { memoryStore } from "@/server/store/memory-store";

type ReplayMode = "full";

export interface RunCompareReport {
  baselineRunId: string;
  candidateRunId: string;
  baselineStatus: string;
  candidateStatus: string;
  baselineDurationMs?: number;
  candidateDurationMs?: number;
  baselineTotalTokens?: number;
  candidateTotalTokens?: number;
  baselineOutputHash?: string;
  candidateOutputHash?: string;
  statusChanged: boolean;
  durationDeltaMs?: number;
  tokenDelta?: number;
  outputChanged: boolean;
  baselineFailedToolCalls: number;
  candidateFailedToolCalls: number;
  toolFailureDelta: number;
  promptDiffSummary: {
    baselinePromptTraceCount: number;
    candidatePromptTraceCount: number;
    changedPromptCount: number;
    changedNodes: Array<{
      nodeId: string;
      nodeName: string;
      baselinePromptHash?: string;
      candidatePromptHash?: string;
      changed: boolean;
    }>;
  };
  nodeDiffs: Array<{
    nodeId: string;
    nodeName: string;
    baselineStatus?: string;
    candidateStatus?: string;
    statusChanged: boolean;
    baselineTotalTokens?: number;
    candidateTotalTokens?: number;
    tokenDelta?: number;
    baselineOutputHash?: string;
    candidateOutputHash?: string;
    outputChanged: boolean;
  }>;
}

export interface EvaluationSuite {
  id: string;
  name: string;
  description?: string;
  workflowId?: string;
  workflowVersionId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationCase {
  id: string;
  suiteId: string;
  name: string;
  taskInput: string;
  replayMode: ReplayMode;
  expectedOutputContains?: string;
  expectedOutputRegex?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationExecutionReport {
  evaluationRunId: string;
  suiteId: string;
  caseId: string;
  baselineRunId: string;
  replayRunId: string;
  baseline: {
    taskInput?: string;
    memoryIsolationMode?: string;
    status: string;
  };
  replay: {
    taskInput?: string;
    memoryIsolationMode?: string;
    status: string;
  };
  score: number;
  verdict: "pass" | "warn" | "fail";
  checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }>;
  compare: RunCompareReport;
  artifacts: {
    baselineFiles: string[];
    replayFiles: string[];
    missingReplayFiles: string[];
    additionalReplayFiles: string[];
    changedSharedFiles: string[];
    allReplayFilesUnderManagedRoot: boolean;
  };
  createdAt: string;
}

function hashText(input?: string) {
  if (!input) {
    return undefined;
  }
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function hashFile(absolutePath?: string) {
  if (!absolutePath || !existsSync(absolutePath)) {
    return undefined;
  }
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex").slice(0, 16);
}

function diffMs(start?: string, end?: string) {
  if (!start || !end) {
    return undefined;
  }
  const value = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toWorkflowPayload(runId: string): {
  nodes: StoredWorkflowNode[];
  edges: StoredWorkflowEdge[];
  tasks: StoredWorkflowTask[];
} {
  const snapshot = memoryStore.getRunSnapshot(runId);
  if (!snapshot) {
    throw new Error("运行不存在");
  }
  return {
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      role: node.role,
      taskSummary: node.taskBrief ?? node.name,
      responsibilitySummary: node.responsibility ?? "",
      position: node.position,
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      type: edge.type,
      condition: edge.condition,
      maxIterations: edge.maxIterations,
      convergenceKeyword: edge.convergenceKeyword,
    })),
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      assignedNodeId: task.assignedNodeId,
      parentTaskId: task.parentTaskId,
      summary: task.summary,
    })),
  };
}

const stmts = {
  insertSuite: db.prepare(`
    INSERT INTO evaluation_suite(id, name, description, workflow_id, workflow_version_id, enabled, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listSuites: db.prepare(`
    SELECT * FROM evaluation_suite
    ORDER BY created_at DESC
  `),
  getSuite: db.prepare(`
    SELECT * FROM evaluation_suite
    WHERE id = ?
  `),
  insertCase: db.prepare(`
    INSERT INTO evaluation_case(
      id, suite_id, name, task_input, replay_mode, expected_output_contains, expected_output_regex, enabled, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listCases: db.prepare(`
    SELECT * FROM evaluation_case
    WHERE suite_id = ?
    ORDER BY created_at DESC
  `),
  getCase: db.prepare(`
    SELECT * FROM evaluation_case
    WHERE id = ?
  `),
  insertEvaluationRun: db.prepare(`
    INSERT INTO evaluation_run(
      id, suite_id, case_id, baseline_run_id, replay_run_id, status, score, verdict, report_json, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateEvaluationRun: db.prepare(`
    UPDATE evaluation_run SET
      baseline_run_id = ?,
      replay_run_id = ?,
      status = ?,
      score = ?,
      verdict = ?,
      report_json = ?,
      updated_at = ?
    WHERE id = ?
  `),
  getEvaluationRun: db.prepare(`
    SELECT * FROM evaluation_run
    WHERE id = ?
  `),
  listEvaluationRuns: db.prepare(`
    SELECT * FROM evaluation_run
    ORDER BY created_at DESC
    LIMIT ?
  `),
  insertReplayLink: db.prepare(`
    INSERT OR REPLACE INTO run_replay_link(id, baseline_run_id, replay_run_id, replay_mode, replay_node_id, include_downstream, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `),
  upsertCompareReport: db.prepare(`
    INSERT INTO run_compare_report(id, baseline_run_id, candidate_run_id, report_json, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(baseline_run_id, candidate_run_id) DO UPDATE SET
      report_json=excluded.report_json,
      updated_at=excluded.updated_at
  `),
};

function toEvaluationSuite(row: Record<string, unknown> | undefined | null): EvaluationSuite | null {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    workflowId: row.workflow_id ? String(row.workflow_id) : undefined,
    workflowVersionId: row.workflow_version_id ? String(row.workflow_version_id) : undefined,
    enabled: Number(row.enabled ?? 0) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toEvaluationCase(row: Record<string, unknown> | undefined | null): EvaluationCase | null {
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    suiteId: String(row.suite_id),
    name: String(row.name),
    taskInput: String(row.task_input),
    replayMode: (row.replay_mode ? String(row.replay_mode) : "full") as ReplayMode,
    expectedOutputContains: row.expected_output_contains ? String(row.expected_output_contains) : undefined,
    expectedOutputRegex: row.expected_output_regex ? String(row.expected_output_regex) : undefined,
    enabled: Number(row.enabled ?? 0) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function getSuiteOrThrow(suiteId: string) {
  const suite = toEvaluationSuite(stmts.getSuite.get(suiteId) as Record<string, unknown> | undefined);
  if (!suite) {
    throw new Error("评测套件不存在");
  }
  return suite;
}

function getCaseOrThrow(caseId: string) {
  const evaluationCase = toEvaluationCase(stmts.getCase.get(caseId) as Record<string, unknown> | undefined);
  if (!evaluationCase) {
    throw new Error("评测用例不存在");
  }
  return evaluationCase;
}

function safeRegex(pattern?: string) {
  if (!pattern?.trim()) {
    return null;
  }
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function waitForRunCompletion(runId: string) {
  return runtimeEngine.startRun(runId);
}

function normalizeArtifactList(runId: string) {
  const root = join(outputManager.baseOutputRoot, runId);
  return outputManager.collectOutputFiles(root).map((item) => outputManager.toProjectRelativePath(item));
}

function buildArtifactMaps(runId: string) {
  const root = join(outputManager.baseOutputRoot, runId);
  const files = outputManager.collectOutputFiles(root);
  const byScopedPath = new Map<
    string,
    {
      absolutePath: string;
      projectRelativePath: string;
    }
  >();
  for (const absolutePath of files) {
    const scopedPath = relative(root, absolutePath).replace(/\\/g, "/");
    byScopedPath.set(scopedPath, {
      absolutePath,
      projectRelativePath: outputManager.toProjectRelativePath(absolutePath),
    });
  }
  return byScopedPath;
}

function countFailedNodes(runId: string) {
  const snapshot = memoryStore.getRunSnapshot(runId);
  return snapshot?.nodes.filter((node) => node.status === "failed").length ?? 0;
}

function countFailedTools(runId: string) {
  return memoryStore.getToolTraces(runId).filter((trace) => trace.status === "failed").length;
}

function summarizePromptDiffs(baselineRunId: string, candidateRunId: string): RunCompareReport["promptDiffSummary"] {
  const baselinePromptTraces = memoryStore.getPromptTraces(baselineRunId);
  const candidatePromptTraces = memoryStore.getPromptTraces(candidateRunId);
  const baselineSnapshot = memoryStore.getRunSnapshot(baselineRunId);
  const candidateSnapshot = memoryStore.getRunSnapshot(candidateRunId);
  const nodeNameLookup = new Map<string, string>();

  for (const node of baselineSnapshot?.nodes ?? []) {
    nodeNameLookup.set(node.id, node.name);
  }
  for (const node of candidateSnapshot?.nodes ?? []) {
    nodeNameLookup.set(node.id, node.name);
  }

  const toNodePromptHashMap = (runTraces: typeof baselinePromptTraces) => {
    const grouped = new Map<string, string[]>();
    for (const trace of runTraces) {
      const payload = [
        `round=${trace.round}`,
        trace.systemPrompt ?? "",
        trace.userPrompt ?? "",
        trace.toolsJson ?? "",
        trace.messageHistoryJson ?? "",
      ].join("\n---\n");
      const existing = grouped.get(trace.nodeId) ?? [];
      existing.push(payload);
      grouped.set(trace.nodeId, existing);
    }
    const result = new Map<string, string>();
    for (const [nodeId, chunks] of grouped.entries()) {
      result.set(nodeId, hashText(chunks.join("\n====\n")) ?? "");
    }
    return result;
  };

  const baselineHashes = toNodePromptHashMap(baselinePromptTraces);
  const candidateHashes = toNodePromptHashMap(candidatePromptTraces);
  const nodeIds = new Set([...baselineHashes.keys(), ...candidateHashes.keys()]);
  const changedNodes = [...nodeIds]
    .map((nodeId) => {
      const baselinePromptHash = baselineHashes.get(nodeId);
      const candidatePromptHash = candidateHashes.get(nodeId);
      return {
        nodeId,
        nodeName: nodeNameLookup.get(nodeId) ?? nodeId,
        baselinePromptHash,
        candidatePromptHash,
        changed: baselinePromptHash !== candidatePromptHash,
      };
    })
    .sort((a, b) => a.nodeName.localeCompare(b.nodeName, "zh-CN"));

  return {
    baselinePromptTraceCount: baselinePromptTraces.length,
    candidatePromptTraceCount: candidatePromptTraces.length,
    changedPromptCount: changedNodes.filter((item) => item.changed).length,
    changedNodes,
  };
}

function buildExecutionReport(args: {
  evaluationRunId: string;
  suiteId: string;
  caseId: string;
  baselineRunId: string;
  replayRunId: string;
  compare: RunCompareReport;
  expectedOutputContains?: string;
  expectedOutputRegex?: string;
}): EvaluationExecutionReport {
  const baselineArtifactMap = buildArtifactMaps(args.baselineRunId);
  const replayArtifactMap = buildArtifactMaps(args.replayRunId);
  const baselineFiles = [...baselineArtifactMap.values()].map((item) => item.projectRelativePath);
  const replayFiles = [...replayArtifactMap.values()].map((item) => item.projectRelativePath);
  const baselineSnapshot = memoryStore.getRunSnapshot(args.baselineRunId);
  const replaySnapshot = memoryStore.getRunSnapshot(args.replayRunId);
  const replayOutput = replaySnapshot?.run.output ?? "";
  const baselineFailedNodeCount = countFailedNodes(args.baselineRunId);
  const replayFailedNodeCount = countFailedNodes(args.replayRunId);
  const regex = safeRegex(args.expectedOutputRegex);

  const baselineScopedPaths = new Set(baselineArtifactMap.keys());
  const replayScopedPaths = new Set(replayArtifactMap.keys());
  const missingReplayFiles = [...baselineScopedPaths].filter((item) => !replayScopedPaths.has(item));
  const additionalReplayFiles = [...replayScopedPaths].filter((item) => !baselineScopedPaths.has(item));
  const changedSharedFiles = [...baselineScopedPaths]
    .filter((item) => replayScopedPaths.has(item))
    .filter((item) => {
      const baselineArtifact = baselineArtifactMap.get(item);
      const replayArtifact = replayArtifactMap.get(item);
      return hashFile(baselineArtifact?.absolutePath) !== hashFile(replayArtifact?.absolutePath);
    });

  const checks = [
    {
      id: "baseline_completed",
      passed: args.compare.baselineStatus === "completed",
      detail: `baseline 状态：${args.compare.baselineStatus}`,
    },
    {
      id: "replay_completed",
      passed: args.compare.candidateStatus === "completed",
      detail: `replay 状态：${args.compare.candidateStatus}`,
    },
    {
      id: "status_consistent",
      passed: !args.compare.statusChanged,
      detail: args.compare.statusChanged ? "baseline 与 replay 状态不一致" : "状态一致",
    },
    {
      id: "latency_regression",
      passed:
        typeof args.compare.durationDeltaMs !== "number"
        || typeof args.compare.baselineDurationMs !== "number"
        || args.compare.baselineDurationMs === 0
        || args.compare.durationDeltaMs <= args.compare.baselineDurationMs * 0.5,
      detail: `耗时变化：${args.compare.durationDeltaMs ?? 0}ms`,
    },
    {
      id: "token_regression",
      passed:
        typeof args.compare.tokenDelta !== "number"
        || typeof args.compare.baselineTotalTokens !== "number"
        || args.compare.baselineTotalTokens === 0
        || args.compare.tokenDelta <= args.compare.baselineTotalTokens * 0.2,
      detail: `Token 变化：${args.compare.tokenDelta ?? 0}`,
    },
    {
      id: "expected_contains",
      passed: args.expectedOutputContains ? replayOutput.includes(args.expectedOutputContains) : true,
      detail: args.expectedOutputContains
        ? `输出需要包含：${args.expectedOutputContains}`
        : "未配置 contains 规则",
    },
    {
      id: "expected_regex",
      passed: regex ? regex.test(replayOutput) : true,
      detail: args.expectedOutputRegex
        ? `输出需要匹配正则：${args.expectedOutputRegex}`
        : "未配置 regex 规则",
    },
    {
      id: "managed_output_root",
      passed: replayFiles.every((item) => item.startsWith(".output/v0_2/") || item.startsWith(".output\\v0_2\\")),
      detail: replayFiles.length > 0 ? `输出文件数：${replayFiles.length}` : "本次 replay 未生成文件输出",
    },
    {
      id: "tool_failure_delta",
      passed: args.compare.candidateFailedToolCalls <= args.compare.baselineFailedToolCalls,
      detail: `工具失败 baseline/replay：${args.compare.baselineFailedToolCalls}/${args.compare.candidateFailedToolCalls}`,
    },
    {
      id: "artifact_diff",
      passed: missingReplayFiles.length === 0,
      detail: `缺少文件 ${missingReplayFiles.length} 个，新增文件 ${additionalReplayFiles.length} 个，内容变化 ${changedSharedFiles.length} 个，失败节点 baseline/replay：${baselineFailedNodeCount}/${replayFailedNodeCount}`,
    },
    {
      id: "prompt_diff_summary",
      passed: args.compare.promptDiffSummary.changedPromptCount === 0,
      detail: `Prompt Trace baseline/replay：${args.compare.promptDiffSummary.baselinePromptTraceCount}/${args.compare.promptDiffSummary.candidatePromptTraceCount}，变化节点数 ${args.compare.promptDiffSummary.changedPromptCount}`,
    },
  ];

  let score = 100;
  for (const check of checks) {
    if (check.passed) {
      continue;
    }
    if (check.id === "baseline_completed" || check.id === "replay_completed") {
      score -= 35;
    } else if (check.id === "expected_contains" || check.id === "expected_regex") {
      score -= 20;
    } else if (check.id === "managed_output_root") {
      score -= 15;
    } else if (check.id === "artifact_diff" || check.id === "tool_failure_delta") {
      score -= 12;
    } else {
      score -= 10;
    }
  }
  score = Math.max(0, score);

  const verdict: "pass" | "warn" | "fail" = score >= 80 ? "pass" : score >= 60 ? "warn" : "fail";

  return {
    evaluationRunId: args.evaluationRunId,
    suiteId: args.suiteId,
    caseId: args.caseId,
    baselineRunId: args.baselineRunId,
    replayRunId: args.replayRunId,
    baseline: {
      taskInput: baselineSnapshot?.run.taskInput,
      memoryIsolationMode: baselineSnapshot?.run.memoryIsolationMode,
      status: args.compare.baselineStatus,
    },
    replay: {
      taskInput: replaySnapshot?.run.taskInput,
      memoryIsolationMode: replaySnapshot?.run.memoryIsolationMode,
      status: args.compare.candidateStatus,
    },
    score,
    verdict,
    checks,
    compare: args.compare,
    artifacts: {
      baselineFiles,
      replayFiles,
      missingReplayFiles,
      additionalReplayFiles,
      changedSharedFiles,
      allReplayFilesUnderManagedRoot: checks.find((item) => item.id === "managed_output_root")?.passed ?? true,
    },
    createdAt: nowIso(),
  };
}

export const evaluationService = {
  listSuites() {
    return (stmts.listSuites.all() as Array<Record<string, unknown>>)
      .map((row) => toEvaluationSuite(row))
      .filter((row): row is EvaluationSuite => Boolean(row));
  },

  createSuite(payload: {
    name?: string;
    description?: string;
    workflowId?: string;
    workflowVersionId?: string;
    enabled?: boolean;
  }) {
    if (!payload.name?.trim()) {
      throw new Error("评测套件名称不能为空");
    }
    const id = makeId("eval_suite");
    const now = nowIso();
    stmts.insertSuite.run(
      id,
      payload.name.trim(),
      payload.description ?? null,
      payload.workflowId ?? null,
      payload.workflowVersionId ?? null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    return getSuiteOrThrow(id);
  },

  listCases(suiteId: string) {
    getSuiteOrThrow(suiteId);
    return (stmts.listCases.all(suiteId) as Array<Record<string, unknown>>)
      .map((row) => toEvaluationCase(row))
      .filter((row): row is EvaluationCase => Boolean(row));
  },

  createCase(payload: {
    suiteId: string;
    name?: string;
    taskInput?: string;
    replayMode?: ReplayMode;
    expectedOutputContains?: string;
    expectedOutputRegex?: string;
    enabled?: boolean;
  }) {
    getSuiteOrThrow(payload.suiteId);
    if (!payload.name?.trim()) {
      throw new Error("评测用例名称不能为空");
    }
    if (!payload.taskInput?.trim()) {
      throw new Error("评测用例输入不能为空");
    }
    const id = makeId("eval_case");
    const now = nowIso();
    stmts.insertCase.run(
      id,
      payload.suiteId,
      payload.name.trim(),
      payload.taskInput.trim(),
      payload.replayMode ?? "full",
      payload.expectedOutputContains ?? null,
      payload.expectedOutputRegex ?? null,
      payload.enabled === false ? 0 : 1,
      now,
      now,
    );
    return getCaseOrThrow(id);
  },

  getEvaluationRun(evaluationRunId: string) {
    const row = stmts.getEvaluationRun.get(evaluationRunId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error("评测运行不存在");
    }
    return {
      id: String(row.id),
      suiteId: String(row.suite_id),
      caseId: String(row.case_id),
      baselineRunId: row.baseline_run_id ? String(row.baseline_run_id) : undefined,
      replayRunId: row.replay_run_id ? String(row.replay_run_id) : undefined,
      status: String(row.status),
      score: typeof row.score === "number" ? row.score : undefined,
      verdict: row.verdict ? String(row.verdict) : undefined,
      report: row.report_json ? (JSON.parse(String(row.report_json)) as EvaluationExecutionReport) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  },

  listEvaluationRuns(limit = 20) {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 200));
    return (stmts.listEvaluationRuns.all(safeLimit) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      suiteId: String(row.suite_id),
      caseId: String(row.case_id),
      baselineRunId: row.baseline_run_id ? String(row.baseline_run_id) : undefined,
      replayRunId: row.replay_run_id ? String(row.replay_run_id) : undefined,
      status: String(row.status),
      score: typeof row.score === "number" ? row.score : undefined,
      verdict: row.verdict ? String(row.verdict) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  },

  createReplayRun(input: {
    baselineRunId: string;
    replayMode?: ReplayMode;
    autoStart?: boolean;
  }) {
    const baseline = memoryStore.getRunSnapshot(input.baselineRunId);
    if (!baseline) {
      throw new Error("基线运行不存在");
    }

    const workflow = baseline.run.workflowId
      ? configService.getWorkflow(baseline.run.workflowId, baseline.run.workflowVersionId)
      : null;

    const workflowPayload = workflow
      ? { nodes: workflow.nodes, edges: workflow.edges, tasks: workflow.tasks }
      : toWorkflowPayload(input.baselineRunId);

    const originalTaskInput =
      baseline.run.taskInput
      ?? baseline.tasks.find((task) => task.id === baseline.run.rootTaskId)?.title
      ?? baseline.run.name;

    const replayRun = runtimeEngine.createRun(originalTaskInput, workflowPayload, baseline.run.runMode, {
      workflowId: baseline.run.workflowId,
      workflowVersionId: baseline.run.workflowVersionId,
      taskInput: originalTaskInput,
      memoryIsolationMode: baseline.run.memoryIsolationMode ?? "run_scoped",
    });

    stmts.insertReplayLink.run(
      makeId("rpl"),
      input.baselineRunId,
      replayRun.id,
      input.replayMode ?? "full",
      null,
      0,
      nowIso(),
    );

    if (input.autoStart !== false) {
      runtimeEngine.startRun(replayRun.id).catch((error) => {
        console.error("[EvaluationService] replay startRun failed:", error);
      });
    }

    return {
      baselineRunId: input.baselineRunId,
      replayRunId: replayRun.id,
      replayMode: input.replayMode ?? "full",
    };
  },

  compareRuns(baselineRunId: string, candidateRunId: string): RunCompareReport {
    const baseline = memoryStore.getRunSnapshot(baselineRunId);
    const candidate = memoryStore.getRunSnapshot(candidateRunId);
    if (!baseline || !candidate) {
      throw new Error("运行不存在");
    }

    const aggregateTokens = (runId: string) =>
      memoryStore.getNodeTraces(runId).reduce((sum, trace) => sum + (trace.totalTokens ?? 0), 0);

    const baselineDurationMs = diffMs(baseline.run.startedAt, baseline.run.finishedAt);
    const candidateDurationMs = diffMs(candidate.run.startedAt, candidate.run.finishedAt);
    const baselineTotalTokens = aggregateTokens(baselineRunId);
    const candidateTotalTokens = aggregateTokens(candidateRunId);
    const baselineFailedToolCalls = countFailedTools(baselineRunId);
    const candidateFailedToolCalls = countFailedTools(candidateRunId);

    const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
    const candidateNodes = new Map(candidate.nodes.map((node) => [node.id, node]));
    const baselineTokens = new Map(memoryStore.getNodeTraces(baselineRunId).map((trace) => [trace.nodeId, trace.totalTokens ?? 0]));
    const candidateTokens = new Map(memoryStore.getNodeTraces(candidateRunId).map((trace) => [trace.nodeId, trace.totalTokens ?? 0]));

    const nodeIds = new Set([...baselineNodes.keys(), ...candidateNodes.keys()]);
    const nodeDiffs = [...nodeIds].map((nodeId) => {
      const baseNode = baselineNodes.get(nodeId);
      const candNode = candidateNodes.get(nodeId);
      const baseToken = baselineTokens.get(nodeId);
      const candToken = candidateTokens.get(nodeId);
      const baselineOutputHash = hashText(baseNode?.latestOutput);
      const candidateOutputHash = hashText(candNode?.latestOutput);
      return {
        nodeId,
        nodeName: candNode?.name ?? baseNode?.name ?? nodeId,
        baselineStatus: baseNode?.status,
        candidateStatus: candNode?.status,
        statusChanged: baseNode?.status !== candNode?.status,
        baselineTotalTokens: baseToken,
        candidateTotalTokens: candToken,
        tokenDelta:
          typeof baseToken === "number" || typeof candToken === "number"
            ? (candToken ?? 0) - (baseToken ?? 0)
            : undefined,
        baselineOutputHash,
        candidateOutputHash,
        outputChanged: baselineOutputHash !== candidateOutputHash,
      };
    });

    const report: RunCompareReport = {
      baselineRunId,
      candidateRunId,
      baselineStatus: baseline.run.status,
      candidateStatus: candidate.run.status,
      baselineDurationMs,
      candidateDurationMs,
      baselineTotalTokens,
      candidateTotalTokens,
      baselineOutputHash: hashText(baseline.run.output),
      candidateOutputHash: hashText(candidate.run.output),
      statusChanged: baseline.run.status !== candidate.run.status,
      durationDeltaMs:
        typeof baselineDurationMs === "number" || typeof candidateDurationMs === "number"
          ? (candidateDurationMs ?? 0) - (baselineDurationMs ?? 0)
          : undefined,
      tokenDelta: candidateTotalTokens - baselineTotalTokens,
      outputChanged: hashText(baseline.run.output) !== hashText(candidate.run.output),
      baselineFailedToolCalls,
      candidateFailedToolCalls,
      toolFailureDelta: candidateFailedToolCalls - baselineFailedToolCalls,
      promptDiffSummary: summarizePromptDiffs(baselineRunId, candidateRunId),
      nodeDiffs,
    };

    const now = nowIso();
    stmts.upsertCompareReport.run(
      makeId("cmp"),
      baselineRunId,
      candidateRunId,
      JSON.stringify(report),
      now,
      now,
    );

    return report;
  },

  async executeCase(caseId: string) {
    const evaluationCase = getCaseOrThrow(caseId);
    const suite = getSuiteOrThrow(evaluationCase.suiteId);
    if (!suite.workflowId) {
      throw new Error("评测套件未绑定 workflowId");
    }

    const workflow = configService.getWorkflow(suite.workflowId, suite.workflowVersionId);
    if (!workflow) {
      throw new Error("评测套件关联的工作流不存在");
    }

    const evaluationRunId = makeId("eval_run");
    const now = nowIso();
    stmts.insertEvaluationRun.run(
      evaluationRunId,
      suite.id,
      evaluationCase.id,
      null,
      null,
      "running",
      null,
      null,
      null,
      now,
      now,
    );

    try {
      const baseline = runtimeEngine.createRun(
        evaluationCase.taskInput,
        {
          nodes: workflow.nodes,
          edges: workflow.edges,
          tasks: workflow.tasks,
        },
        "standard",
        {
          workflowId: suite.workflowId,
          workflowVersionId: suite.workflowVersionId,
          taskInput: evaluationCase.taskInput,
          memoryIsolationMode: "run_scoped",
        },
      );

      await waitForRunCompletion(baseline.id);

      const replay = this.createReplayRun({
        baselineRunId: baseline.id,
        replayMode: evaluationCase.replayMode,
        autoStart: false,
      });

      await waitForRunCompletion(replay.replayRunId);
      const compare = this.compareRuns(baseline.id, replay.replayRunId);
      const report = buildExecutionReport({
        evaluationRunId,
        suiteId: suite.id,
        caseId: evaluationCase.id,
        baselineRunId: baseline.id,
        replayRunId: replay.replayRunId,
        compare,
        expectedOutputContains: evaluationCase.expectedOutputContains,
        expectedOutputRegex: evaluationCase.expectedOutputRegex,
      });

      stmts.updateEvaluationRun.run(
        baseline.id,
        replay.replayRunId,
        "completed",
        report.score,
        report.verdict,
        JSON.stringify(report),
        nowIso(),
        evaluationRunId,
      );

      return report;
    } catch (error) {
      const failedAt = nowIso();
      const message = error instanceof Error ? error.message : "评测执行失败";
      stmts.updateEvaluationRun.run(
        null,
        null,
        "failed",
        0,
        "fail",
        JSON.stringify({ error: message, createdAt: failedAt }),
        failedAt,
        evaluationRunId,
      );
      throw error;
    }
  },
};
