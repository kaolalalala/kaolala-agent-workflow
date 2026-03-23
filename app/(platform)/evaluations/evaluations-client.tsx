"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PlayCircle, RefreshCw, TestTube2 } from "lucide-react";

import {
  runtimeClient,
  type EvaluationCaseView,
  type EvaluationExecutionReportView,
  type EvaluationRunView,
  type EvaluationSuiteView,
  type WorkflowSummaryView,
} from "@/features/workflow/adapters/runtime-client";

interface SuiteWithCases extends EvaluationSuiteView {
  cases: EvaluationCaseView[];
}

const EMPTY_SUITE_FORM = {
  name: "",
  description: "",
  workflowId: "",
};

const EMPTY_CASE_FORM = {
  suiteId: "",
  name: "",
  taskInput: "",
  expectedOutputContains: "",
  expectedOutputRegex: "",
};

export function EvaluationsClient() {
  const [workflows, setWorkflows] = useState<WorkflowSummaryView[]>([]);
  const [suites, setSuites] = useState<SuiteWithCases[]>([]);
  const [evaluationRuns, setEvaluationRuns] = useState<EvaluationRunView[]>([]);
  const [selectedReport, setSelectedReport] = useState<EvaluationExecutionReportView | null>(null);

  const [suiteForm, setSuiteForm] = useState(EMPTY_SUITE_FORM);
  const [caseForm, setCaseForm] = useState(EMPTY_CASE_FORM);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingSuite, setCreatingSuite] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [executingCaseId, setExecutingCaseId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const [workflowPayload, suitePayload, evaluationRunPayload] = await Promise.all([
        runtimeClient.listWorkflows(),
        runtimeClient.listEvaluationSuites(),
        runtimeClient.listEvaluationRuns(50),
      ]);
      const suiteRows = await Promise.all(
        suitePayload.suites.map(async (suite) => {
          const casesPayload = await runtimeClient.listEvaluationCases(suite.id);
          return {
            ...suite,
            cases: casesPayload.cases,
          };
        }),
      );

      setWorkflows(workflowPayload.workflows);
      setSuites(suiteRows);
      setEvaluationRuns(evaluationRunPayload.evaluationRuns);

      if (!suiteForm.workflowId && workflowPayload.workflows[0]) {
        setSuiteForm((prev) => ({ ...prev, workflowId: workflowPayload.workflows[0].id }));
      }
      if (!caseForm.suiteId && suiteRows[0]) {
        setCaseForm((prev) => ({ ...prev, suiteId: suiteRows[0].id }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载评测数据失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [caseForm.suiteId, suiteForm.workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  const suitesById = useMemo(
    () => Object.fromEntries(suites.map((suite) => [suite.id, suite])),
    [suites],
  );

  const onCreateSuite = async () => {
    if (!suiteForm.name.trim()) {
      setError("评测套件名称不能为空");
      return;
    }
    setCreatingSuite(true);
    setError("");
    setMessage("");
    try {
      await runtimeClient.createEvaluationSuite({
        name: suiteForm.name.trim(),
        description: suiteForm.description.trim() || undefined,
        workflowId: suiteForm.workflowId || undefined,
      });
      setSuiteForm((prev) => ({ ...EMPTY_SUITE_FORM, workflowId: prev.workflowId }));
      setMessage("评测套件已创建");
      await load(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建评测套件失败");
    } finally {
      setCreatingSuite(false);
    }
  };

  const onCreateCase = async () => {
    if (!caseForm.suiteId) {
      setError("请先选择评测套件");
      return;
    }
    if (!caseForm.name.trim() || !caseForm.taskInput.trim()) {
      setError("评测用例名称和输入不能为空");
      return;
    }
    setCreatingCase(true);
    setError("");
    setMessage("");
    try {
      await runtimeClient.createEvaluationCase(caseForm.suiteId, {
        name: caseForm.name.trim(),
        taskInput: caseForm.taskInput.trim(),
        expectedOutputContains: caseForm.expectedOutputContains.trim() || undefined,
        expectedOutputRegex: caseForm.expectedOutputRegex.trim() || undefined,
      });
      setCaseForm((prev) => ({
        suiteId: prev.suiteId,
        name: "",
        taskInput: "",
        expectedOutputContains: "",
        expectedOutputRegex: "",
      }));
      setMessage("评测用例已创建");
      await load(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建评测用例失败");
    } finally {
      setCreatingCase(false);
    }
  };

  const onExecuteCase = async (evaluationCase: EvaluationCaseView) => {
    setExecutingCaseId(evaluationCase.id);
    setError("");
    setMessage("");
    try {
      const payload = await runtimeClient.executeEvaluationCase(evaluationCase.id);
      setSelectedReport(payload.report);
      setMessage(`评测执行完成，得分 ${payload.report.score}`);
      await load(true);
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : "执行评测用例失败");
    } finally {
      setExecutingCaseId(null);
    }
  };

  const onOpenEvaluationRun = async (evaluationRunId: string) => {
    setError("");
    try {
      const payload = await runtimeClient.getEvaluationRun(evaluationRunId);
      setSelectedReport(payload.evaluationRun.report ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载评测详情失败");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        <div className="inline-flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载评测模块...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 px-6 py-5 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.32),0_10px_18px_-16px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">Evaluations / 评测闭环</p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">回放、对比、评分与回归验证</h1>
            <p className="mt-1 text-sm text-slate-500">
              基于 run_snapshot、Prompt Trace、Tool Trace 和统一输出目录构建结构化评测闭环。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-emerald-600">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">创建评测套件</h2>
          <div className="mt-3 space-y-3">
            <input
              value={suiteForm.name}
              onChange={(event) => setSuiteForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如：Swarm Regression Suite"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <textarea
              value={suiteForm.description}
              onChange={(event) => setSuiteForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="说明这组评测关注的回归场景"
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <select
              value={suiteForm.workflowId}
              onChange={(event) => setSuiteForm((prev) => ({ ...prev, workflowId: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">选择工作流（可选）</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={creatingSuite}
              onClick={() => void onCreateSuite()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingSuite ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
              创建套件
            </button>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">创建评测用例</h2>
          <div className="mt-3 space-y-3">
            <select
              value={caseForm.suiteId}
              onChange={(event) => setCaseForm((prev) => ({ ...prev, suiteId: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              <option value="">选择所属套件</option>
              {suites.map((suite) => (
                <option key={suite.id} value={suite.id}>
                  {suite.name}
                </option>
              ))}
            </select>
            <input
              value={caseForm.name}
              onChange={(event) => setCaseForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如：角色协作稳定性回归"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <textarea
              value={caseForm.taskInput}
              onChange={(event) => setCaseForm((prev) => ({ ...prev, taskInput: event.target.value }))}
              placeholder="输入本次评测要执行的任务"
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <input
              value={caseForm.expectedOutputContains}
              onChange={(event) => setCaseForm((prev) => ({ ...prev, expectedOutputContains: event.target.value }))}
              placeholder="输出必须包含（可选）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <input
              value={caseForm.expectedOutputRegex}
              onChange={(event) => setCaseForm((prev) => ({ ...prev, expectedOutputRegex: event.target.value }))}
              placeholder="输出正则规则（可选）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <button
              type="button"
              disabled={creatingCase}
              onClick={() => void onCreateCase()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingCase ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              创建用例
            </button>
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">套件与用例</h2>
          <div className="mt-3 space-y-4">
            {suites.length === 0 ? (
              <EmptyState text="还没有评测套件，先创建一个用于回归验证的 suite。" />
            ) : (
              suites.map((suite) => (
                <div key={suite.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">{suite.name}</h3>
                      {suite.description ? <p className="mt-1 text-xs text-slate-500">{suite.description}</p> : null}
                      <p className="mt-1 text-xs text-slate-400">
                        绑定工作流：
                        {suite.workflowId ? workflows.find((item) => item.id === suite.workflowId)?.name ?? suite.workflowId : "未绑定"}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">
                      {suite.cases.length} 个用例
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {suite.cases.length === 0 ? (
                      <EmptyState text="当前套件还没有用例。" compact />
                    ) : (
                      suite.cases.map((evaluationCase) => (
                        <div key={evaluationCase.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-800">{evaluationCase.name}</p>
                              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{evaluationCase.taskInput}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void onExecuteCase(evaluationCase)}
                              disabled={executingCaseId === evaluationCase.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {executingCaseId === evaluationCase.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <PlayCircle className="h-3.5 w-3.5" />}
                              执行
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">最近评测运行</h2>
          <div className="mt-3 space-y-2">
            {evaluationRuns.length === 0 ? (
              <EmptyState text="还没有评测运行记录。" />
            ) : (
              evaluationRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void onOpenEvaluationRun(run.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:bg-slate-100"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {suitesById[run.suiteId]?.name ?? run.suiteId}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {suitesById[run.suiteId]?.cases.find((item) => item.id === run.caseId)?.name ?? run.caseId}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(run.createdAt).toLocaleString("zh-CN")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-800">{run.score ?? "--"}</p>
                    <VerdictBadge verdict={run.verdict} />
                  </div>
                </button>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">评测报告</h2>
        {!selectedReport ? (
          <div className="mt-3">
            <EmptyState text="选择一条评测运行，或者先执行一个用例，这里会显示基线、回放和对比报告。" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard title="评分" value={String(selectedReport.score)} />
              <MetricCard title="结论" value={selectedReport.verdict.toUpperCase()} />
              <MetricCard title="Baseline Run" value={selectedReport.baselineRunId} mono />
              <MetricCard title="Replay Run" value={selectedReport.replayRunId} mono />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <RunContextCard title="Baseline 上下文" runStatus={selectedReport.baseline.status} taskInput={selectedReport.baseline.taskInput} memoryIsolationMode={selectedReport.baseline.memoryIsolationMode} />
              <RunContextCard title="Replay 上下文" runStatus={selectedReport.replay.status} taskInput={selectedReport.replay.taskInput} memoryIsolationMode={selectedReport.replay.memoryIsolationMode} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800">系统对比</h3>
                <dl className="mt-3 space-y-2 text-sm text-slate-600">
                  <MetricRow label="状态变化" value={selectedReport.compare.statusChanged ? "有变化" : "一致"} />
                  <MetricRow label="耗时变化" value={`${selectedReport.compare.durationDeltaMs ?? 0} ms`} />
                  <MetricRow label="Token 变化" value={String(selectedReport.compare.tokenDelta ?? 0)} />
                  <MetricRow label="输出变化" value={selectedReport.compare.outputChanged ? "有变化" : "一致"} />
                  <MetricRow
                    label="工具失败变化"
                    value={`${selectedReport.compare.baselineFailedToolCalls} -> ${selectedReport.compare.candidateFailedToolCalls}（Δ ${selectedReport.compare.toolFailureDelta}）`}
                  />
                </dl>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Prompt 对比摘要</h3>
                <dl className="mt-3 space-y-2 text-sm text-slate-600">
                  <MetricRow
                    label="Prompt Trace 数量"
                    value={`${selectedReport.compare.promptDiffSummary.baselinePromptTraceCount} / ${selectedReport.compare.promptDiffSummary.candidatePromptTraceCount}`}
                  />
                  <MetricRow
                    label="变化节点数"
                    value={String(selectedReport.compare.promptDiffSummary.changedPromptCount)}
                  />
                </dl>
                <div className="mt-3 max-h-48 space-y-2 overflow-auto rounded-md border border-slate-200 bg-white p-3">
                  {selectedReport.compare.promptDiffSummary.changedNodes.length === 0 ? (
                    <p className="text-xs text-slate-500">没有可比较的 Prompt 节点。</p>
                  ) : (
                    selectedReport.compare.promptDiffSummary.changedNodes.map((item) => (
                      <div key={item.nodeId} className="flex items-start justify-between gap-3 text-xs">
                        <div>
                          <p className="font-medium text-slate-700">{item.nodeName}</p>
                          <p className="font-mono text-slate-400">
                            {item.baselinePromptHash ?? "--"} / {item.candidatePromptHash ?? "--"}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 ${item.changed ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {item.changed ? "变化" : "一致"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800">输出文件与目录约束</h3>
                <p className="mt-2 text-xs text-slate-500">
                  Replay 输出是否全部位于统一输出目录：
                  {selectedReport.artifacts.allReplayFilesUnderManagedRoot ? "是" : "否"}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ArtifactList title="Baseline 文件" items={selectedReport.artifacts.baselineFiles} />
                  <ArtifactList title="Replay 文件" items={selectedReport.artifacts.replayFiles} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Artifact Diff</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <ArtifactList title="缺失文件" items={selectedReport.artifacts.missingReplayFiles} compact />
                  <ArtifactList title="新增文件" items={selectedReport.artifacts.additionalReplayFiles} compact />
                  <ArtifactList title="内容变化" items={selectedReport.artifacts.changedSharedFiles} compact />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-800">检查项</h3>
              <div className="mt-3 space-y-2">
                {selectedReport.checks.map((check) => (
                  <div key={check.id} className="flex items-start justify-between gap-3 rounded-md bg-white px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{check.id}</p>
                      <p className="text-xs text-slate-500">{check.detail}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        check.passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {check.passed ? "通过" : "失败"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-800">节点级对比</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs text-slate-600">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="pb-2 pr-4">节点</th>
                      <th className="pb-2 pr-4">状态</th>
                      <th className="pb-2 pr-4">Token Δ</th>
                      <th className="pb-2 pr-4">输出变化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedReport.compare.nodeDiffs.map((node) => (
                      <tr key={node.nodeId} className="border-t border-slate-200">
                        <td className="py-2 pr-4 font-medium text-slate-700">{node.nodeName}</td>
                        <td className="py-2 pr-4">
                          {node.baselineStatus ?? "--"} / {node.candidateStatus ?? "--"}
                        </td>
                        <td className="py-2 pr-4">{node.tokenDelta ?? 0}</td>
                        <td className="py-2 pr-4">{node.outputChanged ? "有变化" : "一致"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function RunContextCard({
  title,
  runStatus,
  taskInput,
  memoryIsolationMode,
}: {
  title: string;
  runStatus: string;
  taskInput?: string;
  memoryIsolationMode?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <dl className="mt-3 space-y-2 text-sm text-slate-600">
        <MetricRow label="运行状态" value={runStatus} />
        <MetricRow label="Memory Isolation" value={memoryIsolationMode ?? "default"} />
      </dl>
      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-700">任务输入</p>
        <p className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{taskInput || "无"}</p>
      </div>
    </div>
  );
}

function MetricCard({ title, value, mono = false }: { title: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`mt-2 text-sm font-semibold text-slate-900 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict?: string }) {
  if (verdict === "pass") {
    return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">PASS</span>;
  }
  if (verdict === "warn") {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">WARN</span>;
  }
  if (verdict === "fail") {
    return <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">FAIL</span>;
  }
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">--</span>;
}

function ArtifactList({ title, items, compact = false }: { title: string; items: string[]; compact?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      <div className={`mt-2 space-y-1 ${compact ? "max-h-36 overflow-auto" : ""}`}>
        {items.length === 0 ? (
          <p className="text-xs text-slate-400">无文件</p>
        ) : (
          items.map((item) => (
            <p key={item} className="break-all font-mono text-[11px] text-slate-500">
              {item}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center ${compact ? "px-3 py-4" : "px-4 py-6"}`}>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}
