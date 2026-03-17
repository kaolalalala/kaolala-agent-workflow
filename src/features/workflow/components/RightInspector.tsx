"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  runtimeClient,
  type AgentDocumentView,
  type NodeConfigView,
  type WorkspaceConfigView,
} from "@/features/workflow/adapters/runtime-client";
import { ROLE_LABELS, STATUS_LABELS } from "@/features/workflow/constants";
import { COMMON_PROVIDERS, PROVIDER_MODELS } from "@/features/workflow/model-options";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";
import { ToolBindingsSection } from "@/features/workflow/components/ToolBindingsSection";
import { SkillBindingsSection } from "@/features/workflow/components/SkillBindingsSection";
import { formatZhDateTime } from "@/lib/utils";

interface NodeConfigDraft {
  name: string;
  description: string;
  responsibility: string;
  systemPrompt: string;
  additionalPrompt: string;
  useWorkspaceModelDefault: boolean;
  provider: string;
  model: string;
  credentialId: string;
  outputPath: string;
  temperature: number;
  allowHumanInput: boolean;
  toolPolicy: "disabled" | "allowed" | "required";
  executionMode: "standard" | "dev" | "script";
  workspaceId: string;
  entryFile: string;
  runCommand: string;
}

const sectionCardClass =
  "rounded-[24px] border border-black/6 bg-white/72 shadow-none dark:border-white/10 dark:bg-white/[0.04]";
const subtlePanelClass =
  "rounded-[18px] border border-black/6 bg-white/76 p-3 dark:border-white/10 dark:bg-white/[0.03]";

function draftFromNodeConfig(config: NodeConfigView): NodeConfigDraft {
  return {
    name: config.name || "",
    description: config.description || "",
    responsibility: config.responsibility || "",
    systemPrompt: config.systemPrompt || "",
    additionalPrompt: config.additionalPrompt || "",
    useWorkspaceModelDefault: config.useWorkspaceModelDefault,
    provider: config.provider || "",
    model: config.model || "",
    credentialId: config.credentialId || "",
    outputPath: config.outputPath || "",
    temperature: typeof config.temperature === "number" ? config.temperature : 0.2,
    allowHumanInput: config.allowHumanInput,
    toolPolicy: config.toolPolicy ?? "allowed",
    executionMode: config.executionMode ?? "standard",
    workspaceId: config.workspaceId || "",
    entryFile: config.entryFile || "",
    runCommand: config.runCommand || "",
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function draftFromNode(node: { name: string; responsibilitySummary: string; role: string }): NodeConfigDraft {
  return {
    name: node.name,
    description: "",
    responsibility: node.responsibilitySummary,
    systemPrompt: "",
    additionalPrompt: "",
    useWorkspaceModelDefault: true,
    provider: "",
    model: "",
    credentialId: "",
    outputPath: "",
    temperature: 0.2,
    allowHumanInput: true,
    toolPolicy: node.role === "planner" || node.role === "input" || node.role === "output" ? "disabled" : "allowed",
    executionMode: "standard",
    workspaceId: "",
    entryFile: "",
    runCommand: "",
  };
}

export function RightInspector() {
  const nodes = useWorkflowStore((state) => state.nodes);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const inspectorTab = useWorkflowStore((state) => state.inspectorTab);
  const setInspectorTab = useWorkflowStore((state) => state.setInspectorTab);
  const activeRun = useWorkflowStore((state) => state.activeRun);
  const setRuntimeSnapshot = useWorkflowStore((state) => state.setRuntimeSnapshot);
  const updateNodeDetails = useWorkflowStore((state) => state.updateNodeDetails);
  const saveNodeAsTemplate = useWorkflowStore((state) => state.saveNodeAsTemplate);
  const nodeContextsByNodeId = useWorkflowStore((state) => state.nodeContextsByNodeId);
  const currentWorkflow = useWorkflowStore((state) => state.currentWorkflow);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedContext = selectedNodeId ? nodeContextsByNodeId[selectedNodeId] : undefined;

  const [documents, setDocuments] = useState<AgentDocumentView[]>([]);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfigView | null>(null);
  const [nodeDraft, setNodeDraft] = useState<NodeConfigDraft | null>(null);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [agentError, setAgentError] = useState("");
  const [humanInput, setHumanInput] = useState("");
  const [humanFiles, setHumanFiles] = useState<File[]>([]);
  const [rerunAfterSend, setRerunAfterSend] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState("");

  const [docType, setDocType] = useState<"prompt" | "skill" | "reference">("skill");

  // Workspace state removed — dev workspace UI now lives at /agent-dev

  useEffect(() => {
    if (!selectedNode) {
      setNodeDraft(null);
      setHumanFiles([]);
      setConfigSaved("");
      setSendStatus("");
      return;
    }
    // Only reset draft when the selected node *identity* changes, not on every store update.
    // loadConfigData (triggered by selectedNodeId) will replace this with backend values if a run exists.
    setNodeDraft(draftFromNode(selectedNode));
    setHumanFiles([]);
    setConfigSaved("");
    setSendStatus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const effectiveModelLabel = useMemo(() => {
    if (!nodeDraft) {
      return "-";
    }
    if (nodeDraft.useWorkspaceModelDefault) {
      return `${workspaceConfig?.defaultProvider ?? "mock"} / ${workspaceConfig?.defaultModel ?? "mock-agent-v1"}`;
    }
    return `${nodeDraft.provider || "-"} / ${nodeDraft.model || "-"}`;
  }, [nodeDraft, workspaceConfig]);

  const nodeProvider = nodeDraft?.provider || "";
  const nodeProviderSelectValue = useMemo(() => {
    if (!nodeProvider) {
      return "";
    }
    return COMMON_PROVIDERS.some((item) => item.value === nodeProvider && item.value !== "custom")
      ? nodeProvider
      : "__custom__";
  }, [nodeProvider]);
  const nodeModelCandidates = useMemo(() => PROVIDER_MODELS[nodeProvider] ?? [], [nodeProvider]);

  const loadConfigData = useCallback(async () => {
    if (!selectedNodeId) {
      setDocuments([]);
      return;
    }

    try {
      const workspacePayload = await runtimeClient.getWorkspaceConfig();
      setWorkspaceConfig(workspacePayload.workspace);

      if (!activeRun?.id) {
        setDocuments([]);
        return;
      }

      const nodePayload = await runtimeClient.getNodeConfig(activeRun.id, selectedNodeId);
      setNodeDraft(draftFromNodeConfig(nodePayload.config));
      setDocuments(nodePayload.documents);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "加载配置失败");
    }
  }, [activeRun?.id, selectedNodeId]);

  useEffect(() => {
    void loadConfigData();
  }, [loadConfigData]);

  const refreshSnapshot = useCallback(async () => {
    if (!activeRun?.id) {
      return;
    }
    const snapshot = await runtimeClient.getRunSnapshot(activeRun.id);
    setRuntimeSnapshot(snapshot);
  }, [activeRun?.id, setRuntimeSnapshot]);

  const onSaveNodeConfig = async () => {
    if (!selectedNode || !nodeDraft) {
      return;
    }

    setSavingConfig(true);
    setAgentError("");
    setConfigSaved("");

    try {
      updateNodeDetails(selectedNode.id, {
        name: nodeDraft.name,
        responsibilitySummary: nodeDraft.responsibility,
      });

      if (activeRun?.id) {
        await runtimeClient.updateNodeConfig(activeRun.id, selectedNode.id, {
          name: nodeDraft.name,
          description: nodeDraft.description,
          responsibility: nodeDraft.responsibility,
          systemPrompt: nodeDraft.systemPrompt,
          additionalPrompt: nodeDraft.additionalPrompt,
          useWorkspaceModelDefault: nodeDraft.useWorkspaceModelDefault,
          provider: nodeDraft.provider,
          model: nodeDraft.model,
          credentialId: nodeDraft.credentialId,
          outputPath: nodeDraft.outputPath,
          temperature: nodeDraft.temperature,
          allowHumanInput: nodeDraft.allowHumanInput,
          toolPolicy: nodeDraft.toolPolicy,
          executionMode: nodeDraft.executionMode,
          workspaceId: nodeDraft.workspaceId || undefined,
          entryFile: nodeDraft.entryFile || undefined,
          runCommand: nodeDraft.runCommand || undefined,
        });
        await Promise.all([loadConfigData(), refreshSnapshot()]);
        setConfigSaved("节点配置已保存并同步到后端。");
      } else {
        setConfigSaved("当前为未运行画布，已保存本地修改。");
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "保存节点配置失败");
    } finally {
      setSavingConfig(false);
    }
  };

  const onSaveAsTemplate = () => {
    if (!selectedNode || !nodeDraft) {
      return;
    }

    const created = saveNodeAsTemplate(selectedNode.id, {
      name: nodeDraft.name,
      responsibilitySummary: nodeDraft.responsibility,
      taskSummary: selectedNode.taskSummary,
    });

    if (!created) {
      setAgentError("保存模板失败");
    }
  };

  const onUploadDocument = async (file: File | undefined) => {
    if (!activeRun?.id || !selectedNodeId || !file) {
      return;
    }

    setAgentError("");
    try {
      await runtimeClient.uploadNodeDocument(activeRun.id, selectedNodeId, docType, file);
      const payload = await runtimeClient.getNodeConfig(activeRun.id, selectedNodeId);
      setDocuments(payload.documents);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "上传文档失败");
    }
  };

  const onDeleteDocument = async (documentId: string) => {
    setAgentError("");
    try {
      await runtimeClient.deleteDocument(documentId);
      setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "删除文档失败");
    }
  };

  const onSendHumanMessage = async () => {
    if (!activeRun?.id || !selectedNode) {
      return;
    }
    if (!humanInput.trim() && humanFiles.length === 0) {
      return;
    }

    setSending(true);
    setAgentError("");
    setSendStatus("");
    try {
      const attachments = await Promise.all(
        humanFiles.map(async (file) => ({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          content: await readFileAsDataUrl(file),
        })),
      );
      await runtimeClient.sendHumanMessage(activeRun.id, selectedNode.id, humanInput.trim() || "附加文件输入", attachments);
      if (rerunAfterSend) {
        await runtimeClient.rerunFromNode(activeRun.id, selectedNode.id, true);
        setSendStatus("消息已发送，并已触发从当前节点重跑（含下游）。");
      } else {
        setSendStatus("消息已发送。未触发自动重跑。");
      }
      setHumanInput("");
      setHumanFiles([]);
      if (rerunAfterSend) {
        await refreshSnapshot();
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="h-full min-h-0 rounded-[28px] border border-white/60 bg-[var(--panel)] p-3 shadow-[0_28px_80px_-36px_var(--shadow-color)] backdrop-blur dark:border-white/10">
      {!selectedNode && (
        <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-black/10 bg-white/50 px-6 text-center dark:border-white/10 dark:bg-white/[0.03]">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Inspector</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">选择节点后查看详情、日志、配置和人工输入。</p>
          </div>
        </div>
      )}
      {selectedNode && (
        <Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as never)} className="h-full">
          <TabsList className="grid w-full min-w-0 grid-cols-3 gap-1 rounded-[22px] bg-white/70 p-1 dark:bg-white/5 xl:grid-cols-6">
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="responsibility">职责</TabsTrigger>
            <TabsTrigger value="task">任务</TabsTrigger>
            <TabsTrigger value="status">状态</TabsTrigger>
            <TabsTrigger value="logs">日志</TabsTrigger>
            <TabsTrigger value="agent">配置</TabsTrigger>
          </TabsList>
          <ScrollArea className="mt-2 h-[calc(100%-3rem)] pr-2">
            <TabsContent value="overview">
              <Card className={sectionCardClass}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">Overview</p>
                      <CardTitle>{selectedNode.name}</CardTitle>
                    </div>
                    <div className="rounded-full border border-black/6 bg-white/80 px-3 py-1 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
                      {ROLE_LABELS[selectedNode.role]}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">状态</p>
                      <p className="mt-1 font-medium">{STATUS_LABELS[selectedNode.status]}</p>
                    </div>
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">创建时间</p>
                      <p className="mt-1 font-medium">{formatZhDateTime(selectedNode.createdAt)}</p>
                    </div>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">节点 ID</p>
                    <p className="mt-1 break-all font-mono text-xs">{selectedNode.id}</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">任务摘要</p>
                    <p className="mt-1 leading-6">{selectedNode.taskSummary}</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">节点调试位（预留）</p>
                    <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">
                      最近输出：{selectedNode.lastOutput ? selectedNode.lastOutput.slice(0, 120) : "暂无输出"}
                    </p>
                    <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">
                      最近错误：{selectedNode.lastError || "无"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">后续可在此扩展“测试此节点”与节点级运行能力。</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">上游</p>
                      <p className="mt-1">{selectedNode.upstreamIds.join(", ") || "无"}</p>
                    </div>
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">下游</p>
                      <p className="mt-1">{selectedNode.downstreamIds.join(", ") || "无"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="responsibility">
              <Card className={sectionCardClass}>
                <CardHeader>
                  <CardTitle>职责说明</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">角色职责</p>
                    <p className="mt-1 leading-6">{selectedNode.responsibilitySummary}</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">预期输入</p>
                    <p className="mt-1">上游节点输出 + 总任务约束</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">预期输出</p>
                    <p className="mt-1">结构化结果片段</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">适用场景</p>
                    <p className="mt-1">多节点协作流水线</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="task">
              <Card className={sectionCardClass}>
                <CardHeader>
                  <CardTitle>任务书</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">任务目标</p>
                    <p className="mt-1 leading-6">{selectedNode.taskBrief || "完成当前分配任务"}</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">背景说明</p>
                    <p className="mt-1">来自后端 Runtime 分配的执行上下文。</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">输入约束</p>
                    <p className="mt-1">基于上游消息输入执行，不偏离任务目标。</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">成功标准</p>
                    <p className="mt-1">输出可供下游节点消费的结果。</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">输出要求</p>
                    <p className="mt-1">提供结构化摘要与核心结论。</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">上游依赖</p>
                    <p className="mt-1">{selectedNode.upstreamIds.join(", ") || "无"}</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="status">
              <Card className={sectionCardClass}>
                <CardHeader>
                  <CardTitle>状态详情</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">当前阶段</p>
                    <p className="mt-1 font-medium">{STATUS_LABELS[selectedNode.status]}</p>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">最近更新时间</p>
                    <p className="mt-1">{formatZhDateTime(selectedNode.lastUpdatedAt)}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">是否阻塞</p>
                      <p className="mt-1">{selectedNode.blocked ? "是" : "否"}</p>
                    </div>
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">执行顺序</p>
                      <p className="mt-1">{typeof selectedNode.executionOrder === "number" ? `#${selectedNode.executionOrder}` : "未分配"}</p>
                    </div>
                  </div>
                  <div className={subtlePanelClass}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">阻塞原因</p>
                    <p className="mt-1">{selectedNode.blockedReason ?? "无"}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">重试次数</p>
                      <p className="mt-1">{selectedNode.retryCount}</p>
                    </div>
                    <div className={subtlePanelClass}>
                      <p className="text-xs text-slate-500 dark:text-slate-400">错误信息</p>
                      <p className="mt-1">{selectedNode.lastError ?? "无"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="logs" className="space-y-3">
              <Card className={sectionCardClass}>
                <CardHeader>
                  <CardTitle>执行输入与输出</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-slate-700 dark:text-slate-200">
                  <div className="space-y-2">
                    <p className="font-medium">上游消息</p>
                    {(selectedContext?.inboundMessages ?? selectedNode.inboundMessages ?? []).length ? (
                      <div className="space-y-1">
                        {(selectedContext?.inboundMessages ?? selectedNode.inboundMessages ?? []).slice(-8).map((msg) => (
                          <div key={msg.id} className={subtlePanelClass}>
                            <p className="text-slate-500 dark:text-slate-400">
                              {msg.fromNodeId} {"->"} {msg.toNodeId} [{msg.type}]
                            </p>
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 dark:text-slate-400">暂无上游消息。</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="font-medium">最终执行输入</p>
                    <div className={subtlePanelClass}>
                      <p className="whitespace-pre-wrap break-words">
                        {selectedContext?.resolvedInput || selectedNode.resolvedInput || selectedNode.lastInput || "暂无"}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="font-medium">最近输出</p>
                    {(selectedContext?.recentOutputs ?? []).length ? (
                      <div className="space-y-1">
                        {(selectedContext?.recentOutputs ?? []).slice(-6).reverse().map((output, index) => (
                          <div key={`${index}-${output.slice(0, 20)}`} className={subtlePanelClass}>
                            <p className="whitespace-pre-wrap break-words">{output}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={subtlePanelClass}>
                        <p className="whitespace-pre-wrap break-words">{selectedNode.lastOutput || "暂无"}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className={sectionCardClass}>
                <CardHeader>
                  <CardTitle>人工消息</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  {(selectedContext?.humanMessages ?? []).length ? (
                    (selectedContext?.humanMessages ?? [])
                      .slice()
                      .reverse()
                      .map((item) => (
                        <div key={item.id} className={subtlePanelClass}>
                          <p>{item.content}</p>
                          {item.attachments && item.attachments.length > 0 && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              附件: {item.attachments.map((attachment) => attachment.name).join(", ")}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatZhDateTime(item.createdAt)}</p>
                        </div>
                      ))
                  ) : (
                    <p className="text-slate-500 dark:text-slate-400">暂无人工消息。</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="agent" className="space-y-3">
              <Card className={sectionCardClass}>
                <CardHeader className="cursor-pointer select-none" onClick={() => toggleSection("nodeConfig")}>
                  <CardTitle className="flex items-center gap-1.5">
                    {collapsedSections.has("nodeConfig") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    节点配置编辑
                  </CardTitle>
                </CardHeader>
                {!collapsedSections.has("nodeConfig") && <CardContent className="space-y-2">
                  <Input
                    value={nodeDraft?.name ?? ""}
                    onChange={(event) => setNodeDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                    placeholder="Agent 名称"
                  />
                  <Input
                    value={nodeDraft?.description ?? ""}
                    onChange={(event) =>
                      setNodeDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                    }
                    placeholder="描述"
                  />
                  <Input
                    value={nodeDraft?.responsibility ?? ""}
                    onChange={(event) =>
                      setNodeDraft((prev) => (prev ? { ...prev, responsibility: event.target.value } : prev))
                    }
                    placeholder="职责"
                  />
                  <Textarea
                    value={nodeDraft?.systemPrompt ?? ""}
                    onChange={(event) =>
                      setNodeDraft((prev) => (prev ? { ...prev, systemPrompt: event.target.value } : prev))
                    }
                    placeholder="System Prompt"
                    className="min-h-[88px] rounded-2xl"
                  />
                  <Textarea
                    value={nodeDraft?.additionalPrompt ?? ""}
                    onChange={(event) =>
                      setNodeDraft((prev) => (prev ? { ...prev, additionalPrompt: event.target.value } : prev))
                    }
                    placeholder="Additional Prompt"
                    className="min-h-[72px] rounded-2xl"
                  />

                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={nodeDraft?.useWorkspaceModelDefault ?? true}
                      onChange={(event) =>
                        setNodeDraft((prev) =>
                          prev ? { ...prev, useWorkspaceModelDefault: event.target.checked } : prev,
                        )
                      }
                    />
                    使用工作区默认模型配置
                  </label>

                  {!nodeDraft?.useWorkspaceModelDefault && (
                    <div className={subtlePanelClass}>
                      <select
                        value={nodeProviderSelectValue}
                        onChange={(event) =>
                          setNodeDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  provider: event.target.value === "__custom__" ? "custom" : event.target.value,
                                }
                              : prev,
                          )
                        }
                        className="h-10 w-full rounded-2xl border border-black/8 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950"
                      >
                        <option value="">请选择 provider</option>
                        {COMMON_PROVIDERS.filter((item) => item.value !== "custom").map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                        <option value="__custom__">自定义 provider</option>
                      </select>

                      {nodeProviderSelectValue === "__custom__" && (
                        <Input
                          value={nodeDraft?.provider ?? ""}
                          onChange={(event) =>
                            setNodeDraft((prev) => (prev ? { ...prev, provider: event.target.value } : prev))
                          }
                          placeholder="输入自定义 provider"
                        />
                      )}

                      {nodeModelCandidates.length > 0 ? (
                        <select
                          value={nodeDraft?.model ?? ""}
                          onChange={(event) =>
                            setNodeDraft((prev) => (prev ? { ...prev, model: event.target.value } : prev))
                          }
                          className="h-10 w-full rounded-2xl border border-black/8 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950"
                        >
                          <option value="">请选择模型</option>
                          {nodeModelCandidates.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={nodeDraft?.model ?? ""}
                          onChange={(event) => setNodeDraft((prev) => (prev ? { ...prev, model: event.target.value } : prev))}
                          placeholder="model"
                        />
                      )}
                      <Input
                        value={nodeDraft?.credentialId ?? ""}
                        onChange={(event) =>
                          setNodeDraft((prev) => (prev ? { ...prev, credentialId: event.target.value } : prev))
                        }
                        placeholder="API 凭证 ID（引用）"
                      />
                      <Input
                        type="number"
                        value={nodeDraft?.temperature ?? 0.2}
                        onChange={(event) =>
                          setNodeDraft((prev) =>
                            prev ? { ...prev, temperature: Number(event.target.value || 0) } : prev,
                          )
                        }
                        placeholder="temperature"
                      />
                    </div>
                  )}

                  <label className="space-y-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">工具策略</span>
                    <select
                      value={nodeDraft?.toolPolicy ?? "allowed"}
                      onChange={(event) =>
                        setNodeDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                toolPolicy: event.target.value as "disabled" | "allowed" | "required",
                              }
                            : prev,
                        )
                      }
                      className="h-10 w-full rounded-2xl border border-black/8 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950"
                    >
                      <option value="disabled">disabled（禁用工具）</option>
                      <option value="allowed">allowed（按需可用）</option>
                      <option value="required">required（必须使用工具）</option>
                    </select>
                  </label>

                  <Input
                    value={nodeDraft?.outputPath ?? ""}
                    onChange={(event) =>
                      setNodeDraft((prev) => (prev ? { ...prev, outputPath: event.target.value } : prev))
                    }
                    placeholder="最终输出文件路径（可选，例如 outputs/final.md）"
                  />

                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={nodeDraft?.allowHumanInput ?? true}
                      onChange={(event) =>
                        setNodeDraft((prev) => (prev ? { ...prev, allowHumanInput: event.target.checked } : prev))
                      }
                    />
                    允许人工输入
                  </label>

                  <p className="text-xs text-slate-500 dark:text-slate-400">当前生效模型: {effectiveModelLabel}</p>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void onSaveNodeConfig()} disabled={savingConfig || !nodeDraft} className="h-9">
                      {savingConfig ? "保存中..." : activeRun?.id ? "保存修改（同步后端）" : "保存修改（本地）"}
                    </Button>
                    <Button variant="secondary" onClick={onSaveAsTemplate} disabled={!nodeDraft} className="h-9">
                      保存为新节点模板
                    </Button>
                  </div>
                  {configSaved && <p className="text-xs text-emerald-600 dark:text-emerald-300">{configSaved}</p>}
                </CardContent>}
              </Card>

              <Card className={sectionCardClass}>
                <CardHeader className="cursor-pointer select-none" onClick={() => toggleSection("execMode")}>
                  <CardTitle className="flex items-center gap-1.5">
                    {collapsedSections.has("execMode") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    执行模式
                  </CardTitle>
                </CardHeader>
                {!collapsedSections.has("execMode") && <CardContent className="space-y-3">
                  <select
                    className="h-10 w-full rounded-2xl border border-black/8 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950"
                    value={nodeDraft?.executionMode ?? "standard"}
                    onChange={(event) => {
                      const mode = event.target.value as "standard" | "dev" | "script";
                      setNodeDraft((prev) => {
                        if (!prev) return prev;
                        const wsId = (mode === "dev" || mode === "script") && !prev.workspaceId && selectedNode
                          ? `ws_${selectedNode.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`
                          : prev.workspaceId;
                        return { ...prev, executionMode: mode, workspaceId: wsId };
                      });
                    }}
                  >
                    <option value="standard">标准模式 — LLM Agent 执行</option>
                    <option value="dev">开发模式 — 脚本 / 代码执行</option>
                    <option value="script">脚本节点 — 命令模板执行</option>
                  </select>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {nodeDraft?.executionMode === "dev"
                      ? "节点将运行 Workspace 中的脚本，而非调用 LLM。"
                      : nodeDraft?.executionMode === "script"
                      ? "节点将执行命令模板，输入参数自动注入 {key} 占位符。"
                      : "节点将通过 LLM Adapter 执行 Agent 任务。"}
                  </p>

                  {(nodeDraft?.executionMode === "dev" || nodeDraft?.executionMode === "script") && (
                    <div className={subtlePanelClass}>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 dark:text-slate-400">Workspace</span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">{nodeDraft?.workspaceId || "(未创建)"}</span>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {nodeDraft?.executionMode === "dev" && (
                          <Input
                            value={nodeDraft.entryFile}
                            onChange={(event) =>
                              setNodeDraft((prev) => (prev ? { ...prev, entryFile: event.target.value } : prev))
                            }
                            placeholder="入口文件（如: main.py）"
                            className="text-sm"
                          />
                        )}
                        <Input
                          value={nodeDraft?.runCommand ?? ""}
                          onChange={(event) =>
                            setNodeDraft((prev) => (prev ? { ...prev, runCommand: event.target.value } : prev))
                          }
                          placeholder={nodeDraft?.executionMode === "script"
                            ? "命令模板（如: python -m cli {stage} --input {input}）"
                            : "执行命令（如: python main.py）"
                          }
                          className="text-sm"
                        />
                      </div>
                      {nodeDraft?.workspaceId && (
                        <Link
                          href={`/agent-dev/${nodeDraft.workspaceId}?entryFile=${encodeURIComponent(nodeDraft.entryFile ?? "")}&runCommand=${encodeURIComponent(nodeDraft.runCommand ?? "")}`}
                          className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 text-sm font-medium text-white transition hover:bg-indigo-600"
                        >
                          进入开发台
                        </Link>
                      )}
                    </div>
                  )}

                  <Button onClick={() => void onSaveNodeConfig()} disabled={savingConfig || !nodeDraft} className="h-9">
                    {savingConfig ? "保存中..." : "保存执行配置"}
                  </Button>
                </CardContent>}
              </Card>

              <div>
                <div
                  className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                  onClick={() => toggleSection("toolBind")}
                >
                  {collapsedSections.has("toolBind") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  工具绑定
                </div>
                {!collapsedSections.has("toolBind") && (
                  <ToolBindingsSection role={selectedNode.role} runId={activeRun?.id} nodeId={selectedNode.id} />
                )}
              </div>
              <div>
                <div
                  className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                  onClick={() => toggleSection("skillBind")}
                >
                  {collapsedSections.has("skillBind") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Skill 绑定
                </div>
                {!collapsedSections.has("skillBind") && (
                  <SkillBindingsSection runId={activeRun?.id} nodeId={selectedNode.id} />
                )}
              </div>

              <Card className={sectionCardClass}>
                <CardHeader className="cursor-pointer select-none" onClick={() => toggleSection("docUpload")}>
                  <CardTitle className="flex items-center gap-1.5">
                    {collapsedSections.has("docUpload") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Markdown 资产上传
                  </CardTitle>
                </CardHeader>
                {!collapsedSections.has("docUpload") && <CardContent className="space-y-2">
                  {!activeRun?.id && (
                    <p className="text-xs text-amber-600 dark:text-amber-300">请先启动一次运行，再上传到该运行节点。</p>
                  )}
                  <div className="flex gap-2">
                    <select
                      value={docType}
                      onChange={(event) => setDocType(event.target.value as "prompt" | "skill" | "reference")}
                      className="h-10 rounded-2xl border border-black/8 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950"
                      disabled={!activeRun?.id}
                    >
                      <option value="prompt">prompt</option>
                      <option value="skill">skill</option>
                      <option value="reference">reference</option>
                    </select>
                    <input
                      type="file"
                      accept=".md"
                      className="text-sm"
                      disabled={!activeRun?.id}
                      onChange={(event) => void onUploadDocument(event.target.files?.[0])}
                    />
                  </div>

                  <div className="space-y-2">
                    {documents.map((doc) => (
                      <div key={doc.id} className={subtlePanelClass}>
                        <p className="font-medium">
                          [{doc.type}] {doc.name}
                        </p>
                        <p className="mt-1 line-clamp-3 text-slate-600 dark:text-slate-300">{doc.content}</p>
                        <div className="mt-1 flex justify-end">
                          <Button variant="ghost" size="sm" onClick={() => void onDeleteDocument(doc.id)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    ))}
                    {documents.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">暂无文档资产</p>}
                  </div>
                </CardContent>}
              </Card>

              <Card className={sectionCardClass}>
                <CardHeader className="cursor-pointer select-none" onClick={() => toggleSection("humanMsg")}>
                  <CardTitle className="flex items-center gap-1.5">
                    {collapsedSections.has("humanMsg") ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {selectedNode.role === "input" || selectedNode.role === "human" ? "输入节点消息" : "发送指令给当前节点"}
                  </CardTitle>
                </CardHeader>
                {!collapsedSections.has("humanMsg") && <CardContent className="space-y-2">
                  <Textarea
                    value={humanInput}
                    onChange={(event) => setHumanInput(event.target.value)}
                    placeholder={
                      selectedNode.role === "input" || selectedNode.role === "human"
                        ? "输入内容，作为工作流入口传给下游节点"
                        : selectedNode.role === "output"
                          ? "Output 节点通常不需要人工消息，可用于补充输出约束"
                          : "输入你希望该节点遵循的补充要求"
                    }
                    className="min-h-[88px] rounded-2xl"
                  />
                  <div className="space-y-1">
                    <input
                      type="file"
                      multiple
                      accept="image/*,.txt,.md,.pdf,.json,.csv"
                      onChange={(event) => setHumanFiles(Array.from(event.target.files ?? []))}
                      className="text-sm"
                      disabled={!activeRun?.id}
                    />
                    {humanFiles.length > 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        已选择附件: {humanFiles.map((item) => item.name).join(", ")}
                      </p>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={rerunAfterSend}
                      onChange={(event) => setRerunAfterSend(event.target.checked)}
                    />
                    发送后立即从当前节点重跑（包含下游）
                  </label>
                  {agentError && <p className="text-xs text-rose-600 dark:text-rose-300">{agentError}</p>}
                  {sendStatus && <p className="text-xs text-emerald-600 dark:text-emerald-300">{sendStatus}</p>}
                  <Button
                    onClick={onSendHumanMessage}
                    disabled={sending || (!humanInput.trim() && humanFiles.length === 0) || !activeRun?.id}
                    className="h-9 min-w-[120px]"
                  >
                    {sending ? "发送中..." : selectedNode.role === "input" || selectedNode.role === "human" ? "发送输入" : "发送指令"}
                  </Button>
                </CardContent>}
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      )}
    </aside>
  );
}
