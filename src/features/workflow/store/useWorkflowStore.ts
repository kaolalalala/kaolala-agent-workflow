import { create } from "zustand";

import {
  AgentContextView,
  AgentNode,
  AgentRole,
  HumanMessageView,
  NodeStatus,
  NodeTemplate,
  RunEvent,
  RunInfo,
  TaskItem,
  WorkflowEdge,
  WorkflowMessage,
} from "@/features/workflow/types";
import { NODE_LIBRARY_ROLES, ROLE_LABELS, ROLE_RESPONSIBILITY } from "@/features/workflow/constants";
import type { FrontendSnapshot, RunDiagnosticsView } from "@/features/workflow/adapters/runtime-client";
import { makeId, nowIso } from "@/lib/utils";

type InspectorTab = "overview" | "responsibility" | "task" | "status" | "logs" | "agent" | "dev";
type BottomTab = "events" | "output" | "diagnostics";
export type ThemeMode = "light" | "dark";

interface WorkflowState {
  nodes: AgentNode[];
  edges: WorkflowEdge[];
  tasks: TaskItem[];
  events: RunEvent[];
  messages: WorkflowMessage[];
  nodeContextsByNodeId: Record<string, AgentContextView>;
  lastAppliedRunEventSeqByRunId: Record<string, number>;
  nodeTemplates: NodeTemplate[];
  agentNodeTemplates: NodeTemplate[];
  selectedNodeId?: string;
  rootTaskInput: string;
  finalOutput: string;
  activeRun: RunInfo | null;
  currentWorkflow:
    | {
        workflowId: string;
        projectId?: string;
        name: string;
        updatedAt?: string;
        currentVersionId?: string;
        currentVersionNumber?: number;
        publishedVersionId?: string;
        publishedVersionNumber?: number;
        isDirty: boolean;
      }
    | null;
  runDiagnostics: RunDiagnosticsView | null;
  inspectorTab: InspectorTab;
  bottomTab: BottomTab;
  bottomPanelCollapsed: boolean;
  themeMode: ThemeMode;
  focusNodeRequest: { nodeId: string; nonce: number } | null;
}

interface WorkflowActions {
  setRootTaskInput: (value: string) => void;
  setNodes: (nodes: AgentNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  setTasks: (tasks: TaskItem[]) => void;
  setAgentNodeTemplates: (templates: NodeTemplate[]) => void;
  setMessages: (messages: WorkflowMessage[]) => void;
  setWorkflowData: (payload: { nodes: AgentNode[]; edges: WorkflowEdge[]; tasks: TaskItem[] }) => void;
  setRuntimeSnapshot: (snapshot: FrontendSnapshot) => void;
  applyRuntimeEvent: (event: RunEvent) => void;
  addNode: (
    role: AgentRole,
    position?: { x: number; y: number },
    overrides?: Partial<Pick<AgentNode, "name" | "taskSummary" | "responsibilitySummary" | "taskBrief">>,
  ) => AgentNode;
  addNodeFromTemplate: (templateId: string, position?: { x: number; y: number }) => AgentNode | null;
  saveNodeAsTemplate: (
    nodeId: string,
    overrides?: Partial<Pick<NodeTemplate, "name" | "taskSummary" | "responsibilitySummary">>,
  ) => NodeTemplate | null;
  updateNodeDetails: (nodeId: string, patch: Partial<Pick<AgentNode, "name" | "taskSummary" | "responsibilitySummary" | "taskBrief">>) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  connectNodes: (sourceNodeId: string, targetNodeId: string, type?: WorkflowEdge["type"]) => void;
  updateEdge: (edgeId: string, patch: Partial<Pick<WorkflowEdge, "type" | "condition" | "maxIterations" | "convergenceKeyword">>) => void;
  selectNode: (nodeId?: string) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodeSize: (nodeId: string, size: { width: number; height: number }) => void;
  setNodeStatus: (nodeId: string, status: NodeStatus, partial?: Partial<AgentNode>) => void;
  setRun: (run: RunInfo | null) => void;
  setCurrentWorkflow: (
    workflow:
      | {
          workflowId: string;
          projectId?: string;
          name: string;
          updatedAt?: string;
          currentVersionId?: string;
          currentVersionNumber?: number;
          publishedVersionId?: string;
          publishedVersionNumber?: number;
          isDirty?: boolean;
        }
      | null,
  ) => void;
  markWorkflowDirty: () => void;
  setRunDiagnostics: (diagnostics: RunDiagnosticsView | null) => void;
  setRunStatus: (status: RunInfo["status"]) => void;
  addEvent: (event: RunEvent) => void;
  clearEvents: () => void;
  setFinalOutput: (value: string) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setBottomTab: (tab: BottomTab) => void;
  toggleBottomPanel: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
  requestFocusNode: (nodeId: string) => void;
  relatedNodeIds: () => Set<string>;
  autoLayoutNodes: () => void;
}

type WorkflowStore = WorkflowState & WorkflowActions;

const defaultTemplates: NodeTemplate[] = NODE_LIBRARY_ROLES.map((item) => ({
  id: `tpl_builtin_${item.role}`,
  name: `${ROLE_LABELS[item.role]}模板`,
  role: item.role,
  responsibilitySummary: ROLE_RESPONSIBILITY[item.role],
  taskSummary: "待分配任务",
  builtIn: true,
  disabled: item.disabled,
  source: "node_template",
}));

const initialState: WorkflowState = {
  nodes: [],
  edges: [],
  tasks: [],
  events: [],
  messages: [],
  nodeContextsByNodeId: {},
  lastAppliedRunEventSeqByRunId: {},
  nodeTemplates: defaultTemplates,
  agentNodeTemplates: [],
  selectedNodeId: undefined,
  rootTaskInput: "多代理协作模式调研",
  finalOutput: "",
  activeRun: null,
  currentWorkflow: null,
  runDiagnostics: null,
  inspectorTab: "overview",
  bottomTab: "events",
  bottomPanelCollapsed: true,
  themeMode: "light",
  focusNodeRequest: null,
};

function rebuildRelations(nodes: AgentNode[], edges: WorkflowEdge[]) {
  const nextNodes = nodes.map((node) => ({
    ...node,
    upstreamIds: [] as string[],
    downstreamIds: [] as string[],
  }));
  const byId = new Map(nextNodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    byId.get(edge.sourceNodeId)?.downstreamIds.push(edge.targetNodeId);
    byId.get(edge.targetNodeId)?.upstreamIds.push(edge.sourceNodeId);
  }

  return nextNodes;
}

function upsertWorkflowMessageList(
  list: WorkflowMessage[],
  message: WorkflowMessage,
  limit = 30,
) {
  const deduped = [...list.filter((item) => item.id !== message.id), message];
  return deduped.slice(-limit);
}

function normalizeWorkflowMessageList(list: WorkflowMessage[], limit = 30) {
  const seen = new Set<string>();
  const orderedReversed: WorkflowMessage[] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    orderedReversed.push(item);
  }
  return orderedReversed.reverse().slice(-limit);
}

function upsertHumanMessageList(
  list: HumanMessageView[],
  message: HumanMessageView,
  limit = 20,
) {
  const deduped = [...list.filter((item) => item.id !== message.id), message];
  return deduped.slice(-limit);
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  ...initialState,
  setRootTaskInput: (value) =>
    set((state) => ({
      rootTaskInput: value,
      currentWorkflow:
        state.currentWorkflow && state.rootTaskInput !== value
          ? { ...state.currentWorkflow, isDirty: true }
          : state.currentWorkflow,
    })),
  setNodes: (nodes) =>
    set((state) => ({
      nodes: rebuildRelations(nodes, state.edges),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    })),
  setEdges: (edges) =>
    set((state) => ({
      edges,
      nodes: rebuildRelations(state.nodes, edges),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    })),
  setTasks: (tasks) => set({ tasks }),
  setAgentNodeTemplates: (templates) =>
    set(() => ({
      agentNodeTemplates: templates,
    })),
  setMessages: (messages) => set({ messages }),
  setWorkflowData: ({ nodes, edges, tasks }) =>
    set((state) => ({
      nodes: rebuildRelations(nodes, edges),
      edges,
      tasks,
      events: [],
      messages: [],
      nodeContextsByNodeId: {},
      lastAppliedRunEventSeqByRunId: {},
      finalOutput: "",
      activeRun: null,
      runDiagnostics: null,
      selectedNodeId: undefined,
      inspectorTab: "overview",
      bottomTab: "events",
      nodeTemplates: state.nodeTemplates,
      agentNodeTemplates: state.agentNodeTemplates,
    })),
  setRuntimeSnapshot: (snapshot) =>
    set((state) => ({
      nodes: rebuildRelations(snapshot.nodes, snapshot.edges),
      edges: snapshot.edges,
      tasks: snapshot.tasks,
      events: snapshot.events,
      messages: snapshot.messages,
      nodeContextsByNodeId: snapshot.nodeContextsByNodeId,
      lastAppliedRunEventSeqByRunId: snapshot.run.id
        ? {
            ...state.lastAppliedRunEventSeqByRunId,
            [snapshot.run.id]: snapshot.events.reduce((max, event) => Math.max(max, event.runEventSeq ?? 0), 0),
          }
        : state.lastAppliedRunEventSeqByRunId,
      activeRun: snapshot.run,
      finalOutput: snapshot.output,
      runDiagnostics: state.runDiagnostics,
      selectedNodeId:
        state.selectedNodeId && snapshot.nodes.find((node) => node.id === state.selectedNodeId)
          ? state.selectedNodeId
          : undefined,
      inspectorTab: state.selectedNodeId ? state.inspectorTab : "overview",
      bottomTab: state.bottomTab,
      nodeTemplates: state.nodeTemplates,
    })),
  applyRuntimeEvent: (event) => {
    const runId = get().activeRun?.id;
    if (runId && typeof event.runEventSeq === "number") {
      const lastApplied = get().lastAppliedRunEventSeqByRunId[runId] ?? 0;
      if (event.runEventSeq <= lastApplied) {
        return;
      }
      set((state) => ({
        lastAppliedRunEventSeqByRunId: {
          ...state.lastAppliedRunEventSeqByRunId,
          [runId]: event.runEventSeq as number,
        },
      }));
    }

    get().addEvent(event);

    if (event.type === "run_started") {
      get().setRunStatus("running");
      return;
    }

    if (event.type === "node_started" && event.relatedNodeId) {
      get().setNodeStatus(event.relatedNodeId, "running", {
        blocked: false,
        blockedReason: undefined,
        executionOrder:
          typeof event.payload?.executionOrder === "number"
            ? Number(event.payload.executionOrder)
            : get().nodes.find((node) => node.id === event.relatedNodeId)?.executionOrder,
        lastInput: event.message,
        streamingOutput: "",
      });
      return;
    }

    if (event.type === "token_stream" && event.relatedNodeId) {
      const accumulatedOutput =
        typeof event.payload?.accumulatedOutput === "string"
          ? String(event.payload.accumulatedOutput)
          : undefined;
      const token = accumulatedOutput ?? event.message;

      set((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === event.relatedNodeId
            ? {
                ...node,
                streamingOutput: token,
                lastOutput: token,
                lastUpdatedAt: nowIso(),
              }
            : node,
        ),
      }));

      return;
    }

    if (event.type === "context_resolved" && event.relatedNodeId) {
      const resolvedInput =
        typeof event.payload?.resolvedInput === "string"
          ? String(event.payload.resolvedInput)
          : undefined;
      get().setNodeStatus(event.relatedNodeId, get().nodes.find((node) => node.id === event.relatedNodeId)?.status ?? "ready", {
        blocked: false,
        blockedReason: undefined,
        lastInput: resolvedInput ?? get().nodes.find((node) => node.id === event.relatedNodeId)?.lastInput,
        resolvedInput,
      });
      set((state) => {
        const current = state.nodeContextsByNodeId[event.relatedNodeId as string];
        const base = current ?? {
          id: `ctx_${event.relatedNodeId as string}`,
          nodeId: event.relatedNodeId as string,
          systemPrompt: "",
          taskBrief: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: nowIso(),
        };
        return {
          nodeContextsByNodeId: {
            ...state.nodeContextsByNodeId,
            [event.relatedNodeId as string]: {
              ...base,
              resolvedInput: resolvedInput ?? base.resolvedInput,
              updatedAt: nowIso(),
            },
          },
        };
      });
      return;
    }

    if (event.type === "agent_context_updated" && event.relatedNodeId) {
      const patch = (event.payload?.contextPatch && typeof event.payload.contextPatch === "object")
        ? (event.payload.contextPatch as {
            inboundMessages?: WorkflowMessage[];
            outboundMessages?: WorkflowMessage[];
            resolvedInput?: string;
            recentOutputs?: string[];
            latestSummary?: string;
          })
        : undefined;

      if (!patch) {
        return;
      }

      set((state) => {
        const nodeId = event.relatedNodeId as string;
        const current = state.nodeContextsByNodeId[nodeId];
        const base = current ?? {
          id: `ctx_${nodeId}`,
          nodeId,
          systemPrompt: "",
          taskBrief: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: nowIso(),
        };

        const nextContext = {
          ...base,
          inboundMessages: patch.inboundMessages
            ? normalizeWorkflowMessageList(patch.inboundMessages, 30)
            : base.inboundMessages,
          outboundMessages: patch.outboundMessages
            ? normalizeWorkflowMessageList(patch.outboundMessages, 30)
            : base.outboundMessages,
          resolvedInput: patch.resolvedInput ?? base.resolvedInput,
          recentOutputs: patch.recentOutputs ?? base.recentOutputs,
          latestSummary: patch.latestSummary ?? base.latestSummary,
          updatedAt: nowIso(),
        };

        return {
          nodeContextsByNodeId: {
            ...state.nodeContextsByNodeId,
            [nodeId]: nextContext,
          },
          nodes: state.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  inboundMessages: nextContext.inboundMessages,
                  outboundMessages: nextContext.outboundMessages,
                  resolvedInput: nextContext.resolvedInput,
                  lastInput: nextContext.resolvedInput ?? node.lastInput,
                  lastOutput: nextContext.recentOutputs.at(-1) ?? node.lastOutput,
                  lastUpdatedAt: nowIso(),
                }
              : node,
          ),
        };
      });
      return;
    }

    if (event.type === "message_sent") {
      const runId = get().activeRun?.id ?? "";
      const fromNodeId = typeof event.payload?.fromNodeId === "string" ? String(event.payload.fromNodeId) : undefined;
      const toNodeId = typeof event.payload?.toNodeId === "string" ? String(event.payload.toNodeId) : event.relatedNodeId;
      const payloadMessage = (event.payload?.message && typeof event.payload.message === "object")
        ? (event.payload.message as WorkflowMessage)
        : undefined;
      const content = typeof payloadMessage?.content === "string"
        ? payloadMessage.content
        : (typeof event.payload?.content === "string" ? String(event.payload.content) : event.message);
      const messageType =
        payloadMessage?.type === "task_assignment" || payloadMessage?.type === "result"
          ? payloadMessage.type
          : (event.payload?.messageType === "task_assignment" || event.payload?.messageType === "result"
            ? event.payload.messageType
            : "result");
      const messageId = typeof payloadMessage?.id === "string"
        ? payloadMessage.id
        : (typeof event.payload?.messageId === "string" ? String(event.payload.messageId) : makeId("msg"));

      if (!fromNodeId || !toNodeId || !runId) {
        return;
      }

      const message: WorkflowMessage = {
        id: messageId,
        runId,
        fromNodeId,
        toNodeId,
        type: messageType,
        content,
        payload: payloadMessage?.payload,
        createdAt: event.time,
      };

      set((state) => {
        // 更新发送方节点的 outboundMessages
        const fromCtx = state.nodeContextsByNodeId[fromNodeId];
        const nextFromCtx = fromCtx
          ? {
              ...fromCtx,
              outboundMessages: upsertWorkflowMessageList(fromCtx.outboundMessages, message),
              updatedAt: nowIso(),
            }
          : {
              id: `ctx_${fromNodeId}`,
              nodeId: fromNodeId,
              systemPrompt: "",
              taskBrief: "",
              inboundMessages: [],
              outboundMessages: [message],
              resolvedInput: "",
              humanMessages: [],
              recentOutputs: [],
              updatedAt: nowIso(),
            };

        // 同时更新接收方节点的 inboundMessages，不等待 message_delivered 事件
        const toCtx = state.nodeContextsByNodeId[toNodeId];
        const nextToCtx = toCtx
          ? {
              ...toCtx,
              inboundMessages: upsertWorkflowMessageList(toCtx.inboundMessages, message),
              updatedAt: nowIso(),
            }
          : {
              id: `ctx_${toNodeId}`,
              nodeId: toNodeId,
              systemPrompt: "",
              taskBrief: "",
              inboundMessages: [message],
              outboundMessages: [],
              resolvedInput: "",
              humanMessages: [],
              recentOutputs: [],
              updatedAt: nowIso(),
            };

        return {
          messages: state.messages.some((item) => item.id === message.id)
            ? state.messages
            : [...state.messages, message],
          nodeContextsByNodeId: {
            ...state.nodeContextsByNodeId,
            [fromNodeId]: nextFromCtx,
            [toNodeId]: nextToCtx,
          },
          nodes: state.nodes.map((node) => {
            if (node.id === fromNodeId) {
              return {
                ...node,
                outboundMessages: upsertWorkflowMessageList(node.outboundMessages ?? [], message),
                lastUpdatedAt: nowIso(),
              };
            }
            if (node.id === toNodeId) {
              return {
                ...node,
                inboundMessages: upsertWorkflowMessageList(node.inboundMessages ?? [], message),
                lastUpdatedAt: nowIso(),
              };
            }
            return node;
          }),
        };
      });
      return;
    }

    if (event.type === "message_delivered" && event.relatedNodeId) {
      const runId = get().activeRun?.id ?? "";
      const payloadMessage = (event.payload?.message && typeof event.payload.message === "object")
        ? (event.payload.message as WorkflowMessage)
        : undefined;
      const deliveredContent = typeof payloadMessage?.content === "string"
        ? payloadMessage.content
        : (typeof event.payload?.content === "string" ? String(event.payload.content) : undefined);
      const fromNodeId = typeof payloadMessage?.fromNodeId === "string"
        ? payloadMessage.fromNodeId
        : (typeof event.payload?.fromNodeId === "string" ? String(event.payload.fromNodeId) : "");
      const toNodeId = typeof payloadMessage?.toNodeId === "string"
        ? payloadMessage.toNodeId
        : (typeof event.payload?.toNodeId === "string" ? String(event.payload.toNodeId) : event.relatedNodeId);
      const messageType =
        payloadMessage?.type === "task_assignment" || payloadMessage?.type === "result"
          ? payloadMessage.type
          : (event.payload?.messageType === "task_assignment" || event.payload?.messageType === "result"
            ? event.payload.messageType
            : "result");
      const messageId = typeof payloadMessage?.id === "string"
        ? payloadMessage.id
        : (typeof event.payload?.messageId === "string" ? String(event.payload.messageId) : makeId("msg"));

      if (!toNodeId || !runId) {
        return;
      }

      const deliveredMessage: WorkflowMessage = {
        id: messageId,
        runId,
        fromNodeId,
        toNodeId,
        type: messageType,
        content: deliveredContent ?? "",
        payload: payloadMessage?.payload,
        createdAt: event.time,
      };

      set((state) => ({
        nodeContextsByNodeId: {
          ...state.nodeContextsByNodeId,
          [toNodeId]: state.nodeContextsByNodeId[toNodeId]
            ? {
                ...state.nodeContextsByNodeId[toNodeId],
                inboundMessages: upsertWorkflowMessageList(
                  state.nodeContextsByNodeId[toNodeId].inboundMessages,
                  deliveredMessage,
                ),
                updatedAt: nowIso(),
              }
            : {
                id: `ctx_${toNodeId}`,
                nodeId: toNodeId,
                systemPrompt: "",
                taskBrief: "",
                inboundMessages: [deliveredMessage],
                outboundMessages: [],
                resolvedInput: "",
                humanMessages: [],
                recentOutputs: [],
                updatedAt: nowIso(),
              },
        },
        nodes: state.nodes.map((node) =>
          node.id === toNodeId
            ? {
                ...node,
                inboundMessages: upsertWorkflowMessageList(node.inboundMessages ?? [], deliveredMessage),
                lastInput: deliveredContent ?? node.lastInput,
                lastUpdatedAt: nowIso(),
              }
            : node,
        ),
      }));
      return;
    }

    if (event.type === "human_message_sent" && event.relatedNodeId) {
      const payloadMessage = event.payload?.humanMessage;
      if (!payloadMessage || typeof payloadMessage !== "object") {
        return;
      }
      const humanMessage = payloadMessage as HumanMessageView;
      set((state) => {
        const current = state.nodeContextsByNodeId[event.relatedNodeId as string];
        const base = current ?? {
          id: `ctx_${event.relatedNodeId as string}`,
          nodeId: event.relatedNodeId as string,
          systemPrompt: "",
          taskBrief: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: nowIso(),
        };
        return {
          nodeContextsByNodeId: {
            ...state.nodeContextsByNodeId,
            [event.relatedNodeId as string]: {
              ...base,
              humanMessages: upsertHumanMessageList(base.humanMessages ?? [], humanMessage),
              updatedAt: nowIso(),
            },
          },
        };
      });
      return;
    }

    if (event.type === "node_ready" && event.relatedNodeId) {
      get().setNodeStatus(event.relatedNodeId, "ready", {
        blocked: false,
        blockedReason: undefined,
        executionOrder:
          typeof event.payload?.executionOrder === "number"
            ? Number(event.payload.executionOrder)
            : get().nodes.find((node) => node.id === event.relatedNodeId)?.executionOrder,
      });
      return;
    }

    if (event.type === "node_waiting" && event.relatedNodeId) {
      get().setNodeStatus(event.relatedNodeId, "waiting", {
        blocked: true,
        blockedReason:
          typeof event.payload?.blockedReason === "string"
            ? String(event.payload.blockedReason)
            : event.message,
        executionOrder:
          typeof event.payload?.executionOrder === "number"
            ? Number(event.payload.executionOrder)
            : get().nodes.find((node) => node.id === event.relatedNodeId)?.executionOrder,
      });
      return;
    }

    if ((event.type === "node_rerun_started" || event.type === "downstream_rerun_started") && event.relatedNodeId) {
      get().setRunStatus("running");
      get().setNodeStatus(event.relatedNodeId, "running", {
        blocked: false,
        blockedReason: undefined,
      });
      return;
    }

    if (event.type === "task_assigned" && event.relatedNodeId) {
      const node = get().nodes.find((item) => item.id === event.relatedNodeId);
      if (node && node.status === "idle") {
        get().setNodeStatus(event.relatedNodeId, "ready", { blocked: false, blockedReason: undefined });
      }
      return;
    }

    if (event.type === "node_completed" && event.relatedNodeId) {
      get().setNodeStatus(event.relatedNodeId, "completed", {
        blocked: false,
        blockedReason: undefined,
        lastOutput: String(event.payload?.output ?? event.message),
        streamingOutput: undefined,
      });
      const latestOutput = String(event.payload?.output ?? event.message);
      set((state) => {
        const current = state.nodeContextsByNodeId[event.relatedNodeId as string];
        const base = current ?? {
          id: `ctx_${event.relatedNodeId as string}`,
          nodeId: event.relatedNodeId as string,
          systemPrompt: "",
          taskBrief: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: nowIso(),
        };
        const nextRecentOutputs = (() => {
          const prev = base.recentOutputs ?? [];
          if (prev.at(-1) === latestOutput) {
            return prev.slice(-8);
          }
          return [...prev, latestOutput].slice(-8);
        })();
        return {
          nodeContextsByNodeId: {
            ...state.nodeContextsByNodeId,
            [event.relatedNodeId as string]: {
              ...base,
              recentOutputs: nextRecentOutputs,
              latestSummary: latestOutput,
              updatedAt: nowIso(),
            },
          },
        };
      });
      return;
    }

    if (event.type === "node_failed" && event.relatedNodeId) {
      get().setNodeStatus(event.relatedNodeId, "failed", {
        blocked: true,
        retryCount: 1,
        blockedReason:
          typeof event.payload?.blockedReason === "string"
            ? String(event.payload.blockedReason)
            : undefined,
        lastError: event.message,
        streamingOutput: undefined,
      });
      return;
    }

    if (event.type === "run_completed") {
      get().setRunStatus("completed");
      get().setFinalOutput(String(event.payload?.output ?? event.message));
      return;
    }

    if (event.type === "run_failed") {
      get().setRunStatus("failed");
      get().setFinalOutput(event.message);
      return;
    }

    if (event.type === "node_rerun_requested") {
      get().setRunStatus("running");
    }

    // Loop events — reset loop segment nodes back to running
    if (event.type === "loop_iteration" && event.relatedNodeId) {
      const loopSegment = Array.isArray(event.payload?.loopSegment) ? (event.payload.loopSegment as string[]) : [];
      if (loopSegment.length > 0) {
        set((state) => ({
          nodes: state.nodes.map((node) =>
            loopSegment.includes(node.id)
              ? { ...node, status: "ready" as NodeStatus, blocked: false, blockedReason: undefined, streamingOutput: undefined, lastUpdatedAt: nowIso() }
              : node,
          ),
        }));
      }
    }
  },
  addNode: (role, position = { x: 180, y: 220 }, overrides) => {
    const index = get().nodes.filter((node) => node.role === role).length + 1;
    const now = nowIso();
    const nextNode: AgentNode = {
      id: makeId("node"),
      name: overrides?.name?.trim() || `${ROLE_LABELS[role]}-${index}`,
      role,
      status: "idle",
      taskSummary: overrides?.taskSummary?.trim() || "待分配任务",
      responsibilitySummary: overrides?.responsibilitySummary?.trim() || ROLE_RESPONSIBILITY[role],
      position,
      width: 200,
      height: 140,
      upstreamIds: [],
      downstreamIds: [],
      createdAt: now,
      lastUpdatedAt: now,
      blocked: false,
      retryCount: 0,
      blockedReason: undefined,
      executionOrder: undefined,
      lastInput: "",
      lastOutput: "",
      inboundMessages: [],
      outboundMessages: [],
      resolvedInput: "",
      taskBrief: overrides?.taskBrief ?? "",
    };

    set((state) => ({
      nodes: [...state.nodes, nextNode],
      activeRun: null,
      finalOutput: "",
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    }));
    get().addEvent({
      id: makeId("event"),
      time: nowIso(),
      type: "node_created",
      relatedNodeId: nextNode.id,
      message: `${nextNode.name} 已创建`,
    });

    return nextNode;
  },
  addNodeFromTemplate: (templateId, position) => {
    const template = [...get().nodeTemplates, ...get().agentNodeTemplates].find((item) => item.id === templateId);
    if (!template || template.disabled) {
      return null;
    }
    return get().addNode(template.role, position, {
      name: template.name,
      taskSummary: template.taskSummary,
      responsibilitySummary: template.responsibilitySummary,
      taskBrief: template.defaultPrompt ?? "",
    });
  },
  saveNodeAsTemplate: (nodeId, overrides) => {
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) {
      return null;
    }

    const template: NodeTemplate = {
      id: makeId("tpl"),
      name: overrides?.name?.trim() || `${node.name}-模板`,
      role: node.role,
      responsibilitySummary: overrides?.responsibilitySummary?.trim() || node.responsibilitySummary,
      taskSummary: overrides?.taskSummary?.trim() || node.taskSummary,
      builtIn: false,
      source: "node_template",
    };

    set((state) => ({ nodeTemplates: [...state.nodeTemplates, template] }));
    get().addEvent({
      id: makeId("event"),
      time: nowIso(),
      type: "node_created",
      relatedNodeId: nodeId,
      message: `已保存节点模板: ${template.name}`,
    });

    return template;
  },
  updateNodeDetails: (nodeId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              ...patch,
              name: patch.name?.trim() || node.name,
              taskSummary: patch.taskSummary?.trim() || node.taskSummary,
              responsibilitySummary: patch.responsibilitySummary?.trim() || node.responsibilitySummary,
              taskBrief: patch.taskBrief ?? node.taskBrief,
              lastUpdatedAt: nowIso(),
            }
          : node,
      ),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    }));
  },
  deleteNode: (nodeId) => {
    set((state) => {
      const nextNodes = state.nodes.filter((node) => node.id !== nodeId);
      const nextEdges = state.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId);
      const { [nodeId]: removedContext, ...restContexts } = state.nodeContextsByNodeId;
      void removedContext;

      return {
        nodes: rebuildRelations(nextNodes, nextEdges),
        edges: nextEdges,
        nodeContextsByNodeId: restContexts,
        selectedNodeId: state.selectedNodeId === nodeId ? undefined : state.selectedNodeId,
        activeRun: null,
        finalOutput: "",
        currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
      };
    });

    get().addEvent({
      id: makeId("event"),
      time: nowIso(),
      type: "node_failed",
      relatedNodeId: nodeId,
      message: "节点已删除",
    });
  },
  deleteEdge: (edgeId) => {
    const edge = get().edges.find((item) => item.id === edgeId);
    if (!edge) {
      return;
    }

    set((state) => {
      const nextEdges = state.edges.filter((item) => item.id !== edgeId);
      return {
        edges: nextEdges,
        nodes: rebuildRelations(state.nodes, nextEdges),
        activeRun: null,
        finalOutput: "",
        currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
      };
    });

    get().addEvent({
      id: makeId("event"),
      time: nowIso(),
      type: "edge_deleted",
      relatedNodeId: edge.targetNodeId,
      message: `已删除连线 ${edge.sourceNodeId} -> ${edge.targetNodeId}`,
    });
  },
  connectNodes: (sourceNodeId, targetNodeId, type = "task_flow") => {
    if (sourceNodeId === targetNodeId) {
      return;
    }
    const snapshot = get();
    const sourceNode = snapshot.nodes.find((node) => node.id === sourceNodeId);
    const targetNode = snapshot.nodes.find((node) => node.id === targetNodeId);
    if (!sourceNode || !targetNode) {
      return;
    }
    if (sourceNode.role === "output" || targetNode.role === "input") {
      return;
    }
    if (snapshot.edges.some((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId)) {
      return;
    }

    // Auto-detect back-edge: if target can reach source via existing forward edges, this creates a cycle
    let resolvedType = type;
    if (type === "task_flow") {
      const forwardEdges = snapshot.edges.filter((e) => e.type !== "loop_back");
      const visited = new Set<string>();
      const queue = [targetNodeId];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur === sourceNodeId) {
          resolvedType = "loop_back";
          break;
        }
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const e of forwardEdges) {
          if (e.sourceNodeId === cur && !visited.has(e.targetNodeId)) {
            queue.push(e.targetNodeId);
          }
        }
      }
    }

    set((state) => {
      const edge: WorkflowEdge = {
        id: makeId("edge"),
        sourceNodeId,
        targetNodeId,
        type: resolvedType,
        ...(resolvedType === "loop_back" ? { maxIterations: 3 } : {}),
      };
      const edges = [...state.edges, edge];
      return {
        edges,
        nodes: rebuildRelations(state.nodes, edges),
        activeRun: null,
        finalOutput: "",
        currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
      };
    });

    get().addEvent({
      id: makeId("event"),
      time: nowIso(),
      type: "edge_created",
      relatedNodeId: targetNodeId,
      message: resolvedType === "loop_back"
        ? `已创建回环连线 ${sourceNodeId} -> ${targetNodeId} (最多 3 次迭代)`
        : `已连接 ${sourceNodeId} -> ${targetNodeId}`,
    });
  },
  updateEdge: (edgeId, patch) => {
    set((state) => ({
      edges: state.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, ...patch } : edge,
      ),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    }));
  },
  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setNodePosition: (nodeId, position) => {
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, position, lastUpdatedAt: nowIso() } : node)),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    }));
  },
  setNodeSize: (nodeId, size) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              width: size.width,
              height: size.height,
              lastUpdatedAt: nowIso(),
            }
          : node,
      ),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    }));
  },
  setNodeStatus: (nodeId, status, partial) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...partial, status, lastUpdatedAt: nowIso() } : node,
      ),
    }));
  },
  setRun: (run) => set({ activeRun: run }),
  setCurrentWorkflow: (workflow) =>
    set({
      currentWorkflow: workflow
        ? {
            workflowId: workflow.workflowId,
            projectId: workflow.projectId,
            name: workflow.name,
            updatedAt: workflow.updatedAt,
            currentVersionId: workflow.currentVersionId,
            currentVersionNumber: workflow.currentVersionNumber,
            publishedVersionId: workflow.publishedVersionId,
            publishedVersionNumber: workflow.publishedVersionNumber,
            isDirty: workflow.isDirty ?? false,
          }
        : null,
    }),
  markWorkflowDirty: () =>
    set((state) => ({
      currentWorkflow: state.currentWorkflow
        ? {
            ...state.currentWorkflow,
            isDirty: true,
          }
        : null,
    })),
  setRunDiagnostics: (runDiagnostics) => set({ runDiagnostics }),
  setRunStatus: (status) => {
    const run = get().activeRun;
    if (!run) {
      return;
    }

    set({
      activeRun: {
        ...run,
        status,
        finishedAt: status === "completed" || status === "failed" || status === "cancelled" ? nowIso() : run.finishedAt,
      },
    });
  },
  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
  clearEvents: () => set({ events: [] }),
  setFinalOutput: (value) => set({ finalOutput: value }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setBottomTab: (tab) => set({ bottomTab: tab }),
  toggleBottomPanel: () => set((state) => ({ bottomPanelCollapsed: !state.bottomPanelCollapsed })),
  setThemeMode: (mode) => set({ themeMode: mode }),
  toggleThemeMode: () => set((state) => ({ themeMode: state.themeMode === "light" ? "dark" : "light" })),
  requestFocusNode: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      focusNodeRequest: { nodeId, nonce: Date.now() },
    }),
  relatedNodeIds: () => {
    const selected = get().selectedNodeId;
    if (!selected) {
      return new Set<string>();
    }

    const visited = new Set<string>([selected]);
    const queue = [selected];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of get().edges) {
        if (edge.sourceNodeId === current && !visited.has(edge.targetNodeId)) {
          visited.add(edge.targetNodeId);
          queue.push(edge.targetNodeId);
        }
        if (edge.targetNodeId === current && !visited.has(edge.sourceNodeId)) {
          visited.add(edge.sourceNodeId);
          queue.push(edge.sourceNodeId);
        }
      }
    }

    return visited;
  },

  autoLayoutNodes: () => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;

    // ---- constants ----
    const NODE_W = 200;
    const NODE_H = 140;
    const GAP_X = 60;   // horizontal gap between columns
    const GAP_Y = 40;   // vertical gap between rows
    const PAD_X = 60;   // canvas left padding
    const PAD_Y = 60;   // canvas top padding
    const COL_W = NODE_W + GAP_X; // column stride
    const ROW_H = NODE_H + GAP_Y; // row stride

    // ---- build adjacency (skip loop_back edges for layout) ----
    const forwardEdges = edges.filter((e) => e.type !== "loop_back");
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const n of nodes) {
      inDegree.set(n.id, 0);
      children.set(n.id, []);
    }
    for (const e of forwardEdges) {
      if (!inDegree.has(e.sourceNodeId) || !inDegree.has(e.targetNodeId)) continue;
      inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
      children.get(e.sourceNodeId)?.push(e.targetNodeId);
    }

    // ---- topological sort into layers (BFS / Kahn) ----
    const layers: string[][] = [];
    const nodeLayer = new Map<string, number>();
    let queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);

    // If no root found (cycle), fallback: use all nodes
    if (queue.length === 0) {
      queue = nodes.map((n) => n.id);
    }

    while (queue.length > 0) {
      layers.push([...queue]);
      for (const id of queue) nodeLayer.set(id, layers.length - 1);
      const next: string[] = [];
      for (const id of queue) {
        for (const child of children.get(id) ?? []) {
          if (nodeLayer.has(child)) continue;
          const deg = (inDegree.get(child) ?? 1) - 1;
          inDegree.set(child, deg);
          if (deg <= 0) next.push(child);
        }
      }
      queue = next;
    }

    // Catch any nodes not assigned (disconnected)
    const unassigned = nodes.filter((n) => !nodeLayer.has(n.id));
    if (unassigned.length > 0) {
      layers.push(unassigned.map((n) => n.id));
      for (const n of unassigned) nodeLayer.set(n.id, layers.length - 1);
    }

    // ---- assign positions ----
    const posMap = new Map<string, { x: number; y: number }>();
    for (let col = 0; col < layers.length; col++) {
      const layer = layers[col];
      const totalH = layer.length * NODE_H + (layer.length - 1) * GAP_Y;
      const startY = PAD_Y + Math.max(0, (3 * ROW_H - totalH) / 2); // center vertically around ~3 rows height
      for (let row = 0; row < layer.length; row++) {
        posMap.set(layer[row], {
          x: PAD_X + col * COL_W,
          y: startY + row * ROW_H,
        });
      }
    }

    set((state) => ({
      nodes: state.nodes.map((node) => {
        const pos = posMap.get(node.id);
        return pos ? { ...node, position: pos, lastUpdatedAt: nowIso() } : node;
      }),
      currentWorkflow: state.currentWorkflow ? { ...state.currentWorkflow, isDirty: true } : null,
    }));
  },
}));
