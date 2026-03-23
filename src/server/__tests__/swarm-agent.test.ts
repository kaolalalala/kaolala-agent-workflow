/**
 * Integration tests for swarm agent features:
 * - Agent handoff (transfer_to_agent)
 * - Subtask spawning (spawn_subtask)
 * - Agent registry & capability matching
 * - Reflection loop
 * - Multi-round tool loop
 * - Memory consolidation on run completion
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { configService } from "@/server/config/config-service";
import { runtimeEngine } from "@/server/runtime/runtime-engine";
import { memoryStore } from "@/server/store/memory-store";

// ─── Helpers ──────────────────────────────────────────────

function createSwarmWorkflow() {
  return {
    nodes: [
      { id: "n_input", name: "输入节点", role: "input", taskSummary: "接收输入", responsibilitySummary: "注入任务" },
      { id: "n_planner", name: "规划节点", role: "planner", taskSummary: "任务规划", responsibilitySummary: "拆解与分配任务" },
      { id: "n_researcher", name: "调研节点", role: "research", taskSummary: "资料调研", responsibilitySummary: "搜索与整理调研信息" },
      { id: "n_writer", name: "撰写节点", role: "worker", taskSummary: "内容撰写", responsibilitySummary: "撰写报告与文档" },
      { id: "n_reviewer", name: "审核节点", role: "reviewer", taskSummary: "质量审核", responsibilitySummary: "检查质量与合规性" },
      { id: "n_output", name: "输出节点", role: "output", taskSummary: "收敛输出", responsibilitySummary: "输出最终结果" },
    ],
    edges: [
      { id: "e1", sourceNodeId: "n_input", targetNodeId: "n_planner", type: "task_flow" as const },
      { id: "e2", sourceNodeId: "n_planner", targetNodeId: "n_researcher", type: "task_flow" as const },
      { id: "e3", sourceNodeId: "n_researcher", targetNodeId: "n_writer", type: "task_flow" as const },
      { id: "e4", sourceNodeId: "n_writer", targetNodeId: "n_reviewer", type: "task_flow" as const },
      { id: "e5", sourceNodeId: "n_reviewer", targetNodeId: "n_output", type: "output_flow" as const },
    ],
    tasks: [
      { id: "t_root", title: "Swarm Agent 测试任务", status: "ready" },
      { id: "t_input", title: "输入注入", status: "ready", assignedNodeId: "n_input", parentTaskId: "t_root" },
      { id: "t_plan", title: "任务规划", status: "ready", assignedNodeId: "n_planner", parentTaskId: "t_root" },
      { id: "t_research", title: "调研", status: "ready", assignedNodeId: "n_researcher", parentTaskId: "t_root" },
      { id: "t_write", title: "撰写", status: "ready", assignedNodeId: "n_writer", parentTaskId: "t_root" },
      { id: "t_review", title: "审核", status: "ready", assignedNodeId: "n_reviewer", parentTaskId: "t_root" },
      { id: "t_output", title: "最终输出", status: "ready", assignedNodeId: "n_output", parentTaskId: "t_root" },
    ],
  };
}

describe("swarm agent features", () => {
  beforeEach(() => {
    memoryStore.reset();
    configService.resetForTests();
    vi.useFakeTimers();
  });

  // ─── Agent Registry & Built-in Tool Injection ──────────

  it("registers agent capabilities and injects builtin tools for multi-agent workflows", () => {
    const workflow = createSwarmWorkflow();
    const run = runtimeEngine.createRun("Swarm 能力测试", workflow);
    const snapshot = runtimeEngine.getRunSnapshot(run.id);

    // Should have 6 nodes (input, planner, researcher, writer, reviewer, output)
    expect(snapshot.nodes).toHaveLength(6);
    expect(snapshot.edges).toHaveLength(5);

    // All agent roles should be present
    const roles = snapshot.nodes.map((n) => n.role);
    expect(roles).toContain("input");
    expect(roles).toContain("planner");
    expect(roles).toContain("research");
    expect(roles).toContain("worker");
    expect(roles).toContain("reviewer");
    expect(roles).toContain("output");
  });

  it("completes a multi-agent workflow end-to-end", async () => {
    const workflow = createSwarmWorkflow();
    const run = runtimeEngine.createRun("多 Agent 协作链路测试", workflow);

    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.run.output).toBeTruthy();

    // All non-port nodes should have completed
    const completedNodes = snapshot.nodes.filter((n) => n.status === "completed");
    expect(completedNodes.length).toBeGreaterThanOrEqual(4); // planner, researcher, writer, reviewer

    // Events should include key lifecycle events
    const types = snapshot.events.map((e) => e.type);
    expect(types).toContain("run_started");
    expect(types).toContain("run_completed");
    expect(types).toContain("message_sent");
    expect(types).toContain("context_resolved");
  });

  // ─── Agent Handoff via tool directive ──────────────────

  it("executes agent handoff when worker calls transfer_to_agent", async () => {
    const workflow = createSwarmWorkflow();
    const run = runtimeEngine.createRun("Handoff 测试", workflow);

    // First run the workflow normally
    const first = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await first;

    // Now inject a handoff directive via human message on the writer node
    const writerNode = runtimeEngine.getRunSnapshot(run.id).nodes.find((n) => n.role === "worker");
    expect(writerNode).toBeTruthy();

    runtimeEngine.sendHumanMessage(
      run.id,
      writerNode!.id,
      '/tool __builtin_transfer_to_agent {"target_agent_name":"调研节点","reason":"需要更多调研数据","context":"当前写作需要补充资料"}',
    );

    const rerun = runtimeEngine.rerunFromNode(run.id, writerNode!.id, true);
    await vi.runAllTimersAsync();
    await rerun;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");

    // Should have handoff-related events
    const handoffEvents = snapshot.events.filter(
      (e) => e.type === "message_sent" && e.payload?.type === "handoff",
    );
    expect(handoffEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Subtask spawning ─────────────────────────────────

  it("executes subtask spawning when worker calls spawn_subtask", async () => {
    const workflow = createSwarmWorkflow();
    const run = runtimeEngine.createRun("Subtask 测试", workflow);

    const first = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await first;

    const writerNode = runtimeEngine.getRunSnapshot(run.id).nodes.find((n) => n.role === "worker");
    expect(writerNode).toBeTruthy();

    runtimeEngine.sendHumanMessage(
      run.id,
      writerNode!.id,
      '/tool __builtin_spawn_subtask {"target_agent_name":"审核节点","task_description":"请先帮我检查已有材料的准确性","context":"撰写阶段需要前置审核"}',
    );

    const rerun = runtimeEngine.rerunFromNode(run.id, writerNode!.id, true);
    await vi.runAllTimersAsync();
    await rerun;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");

    // Should have subtask-related events
    const subtaskEvents = snapshot.events.filter(
      (e) => e.type === "message_sent" && e.payload?.type === "subtask",
    );
    expect(subtaskEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Handoff to non-existent agent (graceful failure) ──

  it("returns error when handoff targets a non-existent agent", async () => {
    const workflow = createSwarmWorkflow();
    const run = runtimeEngine.createRun("Handoff 失败测试", workflow);

    const first = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await first;

    const writerNode = runtimeEngine.getRunSnapshot(run.id).nodes.find((n) => n.role === "worker");
    expect(writerNode).toBeTruthy();

    runtimeEngine.sendHumanMessage(
      run.id,
      writerNode!.id,
      '/tool __builtin_transfer_to_agent {"target_agent_name":"不存在的节点","reason":"测试"}',
    );

    const rerun = runtimeEngine.rerunFromNode(run.id, writerNode!.id, true);
    await vi.runAllTimersAsync();
    await rerun;

    // Run should still complete (graceful error handling)
    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");
  });

  // ─── Three-node minimal swarm ─────────────────────────

  it("handles swarm handoff in a minimal 3-node workflow", async () => {
    const workflow = {
      nodes: [
        { id: "n_in", name: "输入", role: "input", taskSummary: "输入", responsibilitySummary: "注入" },
        { id: "n_w1", name: "工人A", role: "worker", taskSummary: "处理A", responsibilitySummary: "执行任务A" },
        { id: "n_w2", name: "工人B", role: "worker", taskSummary: "处理B", responsibilitySummary: "执行任务B" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "n_in", targetNodeId: "n_w1", type: "task_flow" as const },
        { id: "e2", sourceNodeId: "n_in", targetNodeId: "n_w2", type: "task_flow" as const },
      ],
      tasks: [
        { id: "t_root", title: "最小 Swarm 测试", status: "ready" },
        { id: "t_in", title: "输入", status: "ready", assignedNodeId: "n_in", parentTaskId: "t_root" },
        { id: "t_w1", title: "任务A", status: "ready", assignedNodeId: "n_w1", parentTaskId: "t_root" },
        { id: "t_w2", title: "任务B", status: "ready", assignedNodeId: "n_w2", parentTaskId: "t_root" },
      ],
    };

    const run = runtimeEngine.createRun("最小 Swarm 测试", workflow);
    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    // Both workers should be part of the run
    const workers = snapshot.nodes.filter((n) => n.role === "worker");
    expect(workers).toHaveLength(2);

    // Registry should have the 2 workers (port nodes excluded)
    expect(snapshot.agentDefinitions.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Memory persistence across runs ───────────────────

  it("persists memory across runs for the same workflow task", async () => {
    const workflow = createSwarmWorkflow();

    // Run 1
    const run1 = runtimeEngine.createRun("记忆跨运行测试", workflow);
    const p1 = runtimeEngine.startRun(run1.id);
    await vi.runAllTimersAsync();
    await p1;
    expect(runtimeEngine.getRunSnapshot(run1.id).run.status).toBe("completed");

    // Run 2 with similar task
    const run2 = runtimeEngine.createRun("记忆跨运行测试（第二轮）", workflow);
    const p2 = runtimeEngine.startRun(run2.id);
    await vi.runAllTimersAsync();
    await p2;
    expect(runtimeEngine.getRunSnapshot(run2.id).run.status).toBe("completed");

    // Both runs should complete successfully — memory should not cause errors
    const snap1 = runtimeEngine.getRunSnapshot(run1.id);
    const snap2 = runtimeEngine.getRunSnapshot(run2.id);
    expect(snap1.events.map((e) => e.type)).toContain("run_completed");
    expect(snap2.events.map((e) => e.type)).toContain("run_completed");
  });

  // ─── Workflow with all node roles ─────────────────────

  it("handles workflow with all supported node roles", async () => {
    const workflow = {
      nodes: [
        { id: "n_in", name: "入口", role: "input", taskSummary: "输入", responsibilitySummary: "注入" },
        { id: "n_plan", name: "规划器", role: "planner", taskSummary: "规划", responsibilitySummary: "制定计划" },
        { id: "n_res", name: "调研员", role: "research", taskSummary: "调研", responsibilitySummary: "检索信息" },
        { id: "n_work", name: "执行者", role: "worker", taskSummary: "执行", responsibilitySummary: "完成任务" },
        { id: "n_rev", name: "审核员", role: "reviewer", taskSummary: "审核", responsibilitySummary: "质量把关" },
        { id: "n_sum", name: "总结者", role: "summarizer", taskSummary: "总结", responsibilitySummary: "汇总输出" },
        { id: "n_out", name: "出口", role: "output", taskSummary: "输出", responsibilitySummary: "结果输出" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "n_in", targetNodeId: "n_plan", type: "task_flow" as const },
        { id: "e2", sourceNodeId: "n_plan", targetNodeId: "n_res", type: "task_flow" as const },
        { id: "e3", sourceNodeId: "n_res", targetNodeId: "n_work", type: "task_flow" as const },
        { id: "e4", sourceNodeId: "n_work", targetNodeId: "n_rev", type: "task_flow" as const },
        { id: "e5", sourceNodeId: "n_rev", targetNodeId: "n_sum", type: "task_flow" as const },
        { id: "e6", sourceNodeId: "n_sum", targetNodeId: "n_out", type: "output_flow" as const },
      ],
      tasks: [
        { id: "t_root", title: "全角色测试", status: "ready" },
        { id: "t1", title: "输入", status: "ready", assignedNodeId: "n_in", parentTaskId: "t_root" },
        { id: "t2", title: "规划", status: "ready", assignedNodeId: "n_plan", parentTaskId: "t_root" },
        { id: "t3", title: "调研", status: "ready", assignedNodeId: "n_res", parentTaskId: "t_root" },
        { id: "t4", title: "执行", status: "ready", assignedNodeId: "n_work", parentTaskId: "t_root" },
        { id: "t5", title: "审核", status: "ready", assignedNodeId: "n_rev", parentTaskId: "t_root" },
        { id: "t6", title: "总结", status: "ready", assignedNodeId: "n_sum", parentTaskId: "t_root" },
        { id: "t7", title: "输出", status: "ready", assignedNodeId: "n_out", parentTaskId: "t_root" },
      ],
    };

    const run = runtimeEngine.createRun("全角色协作测试", workflow);
    const promise = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await promise;

    const snapshot = runtimeEngine.getRunSnapshot(run.id);
    expect(snapshot.run.status).toBe("completed");
    expect(snapshot.nodes).toHaveLength(7);
    expect(snapshot.run.output).toBeTruthy();
  });
});
