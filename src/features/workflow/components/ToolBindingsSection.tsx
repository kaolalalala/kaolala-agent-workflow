"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { runtimeClient, type ResolvedToolView, type ToolDefinitionView } from "@/features/workflow/adapters/runtime-client";

interface ToolBindingsSectionProps {
  role: string;
  runId?: string;
  nodeId: string;
}

function nodeScopeId(runId: string, nodeId: string) {
  return `${runId}:${nodeId}`;
}

const shellCardClass =
  "rounded-[24px] border border-black/6 bg-white/72 shadow-none dark:border-white/10 dark:bg-white/[0.04]";
const subPanelClass =
  "rounded-[20px] border border-black/6 bg-white/78 p-3 dark:border-white/10 dark:bg-white/[0.035]";

export function ToolBindingsSection({ role, runId, nodeId }: ToolBindingsSectionProps) {
  const [tools, setTools] = useState<ToolDefinitionView[]>([]);
  const [roleEnabled, setRoleEnabled] = useState<Set<string>>(new Set());
  const [nodeModes, setNodeModes] = useState<Map<string, "inherit" | "enable" | "disable">>(new Map());
  const [resolvedTools, setResolvedTools] = useState<ResolvedToolView[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [savingNode, setSavingNode] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const hasRun = Boolean(runId);

  const sortedResolved = useMemo(
    () => resolvedTools.slice().sort((a, b) => Number(b.effectiveEnabled) - Number(a.effectiveEnabled)),
    [resolvedTools],
  );

  const load = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const [toolPayload, roleBindingPayload] = await Promise.all([
        runtimeClient.listToolAssets(),
        runtimeClient.listToolBindings("agent_role", role),
      ]);
      setTools(toolPayload.tools);

      const roleSet = new Set(roleBindingPayload.bindings.filter((item) => item.enabled).map((item) => item.toolId));
      setRoleEnabled(roleSet);

      if (runId) {
        const [nodeBindingPayload, resolvedPayload] = await Promise.all([
          runtimeClient.listToolBindings("node_instance", nodeScopeId(runId, nodeId)),
          runtimeClient.getResolvedNodeTools(runId, nodeId),
        ]);
        const modeMap = new Map<string, "inherit" | "enable" | "disable">();
        for (const binding of nodeBindingPayload.bindings) {
          modeMap.set(binding.toolId, binding.enabled ? "enable" : "disable");
        }
        setNodeModes(modeMap);
        setResolvedTools(resolvedPayload.all);
      } else {
        setNodeModes(new Map());
        setResolvedTools([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载工具失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, runId, nodeId]);

  const toggleRoleTool = (toolId: string) => {
    setRoleEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const setNodeToolMode = (toolId: string, mode: "inherit" | "enable" | "disable") => {
    setNodeModes((prev) => {
      const next = new Map(prev);
      if (mode === "inherit") {
        next.delete(toolId);
      } else {
        next.set(toolId, mode);
      }
      return next;
    });
  };

  const onSaveRoleBindings = async () => {
    setSavingRole(true);
    setError("");
    setSuccess("");
    try {
      await runtimeClient.replaceToolBindings(
        "agent_role",
        role,
        Array.from(roleEnabled).map((toolId) => ({ toolId, enabled: true, priority: 100 })),
      );
      setSuccess("角色默认工具已更新");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存角色工具失败");
    } finally {
      setSavingRole(false);
    }
  };

  const onSaveNodeBindings = async () => {
    if (!runId) {
      return;
    }

    setSavingNode(true);
    setError("");
    setSuccess("");
    try {
      await runtimeClient.replaceToolBindings(
        "node_instance",
        nodeScopeId(runId, nodeId),
        Array.from(nodeModes.entries()).map(([toolId, mode]) => ({
          toolId,
          enabled: mode === "enable",
          priority: 200,
        })),
      );
      setSuccess("节点工具覆盖已更新");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存节点工具覆盖失败");
    } finally {
      setSavingNode(false);
    }
  };

  return (
    <Card className={shellCardClass}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">工具权限</p>
            <CardTitle>工具绑定</CardTitle>
          </div>
          <div className="rounded-full border border-black/6 bg-white/80 px-3 py-1 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
            {tools.length} 个工具
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-xs text-slate-500 dark:text-slate-400">加载工具中...</p>}
        {!loading && tools.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">平台中暂无工具。</p>}

        {!loading && tools.length > 0 && (
          <>
            <div className={subPanelClass}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">角色默认值</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">角色默认工具：{role}</p>
                </div>
                <Button size="sm" onClick={() => void onSaveRoleBindings()} disabled={savingRole} className="rounded-xl">
                  {savingRole ? "保存中..." : "保存默认值"}
                </Button>
              </div>

              <div className="space-y-2">
                {tools.map((tool) => (
                  <label
                    key={`role-${tool.toolId}`}
                    className="flex items-center gap-3 rounded-2xl border border-black/6 bg-white/72 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200"
                  >
                    <input type="checkbox" checked={roleEnabled.has(tool.toolId)} onChange={() => toggleRoleTool(tool.toolId)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900 dark:text-slate-100">{tool.name}</span>
                      <span className="block text-slate-500 dark:text-slate-400">{tool.toolId}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className={subPanelClass}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">节点覆盖</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{hasRun ? `节点覆盖：${nodeId}` : "节点覆盖需要运行实例"}</p>
                </div>
                {hasRun && (
                  <Button size="sm" onClick={() => void onSaveNodeBindings()} disabled={savingNode} className="rounded-xl">
                    {savingNode ? "保存中..." : "保存覆盖"}
                  </Button>
                )}
              </div>

              {hasRun ? (
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <label
                      key={`node-${tool.toolId}`}
                      className="flex items-center gap-3 rounded-2xl border border-black/6 bg-white/72 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-900 dark:text-slate-100">{tool.name}</span>
                        <span className="block text-slate-500 dark:text-slate-400">{tool.toolId}</span>
                      </span>
                      <select
                        value={nodeModes.get(tool.toolId) ?? "inherit"}
                        onChange={(event) => setNodeToolMode(tool.toolId, event.target.value as "inherit" | "enable" | "disable")}
                        className="h-8 rounded-xl border border-black/8 bg-white px-2 text-xs dark:border-white/10 dark:bg-slate-950"
                      >
                        <option value="inherit">继承</option>
                        <option value="enable">强制启用</option>
                        <option value="disable">强制禁用</option>
                      </select>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
                  请先启动一次运行，再编辑节点级工具绑定。
                </p>
              )}
            </div>

            {hasRun && (
              <div className={subPanelClass}>
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">运行时视图</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">运行时解析结果</p>
                </div>
                {sortedResolved.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">当前没有解析出的工具。</p>}
                <div className="space-y-2">
                  {sortedResolved.map((tool) => (
                    <div
                      key={`resolved-${tool.toolId}`}
                      className="rounded-2xl border border-black/6 bg-white/72 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {tool.name} - {tool.effectiveEnabled ? "已启用" : "已禁用"}
                      </p>
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        来源：{tool.resolvedFrom} · 优先级：{tool.effectivePriority}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>}
        {success && <p className="text-xs text-emerald-600 dark:text-emerald-300">{success}</p>}
      </CardContent>
    </Card>
  );
}
