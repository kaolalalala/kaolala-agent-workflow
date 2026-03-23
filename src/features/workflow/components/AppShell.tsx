"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildWorkflowPayload,
  runtimeClient,
  type WorkflowSummaryView,
  type WorkflowTemplateView,
  type WorkflowVersionSummaryView,
} from "@/features/workflow/adapters/runtime-client";
import type { AgentNode } from "@/features/workflow/types";
import { BottomPanel } from "@/features/workflow/components/BottomPanel";
import { LeftSidebar } from "@/features/workflow/components/LeftSidebar";
import { RightInspector } from "@/features/workflow/components/RightInspector";
import { ToolPlatformPanel } from "@/features/workflow/components/ToolPlatformPanel";
import { TopBar } from "@/features/workflow/components/TopBar";
import { WorkflowCanvas } from "@/features/workflow/components/WorkflowCanvas";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";

const WORKFLOW_DRAFT_KEY = "workflow-canvas-draft-v1";
const THEME_MODE_KEY = "ui-theme-mode";
const DEFAULT_BOTTOM_HEIGHT = 280;
const MIN_BOTTOM_HEIGHT = 180;
const MAX_BOTTOM_HEIGHT = 520;

interface CanvasDraftSnapshot {
  nodes: ReturnType<typeof useWorkflowStore.getState>["nodes"];
  edges: ReturnType<typeof useWorkflowStore.getState>["edges"];
  tasks: ReturnType<typeof useWorkflowStore.getState>["tasks"];
  rootTaskInput: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toCanvasNode(
  node: {
    id: string;
    name: string;
    role: AgentNode["role"];
    taskSummary?: string;
    responsibilitySummary?: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
  },
  index: number,
): AgentNode {
  const now = new Date().toISOString();
  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: "idle",
    taskSummary: node.taskSummary ?? "",
    responsibilitySummary: node.responsibilitySummary ?? "",
    position: node.position ?? { x: 120 + index * 60, y: 140 + index * 40 },
    width: node.width,
    height: node.height,
    upstreamIds: [],
    downstreamIds: [],
    createdAt: now,
    lastUpdatedAt: now,
    blocked: false,
    retryCount: 0,
    inboundMessages: [],
    outboundMessages: [],
    resolvedInput: "",
    taskBrief: "",
  };
}

interface AppShellProps {
  projectId?: string;
  workflowId?: string;
}

export function AppShell({ projectId, workflowId }: AppShellProps) {
  const streamRef = useRef<null | { close: () => void }>(null);
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerunBoostUntilRef = useRef<number>(0);
  const draftHydratedRef = useRef(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyRef = useRef<CanvasDraftSnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const applyingHistoryRef = useRef(false);

  const [showNodeLibrary, setShowNodeLibrary] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showToolPlatform, setShowToolPlatform] = useState(false);
  const [showWorkspaceConfig, setShowWorkspaceConfig] = useState(false);
  const [showWorkflowVersions, setShowWorkflowVersions] = useState(false);
  const [showWorkflowTemplateSave, setShowWorkflowTemplateSave] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [notice, setNotice] = useState("");
  const [projectName, setProjectName] = useState("");

  const [fitViewNonce, setFitViewNonce] = useState(0);
  const [zoomInNonce, setZoomInNonce] = useState(0);
  const [zoomOutNonce, setZoomOutNonce] = useState(0);
  const [initializingWorkflow, setInitializingWorkflow] = useState(Boolean(workflowId));

  const rootTaskInput = useWorkflowStore((state) => state.rootTaskInput);
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const tasks = useWorkflowStore((state) => state.tasks);
  const activeRun = useWorkflowStore((state) => state.activeRun);
  const currentWorkflow = useWorkflowStore((state) => state.currentWorkflow);
  const setWorkflowData = useWorkflowStore((state) => state.setWorkflowData);
  const setRootTaskInput = useWorkflowStore((state) => state.setRootTaskInput);
  const setCurrentWorkflow = useWorkflowStore((state) => state.setCurrentWorkflow);
  const setRuntimeSnapshot = useWorkflowStore((state) => state.setRuntimeSnapshot);
  const setRunDiagnostics = useWorkflowStore((state) => state.setRunDiagnostics);
  const applyRuntimeEvent = useWorkflowStore((state) => state.applyRuntimeEvent);
  const addEvent = useWorkflowStore((state) => state.addEvent);
  const setFinalOutput = useWorkflowStore((state) => state.setFinalOutput);
  const themeMode = useWorkflowStore((state) => state.themeMode);
  const setThemeMode = useWorkflowStore((state) => state.setThemeMode);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const saveNodeAsTemplate = useWorkflowStore((state) => state.saveNodeAsTemplate);
  const bottomPanelCollapsed = useWorkflowStore((state) => state.bottomPanelCollapsed);
  const toggleBottomPanel = useWorkflowStore((state) => state.toggleBottomPanel);
  const autoLayoutNodes = useWorkflowStore((state) => state.autoLayoutNodes);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (workflowId) {
      draftHydratedRef.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(WORKFLOW_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        currentWorkflow?: typeof currentWorkflow;
        edges?: typeof edges;
        nodes?: typeof nodes;
        rootTaskInput?: string;
        tasks?: typeof tasks;
      };
      if (draft.nodes && draft.edges && draft.tasks) setWorkflowData({ nodes: draft.nodes, edges: draft.edges, tasks: draft.tasks });
      if (typeof draft.rootTaskInput === "string") setRootTaskInput(draft.rootTaskInput);
      if (draft.currentWorkflow) setCurrentWorkflow(draft.currentWorkflow);
    } catch {
      // ignore local corrupted draft
    } finally {
      draftHydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  useEffect(() => {
    if (!projectId) {
      setProjectName("");
      return;
    }
    void (async () => {
      try {
        const payload = await runtimeClient.getProject(projectId);
        setProjectName(payload.project.name);
      } catch {
        setProjectName("");
      }
    })();
  }, [projectId]);

  useEffect(() => {
    if (!workflowId) return;
    void (async () => {
      setInitializingWorkflow(true);
      try {
        const payload = await runtimeClient.getWorkflow(workflowId);
        if (projectId && payload.workflow.projectId && payload.workflow.projectId !== projectId) {
          showNotice("当前工作流不属于该项目");
          return;
        }
        setWorkflowData({
          nodes: payload.workflow.nodes.map((node, index) => toCanvasNode(node, index)),
          edges: payload.workflow.edges,
          tasks: payload.workflow.tasks,
        });
        setRootTaskInput(payload.workflow.rootTaskInput ?? "");
        setCurrentWorkflow({
          workflowId: payload.workflow.id,
          projectId: payload.workflow.projectId ?? projectId,
          name: payload.workflow.name,
          updatedAt: payload.workflow.updatedAt,
          currentVersionId: payload.workflow.currentVersionId,
          currentVersionNumber: payload.workflow.currentVersionNumber,
          publishedVersionId: payload.workflow.publishedVersionId,
          publishedVersionNumber: payload.workflow.publishedVersionNumber,
          isDirty: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载工作流失败";
        showNotice(message);
      } finally {
        setInitializingWorkflow(false);
      }
    })();
  }, [projectId, setCurrentWorkflow, setRootTaskInput, setWorkflowData, showNotice, workflowId]);

  useEffect(() => {
    const cached = window.localStorage.getItem(THEME_MODE_KEY);
    if (cached === "light" || cached === "dark") setThemeMode(cached);
  }, [setThemeMode]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    window.localStorage.setItem(THEME_MODE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    window.localStorage.setItem(WORKFLOW_DRAFT_KEY, JSON.stringify({ currentWorkflow, edges, nodes, rootTaskInput, tasks }));
  }, [currentWorkflow, edges, nodes, rootTaskInput, tasks]);

  useEffect(() => {
    if (selectedNodeId) setShowInspector(true);
  }, [selectedNodeId]);

  useEffect(() => {
    if (!draftHydratedRef.current || activeRun?.status === "running") return;
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      return;
    }
    const snapshot: CanvasDraftSnapshot = { nodes, edges, tasks, rootTaskInput };
    const previous = historyRef.current[historyIndex];
    if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) return;
    historyRef.current = [...historyRef.current.slice(0, historyIndex + 1), snapshot].slice(-60);
    setHistoryIndex(historyRef.current.length - 1);
  }, [activeRun?.status, edges, historyIndex, nodes, rootTaskInput, tasks]);

  const applyHistorySnapshot = (snapshot: CanvasDraftSnapshot) => {
    applyingHistoryRef.current = true;
    setWorkflowData({ nodes: snapshot.nodes, edges: snapshot.edges, tasks: snapshot.tasks });
    setRootTaskInput(snapshot.rootTaskInput);
  };

  const onUndo = () => {
    if (historyIndex <= 0) return;
    const next = historyRef.current[historyIndex - 1];
    if (!next) return;
    applyHistorySnapshot(next);
    setHistoryIndex((value) => value - 1);
  };

  const onRedo = () => {
    if (historyIndex < 0 || historyIndex >= historyRef.current.length - 1) return;
    const next = historyRef.current[historyIndex + 1];
    if (!next) return;
    applyHistorySnapshot(next);
    setHistoryIndex((value) => value + 1);
  };

  const stopReconcile = useCallback(() => {
    if (reconcileTimerRef.current) {
      clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
    }
  }, []);

  const reconcileSnapshot = useCallback(async (runId: string) => {
    try {
      const snapshot = await runtimeClient.getRunSnapshot(runId);
      setRuntimeSnapshot(snapshot);
      const diagnostics = await runtimeClient.getRunDiagnostics(runId);
      setRunDiagnostics(diagnostics);
    } catch {
      // ignore transient failures
    }
  }, [setRunDiagnostics, setRuntimeSnapshot]);

  const scheduleReconcile = useCallback((runId: string) => {
    stopReconcile();
    const tick = async () => {
      const state = useWorkflowStore.getState();
      if (state.activeRun?.id !== runId || state.activeRun?.status !== "running") return stopReconcile();
      await reconcileSnapshot(runId);
      const interval = Date.now() < rerunBoostUntilRef.current ? 1000 : 2000;
      reconcileTimerRef.current = setTimeout(() => void tick(), interval);
    };
    reconcileTimerRef.current = setTimeout(() => void tick(), 1600);
  }, [reconcileSnapshot, stopReconcile]);

  const connectStream = useCallback((runId: string) => {
    streamRef.current?.close();
    streamRef.current = runtimeClient.connectRunStream(
      runId,
      (event) => {
        applyRuntimeEvent(event);
        if (event.type === "node_rerun_requested") rerunBoostUntilRef.current = Date.now() + 10_000;
      },
      () => void reconcileSnapshot(runId),
    );
  }, [applyRuntimeEvent, reconcileSnapshot]);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      stopReconcile();
    };
  }, [stopReconcile]);

  useEffect(() => {
    if (!activeRun?.id) return stopReconcile();
    if (activeRun.status === "running") {
      void reconcileSnapshot(activeRun.id);
      scheduleReconcile(activeRun.id);
      return;
    }
    stopReconcile();
  }, [activeRun?.id, activeRun?.status, reconcileSnapshot, scheduleReconcile, stopReconcile]);

  const onStartRun = async () => {
    const task = rootTaskInput.trim();
    if (!task) return;
    if (nodes.length === 0) {
      const message = "运行失败：画布中没有节点。";
      setFinalOutput(message);
      addEvent({ id: `event_local_${Date.now()}`, time: new Date().toISOString(), type: "run_failed", message });
      return;
    }
    streamRef.current?.close();
    stopReconcile();
    try {
      const workflow = buildWorkflowPayload({ nodes, edges, tasks });
      const { runId } = await runtimeClient.createRun({
        task,
        workflow: workflow.nodes.length ? workflow : undefined,
        workflowId: currentWorkflow?.workflowId,
        workflowVersionId: currentWorkflow?.isDirty ? undefined : currentWorkflow?.currentVersionId,
      });
      const snapshot = await runtimeClient.getRunSnapshot(runId);
      setRuntimeSnapshot(snapshot);
      setRunDiagnostics(await runtimeClient.getRunDiagnostics(runId));
      connectStream(runId);
      await runtimeClient.startRun(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动运行失败";
      setFinalOutput(`运行失败：${message}`);
      addEvent({ id: `event_local_${Date.now()}`, time: new Date().toISOString(), type: "run_failed", message: `运行失败：${message}` });
    }
  };

  const onResetLayout = () => {
    autoLayoutNodes();
    setFitViewNonce((value) => value + 1);
    setBottomHeight(DEFAULT_BOTTOM_HEIGHT);
    setShowNodeLibrary(false);
    setShowInspector(false);
  };

  const onSaveNodeTemplate = () => {
    if (!selectedNodeId) return showNotice("请先选中一个节点");
    const template = saveNodeAsTemplate(selectedNodeId);
    if (!template) return showNotice("保存节点模板失败");
    showNotice(`已保存节点模板：${template.name}`);
  };

  const startBottomResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottomHeight;
    const onMove = (move: PointerEvent) => setBottomHeight(clamp(startHeight + (startY - move.clientY), MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden text-slate-900 dark:text-slate-100">
      {initializingWorkflow ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/65 text-sm text-slate-700 backdrop-blur-sm">
          正在加载工作流...
        </div>
      ) : null}
      {!initializingWorkflow && nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
          <div className="pointer-events-auto rounded-2xl border border-dashed border-slate-300 bg-white/90 px-6 py-5 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-700">当前工作流还是空白</p>
            <p className="mt-1 text-sm text-slate-500">点击顶部“节点库”添加第一个节点，开始编排。</p>
            <button
              type="button"
              onClick={() => setShowNodeLibrary(true)}
              className="mt-3 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
            >
              打开节点库
            </button>
          </div>
        </div>
      ) : null}
      <div className="absolute inset-0">
        <WorkflowCanvas fitViewNonce={fitViewNonce} zoomInNonce={zoomInNonce} zoomOutNonce={zoomOutNonce} />
      </div>

      <TopBar
        projectName={projectName}
        onStartRun={onStartRun}
        onResetLayout={onResetLayout}
        onToggleNodeLibrary={() => setShowNodeLibrary((value) => !value)}
        onToggleInspector={() => setShowInspector((value) => !value)}
        onToggleBottomPanel={toggleBottomPanel}
        onOpenToolPlatform={() => setShowToolPlatform(true)}
        onOpenWorkspaceConfig={() => setShowWorkspaceConfig(true)}
        onOpenWorkflowVersions={() => setShowWorkflowVersions(true)}
        onOpenWorkflowTemplateSave={() => setShowWorkflowTemplateSave(true)}
        onSaveNodeTemplate={onSaveNodeTemplate}
        onUndo={onUndo}
        onRedo={onRedo}
        onFitView={() => setFitViewNonce((value) => value + 1)}
        onZoomIn={() => setZoomInNonce((value) => value + 1)}
        onZoomOut={() => setZoomOutNonce((value) => value + 1)}
        bottomPanelCollapsed={bottomPanelCollapsed}
      />

      {notice ? <div className="pointer-events-none absolute inset-x-0 top-20 z-40 flex justify-center px-3"><div className="rounded-xl border border-emerald-300/50 bg-emerald-100/90 px-3 py-2 text-xs text-emerald-800 shadow-lg">{notice}</div></div> : null}

      <aside className={`absolute left-3 top-[5.25rem] z-30 h-[calc(100%-5.75rem)] w-[min(360px,calc(100vw-1.5rem))] transition-transform duration-300 ${showNodeLibrary ? "translate-x-0" : "-translate-x-[115%]"}`}>
        <div className="mb-2 flex justify-end"><ButtonIconClose onClick={() => setShowNodeLibrary(false)} /></div>
        <LeftSidebar />
      </aside>

      <aside className={`absolute right-3 top-[5.25rem] z-30 h-[calc(100%-5.75rem)] w-[min(420px,calc(100vw-1.5rem))] transition-transform duration-300 ${showInspector ? "translate-x-0" : "translate-x-[115%]"}`}>
        <div className="mb-2 flex justify-end"><ButtonIconClose onClick={() => setShowInspector(false)} /></div>
        <RightInspector />
      </aside>

      {!bottomPanelCollapsed ? (
        <div className="absolute inset-x-3 bottom-3 z-30">
          <div className="rounded-2xl border border-white/55 bg-[var(--panel-strong)]/95 backdrop-blur dark:border-white/10" style={{ height: bottomHeight }}>
            <div className="mx-auto mt-1 h-2 w-32 cursor-row-resize rounded-full bg-black/10 dark:bg-white/15" onPointerDown={startBottomResize} />
            <div className="flex h-[calc(100%-0.75rem)] flex-col">
              <div className="flex items-center justify-end px-2">
                <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-black/5" onClick={toggleBottomPanel}><ChevronDown className="h-4 w-4" /></button>
              </div>
              <div className="min-h-0 flex-1 p-2 pt-0"><BottomPanel /></div>
            </div>
          </div>
        </div>
      ) : null}

      {showToolPlatform ? <Overlay onClose={() => setShowToolPlatform(false)}><ToolPlatformPanel onClose={() => setShowToolPlatform(false)} /></Overlay> : null}
      {showWorkspaceConfig ? <Overlay onClose={() => setShowWorkspaceConfig(false)}><WorkspacePanel onClose={() => setShowWorkspaceConfig(false)} /></Overlay> : null}
      {showWorkflowVersions ? <Overlay onClose={() => setShowWorkflowVersions(false)}><WorkflowVersionsPanel onClose={() => setShowWorkflowVersions(false)} onLoaded={showNotice} /></Overlay> : null}
      {showWorkflowTemplateSave ? (
        <Overlay onClose={() => setShowWorkflowTemplateSave(false)}>
          <WorkflowTemplateSavePanel
            onClose={() => setShowWorkflowTemplateSave(false)}
            onSaved={showNotice}
          />
        </Overlay>
      ) : null}
    </div>
  );
}

function WorkflowTemplateSavePanel({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const currentWorkflow = useWorkflowStore((state) => state.currentWorkflow);
  const rootTaskInput = useWorkflowStore((state) => state.rootTaskInput);
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const tasks = useWorkflowStore((state) => state.tasks);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"create" | "overwrite">("create");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templates, setTemplates] = useState<WorkflowTemplateView[]>([]);

  const nodeNameById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.name])),
    [nodes],
  );
  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId),
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!templateName.trim()) {
      setTemplateName(`${currentWorkflow?.name || "工作流"} 模板`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkflow?.name]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const payload = await runtimeClient.listWorkflowTemplates();
        setTemplates(payload.workflowTemplates);
        const firstEnabled = payload.workflowTemplates.find((item) => item.enabled);
        if (firstEnabled) {
          setSelectedTemplateId(firstEnabled.id);
          setTemplateDescription(firstEnabled.description || "");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取模板列表失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (mode !== "overwrite") return;
    if (!selectedTemplate) return;
    setTemplateName(selectedTemplate.name);
    setTemplateDescription(selectedTemplate.description || "");
  }, [mode, selectedTemplate]);

  const onSave = async () => {
    if (!templateName.trim()) {
      setError("模板名称不能为空。");
      return;
    }
    if (nodes.length === 0) {
      setError("当前工作流没有节点，无法保存为模板。");
      return;
    }
    if (mode === "overwrite" && !selectedTemplateId) {
      setError("请选择要覆盖的模板。");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: templateName.trim(),
        description: templateDescription.trim() || undefined,
        rootTaskInput: rootTaskInput.trim() || undefined,
        nodes: nodes.map((node) => ({
          id: node.id,
          name: node.name,
          role: node.role,
          taskSummary: node.taskSummary,
          responsibilitySummary: node.responsibilitySummary,
          position: node.position,
          width: node.width,
          height: node.height,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          type: edge.type,
          condition: edge.condition,
        })),
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          parentTaskId: task.parentTaskId,
          assignedNodeId: task.assignedNodeId,
          summary: task.summary,
        })),
      };

      if (mode === "overwrite" && selectedTemplateId) {
        const updated = await runtimeClient.updateWorkflowTemplate(selectedTemplateId, {
          ...payload,
          enabled: selectedTemplate?.enabled ?? true,
        });
        onSaved(`模板已覆盖更新：${updated.workflowTemplate.name}`);
      } else {
        const created = await runtimeClient.createWorkflowTemplate({
          ...payload,
          enabled: true,
        });
        onSaved(`模板已保存：${created.workflowTemplate.name}`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存模板失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full min-w-0 max-w-[820px] overflow-hidden rounded-3xl border border-white/60 bg-[var(--panel-strong)] p-4">
      <div className="mb-3 flex min-w-0 items-center justify-between">
        <p className="text-sm font-semibold">保存为 Workflow 模板</p>
        <Button variant="ghost" onClick={onClose}>关闭</Button>
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={mode === "create" ? "default" : "secondary"} onClick={() => setMode("create")} className="rounded-xl">新建模板</Button>
          <Button variant={mode === "overwrite" ? "default" : "secondary"} onClick={() => setMode("overwrite")} className="rounded-xl">覆盖现有模板</Button>
        </div>
        {mode === "overwrite" ? (
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950"
          >
            <option value="">请选择要覆盖的模板</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.enabled ? "已启用" : "已禁用"}）
              </option>
            ))}
          </select>
        ) : null}
        <Input
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          placeholder="模板名称"
          className="h-10"
        />
        <Input
          value={templateDescription}
          onChange={(event) => setTemplateDescription(event.target.value)}
          placeholder="模板描述（可选）"
          className="h-10"
        />

        <div className="rounded-2xl border border-black/10 bg-white/70 p-3 text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
          <p>当前画布摘要：节点 {nodes.length} · 连线 {edges.length} · 任务 {tasks.length}</p>
          <p className="mt-1">任务输入：{rootTaskInput || "未设置"}</p>
          <p className="mt-2 line-clamp-2">节点预览：{nodes.length > 0 ? nodes.map((node) => `${node.name}(${node.role})`).slice(0, 8).join("、") : "暂无节点"}</p>
          <p className="mt-1 line-clamp-2">
            连线预览：
            {edges.length > 0
              ? edges
                  .map((edge) => `${nodeNameById.get(edge.sourceNodeId) ?? edge.sourceNodeId}→${nodeNameById.get(edge.targetNodeId) ?? edge.targetNodeId}`)
                  .slice(0, 8)
                  .join("、")
              : "暂无连线"}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={() => void onSave()} disabled={saving || loading}>
            {saving ? "保存中..." : mode === "overwrite" ? "覆盖模板" : "保存模板"}
          </Button>
        </div>
        {loading ? <p className="text-xs text-slate-500">加载模板列表中...</p> : null}
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>
    </div>
  );
}

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3" onClick={onClose}>
      <div className="mx-auto flex w-full min-w-0 max-w-[calc(100vw-1.5rem)] justify-center" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WorkspacePanelLegacy({ onClose }: { onClose: () => void }) {
  const fetchedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [credentialId, setCredentialId] = useState("");
  const [credentials, setCredentials] = useState<Array<{ id: string; label: string }>>([]);
  const [message, setMessage] = useState("");

  const uniqueCredentials = useCallback((items: Array<{ id: string; label: string; provider?: string }>) => {
    const seen = new Set<string>();
    const next: Array<{ id: string; label: string }> = [];
    for (const item of items) {
      const dedupeKey = `${item.provider ?? ""}::${item.label}`;
      if (!item.id || seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      next.push({ id: item.id, label: item.label });
    }
    return next;
  }, []);

  useEffect(() => {
    if (fetchedRef.current) {
      return;
    }
    fetchedRef.current = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await runtimeClient.getWorkspaceConfig();
        setProvider(payload.workspace.defaultProvider ?? "");
        setModel(payload.workspace.defaultModel ?? "");
        setTemperature(String(payload.workspace.defaultTemperature ?? 0.7));
        setCredentialId(payload.workspace.defaultCredentialId ?? "");
        setCredentials(uniqueCredentials(payload.credentials));
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取工作区配置失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [uniqueCredentials]);

  const onSave = async () => {
    setError("");
    setMessage("");
    try {
      await runtimeClient.updateWorkspaceConfig({
        defaultProvider: provider || undefined,
        defaultModel: model || undefined,
        defaultCredentialId: credentialId || undefined,
        defaultTemperature: Number(temperature),
      });
      setMessage("全局默认配置已保存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存工作区配置失败");
    }
  };

  return (
    <div className="w-full min-w-0 max-w-[680px] overflow-hidden rounded-3xl border border-white/60 bg-[var(--panel-strong)] p-4">
      <div className="mb-3 flex min-w-0 items-center justify-between"><p className="text-sm font-semibold">全局工作区配置</p><Button variant="ghost" onClick={onClose}>关闭</Button></div>
      <div className="grid w-full min-w-0 gap-2">
        <Input className="min-w-0" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="默认服务商" />
        <Input className="min-w-0" value={model} onChange={(e) => setModel(e.target.value)} placeholder="默认模型" />
        <Input className="min-w-0" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="默认温度（temperature）" />
        <select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
          <option value="">不设置默认凭证</option>
          {credentials.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div className="mt-3 flex justify-end gap-2"><Button onClick={() => void onSave()}>保存</Button></div>
      {loading ? <p className="mt-2 text-xs text-slate-500">加载中...</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
    </div>
  );
}

function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const fetchedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [defaultCredentialId, setDefaultCredentialId] = useState("");
  const [credentials, setCredentials] = useState<Array<{ id: string; label: string }>>([]);

  const uniqueCredentials = useCallback((items: Array<{ id: string; label: string; provider?: string }>) => {
    const seen = new Set<string>();
    const next: Array<{ id: string; label: string }> = [];
    for (const item of items) {
      const dedupeKey = `${item.provider ?? ""}::${item.label}`;
      if (!item.id || seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      next.push({ id: item.id, label: item.label });
    }
    return next;
  }, []);

  useEffect(() => {
    if (fetchedRef.current) {
      return;
    }
    fetchedRef.current = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await runtimeClient.getWorkspaceConfig();
        setProvider(payload.workspace.defaultProvider ?? "");
        setModel(payload.workspace.defaultModel ?? "");
        setBaseUrl(payload.workspace.defaultBaseUrl ?? "");
        setTemperature(String(payload.workspace.defaultTemperature ?? 0.7));
        setDefaultCredentialId(payload.workspace.defaultCredentialId ?? "");
        setCredentials(uniqueCredentials(payload.credentials));
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取工作区配置失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [uniqueCredentials]);

  const onSave = async () => {
    const nextProvider = provider.trim();
    const nextModel = model.trim();
    const nextBaseUrl = baseUrl.trim();
    const nextApiKey = apiKey.trim();

    setError("");
    setMessage("");

    if (!nextProvider) {
      setError("请填写服务商，例如 OpenAI、MiniMax、Anthropic。");
      return;
    }
    if (!nextModel) {
      setError("请填写模型名称，例如 gpt-4.1、MiniMax-M2.5。");
      return;
    }
    if (!nextBaseUrl) {
      setError("请填写接口 URL，例如 https://api.openai.com/v1。");
      return;
    }

    try {
      const parsed = new URL(nextBaseUrl);
      if (!parsed.protocol.startsWith("http")) {
        setError("URL 必须以 http 或 https 开头。");
        return;
      }
    } catch {
      setError("URL 格式不正确，请检查后重试。");
      return;
    }

    try {
      let credentialId = defaultCredentialId || "";
      if (!nextApiKey && !credentialId) {
        setError("请填写 API Key，例如 sk-xxxxxx。");
        return;
      }

      if (nextApiKey) {
        const hostLabel = (() => {
          try {
            return new URL(nextBaseUrl).host;
          } catch {
            return "custom";
          }
        })();
        const created = await runtimeClient.createCredential({
          provider: nextProvider,
          label: `${nextProvider}@${hostLabel}`,
          apiKey: nextApiKey,
        });
        credentialId = created.credentialId;
        setDefaultCredentialId(created.credentialId);
      }

      await runtimeClient.updateWorkspaceConfig({
        defaultProvider: nextProvider,
        defaultModel: nextModel,
        defaultBaseUrl: nextBaseUrl,
        defaultCredentialId: credentialId || undefined,
        defaultTemperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7,
      });

      setApiKey("");
      setMessage("工作区配置已保存，可用于后续工作流运行。");

      const refreshed = await runtimeClient.listCredentials();
      setCredentials(uniqueCredentials(refreshed.credentials));
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存工作区配置失败");
    }
  };

  return (
    <div className="w-full min-w-0 max-w-[760px] overflow-hidden rounded-3xl border border-white/60 bg-[var(--panel-strong)] p-4">
      <div className="mb-3 flex min-w-0 items-center justify-between">
        <p className="text-sm font-semibold">全局工作区配置</p>
        <Button variant="ghost" onClick={onClose}>关闭</Button>
      </div>

      <div className="rounded-2xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-xs text-slate-600 dark:text-slate-300">核心必填项：服务商、模型、URL、API Key。</p>
        <div className="mt-3 grid w-full min-w-0 gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">服务商 *</p>
            <Input className="min-w-0" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="例如 OpenAI / MiniMax / Anthropic" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">模型 *</p>
            <Input className="min-w-0" value={model} onChange={(e) => setModel(e.target.value)} placeholder="例如 gpt-4.1 / MiniMax-M2.5 / claude-3-5-sonnet" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">URL *</p>
            <Input className="min-w-0" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="例如 https://api.openai.com/v1" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">API Key *</p>
            <Input className="min-w-0" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="例如 sk-xxxxxx（已配置时可留空保持不变）" />
            {defaultCredentialId ? (
              <p className="text-[11px] text-slate-500">当前默认凭证 ID：{defaultCredentialId}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-200">可选高级项</p>
        <div className="grid gap-2 md:grid-cols-2">
          <Input className="min-w-0" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="默认温度（可选），例如 0.7" />
          <select value={defaultCredentialId} onChange={(e) => setDefaultCredentialId(e.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
            <option value="">自动使用新建凭证/不指定</option>
            {credentials.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => void onSave()}>保存配置</Button>
      </div>
      {loading ? <p className="mt-2 text-xs text-slate-500">加载中...</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
    </div>
  );
}

function WorkflowVersionsPanel({ onClose, onLoaded }: { onClose: () => void; onLoaded: (message: string) => void }) {
  const setWorkflowData = useWorkflowStore((state) => state.setWorkflowData);
  const setCurrentWorkflow = useWorkflowStore((state) => state.setCurrentWorkflow);
  const setRootTaskInput = useWorkflowStore((state) => state.setRootTaskInput);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workflows, setWorkflows] = useState<WorkflowSummaryView[]>([]);
  const [versions, setVersions] = useState<WorkflowVersionSummaryView[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await runtimeClient.listWorkflows();
        setWorkflows(payload.workflows);
        setWorkflowId(payload.workflows[0]?.id ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "获取工作流列表失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!workflowId) return;
    void (async () => {
      setError("");
      try {
        const payload = await runtimeClient.listWorkflowVersions(workflowId);
        setVersions(payload.versions);
        setVersionId(payload.versions[0]?.id ?? "");
      } catch (e) {
        setVersions([]);
        setVersionId("");
        setError(e instanceof Error ? e.message : "获取版本列表失败");
      }
    })();
  }, [workflowId]);

  const onLoadVersion = async () => {
    if (!workflowId || !versionId) return;
    setError("");
    setMessage("");
    try {
      const payload = await runtimeClient.getWorkflowVersion(workflowId, versionId);
      setWorkflowData({
        nodes: payload.workflow.nodes.map((node) => ({ ...node, status: "idle", upstreamIds: [], downstreamIds: [], createdAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), blocked: false, retryCount: 0, inboundMessages: [], outboundMessages: [], resolvedInput: "", taskBrief: "" })),
        edges: payload.workflow.edges,
        tasks: payload.workflow.tasks,
      });
      setRootTaskInput(payload.workflow.rootTaskInput ?? "");
      setCurrentWorkflow({
        workflowId: payload.workflow.id,
        projectId: payload.workflow.projectId,
        name: payload.workflow.name,
        updatedAt: payload.workflow.updatedAt,
        currentVersionId: payload.workflow.currentVersionId,
        currentVersionNumber: payload.workflow.currentVersionNumber,
        publishedVersionId: payload.workflow.publishedVersionId,
        publishedVersionNumber: payload.workflow.publishedVersionNumber,
        isDirty: false,
      });
      setMessage("版本已加载到画布。");
      onLoaded("版本已加载。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载版本失败");
    }
  };

  const onPublish = async () => {
    if (!workflowId) return;
    setError("");
    setMessage("");
    try {
      const payload = await runtimeClient.publishWorkflowVersion(workflowId, versionId || undefined);
      setMessage(`已发布 v${payload.workflow.publishedVersionNumber ?? "-"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布版本失败");
    }
  };

  return (
    <div className="w-full min-w-0 max-w-[700px] overflow-hidden rounded-3xl border border-white/60 bg-[var(--panel-strong)] p-4">
      <div className="mb-3 flex min-w-0 items-center justify-between"><p className="text-sm font-semibold">工作流版本</p><Button variant="ghost" onClick={onClose}>关闭</Button></div>
      <div className="grid w-full min-w-0 gap-2">
        <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
          {workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={versionId} onChange={(e) => setVersionId(e.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950">
          {versions.map((item) => <option key={item.id} value={item.id}>v{item.versionNumber} - {item.versionLabel}</option>)}
        </select>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => void onPublish()}>发布</Button>
        <Button onClick={() => void onLoadVersion()}>加载到画布</Button>
      </div>
      {loading ? <p className="mt-2 text-xs text-slate-500">加载中...</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      {message ? <p className="mt-2 text-xs text-emerald-600">{message}</p> : null}
    </div>
  );
}

function ButtonIconClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="rounded-full border border-black/10 bg-white/80 p-2 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300" onClick={onClick} aria-label="关闭面板">
      <X className="h-4 w-4" />
    </button>
  );
}
