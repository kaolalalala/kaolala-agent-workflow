import { beforeEach, describe, expect, it, vi } from "vitest";

import { configService } from "@/server/config/config-service";
import { evaluationService } from "@/server/evaluation/evaluation-service";
import { outputManager } from "@/server/runtime/output-manager";
import { runtimeEngine } from "@/server/runtime/runtime-engine";
import { memoryStore } from "@/server/store/memory-store";

describe("evaluation service", () => {
  beforeEach(() => {
    memoryStore.reset();
    configService.resetForTests();
    vi.useFakeTimers();
  });

  it("normalizes output paths into the unified output root", () => {
    const path1 = outputManager.normalizeOutputPath("run_a", "node_b", "/tmp/demo.md");
    const path2 = outputManager.normalizeOutputPath("run_a", "node_b", "reports/result.md");
    const path3 = outputManager.normalizeOutputPath("run_a", "node_b", "D:\\temp\\other.txt");

    expect(path1).toContain(".output");
    expect(path1).toContain("run_a");
    expect(path1).toContain("node_b");
    expect(path2).toContain(".output");
    expect(path2).toContain("reports");
    expect(path3).toContain(".output");
    expect(path3).toContain("other.txt");
  });

  it("creates replay run and generates compare report", async () => {
    const run = runtimeEngine.createRun("回放测试任务");
    const first = runtimeEngine.startRun(run.id);
    await vi.runAllTimersAsync();
    await first;

    const replay = evaluationService.createReplayRun({
      baselineRunId: run.id,
      replayMode: "full",
      autoStart: false,
    });

    const second = runtimeEngine.startRun(replay.replayRunId);
    await vi.runAllTimersAsync();
    await second;

    const baselineSnapshot = runtimeEngine.getRunSnapshot(run.id);
    const replaySnapshot = runtimeEngine.getRunSnapshot(replay.replayRunId);

    expect(baselineSnapshot.run.status).toBe("completed");
    expect(replaySnapshot.run.status).toBe("completed");
    expect(replaySnapshot.run.taskInput).toBe(baselineSnapshot.run.taskInput);

    const report = evaluationService.compareRuns(run.id, replay.replayRunId);
    expect(report.baselineRunId).toBe(run.id);
    expect(report.candidateRunId).toBe(replay.replayRunId);
    expect(report.baselineFailedToolCalls).toBeGreaterThanOrEqual(0);
    expect(report.candidateFailedToolCalls).toBeGreaterThanOrEqual(0);
    expect(report.promptDiffSummary.baselinePromptTraceCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.nodeDiffs)).toBe(true);
    expect(report.nodeDiffs.length).toBeGreaterThan(0);
  });

  it("executes evaluation case end-to-end with suite/case/report loop", async () => {
    const workflow = configService.saveWorkflow({
      name: "评测工作流",
      rootTaskInput: "评测输入",
      versionLabel: "v1",
      nodes: [
        { id: "n1", name: "输入", role: "input", taskSummary: "输入" },
        { id: "n2", name: "执行", role: "worker", taskSummary: "执行", responsibilitySummary: "完成任务" },
        { id: "n3", name: "输出", role: "output", taskSummary: "输出" },
      ],
      edges: [
        { id: "e1", sourceNodeId: "n1", targetNodeId: "n2", type: "task_flow" },
        { id: "e2", sourceNodeId: "n2", targetNodeId: "n3", type: "task_flow" },
      ],
      tasks: [
        { id: "t1", title: "任务", status: "ready", assignedNodeId: "n2", summary: "执行任务" },
      ],
    });

    const suite = evaluationService.createSuite({
      name: "回归套件",
      workflowId: workflow.id,
      workflowVersionId: workflow.currentVersionId,
    });
    const evaluationCase = evaluationService.createCase({
      suiteId: suite.id,
      name: "基础回放用例",
      taskInput: "请输出 mock-agent-v1 的执行结果",
      expectedOutputContains: "mock-agent-v1",
    });

    const promise = evaluationService.executeCase(evaluationCase.id);
    await vi.runAllTimersAsync();
    const report = await promise;

    expect(report.suiteId).toBe(suite.id);
    expect(report.caseId).toBe(evaluationCase.id);
    expect(report.baselineRunId).toBeTruthy();
    expect(report.replayRunId).toBeTruthy();
    expect(report.checks.length).toBeGreaterThan(0);
    expect(typeof report.score).toBe("number");
    expect(["pass", "warn", "fail"]).toContain(report.verdict);
    expect(report.baseline.taskInput).toBe(evaluationCase.taskInput);
    expect(report.replay.taskInput).toBe(evaluationCase.taskInput);
    expect(report.baseline.memoryIsolationMode).toBe("run_scoped");
    expect(report.replay.memoryIsolationMode).toBe("run_scoped");
    expect(Array.isArray(report.artifacts.missingReplayFiles)).toBe(true);
    expect(Array.isArray(report.artifacts.additionalReplayFiles)).toBe(true);
    expect(Array.isArray(report.artifacts.changedSharedFiles)).toBe(true);
    expect(report.compare.promptDiffSummary.changedPromptCount).toBeGreaterThanOrEqual(0);

    const evaluationRuns = evaluationService.listEvaluationRuns();
    expect(evaluationRuns.length).toBeGreaterThan(0);
    const latest = evaluationService.getEvaluationRun(evaluationRuns[0].id);
    expect(latest.report?.suiteId).toBe(suite.id);

    const baselineSnapshot = runtimeEngine.getRunSnapshot(report.baselineRunId);
    const replaySnapshot = runtimeEngine.getRunSnapshot(report.replayRunId);
    expect(baselineSnapshot.run.taskInput).toBe(evaluationCase.taskInput);
    expect(replaySnapshot.run.taskInput).toBe(evaluationCase.taskInput);
    expect(baselineSnapshot.run.memoryIsolationMode).toBe("run_scoped");
    expect(replaySnapshot.run.memoryIsolationMode).toBe("run_scoped");
  });
});
