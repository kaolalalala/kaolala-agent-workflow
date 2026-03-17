"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronUp,
  Edit3,
  GitBranch,
  Globe,
  LayoutPanelLeft,
  Logs,
  Moon,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildWorkflowPayload, runtimeClient } from "@/features/workflow/adapters/runtime-client";
import { RUN_STATUS_LABELS } from "@/features/workflow/constants";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";

interface TopBarProps {
  projectName?: string;
  onStartRun: () => void;
  onResetLayout: () => void;
  onToggleNodeLibrary: () => void;
  onToggleInspector: () => void;
  onToggleBottomPanel: () => void;
  onOpenToolPlatform: () => void;
  onOpenWorkspaceConfig: () => void;
  onOpenWorkflowVersions: () => void;
  onOpenWorkflowTemplateSave: () => void;
  onSaveNodeTemplate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  bottomPanelCollapsed: boolean;
}

const secondaryButtonClass = "h-9 shrink-0 rounded-xl px-2.5 sm:px-3";

export function TopBar({
  projectName,
  onStartRun,
  onResetLayout,
  onToggleNodeLibrary,
  onToggleInspector,
  onToggleBottomPanel,
  onOpenToolPlatform,
  onOpenWorkspaceConfig,
  onOpenWorkflowVersions,
  onOpenWorkflowTemplateSave,
  onSaveNodeTemplate,
  onUndo,
  onRedo,
  onFitView,
  onZoomIn,
  onZoomOut,
  bottomPanelCollapsed,
}: TopBarProps) {
  const run = useWorkflowStore((state) => state.activeRun);
  const currentWorkflow = useWorkflowStore((state) => state.currentWorkflow);
  const rootTaskInput = useWorkflowStore((state) => state.rootTaskInput);
  const setRootTaskInput = useWorkflowStore((state) => state.setRootTaskInput);
  const themeMode = useWorkflowStore((state) => state.themeMode);
  const toggleThemeMode = useWorkflowStore((state) => state.toggleThemeMode);
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const tasks = useWorkflowStore((state) => state.tasks);
  const setCurrentWorkflow = useWorkflowStore((state) => state.setCurrentWorkflow);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);

  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showTask, setShowTask] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const runStatus = run?.status ?? "idle";

  useEffect(() => {
    if (currentWorkflow?.updatedAt) {
      setLastSavedAt(currentWorkflow.updatedAt);
    }
  }, [currentWorkflow?.updatedAt]);

  const saveStateText = saving
    ? "保存中"
    : currentWorkflow?.isDirty
      ? "未保存变更"
      : currentWorkflow?.workflowId
        ? "已保存"
        : "未保存";

  const saveStateClass = saving
    ? "bg-blue-100 text-blue-700"
    : currentWorkflow?.isDirty
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";

  const onSaveWorkflow = async () => {
    if (nodes.length === 0) {
      setSaveMessage("当前没有节点，无法保存工作流。");
      return;
    }

    setSaving(true);
    setSaveMessage("");
    try {
      const payload = buildWorkflowPayload({ nodes, edges, tasks });
      const saved = await runtimeClient.saveWorkflow({
        workflowId: currentWorkflow?.workflowId,
        projectId: currentWorkflow?.projectId,
        name: currentWorkflow?.name || `工作流${new Date().toLocaleDateString()}`,
        rootTaskInput: rootTaskInput.trim() || undefined,
        versionLabel: "Canvas Save",
        workflow: payload,
      });
      setCurrentWorkflow({
        workflowId: saved.workflow.id,
        projectId: saved.workflow.projectId,
        name: saved.workflow.name,
        updatedAt: saved.workflow.updatedAt,
        currentVersionId: saved.workflow.currentVersionId,
        currentVersionNumber: saved.workflow.currentVersionNumber,
        publishedVersionId: saved.workflow.publishedVersionId,
        publishedVersionNumber: saved.workflow.publishedVersionNumber,
        isDirty: false,
      });
      setLastSavedAt(saved.workflow.updatedAt);
      setSaveMessage(`已保存：${saved.workflow.name}`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
      window.setTimeout(() => setSaveMessage(""), 2600);
    }
  };

  const onStartRename = () => {
    setNameDraft(currentWorkflow?.name ?? "");
    setEditingName(true);
  };

  const onConfirmRename = async () => {
    if (!currentWorkflow?.workflowId) {
      setEditingName(false);
      return;
    }
    const nextName = nameDraft.trim();
    if (!nextName) {
      setSaveMessage("工作流名称不能为空。");
      return;
    }
    if (nextName.length > 64) {
      setSaveMessage("工作流名称不能超过 64 个字符。");
      return;
    }
    if (nextName === currentWorkflow.name) {
      setEditingName(false);
      return;
    }

    setRenaming(true);
    setSaveMessage("");
    try {
      const result = await runtimeClient.renameWorkflow(currentWorkflow.workflowId, {
        projectId: currentWorkflow.projectId,
        name: nextName,
      });
      setCurrentWorkflow({
        workflowId: result.workflow.id,
        projectId: result.workflow.projectId,
        name: result.workflow.name,
        updatedAt: result.workflow.updatedAt,
        currentVersionId: result.workflow.currentVersionId,
        currentVersionNumber: result.workflow.currentVersionNumber,
        publishedVersionId: result.workflow.publishedVersionId,
        publishedVersionNumber: result.workflow.publishedVersionNumber,
        isDirty: currentWorkflow.isDirty,
      });
      setLastSavedAt(result.workflow.updatedAt);
      setSaveMessage("工作流名称已更新。");
      setEditingName(false);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setRenaming(false);
      window.setTimeout(() => setSaveMessage(""), 2600);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-40 px-2 md:px-3">
      <div className="pointer-events-auto mx-auto w-full max-w-[1520px] rounded-2xl border border-white/55 bg-[var(--panel-strong)]/95 p-2.5 shadow-[0_24px_80px_-40px_var(--shadow-color)] backdrop-blur dark:border-white/10">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="flex w-max items-center gap-2 pr-2">
                <Button variant="secondary" className={secondaryButtonClass} onClick={onToggleNodeLibrary}>
                  <LayoutPanelLeft className="h-4 w-4" />
                  <span className="hidden md:inline">节点库</span>
                </Button>
                <Button variant="secondary" className={secondaryButtonClass} onClick={onToggleInspector}>
                  <BookOpen className="h-4 w-4" />
                  <span className="hidden md:inline">检查器</span>
                </Button>
                <Button variant="secondary" className={secondaryButtonClass} onClick={onToggleBottomPanel}>
                  <Logs className="h-4 w-4" />
                  <span className="hidden md:inline">{bottomPanelCollapsed ? "运行面板" : "收起面板"}</span>
                </Button>
                <Button variant="secondary" className={secondaryButtonClass} onClick={onOpenToolPlatform}>
                  <Bot className="h-4 w-4" />
                  <span className="hidden md:inline">工具导入</span>
                </Button>
                <Button variant="secondary" className={secondaryButtonClass} onClick={onOpenWorkspaceConfig}>
                  <Globe className="h-4 w-4" />
                  <span className="hidden md:inline">全局配置</span>
                </Button>
                <Button variant="secondary" className={secondaryButtonClass} onClick={onOpenWorkflowVersions}>
                  <GitBranch className="h-4 w-4" />
                  <span className="hidden md:inline">版本管理</span>
                </Button>
                <Button variant="secondary" className={secondaryButtonClass} onClick={onOpenWorkflowTemplateSave}>
                  <Save className="h-4 w-4" />
                  <span className="hidden md:inline">保存为模板</span>
                </Button>
                <Button
                  variant="secondary"
                  className={secondaryButtonClass}
                  onClick={onSaveNodeTemplate}
                  disabled={!selectedNodeId}
                  title={selectedNodeId ? "保存当前选中节点到模板库" : "请先选中一个节点"}
                >
                  <Save className="h-4 w-4" />
                  <span className="hidden md:inline">保存节点</span>
                </Button>
                <div className="hidden items-center gap-1 rounded-xl border border-black/10 bg-white/70 px-2 py-1 lg:flex dark:border-white/10 dark:bg-white/5">
                  <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2" onClick={onUndo}>
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2" onClick={onRedo}>
                    <Redo2 className="h-4 w-4" />
                  </Button>
                  <span className="mx-1 h-4 w-px bg-black/10 dark:bg-white/10" />
                  <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2" onClick={onZoomOut}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2" onClick={onZoomIn}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 rounded-lg px-2" onClick={onFitView}>
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="hidden rounded-full border border-black/10 bg-white/75 px-3 py-1 text-xs sm:block dark:border-white/10 dark:bg-white/5">
                {RUN_STATUS_LABELS[runStatus]}
              </div>
              <Button variant="secondary" className={secondaryButtonClass} onClick={onResetLayout}>
                <RotateCcw className="h-4 w-4" />
                <span className="hidden md:inline">重置布局</span>
              </Button>
              <Button variant="secondary" className={secondaryButtonClass} onClick={toggleThemeMode}>
                {themeMode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="secondary" className="h-9 shrink-0 rounded-xl px-3" disabled={saving} onClick={() => void onSaveWorkflow()}>
                <Save className="h-4 w-4" />
                {saving ? "保存中..." : "保存工作流"}
              </Button>
              <Button className="h-9 shrink-0 rounded-xl bg-[var(--accent)] px-4 text-white hover:bg-[var(--accent-strong)] dark:text-slate-950" onClick={onStartRun}>
                <Play className="h-4 w-4" />
                运行
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              项目：{projectName || "未命名项目"}
            </span>
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  className="h-8 w-[260px] rounded-lg border-black/10 bg-white/80"
                  placeholder="输入工作流名称"
                  disabled={renaming}
                />
                <Button size="sm" className="h-8 rounded-lg" disabled={renaming} onClick={() => void onConfirmRename()}>
                  {renaming ? "保存中..." : "确定"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 rounded-lg" disabled={renaming} onClick={() => setEditingName(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <div className="max-w-[min(70vw,480px)] truncate rounded-xl border border-black/10 bg-white/70 px-3 py-1 text-xs dark:border-white/10 dark:bg-white/5">
                工作流：{currentWorkflow?.name || "未命名工作流"}
              </div>
            )}
            {!editingName ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg px-2"
                onClick={onStartRename}
                disabled={!currentWorkflow?.workflowId}
                title={currentWorkflow?.workflowId ? "重命名工作流" : "请先保存后再重命名"}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
            ) : null}
            <span className={`rounded-full px-2.5 py-1 text-xs ${saveStateClass}`}>{saveStateText}</span>
            {currentWorkflow?.workflowId ? <span className="text-xs text-slate-500">ID：{currentWorkflow.workflowId}</span> : null}
            {lastSavedAt ? <span className="text-xs text-slate-500">更新时间：{new Date(lastSavedAt).toLocaleString()}</span> : null}
            <Button variant="ghost" size="sm" className="h-8 shrink-0 rounded-lg px-2" onClick={() => setShowTask((prev) => !prev)}>
              任务输入
              {showTask ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {saveMessage ? <p className="text-xs text-emerald-600 dark:text-emerald-300">{saveMessage}</p> : null}
          </div>

          {showTask ? (
            <Input
              value={rootTaskInput}
              onChange={(event) => setRootTaskInput(event.target.value)}
              placeholder="输入总任务（运行入口）"
              className="h-10 rounded-xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/5"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
