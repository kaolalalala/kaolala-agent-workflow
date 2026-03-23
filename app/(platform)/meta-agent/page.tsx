"use client";

import { useCallback, useState } from "react";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

/* ── Types (mirror server types) ───────────────────────────── */
interface WorkflowBlueprint {
  nodes: Array<{ id: string; name: string; role: string; taskSummary: string }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>;
  rootTask: string;
}

interface Iteration {
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
  startedAt: string;
  finishedAt?: string;
}

interface MetaAgentResult {
  status: "success" | "failed" | "max_iterations_reached";
  goal: string;
  finalOutput?: string;
  finalRunId?: string;
  finalScore?: number;
  iterations: Iteration[];
  totalDurationMs: number;
  totalTokensUsed: number;
  workflowEvolution: Array<{ iteration: number; adaptations: string[] }>;
}

/* ── Styles ────────────────────────────────────────────────── */
const sectionCard = "rounded-3xl border border-black/[0.06] bg-white/80 shadow-sm backdrop-blur dark:border-white/[0.06] dark:bg-white/[0.03]";

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

/* ── Page ──────────────────────────────────────────────────── */
export default function MetaAgentPage() {
  const [goal, setGoal] = useState("");
  const [maxIter, setMaxIter] = useState(3);
  const [threshold, setThreshold] = useState(0.7);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MetaAgentResult | null>(null);
  const [error, setError] = useState("");
  const [expandedIter, setExpandedIter] = useState<Set<number>>(new Set());

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
    setResult(null);
    setError("");
    setExpandedIter(new Set());

    try {
      const res = await fetch("/api/meta-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          maxIterations: maxIter,
          qualityThreshold: threshold,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: MetaAgentResult = await res.json();
      setResult(data);
      // Auto-expand all iterations
      setExpandedIter(new Set(data.iterations.map((it) => it.iteration)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meta-Agent 执行失败");
    } finally {
      setRunning(false);
    }
  }, [goal, maxIter, threshold, running]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Brain className="h-7 w-7 text-violet-500" />
          Meta-Agent
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          输入一个高层目标，Meta-Agent 会自动规划工作流、执行、评估并迭代优化，直到达到质量阈值。
        </p>
      </div>

      {/* ── Input ── */}
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
            placeholder="描述你的目标，例如：帮我写一篇关于 AI Agent 趋势的深度报告"
            className="min-h-[88px] rounded-2xl"
            disabled={running}
          />
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">最大迭代次数</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxIter}
                onChange={(e) => setMaxIter(Number(e.target.value) || 3)}
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
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </CardContent>
      </Card>

      {/* ── Running indicator ── */}
      {running && (
        <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/30">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <span className="text-sm text-violet-700 dark:text-violet-300">
            Meta-Agent 正在自主规划并执行工作流，这可能需要一些时间...
          </span>
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <>
          {/* Summary card */}
          <Card className={sectionCard}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {result.status === "success" ? (
                  <CircleCheck className="h-5 w-5 text-emerald-500" />
                ) : result.status === "max_iterations_reached" ? (
                  <RotateCcw className="h-5 w-5 text-amber-500" />
                ) : (
                  <CircleX className="h-5 w-5 text-rose-500" />
                )}
                {result.status === "success" ? "目标达成" : result.status === "max_iterations_reached" ? "达到最大迭代次数" : "执行失败"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">迭代次数</p>
                  <p className="mt-1 text-lg font-semibold">{result.iterations.length}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">最终评分</p>
                  <p className="mt-1 text-lg font-semibold">{result.finalScore?.toFixed(2) ?? "—"}</p>
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

              {/* Final output */}
              {result.finalOutput && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">最终输出</p>
                  <div className="max-h-[300px] overflow-y-auto rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <pre className="whitespace-pre-wrap font-sans">{result.finalOutput}</pre>
                  </div>
                </div>
              )}

              {/* Final run link */}
              {result.finalRunId && (
                <p className="mt-3 text-xs text-slate-500">
                  最终运行 ID:{" "}
                  <span className="font-mono text-slate-700 dark:text-slate-300">{result.finalRunId}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Iteration timeline */}
          <Card className={sectionCard}>
            <CardHeader>
              <CardTitle className="text-base">迭代过程</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.iterations.map((iter) => (
                <div key={iter.iteration} className="rounded-xl border border-black/[0.04] dark:border-white/[0.06]">
                  {/* Iteration header */}
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

                    {/* Score badge */}
                    {typeof iter.reflectionScore === "number" && (
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${verdictColors[iter.reflectionVerdict ?? ""] ?? "text-slate-500"}`}>
                        {iter.reflectionScore.toFixed(2)} ({iter.reflectionVerdict})
                      </span>
                    )}
                    {iter.error && (
                      <span className="ml-auto text-xs text-rose-500">错误</span>
                    )}
                  </button>

                  {/* Expanded content */}
                  {expandedIter.has(iter.iteration) && (
                    <div className="space-y-3 border-t border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
                      {/* Workflow snapshot */}
                      {iter.workflowSnapshot && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">工作流拓扑</p>
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

                      {/* Execution info */}
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

                      {/* Observation */}
                      {iter.observationSummary && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">观测结果</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">{iter.observationSummary}</p>
                        </div>
                      )}

                      {/* Reflection */}
                      {iter.reflectionFeedback && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">反思反馈</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">{iter.reflectionFeedback}</p>
                        </div>
                      )}

                      {/* Adaptations */}
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

                      {/* Error */}
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

          {/* Workflow evolution */}
          {result.workflowEvolution.length > 0 && (
            <Card className={sectionCard}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-amber-500" />
                  工作流进化历程
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
