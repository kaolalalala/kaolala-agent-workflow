import { beforeEach, describe, expect, it } from "vitest";

import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";

describe("workflow store", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      tasks: [],
      events: [],
      messages: [],
      nodeContextsByNodeId: {},
      lastAppliedRunEventSeqByRunId: {},
      selectedNodeId: undefined,
      finalOutput: "",
      activeRun: null,
      rootTaskInput: "多 Agent 协作模式调研",
      inspectorTab: "overview",
      bottomTab: "events",
      bottomPanelCollapsed: false,
      focusNodeRequest: null,
    });
  });

  it("creates, connects and deletes nodes", () => {
    const planner = useWorkflowStore.getState().addNode("planner", { x: 10, y: 10 });
    const worker = useWorkflowStore.getState().addNode("worker", { x: 20, y: 20 });

    useWorkflowStore.getState().connectNodes(planner.id, worker.id);

    let state = useWorkflowStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.nodes.find((n) => n.id === planner.id)?.downstreamIds).toContain(worker.id);

    useWorkflowStore.getState().deleteNode(worker.id);
    state = useWorkflowStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0);
  });

  it("computes related node ids from selected node", () => {
    const a = useWorkflowStore.getState().addNode("planner");
    const b = useWorkflowStore.getState().addNode("worker");
    const c = useWorkflowStore.getState().addNode("summarizer");

    useWorkflowStore.getState().connectNodes(a.id, b.id);
    useWorkflowStore.getState().connectNodes(b.id, c.id);
    useWorkflowStore.getState().selectNode(b.id);

    const related = useWorkflowStore.getState().relatedNodeIds();
    expect(related.has(a.id)).toBe(true);
    expect(related.has(b.id)).toBe(true);
    expect(related.has(c.id)).toBe(true);
  });

  it("stores node size updates for resize persistence", () => {
    const node = useWorkflowStore.getState().addNode("worker", { x: 40, y: 60 });

    useWorkflowStore.getState().setNodeSize(node.id, { width: 420, height: 320 });

    const updated = useWorkflowStore.getState().nodes.find((item) => item.id === node.id);
    expect(updated?.width).toBe(420);
    expect(updated?.height).toBe(320);
  });

  it("drops out-of-order runtime events by runEventSeq", () => {
    const node = useWorkflowStore.getState().addNode("worker");
    useWorkflowStore.setState({
      activeRun: {
        id: "run_1",
        name: "run",
        status: "running",
        rootTaskId: "task_root",
      },
      lastAppliedRunEventSeqByRunId: { run_1: 10 },
      nodeContextsByNodeId: {
        [node.id]: {
          id: "ctx_1",
          nodeId: node.id,
          systemPrompt: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: new Date().toISOString(),
        },
      },
    });

    useWorkflowStore.getState().applyRuntimeEvent({
      id: "event_old",
      time: new Date().toISOString(),
      runEventSeq: 9,
      type: "context_resolved",
      relatedNodeId: node.id,
      message: "old",
      payload: { resolvedInput: "old" },
    });

    const state = useWorkflowStore.getState();
    expect(state.nodeContextsByNodeId[node.id]?.resolvedInput).toBe("");
    expect(state.events.find((event) => event.id === "event_old")).toBeUndefined();
  });

  it("deduplicates context messages when patch and message events both arrive", () => {
    const source = useWorkflowStore.getState().addNode("input");
    const target = useWorkflowStore.getState().addNode("planner");
    const now = new Date().toISOString();

    useWorkflowStore.setState({
      activeRun: {
        id: "run_1",
        name: "run",
        status: "running",
        rootTaskId: "task_root",
      },
      lastAppliedRunEventSeqByRunId: { run_1: 0 },
      nodeContextsByNodeId: {
        [source.id]: {
          id: `ctx_${source.id}`,
          nodeId: source.id,
          systemPrompt: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: now,
        },
        [target.id]: {
          id: `ctx_${target.id}`,
          nodeId: target.id,
          systemPrompt: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [],
          updatedAt: now,
        },
      },
    });

    const msg = {
      id: "msg_1",
      runId: "run_1",
      fromNodeId: source.id,
      toNodeId: target.id,
      type: "task_assignment" as const,
      content: "hello",
      createdAt: now,
    };

    useWorkflowStore.getState().applyRuntimeEvent({
      id: "event_patch_out",
      time: now,
      runEventSeq: 1,
      type: "agent_context_updated",
      relatedNodeId: source.id,
      message: "patch out",
      payload: {
        contextPatch: {
          outboundMessages: [msg],
        },
      },
    });

    useWorkflowStore.getState().applyRuntimeEvent({
      id: "event_sent",
      time: now,
      runEventSeq: 2,
      type: "message_sent",
      relatedNodeId: target.id,
      message: "sent",
      payload: {
        fromNodeId: source.id,
        toNodeId: target.id,
        message: msg,
      },
    });

    useWorkflowStore.getState().applyRuntimeEvent({
      id: "event_patch_in",
      time: now,
      runEventSeq: 3,
      type: "agent_context_updated",
      relatedNodeId: target.id,
      message: "patch in",
      payload: {
        contextPatch: {
          inboundMessages: [msg],
        },
      },
    });

    useWorkflowStore.getState().applyRuntimeEvent({
      id: "event_delivered",
      time: now,
      runEventSeq: 4,
      type: "message_delivered",
      relatedNodeId: target.id,
      message: "delivered",
      payload: {
        message: msg,
      },
    });

    const state = useWorkflowStore.getState();
    expect(state.nodeContextsByNodeId[source.id]?.outboundMessages).toHaveLength(1);
    expect(state.nodeContextsByNodeId[target.id]?.inboundMessages).toHaveLength(1);
    expect(state.messages.filter((item) => item.id === msg.id)).toHaveLength(1);
  });

  it("does not append duplicated recentOutputs on node_completed when latest output is unchanged", () => {
    const node = useWorkflowStore.getState().addNode("summarizer");
    const now = new Date().toISOString();
    const duplicatedOutput = "<think>analysis</think>\n{\"result\":\"ok\"}";

    useWorkflowStore.setState({
      activeRun: {
        id: "run_1",
        name: "run",
        status: "running",
        rootTaskId: "task_root",
      },
      nodeContextsByNodeId: {
        [node.id]: {
          id: `ctx_${node.id}`,
          nodeId: node.id,
          systemPrompt: "",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          humanMessages: [],
          recentOutputs: [duplicatedOutput],
          latestSummary: duplicatedOutput,
          updatedAt: now,
        },
      },
    });

    useWorkflowStore.getState().applyRuntimeEvent({
      id: "event_node_completed",
      time: now,
      runEventSeq: 1,
      type: "node_completed",
      relatedNodeId: node.id,
      message: "completed",
      payload: {
        output: duplicatedOutput,
      },
    });

    const state = useWorkflowStore.getState();
    expect(state.nodeContextsByNodeId[node.id]?.recentOutputs).toHaveLength(1);
    expect(state.nodeContextsByNodeId[node.id]?.recentOutputs[0]).toBe(duplicatedOutput);
  });
});
