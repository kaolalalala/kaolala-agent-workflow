import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RightInspector } from "@/features/workflow/components/RightInspector";
import { TaskTree } from "@/features/workflow/components/TaskTree";
import { useWorkflowStore } from "@/features/workflow/store/useWorkflowStore";

vi.mock("@/features/workflow/adapters/runtime-client", () => ({
  runtimeClient: {
    getWorkspaceConfig: vi.fn().mockResolvedValue({
      workspace: {
        id: "ws_1",
        name: "Workspace",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      credentials: [],
    }),
    getNodeConfig: vi.fn().mockResolvedValue({
      config: {
        id: "cfg_1",
        runId: "run_1",
        nodeId: "node_1",
        name: "Planner-1",
        useWorkspaceModelDefault: true,
        allowHumanInput: true,
        toolPolicy: "disabled",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      documents: [],
    }),
  },
}));

describe("workflow components", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: "node_1",
          name: "Planner-1",
          role: "planner",
          status: "running",
          taskSummary: "拆解任务",
          responsibilitySummary: "负责规划",
          position: { x: 100, y: 100 },
          upstreamIds: [],
          downstreamIds: ["node_2"],
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          blocked: false,
          retryCount: 0,
          lastInput: "总任务",
          lastOutput: "子任务列表",
        },
      ],
      edges: [],
      tasks: [
        {
          id: "task_root",
          title: "总任务",
          summary: "总任务摘要",
          status: "ready",
        },
        {
          id: "task_child",
          title: "规划执行",
          summary: "规划",
          status: "running",
          parentTaskId: "task_root",
          assignedNodeId: "node_1",
        },
      ],
      events: [],
      messages: [],
      nodeContextsByNodeId: {
        node_1: {
          id: "ctx_1",
          nodeId: "node_1",
          systemPrompt: "",
          taskBrief: "拆解任务",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "总任务",
          humanMessages: [],
          recentOutputs: ["子任务列表"],
          updatedAt: new Date().toISOString(),
        },
      },
      lastAppliedRunEventSeqByRunId: {},
      selectedNodeId: "node_1",
      rootTaskInput: "测试",
      finalOutput: "",
      activeRun: null,
      inspectorTab: "overview",
      bottomTab: "events",
      bottomPanelCollapsed: false,
      focusNodeRequest: null,
    });
  });

  it("task tree click requests node focus", () => {
    render(<TaskTree collapsed={false} onToggle={() => undefined} />);

    fireEvent.click(screen.getByText("规划执行"));

    expect(useWorkflowStore.getState().focusNodeRequest?.nodeId).toBe("node_1");
  });

  it("inspector renders task brief content", async () => {
    useWorkflowStore.setState({ inspectorTab: "task" });
    render(<RightInspector />);

    expect((await screen.findAllByText(/任务目标/)).length).toBeGreaterThan(0);
  });
});
