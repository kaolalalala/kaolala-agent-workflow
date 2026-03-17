"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowInstance,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";

import { AgentNodeCard, AgentNodeData } from "@/features/workflow/components/AgentNodeCard";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";
import { WorkflowEdge } from "@/features/workflow/types";
// ROLE_LABELS moved to AgentNodeCard inline editing

const nodeTypes = {
  agentNode: AgentNodeCard,
};

type ContextMenuState =
  | { type: "pane"; x: number; y: number }
  | { type: "node"; x: number; y: number; nodeId: string }
  | { type: "edge"; x: number; y: number; edgeId: string };

interface WorkflowCanvasProps {
  fitViewNonce?: number;
  zoomInNonce?: number;
  zoomOutNonce?: number;
}

function toFlowEdge(edge: WorkflowEdge, highlighted: Set<string>, isDark: boolean, hoveredEdgeId: string | null): Edge {
  const isRelated = highlighted.has(edge.sourceNodeId) && highlighted.has(edge.targetNodeId);
  const isHovered = hoveredEdgeId === edge.id;
  const isLoopBack = edge.type === "loop_back";

  const label = isLoopBack
    ? `↻ 回环${edge.maxIterations ? ` (≤${edge.maxIterations})` : ""}${edge.convergenceKeyword ? ` [${edge.convergenceKeyword}]` : ""}`
    : edge.condition
      ? `条件：${edge.condition}`
      : undefined;

  const loopColor = isDark ? "#fb923c" : "#ea580c";
  const normalColor = isRelated ? (isDark ? "#5eead4" : "#0f766e") : (isDark ? "#64748b" : "#94a3b8");

  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    animated: isLoopBack || isRelated,
    label,
    labelStyle: {
      fill: isLoopBack ? (isDark ? "#fed7aa" : "#9a3412") : (isDark ? "#dbeafe" : "#1e293b"),
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: isLoopBack
        ? (isDark ? "rgba(124,45,18,0.85)" : "rgba(255,247,237,0.95)")
        : (isDark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)"),
      fillOpacity: 0.92,
    },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 9999,
    style: {
      stroke: isLoopBack ? loopColor : normalColor,
      strokeWidth: isHovered ? 3.6 : isLoopBack ? 2.8 : isRelated ? 3.2 : 1.5,
      strokeDasharray: isLoopBack ? "8 4" : undefined,
      opacity: highlighted.size > 0 && !isRelated ? 0.18 : 0.98,
    },
    markerEnd: isLoopBack
      ? { type: MarkerType.ArrowClosed, color: loopColor }
      : undefined,
  };
}

export function WorkflowCanvas({ fitViewNonce = 0, zoomInNonce = 0, zoomOutNonce = 0 }: WorkflowCanvasProps) {
  const flowRef = useRef<ReactFlowInstance<Node<AgentNodeData>> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const connectHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const focusNodeRequest = useWorkflowStore((state) => state.focusNodeRequest);
  const relatedNodeIds = useWorkflowStore((state) => state.relatedNodeIds);
  const selectNode = useWorkflowStore((state) => state.selectNode);
  const setNodePosition = useWorkflowStore((state) => state.setNodePosition);
  const connectNodes = useWorkflowStore((state) => state.connectNodes);
  const addNode = useWorkflowStore((state) => state.addNode);
  const addNodeFromTemplate = useWorkflowStore((state) => state.addNodeFromTemplate);
  const deleteNode = useWorkflowStore((state) => state.deleteNode);
  const deleteEdge = useWorkflowStore((state) => state.deleteEdge);
  const updateEdge = useWorkflowStore((state) => state.updateEdge);
  // updateNodeDetails is now handled inline in AgentNodeCard
  const themeMode = useWorkflowStore((state) => state.themeMode);
  const isDark = themeMode === "dark";

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [connectingSourceNodeId, setConnectingSourceNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [connectHint, setConnectHint] = useState("");
  const [edgeEditId, setEdgeEditId] = useState<string | null>(null);
  // Node name editing is now inline in AgentNodeCard

  const highlighted = useMemo(() => relatedNodeIds(), [relatedNodeIds]);
  const connectionModeActive = Boolean(connectingSourceNodeId);
  const connectingSourceNode = useMemo(
    () => (connectingSourceNodeId ? nodes.find((node) => node.id === connectingSourceNodeId) : undefined),
    [connectingSourceNodeId, nodes],
  );

  const showConnectHint = useCallback((message: string) => {
    setConnectHint(message);
    if (connectHintTimerRef.current) {
      clearTimeout(connectHintTimerRef.current);
    }
    connectHintTimerRef.current = setTimeout(() => setConnectHint(""), 1800);
  }, []);

  const flowNodes = useMemo<Array<Node<AgentNodeData>>>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "agentNode",
        position: node.position,
        style: {
          width: node.width ?? 200,
          height: node.height ?? 140,
        },
        data: {
          node,
          isRelated: highlighted.size === 0 ? true : highlighted.has(node.id),
          isSelected: selectedNodeId === node.id,
          connectionModeActive,
          isConnectionSourceNode: connectingSourceNodeId === node.id,
          canAcceptConnection: (() => {
            if (!connectionModeActive || !connectingSourceNode) {
              return false;
            }
            if (connectingSourceNode.id === node.id || node.role === "input" || connectingSourceNode.role === "output") {
              return false;
            }
            return !edges.some(
              (edge) => edge.sourceNodeId === connectingSourceNode.id && edge.targetNodeId === node.id,
            );
          })(),
        },
      })),
    [nodes, highlighted, selectedNodeId, connectionModeActive, connectingSourceNodeId, connectingSourceNode, edges],
  );

  const flowEdges = useMemo(
    () => edges.map((edge) => toFlowEdge(edge, highlighted, isDark, hoveredEdgeId)),
    [edges, highlighted, isDark, hoveredEdgeId],
  );

  const isValidConnection = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return false;
      }
      if (connection.source === connection.target) {
        return false;
      }
      const source = nodes.find((item) => item.id === connection.source);
      const target = nodes.find((item) => item.id === connection.target);
      if (!source || !target) {
        return false;
      }
      if (source.role === "output" || target.role === "input") {
        return false;
      }
      if (edges.some((edge) => edge.sourceNodeId === connection.source && edge.targetNodeId === connection.target)) {
        return false;
      }
      return true;
    },
    [edges, nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      if (!isValidConnection(connection)) {
        if (connection.source === connection.target) {
          showConnectHint("不支持将节点连接到自身");
        } else if (edges.some((edge) => edge.sourceNodeId === connection.source && edge.targetNodeId === connection.target)) {
          showConnectHint("相同连线已存在");
        } else {
          showConnectHint("该连线无效，请检查输入输出方向");
        }
        return;
      }
      connectNodes(connection.source, connection.target, "task_flow");
      showConnectHint("连线已创建");
    },
    [connectNodes, edges, isValidConnection, showConnectHint],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setContextMenu(null);
      const role = event.dataTransfer.getData("application/agent-role");
      const templateId = event.dataTransfer.getData("application/agent-template-id");
      if (!role || !flowRef.current || !wrapperRef.current) {
        return;
      }

      const rect = wrapperRef.current.getBoundingClientRect();
      const position = flowRef.current.screenToFlowPosition({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });

      const node = templateId ? addNodeFromTemplate(templateId, position) : addNode(role as never, position);
      if (!node) {
        return;
      }
      selectNode(node.id);
    },
    [addNode, addNodeFromTemplate, selectNode],
  );

  useEffect(() => {
    if (!focusNodeRequest || !flowRef.current) {
      return;
    }

    const node = nodes.find((item) => item.id === focusNodeRequest.nodeId);
    if (!node) {
      return;
    }

    flowRef.current.setCenter(node.position.x + 150, node.position.y + 40, { zoom: 1.05, duration: 450 });
  }, [focusNodeRequest, nodes]);

  useEffect(() => {
    return () => {
      if (connectHintTimerRef.current) {
        clearTimeout(connectHintTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  useEffect(() => {
    if (!flowRef.current) {
      return;
    }
    flowRef.current.fitView({ duration: 260, padding: 0.16 });
  }, [fitViewNonce]);

  useEffect(() => {
    if (!flowRef.current) {
      return;
    }
    flowRef.current.zoomIn({ duration: 180 });
  }, [zoomInNonce]);

  useEffect(() => {
    if (!flowRef.current) {
      return;
    }
    flowRef.current.zoomOut({ duration: 180 });
  }, [zoomOutNonce]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "INPUT" || (event.target as HTMLElement | null)?.tagName === "TEXTAREA") {
        return;
      }
      if (event.key.toLowerCase() === "n" && flowRef.current) {
        const rect = wrapperRef.current?.getBoundingClientRect();
        const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        const flowPos = flowRef.current.screenToFlowPosition({ x: centerX, y: centerY });
        const node = addNode("worker", flowPos);
        selectNode(node.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addNode, selectNode]);

  const addNodeAtPoint = (role: "input" | "planner" | "worker" | "summarizer" | "output" | "router", x: number, y: number) => {
    if (!flowRef.current || !wrapperRef.current) {
      return;
    }
    const flowPos = flowRef.current.screenToFlowPosition({ x, y });
    const node = addNode(role, flowPos);
    selectNode(node.id);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden rounded-[24px] border border-black/5 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.9),rgba(240,244,248,0.78))] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/8 dark:bg-[radial-gradient(circle_at_top_left,rgba(15,23,42,0.96),rgba(8,15,29,0.92))]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-center justify-between">
        <div className="rounded-full border border-black/5 bg-white/75 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-slate-500 backdrop-blur dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300">
          工作流画布
        </div>
        <div className="rounded-full border border-black/5 bg-white/75 px-3 py-1.5 text-[11px] text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300">
          右键空白添加节点，按 N 快速新增 Worker
        </div>
      </div>

      {connectHint ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
          <div className="rounded-full border border-cyan-200 bg-cyan-50/95 px-3 py-1 text-xs font-medium text-cyan-700 shadow-sm dark:border-cyan-300/20 dark:bg-cyan-500/15 dark:text-cyan-200">
            {connectHint}
          </div>
        </div>
      ) : null}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectStart={(_, params) => {
          setConnectingSourceNodeId(params.handleType === "source" ? params.nodeId : null);
          setConnectHint("");
        }}
        onConnectEnd={() => {
          setConnectingSourceNodeId(null);
        }}
        onNodeDragStop={(_, node) => setNodePosition(node.id, node.position)}
        onNodeClick={(_, node) => {
          setContextMenu(null);
          selectNode(node.id);
        }}
        onNodeDoubleClick={() => {
          // inline editing is handled inside AgentNodeCard (click name / click task)
        }}
        onPaneClick={() => {
          setContextMenu(null);
          selectNode(undefined);
          setHoveredEdgeId(null);
        }}
        onEdgesDelete={(deletedEdges: Edge[]) => deletedEdges.forEach((edge) => deleteEdge(edge.id))}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          selectNode(node.id);
          const rect = wrapperRef.current?.getBoundingClientRect();
          const x = rect ? event.clientX - rect.left : event.clientX;
          const y = rect ? event.clientY - rect.top : event.clientY;
          setContextMenu({ type: "node", x, y, nodeId: node.id });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          const rect = wrapperRef.current?.getBoundingClientRect();
          const x = rect ? event.clientX - rect.left : event.clientX;
          const y = rect ? event.clientY - rect.top : event.clientY;
          setContextMenu({ type: "edge", x, y, edgeId: edge.id });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const rect = wrapperRef.current?.getBoundingClientRect();
          const x = rect ? event.clientX - rect.left : event.clientX;
          const y = rect ? event.clientY - rect.top : event.clientY;
          setContextMenu({ type: "pane", x, y });
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        minZoom={0.2}
        maxZoom={1.7}
        onlyRenderVisibleElements
        panOnScroll
        nodeDragThreshold={1}
        elevateEdgesOnSelect
        selectionOnDrag
        deleteKeyCode={["Backspace", "Delete"]}
        connectionLineStyle={{
          stroke: isDark ? "#22d3ee" : "#0891b2",
          strokeWidth: 2.4,
          strokeDasharray: "6 4",
        }}
        defaultEdgeOptions={{
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDark ? "#5eead4" : "#0f766e",
          },
        }}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
      >
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeColor={isDark ? "#94a3b8" : "#334155"}
          nodeColor={isDark ? "#334155" : "#e2e8f0"}
          maskColor={isDark ? "rgba(2,6,23,0.65)" : "rgba(255,255,255,0.65)"}
          pannable
          zoomable
        />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.1} color={isDark ? "#334155" : "#cbd5e1"} />
      </ReactFlow>

      {contextMenu && (
        <div
          className="absolute z-30 min-w-[204px] rounded-[22px] border border-white/60 bg-[var(--panel-strong)] p-2 shadow-[0_30px_70px_-30px_var(--shadow-color)] backdrop-blur dark:border-white/10"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === "node" && (
            <>
              <button
                type="button"
                className="w-full rounded-2xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                onClick={() => {
                  deleteNode(contextMenu.nodeId);
                  setContextMenu(null);
                }}
              >
                删除节点
              </button>
            </>
          )}
          {contextMenu.type === "edge" && (() => {
            const edgeData = edges.find((e) => e.id === contextMenu.edgeId);
            const isLoop = edgeData?.type === "loop_back";
            return (
              <>
                <button
                  type="button"
                  className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  onClick={() => {
                    if (edgeData) {
                      updateEdge(contextMenu.edgeId, {
                        type: isLoop ? "task_flow" : "loop_back",
                        ...(isLoop ? { maxIterations: undefined, convergenceKeyword: undefined } : { maxIterations: 3 }),
                      });
                    }
                    setContextMenu(null);
                  }}
                >
                  {isLoop ? "转为普通连线" : "设为回环连线 ↻"}
                </button>
                {isLoop && (
                  <button
                    type="button"
                    className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    onClick={() => {
                      setEdgeEditId(contextMenu.edgeId);
                      setContextMenu(null);
                    }}
                  >
                    配置回环参数…
                  </button>
                )}
                <button
                  type="button"
                  className="w-full rounded-2xl px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  onClick={() => {
                    deleteEdge(contextMenu.edgeId);
                    setContextMenu(null);
                  }}
                >
                  删除连线
                </button>
              </>
            );
          })()}
          {contextMenu.type === "pane" && (
            <>
              <button type="button" className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" onClick={() => { addNodeAtPoint("input", contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                新建输入节点
              </button>
              <button type="button" className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" onClick={() => { addNodeAtPoint("planner", contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                新建规划节点
              </button>
              <button type="button" className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" onClick={() => { addNodeAtPoint("worker", contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                新建执行节点
              </button>
              <button type="button" className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" onClick={() => { addNodeAtPoint("router", contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                新建路由节点
              </button>
              <button type="button" className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" onClick={() => { addNodeAtPoint("summarizer", contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                新建总结节点
              </button>
              <button type="button" className="w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]" onClick={() => { addNodeAtPoint("output", contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                新建输出节点
              </button>
            </>
          )}
        </div>
      )}

      {/* Node name editing is now inline in AgentNodeCard */}

      {edgeEditId && (() => {
        const edgeData = edges.find((e) => e.id === edgeEditId);
        if (!edgeData || edgeData.type !== "loop_back") return null;
        const srcNode = nodes.find((n) => n.id === edgeData.sourceNodeId);
        const tgtNode = nodes.find((n) => n.id === edgeData.targetNodeId);
        return (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-[2px]" onClick={() => setEdgeEditId(null)}>
            <div
              className="w-80 rounded-[20px] border border-white/60 bg-white/95 p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900/95"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-1 text-sm font-semibold">回环连线配置</h3>
              <p className="mb-4 text-[11px] text-slate-400">
                {srcNode?.name ?? edgeData.sourceNodeId} → {tgtNode?.name ?? edgeData.targetNodeId}
              </p>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-slate-500">最大迭代次数</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={edgeData.maxIterations ?? 3}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-slate-800"
                  onBlur={(e) => updateEdge(edgeEditId, { maxIterations: Math.max(1, Math.min(20, Number(e.target.value) || 3)) })}
                />
              </label>
              <label className="mb-4 block">
                <span className="mb-1 block text-xs text-slate-500">收敛关键词 <span className="text-slate-400">(可选，输出含此词即停止循环)</span></span>
                <input
                  type="text"
                  defaultValue={edgeData.convergenceKeyword ?? ""}
                  placeholder="例：FINAL、完成、APPROVED"
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-slate-800"
                  onBlur={(e) => updateEdge(edgeEditId, { convergenceKeyword: e.target.value.trim() || undefined })}
                />
              </label>
              <button
                type="button"
                className="w-full rounded-xl bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
                onClick={() => setEdgeEditId(null)}
              >
                完成
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
