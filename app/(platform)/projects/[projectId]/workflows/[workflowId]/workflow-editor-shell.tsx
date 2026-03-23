"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, PanelTopClose } from "lucide-react";

import { AppShell } from "@/features/workflow/components/AppShell";

interface WorkflowEditorShellProps {
  projectId: string;
  workflowId: string;
  projectName: string;
  workflowName: string;
  workflowUpdatedAt?: string;
}

const META_COLLAPSE_KEY = "v0_2_workflow_editor_meta_collapsed";

function formatUpdatedAt(value?: string) {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function WorkflowEditorShell({
  projectId,
  workflowId,
  projectName,
  workflowName,
  workflowUpdatedAt,
}: WorkflowEditorShellProps) {
  const [metaCollapsed, setMetaCollapsed] = useState(false);

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(META_COLLAPSE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMetaCollapsed(cached === "1");
    } catch {
      // ignore storage failures
    }
  }, []);

  const toggleMeta = () => {
    setMetaCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(META_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-5rem)] flex-col gap-2 p-2">
      {!metaCollapsed ? (
        <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.22)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <Link
                href={`/projects/${projectId}`}
                className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                返回项目
              </Link>
              <h1 className="text-base font-semibold text-slate-900">{workflowName}</h1>
              <p className="text-xs text-slate-500">{projectName}</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-right text-[11px] text-slate-400">
                <p>项目 ID：{projectId}</p>
                <p>工作流 ID：{workflowId}</p>
                <p>更新时间：{formatUpdatedAt(workflowUpdatedAt)}</p>
              </div>
              <button
                type="button"
                onClick={toggleMeta}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 transition hover:bg-slate-50"
                aria-label="折叠页面信息"
              >
                <PanelTopClose className="h-3.5 w-3.5" />
                折叠
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_44px_-30px_rgba(15,23,42,0.28)] ${
          metaCollapsed ? "p-1.5" : "p-2"
        }`}
      >
        {metaCollapsed ? (
          <div className="mb-1.5 shrink-0 flex items-center justify-between rounded-xl border border-slate-200/85 bg-white/90 px-2 py-1.5 shadow-[0_8px_20px_-14px_rgba(15,23,42,0.38)] backdrop-blur">
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回项目
            </Link>
            <button
              type="button"
              onClick={toggleMeta}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
              aria-label="展开页面信息"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              展开信息
            </button>
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1">
          <AppShell projectId={projectId} workflowId={workflowId} />
        </div>
      </section>
    </div>
  );
}
