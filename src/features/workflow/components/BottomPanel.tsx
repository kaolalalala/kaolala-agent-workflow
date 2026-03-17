"use client";

import { useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EVENT_TYPE_LABELS } from "@/features/workflow/constants";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";
import { formatZhDateTime, formatZhTime } from "@/lib/utils";

export function BottomPanel() {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const collapsed = useWorkflowStore((state) => state.bottomPanelCollapsed);
  const tab = useWorkflowStore((state) => state.bottomTab);
  const setTab = useWorkflowStore((state) => state.setBottomTab);
  const toggle = useWorkflowStore((state) => state.toggleBottomPanel);
  const events = useWorkflowStore((state) => state.events);
  const output = useWorkflowStore((state) => state.finalOutput);
  const diagnostics = useWorkflowStore((state) => state.runDiagnostics);

  return (
    <section
      className={`flex h-full flex-col rounded-[28px] border border-white/60 bg-[var(--panel)] shadow-[0_28px_80px_-36px_var(--shadow-color)] backdrop-blur dark:border-white/10 ${
        collapsed ? "min-h-0" : "min-h-[220px]"
      }`}
    >
      <div className="flex h-12 items-center justify-between border-b border-black/5 px-4 dark:border-white/10">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">运行观测</p>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">事件流 / 输出 / 运行观测</p>
        </div>
        <Button variant="ghost" size="sm" onClick={toggle}>
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && mounted && (
        <Tabs value={tab} onValueChange={(value) => setTab(value as never)} className="flex min-h-0 flex-1 flex-col p-3">
          <TabsList className="rounded-full bg-white/70 p-1 dark:bg-white/5">
            <TabsTrigger value="events">事件</TabsTrigger>
            <TabsTrigger value="output">输出</TabsTrigger>
            <TabsTrigger value="diagnostics">观测</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full pr-2">
              <div className="space-y-2">
                {events.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">暂时还没有事件。</p>}
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-[18px] border border-black/6 bg-white/72 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
                  >
                    <p className="font-medium">
                      [{formatZhTime(event.time)}] {EVENT_TYPE_LABELS[event.type]}
                      {typeof event.runEventSeq === "number" ? ` · #${event.runEventSeq}` : ""}
                    </p>
                    <p>{event.message}</p>
                    {event.relatedNodeId ? <p className="text-slate-500 dark:text-slate-400">关联节点：{event.relatedNodeId}</p> : null}
                    {typeof event.payload?.executionOrder === "number" ? (
                      <p className="text-slate-500 dark:text-slate-400">执行顺序：{Number(event.payload.executionOrder)}</p>
                    ) : null}
                    {typeof event.payload?.blockedReason === "string" ? (
                      <p className="text-amber-700 dark:text-amber-300">阻塞原因：{String(event.payload.blockedReason)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="output" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full pr-2">
              <div className="rounded-[20px] border border-black/6 bg-white/72 p-4 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">
                {output || "运行完成后会在这里显示最终输出。"}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="diagnostics" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full pr-2">
              {!diagnostics ? (
                <div className="rounded-[20px] border border-dashed border-black/10 bg-white/60 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                  运行开始后会自动加载观测指标，包括耗时、LLM 请求、工具调用和慢节点分析。
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-2 md:grid-cols-4">
                    <div className="rounded-[18px] border border-black/6 bg-white/72 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                      <p className="text-slate-500 dark:text-slate-400">总耗时</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {diagnostics.summary.observability.durationMs ? `${Math.round(diagnostics.summary.observability.durationMs)}ms` : "--"}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-black/6 bg-white/72 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                      <p className="text-slate-500 dark:text-slate-400">LLM 请求</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {diagnostics.summary.observability.llmRequestCount}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-black/6 bg-white/72 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                      <p className="text-slate-500 dark:text-slate-400">工具调用</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {diagnostics.summary.observability.toolInvocationCount}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-black/6 bg-white/72 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                      <p className="text-slate-500 dark:text-slate-400">根因判断</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {diagnostics.summary.rootCause}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-black/6 bg-white/72 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                    <p className="font-medium text-slate-900 dark:text-slate-100">关键时间点</p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      启动：{diagnostics.summary.timeline.runStartedAt ? formatZhDateTime(diagnostics.summary.timeline.runStartedAt) : "--"}
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      完成：{diagnostics.summary.timeline.runCompletedAt ? formatZhDateTime(diagnostics.summary.timeline.runCompletedAt) : "--"}
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">
                      失败：{diagnostics.summary.timeline.runFailedAt ? formatZhDateTime(diagnostics.summary.timeline.runFailedAt) : "--"}
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">绑定版本：{diagnostics.workflow.workflowVersionId ?? "未绑定"}</p>
                  </div>

                  <div className="rounded-[20px] border border-black/6 bg-white/72 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]">
                    <p className="font-medium text-slate-900 dark:text-slate-100">慢节点</p>
                    {diagnostics.summary.observability.slowestNodes.length === 0 ? (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">暂时没有可分析的节点耗时。</p>
                    ) : null}
                    {diagnostics.summary.observability.slowestNodes.map((node) => (
                      <div key={node.nodeId} className="mt-2 rounded-[16px] border border-black/6 bg-white/70 p-2 dark:border-white/10 dark:bg-white/[0.03]">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {node.name} · {node.role}
                        </p>
                        <p className="text-slate-600 dark:text-slate-300">耗时 {node.durationMs ? `${Math.round(node.durationMs)}ms` : "--"} · 状态 {node.status}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      )}

      {!collapsed && !mounted ? <div className="flex-1 p-3" /> : null}
    </section>
  );
}
