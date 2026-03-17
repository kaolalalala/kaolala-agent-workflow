import { beforeEach, describe, expect, it, vi } from "vitest";

import { configService } from "@/server/config/config-service";
import { runtimeEngine } from "@/server/runtime/runtime-engine";
import { memoryStore } from "@/server/store/memory-store";
import { toolService } from "@/server/tools/tool-service";

describe("runtime engine", () => {
  beforeEach(() => {
    memoryStore.reset();
    configService.resetForTests();
    vi.useFakeTimers();
  });

  it("creates initial run graph with agent bindings", () => {
    const run = runtimeEngine.createRun("调研多代理协作模式");
    const snapshot = runtimeEngine.getRunSnapshot(run.id);

    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.edges).toHaveLength(2);
    expect(snapshot.tasks.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.agentDefinitions).toHaveLength(3);
    expect(snapshot.agentContexts).toHaveLength(3);
    expect(snapshot.events.find((item) => item.type === "run_created")).toBeTruthy();
  });

  it("completes happy path and writes output with monotonic event sequence", async () => {
    const run = runtimeEngine.createRun("调研多代理协作模式");
    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.run.output).toBeTruthy();

    const types = snapshot.events.map((event) => event.type);
    expect(types).toContain("run_started");
    expect(types).toContain("message_sent");
    expect(types).toContain("message_delivered");
    expect(types).toContain("context_resolved");
    expect(types).toContain("node_completed");
    expect(types).toContain("run_completed");

    const seqs = snapshot.events.map((event) => event.runEventSeq ?? 0);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("triggers failure path by keyword", async () => {
    const run = runtimeEngine.createRun("失败分支测试");
    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.events.map((event) => event.type)).toContain("node_failed");
    expect(snapshot.events.map((event) => event.type)).toContain("run_failed");
  });

  it("updates context by human message and reruns worker with downstream", async () => {
    const run = runtimeEngine.createRun("调研多 Agent 协作模式");

    const first = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await first;

    const worker = runtimeEngine.getRunSnapshot(run.id).nodes.find((node) => node.role === "worker");
    expect(worker).toBeTruthy();

    runtimeEngine.sendHumanMessage(run.id, worker!.id, "请重点分析 Dynamic Agent Creation，并给出具体例子");

    const rerun = runtimeEngine.rerunFromNode(run.id, worker!.id, true);
    await vi.runAllTimersAsync();
    await rerun;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.humanMessages.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.events.map((event) => event.type)).toContain("human_message_sent");
    expect(snapshot.events.map((event) => event.type)).toContain("node_rerun_started");
    expect(snapshot.events.map((event) => event.type)).toContain("downstream_rerun_started");
  });

  it("invokes bound tools and emits tool invocation events", async () => {
    vi.useRealTimers();

    toolService.createTool({
      toolId: "tool_echo",
      name: "Echo Tool",
      category: "automation",
      sourceType: "local_script",
      sourceConfig: {
        command: 'node -e "console.log(JSON.stringify({ ok: true, input: process.env.TOOL_INPUT }))"',
      },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      authRequirements: { type: "none", required: false },
      enabled: true,
    });

    toolService.upsertBinding({
      scopeType: "agent_role",
      scopeId: "worker",
      toolId: "tool_echo",
      enabled: true,
      priority: 100,
    });

    const run = runtimeEngine.createRun("工具调用流程测试");
    await runtimeEngine.startRun(run.id);

    const worker = runtimeEngine.getRunSnapshot(run.id).nodes.find((node) => node.role === "worker");
    expect(worker).toBeTruthy();

    runtimeEngine.sendHumanMessage(run.id, worker!.id, '/tool tool_echo {"query":"hello"}');
    await runtimeEngine.rerunFromNode(run.id, worker!.id, true);

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const types = snapshot.events.map((event) => event.type);
    expect(types).toContain("tool_invocation_started");
    expect(types).toContain("tool_invocation_succeeded");
  });

  it("safe run mode disables tool invocation during execution", async () => {
    vi.useRealTimers();

    toolService.createTool({
      toolId: "tool_echo_safe",
      name: "Echo Tool Safe",
      category: "automation",
      sourceType: "local_script",
      sourceConfig: {
        command: 'node -e "console.log(JSON.stringify({ ok: true }))"',
      },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      authRequirements: { type: "none", required: false },
      enabled: true,
    });

    toolService.upsertBinding({
      scopeType: "agent_role",
      scopeId: "worker",
      toolId: "tool_echo_safe",
      enabled: true,
      priority: 100,
    });

    const run = runtimeEngine.createRun("safe mode test", undefined, "safe");
    await runtimeEngine.startRun(run.id);

    const worker = runtimeEngine.getRunSnapshot(run.id).nodes.find((node) => node.role === "worker");
    expect(worker).toBeTruthy();

    runtimeEngine.sendHumanMessage(run.id, worker!.id, '/tool tool_echo_safe {"q":"x"}');
    await runtimeEngine.rerunFromNode(run.id, worker!.id, true);

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const types = snapshot.events.map((event) => event.type);
    expect(types).not.toContain("tool_invocation_started");
    expect(snapshot.run.runMode).toBe("safe");
  });

  it("schedules nodes by DAG dependencies and emits waiting/ready events", async () => {
    const run = runtimeEngine.createRun("DAG 调度测试", {
      nodes: [
        { id: "in_1", name: "输入", role: "input", taskSummary: "输入任务" },
        { id: "wk_1", name: "执行A", role: "worker", taskSummary: "执行A" },
        { id: "wk_2", name: "执行B", role: "worker", taskSummary: "执行B" },
        { id: "out_1", name: "输出", role: "output", taskSummary: "输出结果" },
      ],
      edges: [
        { id: "e_1", sourceNodeId: "in_1", targetNodeId: "wk_1", type: "task_flow" },
        { id: "e_2", sourceNodeId: "in_1", targetNodeId: "wk_2", type: "task_flow" },
        { id: "e_3", sourceNodeId: "wk_1", targetNodeId: "out_1", type: "task_flow" },
        { id: "e_4", sourceNodeId: "wk_2", targetNodeId: "out_1", type: "task_flow" },
      ],
      tasks: [],
    });

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.events.map((event) => event.type)).toContain("node_waiting");
    expect(snapshot.events.map((event) => event.type)).toContain("node_ready");
    expect(snapshot.events.map((event) => event.type)).toContain("message_delivered");
    expect(snapshot.run.output).toBeTruthy();
  });

  it("delivers input message to downstream resolved context and preserves payload", async () => {
    const run = runtimeEngine.createRun("Input to Agent", {
      nodes: [
        { id: "in_1", name: "Input", role: "input", taskSummary: "入口输入" },
        { id: "pl_1", name: "Planner", role: "planner", taskSummary: "规划任务" },
      ],
      edges: [{ id: "e_1", sourceNodeId: "in_1", targetNodeId: "pl_1", type: "task_flow" }],
      tasks: [],
    });

    const snapshotBefore = runtimeEngine.getRunSnapshot(run.id);
    const inputNode = snapshotBefore.nodes.find((node) => node.role === "input");
    const plannerNode = snapshotBefore.nodes.find((node) => node.role === "planner");
    expect(inputNode).toBeTruthy();
    expect(plannerNode).toBeTruthy();

    runtimeEngine.sendHumanMessage(run.id, inputNode!.id, "请研究最新 Agent OS 新闻与论文");

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const planner = snapshot.nodes.find((node) => node.id === plannerNode!.id);
    const plannerContext = snapshot.agentContexts.find((ctx) => ctx.nodeId === plannerNode!.id);
    const delivered = snapshot.events.find((event) => event.type === "message_delivered");
    const deliveredMessage = delivered?.payload?.message as {
      payload?: { data?: { userInput?: string } };
    } | undefined;

    expect(planner?.inboundMessages.length).toBeGreaterThan(0);
    expect(planner?.resolvedInput).toContain("Agent OS");
    expect(plannerContext?.resolvedInput).toContain("Agent OS");
    expect(deliveredMessage?.payload?.data?.userInput).toContain("Agent OS");
  });

  it("routes result messages to output_flow before task_flow", async () => {
    const run = runtimeEngine.createRun("路由测试", {
      nodes: [
        { id: "in_1", name: "Input", role: "input", taskSummary: "入口输入" },
        { id: "wk_1", name: "Worker", role: "worker", taskSummary: "执行" },
        { id: "out_1", name: "Output", role: "output", taskSummary: "输出" },
        { id: "sum_1", name: "Summarizer", role: "summarizer", taskSummary: "总结" },
      ],
      edges: [
        { id: "e_1", sourceNodeId: "in_1", targetNodeId: "wk_1", type: "task_flow" },
        { id: "e_2", sourceNodeId: "wk_1", targetNodeId: "sum_1", type: "task_flow" },
        { id: "e_3", sourceNodeId: "wk_1", targetNodeId: "out_1", type: "output_flow" },
      ],
      tasks: [],
    });

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const outputNode = snapshot.nodes.find((node) => node.role === "output");
    const summarizerNode = snapshot.nodes.find((node) => node.role === "summarizer");

    expect(outputNode?.inboundMessages.length).toBeGreaterThan(0);
    expect(summarizerNode?.inboundMessages.length ?? 0).toBe(0);
  });

  it("fails run when workflow contains cycle", async () => {
    const run = runtimeEngine.createRun("环路测试", {
      nodes: [
        { id: "a", name: "A", role: "worker", taskSummary: "A" },
        { id: "b", name: "B", role: "worker", taskSummary: "B" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "a", targetNodeId: "b", type: "task_flow" },
        { id: "e2", sourceNodeId: "b", targetNodeId: "a", type: "task_flow" },
      ],
      tasks: [],
    });

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("failed");
    expect(snapshot.run.error).toContain("环路");
    expect(snapshot.events.map((event) => event.type)).toContain("run_failed");
  });

  it("routes router output by edge condition", async () => {
    const run = runtimeEngine.createRun("router conditional test", {
      nodes: [
        { id: "in_1", name: "Input", role: "input", taskSummary: "输入" },
        { id: "rt_1", name: "Router", role: "router", taskSummary: "根据输入选择下游" },
        { id: "wk_1", name: "Research Worker", role: "worker", taskSummary: "调研分支" },
        { id: "sum_1", name: "Summary Worker", role: "worker", taskSummary: "总结分支" },
      ],
      edges: [
        { id: "e_1", sourceNodeId: "in_1", targetNodeId: "rt_1", type: "task_flow" },
        { id: "e_2", sourceNodeId: "rt_1", targetNodeId: "wk_1", type: "task_flow", condition: "research" },
        { id: "e_3", sourceNodeId: "rt_1", targetNodeId: "sum_1", type: "task_flow", condition: "summary" },
      ],
      tasks: [],
    });

    const inputNode = runtimeEngine.getRunSnapshot(run.id).nodes.find((node) => node.role === "input");
    runtimeEngine.sendHumanMessage(run.id, inputNode!.id, "请走调研分支");

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const researchNode = snapshot.nodes.find((node) => node.name === "Research Worker");
    const summaryNode = snapshot.nodes.find((node) => node.name === "Summary Worker");

    expect(researchNode?.inboundMessages.length).toBeGreaterThan(0);
    expect(summaryNode?.inboundMessages.length ?? 0).toBe(0);
  });

  it("executes same-wave nodes before downstream wave", async () => {
    const run = runtimeEngine.createRun("parallel dag test", {
      nodes: [
        { id: "in_1", name: "Input", role: "input", taskSummary: "输入" },
        { id: "wk_1", name: "Worker A", role: "worker", taskSummary: "A" },
        { id: "wk_2", name: "Worker B", role: "worker", taskSummary: "B" },
        { id: "out_1", name: "Output", role: "output", taskSummary: "输出" },
      ],
      edges: [
        { id: "e_1", sourceNodeId: "in_1", targetNodeId: "wk_1", type: "task_flow" },
        { id: "e_2", sourceNodeId: "in_1", targetNodeId: "wk_2", type: "task_flow" },
        { id: "e_3", sourceNodeId: "wk_1", targetNodeId: "out_1", type: "task_flow" },
        { id: "e_4", sourceNodeId: "wk_2", targetNodeId: "out_1", type: "task_flow" },
      ],
      tasks: [],
    });

    const snapshotBefore = runtimeEngine.getRunSnapshot(run.id);
    const workerNodeIds = snapshotBefore.nodes
      .filter((node) => node.name === "Worker A" || node.name === "Worker B")
      .map((node) => node.id);
    const outputNodeId = snapshotBefore.nodes.find((node) => node.name === "Output")?.id;

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const events = runtimeEngine.getRunSnapshot(run.id).events;
    const workerStartIndices = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === "node_started" && workerNodeIds.includes(event.relatedNodeId ?? ""))
      .map(({ index }) => index);
    const outputStartIndex = events.findIndex(
      (event) => event.type === "node_started" && event.relatedNodeId === outputNodeId,
    );

    expect(workerStartIndices).toHaveLength(2);
    expect(Math.max(...workerStartIndices)).toBeLessThan(outputStartIndex);
  });

  it("emits llm request/response lifecycle events", async () => {
    vi.useRealTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200 },
      ),
    );

    const credential = configService.createCredential({
      provider: "minimax",
      label: "test",
      apiKey: "sk-test",
    });
    configService.updateWorkspaceConfig({
      defaultProvider: "minimax",
      defaultModel: "MiniMax-M2.5",
      defaultBaseUrl: "https://api.minimaxi.com/v1",
      defaultCredentialId: credential.id,
    });

    const run = runtimeEngine.createRun("llm event test");
    const snapshotBefore = runtimeEngine.getRunSnapshot(run.id);
    for (const node of snapshotBefore.nodes) {
      configService.updateNodeConfig(run.id, node.id, {
        toolPolicy: "disabled",
      });
    }

    await runtimeEngine.startRun(run.id);
    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const types = snapshot.events.map((event) => event.type);
    expect(types).toContain("llm_request_sent");
    expect(types).toContain("llm_response_received");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("avoids duplicated output content when output node receives both message and upstream state", async () => {
    vi.useRealTimers();
    const llmText = "<think>analysis</think>\n{\"result\":\"ok\"}";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: llmText } }],
        }),
        { status: 200 },
      ),
    );

    const credential = configService.createCredential({
      provider: "openai",
      label: "test",
      apiKey: "sk-test",
    });
    configService.updateWorkspaceConfig({
      defaultProvider: "openai",
      defaultModel: "gpt-4.1-mini",
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultCredentialId: credential.id,
    });

    const run = runtimeEngine.createRun("输出去重测试", {
      nodes: [
        { id: "in_1", name: "Input", role: "input", taskSummary: "输入" },
        { id: "wk_1", name: "Worker", role: "worker", taskSummary: "执行" },
        { id: "out_1", name: "Output", role: "output", taskSummary: "输出" },
      ],
      edges: [
        { id: "e_1", sourceNodeId: "in_1", targetNodeId: "wk_1", type: "task_flow" },
        { id: "e_2", sourceNodeId: "wk_1", targetNodeId: "out_1", type: "task_flow" },
      ],
      tasks: [],
    });

    await runtimeEngine.startRun(run.id);
    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    const outputNode = snapshot.nodes.find((node) => node.role === "output");
    const workerNode = snapshot.nodes.find((node) => node.role === "worker");

    expect(workerNode).toBeTruthy();
    expect(outputNode).toBeTruthy();
    expect(outputNode?.latestOutput).toBe(llmText);
    expect(snapshot.run.output).toBe(llmText);
    expect(snapshot.events.filter((event) => event.type === "node_started" && event.relatedNodeId === workerNode?.id)).toHaveLength(1);
    expect(snapshot.events.filter((event) => event.type === "node_started" && event.relatedNodeId === outputNode?.id)).toHaveLength(1);

    fetchMock.mockRestore();
  });

  it("retrieves long-term memory across runs with similar tasks", async () => {
    const firstRun = runtimeEngine.createRun("长期记忆测试：设计多代理知识库检索策略");
    const firstPromise = runtimeEngine.startRun(firstRun.id);
    await vi.runAllTimersAsync();
    await firstPromise;

    const secondRun = runtimeEngine.createRun("长期记忆测试：设计多代理知识库检索策略");
    const secondPromise = runtimeEngine.startRun(secondRun.id);
    await vi.runAllTimersAsync();
    await secondPromise;

    const snapshot = runtimeEngine.getRunSnapshot(secondRun.id);
    const eventTypes = snapshot.events.map((event) => event.type);

    expect(eventTypes).toContain("memory_retrieved");
    expect(eventTypes).toContain("memory_indexed");
    expect(snapshot.nodes.some((node) => node.resolvedInput?.includes("长期记忆检索"))).toBe(true);
  });
});

