"use client";

import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from "react";
import { ChevronDown, ChevronRight, PlusCircle, Search, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { runtimeClient, type AgentTemplateView } from "@/features/workflow/adapters/runtime-client";
import { ROLE_LABELS } from "@/features/workflow/constants";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";
import { NodeTemplate } from "@/features/workflow/types";

interface NodeLibraryProps {
  collapsed: boolean;
  onToggle: () => void;
}

const BUILTIN_COMMON_ROLES = new Set(["input", "planner", "worker", "summarizer", "output"]);

function byCategory(templates: NodeTemplate[]) {
  const grouped = new Map<string, NodeTemplate[]>();
  for (const item of templates) {
    const key = item.role;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function toAgentNodeTemplate(template: AgentTemplateView): NodeTemplate {
  return {
    id: `tpl_agent_${template.id}`,
    name: template.name,
    role: template.role,
    responsibilitySummary:
      template.responsibilitySummary || template.defaultPrompt || template.description || "来自 Agent 模板",
    taskSummary: template.taskSummary || "待分配任务",
    defaultPrompt: template.defaultPrompt,
    builtIn: false,
    disabled: !template.enabled,
    source: "agent_template",
  };
}

export function NodeLibrary({ collapsed, onToggle }: NodeLibraryProps) {
  const nodeTemplates = useWorkflowStore((state) => state.nodeTemplates);
  const agentNodeTemplates = useWorkflowStore((state) => state.agentNodeTemplates);
  const setAgentNodeTemplates = useWorkflowStore((state) => state.setAgentNodeTemplates);
  const addNodeFromTemplate = useWorkflowStore((state) => state.addNodeFromTemplate);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<Record<string, true>>({});

  useEffect(() => {
    let active = true;
    runtimeClient
      .listAgentTemplates()
      .then((payload) => {
        if (!active) return;
        setAgentNodeTemplates(payload.agentTemplates.map(toAgentNodeTemplate));
      })
      .catch(() => {
        if (!active) return;
        setAgentNodeTemplates([]);
      });

    return () => {
      active = false;
    };
  }, [setAgentNodeTemplates]);

  const templates = useMemo(
    () => [...nodeTemplates, ...agentNodeTemplates],
    [agentNodeTemplates, nodeTemplates],
  );

  const filteredTemplates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return templates;
    }
    return templates.filter((item) =>
      [item.name, item.role, item.taskSummary, item.responsibilitySummary, item.defaultPrompt ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, templates]);

  const favoriteTemplates = useMemo(
    () => filteredTemplates.filter((item) => favorites[item.id]),
    [favorites, filteredTemplates],
  );
  const commonTemplates = useMemo(
    () => filteredTemplates.filter((item) => item.builtIn && BUILTIN_COMMON_ROLES.has(item.role)),
    [filteredTemplates],
  );
  const agentTemplates = useMemo(
    () => filteredTemplates.filter((item) => item.source === "agent_template"),
    [filteredTemplates],
  );
  const categories = useMemo(() => byCategory(filteredTemplates), [filteredTemplates]);

  const onDragTemplate = (event: ReactDragEvent, template: NodeTemplate) => {
    if (template.disabled) {
      return;
    }
    event.dataTransfer.setData("application/agent-template-id", template.id);
    event.dataTransfer.setData("application/agent-role", template.role);
  };

  const renderTemplate = (template: NodeTemplate) => (
    <div
      key={template.id}
      draggable={!template.disabled}
      onDragStart={(event) => onDragTemplate(event, template)}
      className="rounded-[18px] border border-black/8 bg-white/90 px-3 py-2 text-sm shadow-[0_16px_36px_-26px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-emerald-300/70 dark:border-white/8 dark:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{template.name}</p>
          <p className="truncate text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            {ROLE_LABELS[template.role]}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {template.source === "agent_template" ? (
            <Badge variant="info">Agent 模板</Badge>
          ) : template.builtIn ? (
            <Badge variant="info">内置</Badge>
          ) : (
            <Badge variant="neutral">节点模板</Badge>
          )}
          <button
            type="button"
            className={`rounded-full p-1 ${
              favorites[template.id] ? "text-amber-500" : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"
            }`}
            onClick={() =>
              setFavorites((prev) => {
                const next = { ...prev };
                if (next[template.id]) {
                  delete next[template.id];
                } else {
                  next[template.id] = true;
                }
                return next;
              })
            }
            aria-label="收藏节点模板"
          >
            <Star className={`h-3.5 w-3.5 ${favorites[template.id] ? "fill-current" : ""}`} />
          </button>
          <Button
            size="sm"
            variant="secondary"
            disabled={template.disabled}
            onClick={() => addNodeFromTemplate(template.id)}
            className="h-8 min-w-8 rounded-full border border-black/8 bg-white/80 px-2 dark:border-white/10 dark:bg-white/5"
          >
            <PlusCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{template.responsibilitySummary}</p>
      {template.source === "agent_template" && template.defaultPrompt ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
          默认提示词：{template.defaultPrompt}
        </p>
      ) : null}
    </div>
  );

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border-white/50 bg-white/70 shadow-none dark:border-white/8 dark:bg-white/[0.03]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Blocks</p>
            <CardTitle>节点库</CardTitle>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0" onClick={onToggle}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索节点 / 职责 / 类型"
              className="h-10 rounded-xl border-black/10 bg-white/80 pl-9 dark:border-white/10 dark:bg-white/5"
            />
          </div>

          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">常用节点</p>
            <div className="space-y-2">
              {commonTemplates.length > 0 ? commonTemplates.map(renderTemplate) : <EmptyHint text="暂无常用节点命中" />}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">收藏节点</p>
            <div className="space-y-2">
              {favoriteTemplates.length > 0 ? favoriteTemplates.map(renderTemplate) : <EmptyHint text="还没有收藏节点" />}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Agent 模板</p>
            <div className="space-y-2">
              {agentTemplates.length > 0 ? agentTemplates.map(renderTemplate) : <EmptyHint text="暂无可用 Agent 模板" />}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">节点分类</p>
            <div className="space-y-3">
              {categories.length > 0 ? (
                categories.map(([role, items]) => (
                  <div key={role} className="space-y-2">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}
                    </p>
                    <div className="space-y-2">{items.map(renderTemplate)}</div>
                  </div>
                ))
              ) : (
                <EmptyHint text="未找到匹配节点" />
              )}
            </div>
          </section>
        </CardContent>
      )}
    </Card>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-black/10 bg-white/60 px-3 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
      {text}
    </p>
  );
}
