"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  type NodeProps,
} from "reactflow";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS, STATUS_LABELS, STATUS_STYLES } from "@/features/workflow/constants";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";
import { AgentNode } from "@/features/workflow/types";
import { cn } from "@/lib/utils";

export interface AgentNodeData {
  node: AgentNode;
  isRelated: boolean;
  isSelected: boolean;
  connectionModeActive: boolean;
  canAcceptConnection: boolean;
  isConnectionSourceNode: boolean;
}

const MIN_WIDTH = 160;
const MIN_HEIGHT = 100;
const MAX_WIDTH = 560;
const MAX_HEIGHT = 520;

const ROLE_TONE: Record<AgentNode["role"], { accentBar: string; sourceHandle: string; targetHandle: string }> = {
  input: {
    accentBar: "bg-gradient-to-r from-amber-400/80 to-orange-400/80",
    sourceHandle: "!bg-amber-500",
    targetHandle: "!bg-slate-300",
  },
  output: {
    accentBar: "bg-gradient-to-r from-emerald-400/80 to-teal-400/80",
    sourceHandle: "!bg-slate-300",
    targetHandle: "!bg-emerald-500",
  },
  summarizer: {
    accentBar: "bg-gradient-to-r from-indigo-400/80 to-violet-400/80",
    sourceHandle: "!bg-indigo-500",
    targetHandle: "!bg-violet-500",
  },
  router: {
    accentBar: "bg-gradient-to-r from-cyan-400/80 to-sky-400/80",
    sourceHandle: "!bg-cyan-500",
    targetHandle: "!bg-sky-500",
  },
  planner: {
    accentBar: "bg-gradient-to-r from-blue-400/80 to-indigo-400/80",
    sourceHandle: "!bg-blue-500",
    targetHandle: "!bg-indigo-500",
  },
  worker: {
    accentBar: "bg-gradient-to-r from-sky-400/80 to-cyan-400/80",
    sourceHandle: "!bg-sky-500",
    targetHandle: "!bg-cyan-500",
  },
  research: {
    accentBar: "bg-gradient-to-r from-fuchsia-400/80 to-pink-400/80",
    sourceHandle: "!bg-fuchsia-500",
    targetHandle: "!bg-pink-500",
  },
  reviewer: {
    accentBar: "bg-gradient-to-r from-rose-400/80 to-orange-400/80",
    sourceHandle: "!bg-rose-500",
    targetHandle: "!bg-orange-500",
  },
  human: {
    accentBar: "bg-gradient-to-r from-slate-400/80 to-slate-500/80",
    sourceHandle: "!bg-slate-500",
    targetHandle: "!bg-slate-500",
  },
  tool: {
    accentBar: "bg-gradient-to-r from-teal-400/80 to-emerald-400/80",
    sourceHandle: "!bg-teal-500",
    targetHandle: "!bg-emerald-500",
  },
};

export function AgentNodeCard({ id, data, dragging, selected }: NodeProps<AgentNodeData>) {
  const setNodeSize = useWorkflowStore((state) => state.setNodeSize);
  const selectNode = useWorkflowStore((state) => state.selectNode);
  const updateNodeDetails = useWorkflowStore((state) => state.updateNodeDetails);
  const width = data.node.width ?? 200;
  const height = data.node.height ?? 140;
  const roleTone = ROLE_TONE[data.node.role] ?? ROLE_TONE.worker;
  const supportsInput = data.node.role !== "input";
  const supportsOutput = data.node.role !== "output";

  /* ── inline‑edit: name ── */
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(data.node.name);
  const nameRef = useRef<HTMLInputElement>(null);

  const commitName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== data.node.name) {
      updateNodeDetails(id, { name: trimmed });
    } else {
      setNameValue(data.node.name);
    }
  }, [nameValue, data.node.name, id, updateNodeDetails]);

  useEffect(() => { if (editingName) nameRef.current?.focus(); }, [editingName]);
  useEffect(() => { if (!editingName) setNameValue(data.node.name); }, [data.node.name, editingName]);

  /* ── inline‑edit: task ── */
  const [editingTask, setEditingTask] = useState(false);
  const [taskValue, setTaskValue] = useState(data.node.taskSummary ?? "");
  const taskRef = useRef<HTMLTextAreaElement>(null);

  const commitTask = useCallback(() => {
    setEditingTask(false);
    const trimmed = taskValue.trim();
    if (trimmed !== (data.node.taskSummary ?? "")) {
      updateNodeDetails(id, { taskSummary: trimmed });
    } else {
      setTaskValue(data.node.taskSummary ?? "");
    }
  }, [taskValue, data.node.taskSummary, id, updateNodeDetails]);

  useEffect(() => { if (editingTask) taskRef.current?.focus(); }, [editingTask]);
  useEffect(() => { if (!editingTask) setTaskValue(data.node.taskSummary ?? ""); }, [data.node.taskSummary, editingTask]);

  return (
    <Card
      style={{ width, height }}
      className={cn(
        "group relative flex h-full flex-col overflow-visible rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(245,247,250,0.9))] transition-[box-shadow,border-color,opacity] duration-200 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.76))]",
        data.isSelected && "border-emerald-400 ring-2 ring-emerald-300/70 shadow-[0_26px_60px_-30px_rgba(16,185,129,0.6)]",
        !data.isSelected && data.isRelated && "border-sky-300/70 shadow-[0_24px_56px_-40px_rgba(14,165,233,0.55)]",
        !data.isSelected && !data.isRelated && "opacity-55 saturate-75",
        dragging && "cursor-grabbing shadow-[0_28px_70px_-28px_rgba(15,23,42,0.38)]",
      )}
    >
      <div className={cn("pointer-events-none absolute inset-x-6 top-1.5 z-20 h-1 rounded-full", roleTone.accentBar)} />

      <NodeResizeControl
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        maxWidth={MAX_WIDTH}
        maxHeight={MAX_HEIGHT}
        position="bottom-right"
        variant={ResizeControlVariant.Handle}
        className={cn(
          "nodrag nopan !z-30 !h-6 !w-6 !rounded-[10px] !border !border-white/85 !bg-[var(--accent)] !shadow-[0_10px_22px_-10px_rgba(15,23,42,0.5)] dark:!border-slate-950/70",
          "transition-opacity duration-150",
          data.isSelected ? "!opacity-100" : "!opacity-75 hover:!opacity-100",
        )}
        style={{ right: 10, bottom: 10 }}
        onResizeStart={() => selectNode(id)}
        onResize={(_, params) => {
          setNodeSize(id, {
            width: Math.round(params.width),
            height: Math.round(params.height),
          });
        }}
        onResizeEnd={(_, params) => {
          setNodeSize(id, {
            width: Math.round(params.width),
            height: Math.round(params.height),
          });
        }}
      >
        <div className="pointer-events-none flex h-full w-full items-center justify-center">
          <div className="grid translate-x-[1px] translate-y-[1px] grid-cols-3 gap-[2px]">
            <span className="h-[2px] w-[2px] rounded-full bg-white/95" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/80" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/60" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/80" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/70" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/55" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/60" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/55" />
            <span className="h-[2px] w-[2px] rounded-full bg-white/45" />
          </div>
        </div>
      </NodeResizeControl>

      {supportsInput ? (
        <>
          <Handle
            id="in"
            type="target"
            position={Position.Left}
            isConnectableEnd
            className={cn(
              "!z-40 !h-4 !w-4 !border-2 !border-white !pointer-events-auto",
              roleTone.targetHandle,
              data.connectionModeActive
                ? data.canAcceptConnection
                  ? "shadow-[0_0_0_4px_rgba(16,185,129,0.26)]"
                  : "opacity-60 shadow-[0_0_0_2px_rgba(148,163,184,0.28)]"
                : "shadow-[0_0_0_2px_rgba(14,165,233,0.18)]",
            )}
          />
          <span className="pointer-events-none absolute -left-9 top-1/2 z-30 -translate-y-1/2 rounded-full border border-emerald-200/70 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-300/30 dark:bg-slate-900/90 dark:text-emerald-300">
            输入
          </span>
        </>
      ) : null}

      <CardHeader className="shrink-0 space-y-0 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              {ROLE_LABELS[data.node.role]}
            </p>
            {editingName ? (
              <input
                ref={nameRef}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") { setEditingName(false); setNameValue(data.node.name); }
                }}
                className="nodrag nopan mt-0.5 w-full rounded border border-emerald-300 bg-white px-1 py-0 text-sm leading-tight outline-none dark:border-emerald-600 dark:bg-slate-800"
              />
            ) : (
              <CardTitle
                className="mt-0.5 line-clamp-1 cursor-text text-sm leading-tight hover:text-emerald-600 dark:hover:text-emerald-400"
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
              >
                {data.node.name}
              </CardTitle>
            )}
          </div>
          <Badge className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px]", STATUS_STYLES[data.node.status])}>
            {STATUS_LABELS[data.node.status]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
        {typeof data.node.executionOrder === "number" && (
          <p className="text-[10px] text-slate-400">#{data.node.executionOrder}</p>
        )}

        {data.node.blockedReason && data.node.status === "waiting" && (
          <p className="rounded-xl bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
            阻塞: {data.node.blockedReason}
          </p>
        )}

        {data.node.lastError && data.node.status === "failed" && (
          <p className="rounded-xl bg-rose-50 px-2 py-1 text-[10px] text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">
            错误: {data.node.lastError}
          </p>
        )}

        {editingTask ? (
          <textarea
            ref={taskRef}
            value={taskValue}
            onChange={(e) => setTaskValue(e.target.value)}
            onBlur={commitTask}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditingTask(false); setTaskValue(data.node.taskSummary ?? ""); }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitTask();
            }}
            className="nodrag nopan w-full resize-none rounded-xl border border-emerald-300 bg-white px-2 py-1.5 text-[11px] leading-4 outline-none dark:border-emerald-600 dark:bg-slate-800 dark:text-slate-200"
            rows={3}
            placeholder="输入任务描述…"
          />
        ) : (
          <div
            className="cursor-text rounded-xl border border-black/5 bg-white/70 px-2 py-1.5 transition-colors hover:border-emerald-300/60 dark:border-white/8 dark:bg-white/[0.04] dark:hover:border-emerald-500/40"
            onClick={(e) => { e.stopPropagation(); setEditingTask(true); }}
          >
            <p className="line-clamp-3 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
              {data.node.taskSummary || <span className="italic text-slate-400">点击编辑任务…</span>}
            </p>
          </div>
        )}

        {data.node.status === "running" && data.node.streamingOutput && (
          <div className="max-h-20 overflow-y-auto rounded-xl bg-emerald-50/80 px-2 py-1.5 text-[10px] leading-4 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
            {data.node.streamingOutput}
          </div>
        )}
      </CardContent>

      {supportsOutput ? (
        <>
          <Handle
            id="out"
            type="source"
            position={Position.Right}
            isConnectableStart
            className={cn(
              "!z-40 !h-4 !w-4 !border-2 !border-white !pointer-events-auto",
              roleTone.sourceHandle,
              data.isConnectionSourceNode
                ? "shadow-[0_0_0_4px_rgba(99,102,241,0.28)]"
                : "shadow-[0_0_0_2px_rgba(14,165,233,0.18)]",
            )}
          />
          <span className="pointer-events-none absolute -right-9 top-1/2 z-30 -translate-y-1/2 rounded-full border border-sky-200/70 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-300/30 dark:bg-slate-900/90 dark:text-sky-300">
            输出
          </span>
        </>
      ) : null}

    </Card>
  );
}
