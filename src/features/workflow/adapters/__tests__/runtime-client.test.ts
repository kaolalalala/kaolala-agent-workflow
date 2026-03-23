import { describe, expect, it } from "vitest";

import { mapBackendSnapshot } from "@/features/workflow/adapters/runtime-client";

describe("runtime client mapper", () => {
  it("maps backend snapshot to frontend shape", () => {
    const mapped = mapBackendSnapshot({
      run: {
        id: "run_1",
        name: "运行-1",
        rootTaskId: "task_root",
        status: "running",
        createdAt: new Date().toISOString(),
      },
      tasks: [
        {
          id: "task_root",
          runId: "run_1",
          title: "总任务",
          status: "running",
        },
      ],
      nodes: [
        {
          id: "node_1",
          runId: "run_1",
          name: "规划代理-1",
          role: "planner",
          status: "running",
          inboundMessages: [],
          outboundMessages: [],
          resolvedInput: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          agentDefinitionId: "agent_def_1",
          contextId: "agent_ctx_1",
        },
      ],
      edges: [],
      messages: [],
      events: [],
      agentContexts: [],
      humanMessages: [],
    });

    expect(mapped.run.id).toBe("run_1");
    expect(mapped.nodes[0].name).toBe("规划代理-1");
    expect(mapped.tasks[0].status).toBe("running");
    expect(mapped.nodeContextsByNodeId).toBeDefined();
  });
});
