"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS } from "@/features/workflow/constants";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";

interface TaskTreeProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function TaskTree({ collapsed, onToggle }: TaskTreeProps) {
  const tasks = useWorkflowStore((state) => state.tasks);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const requestFocusNode = useWorkflowStore((state) => state.requestFocusNode);

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border-white/50 bg-white/70 shadow-none dark:border-white/8 dark:bg-white/[0.03]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Task Tree</p>
            <CardTitle>任务树</CardTitle>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0" onClick={onToggle}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {tasks.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">运行开始并拆解任务后，这里会展示任务树。</p>}
          {tasks.map((task) => {
            const active = task.assignedNodeId && task.assignedNodeId === selectedNodeId;
            const indent = task.parentTaskId ? "ml-4" : "ml-0";

            return (
              <button
                type="button"
                key={task.id}
                className={`w-full rounded-[18px] border p-2 text-left text-sm transition ${indent} ${
                  active
                    ? "border-emerald-300 bg-emerald-50/90 shadow-[0_18px_40px_-32px_rgba(16,185,129,0.7)] dark:border-emerald-400/40 dark:bg-emerald-400/10"
                    : "border-black/8 bg-white/76 hover:-translate-y-0.5 hover:bg-white dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                }`}
                onClick={() => {
                  if (task.assignedNodeId) {
                    requestFocusNode(task.assignedNodeId);
                  }
                }}
              >
                <p className="font-medium text-slate-900 dark:text-slate-100">{task.title}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {STATUS_LABELS[task.status]}
                </p>
              </button>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
