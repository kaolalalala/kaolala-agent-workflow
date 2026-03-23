import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as executeCasePost } from "../../../app/api/evaluations/cases/[caseId]/execute/route";
import { GET as getEvaluationRunGet } from "../../../app/api/evaluations/runs/[evaluationRunId]/route";
import { GET as listEvaluationRunsGet } from "../../../app/api/evaluations/runs/route";
import { POST as createCasePost, GET as listCasesGet } from "../../../app/api/evaluations/suites/[suiteId]/cases/route";
import { POST as createSuitePost, GET as listSuitesGet } from "../../../app/api/evaluations/suites/route";
import { configService } from "@/server/config/config-service";
import { memoryStore } from "@/server/store/memory-store";

describe("evaluation api routes", () => {
  beforeEach(() => {
    memoryStore.reset();
    configService.resetForTests();
    vi.useFakeTimers();
  });

  it("supports suite -> case -> execute evaluation flow", async () => {
    const workflow = configService.saveWorkflow({
      name: "评测 API 工作流",
      rootTaskInput: "测试输入",
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

    const createSuiteResponse = await createSuitePost(
      new Request("http://localhost/api/evaluations/suites", {
        method: "POST",
        body: JSON.stringify({
          name: "API 评测套件",
          workflowId: workflow.id,
          workflowVersionId: workflow.currentVersionId,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const suiteBody = (await createSuiteResponse.json()) as { suite: { id: string } };
    expect(createSuiteResponse.status).toBe(200);
    expect(suiteBody.suite.id).toBeTruthy();

    const listSuiteResponse = await listSuitesGet();
    const listedSuites = (await listSuiteResponse.json()) as { suites: Array<{ id: string }> };
    expect(listedSuites.suites.some((suite) => suite.id === suiteBody.suite.id)).toBe(true);

    const createCaseResponse = await createCasePost(
      new Request(`http://localhost/api/evaluations/suites/${suiteBody.suite.id}/cases`, {
        method: "POST",
        body: JSON.stringify({
          name: "基础用例",
          taskInput: "请给出 mock-agent-v1 的结果",
          expectedOutputContains: "mock-agent-v1",
        }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ suiteId: suiteBody.suite.id }) },
    );
    const caseBody = (await createCaseResponse.json()) as { case: { id: string } };
    expect(createCaseResponse.status).toBe(200);
    expect(caseBody.case.id).toBeTruthy();

    const listCasesResponse = await listCasesGet(
      new Request(`http://localhost/api/evaluations/suites/${suiteBody.suite.id}/cases`),
      { params: Promise.resolve({ suiteId: suiteBody.suite.id }) },
    );
    const listedCases = (await listCasesResponse.json()) as { cases: Array<{ id: string }> };
    expect(listedCases.cases.some((item) => item.id === caseBody.case.id)).toBe(true);

    const executePromise = executeCasePost(
      new Request(`http://localhost/api/evaluations/cases/${caseBody.case.id}/execute`, { method: "POST" }),
      { params: Promise.resolve({ caseId: caseBody.case.id }) },
    );
    await vi.runAllTimersAsync();
    const executeResponse = await executePromise;
    const executeBody = (await executeResponse.json()) as {
      report: {
        suiteId: string;
        caseId: string;
        score: number;
        verdict: string;
        baseline: { memoryIsolationMode?: string };
        replay: { memoryIsolationMode?: string };
        compare: { toolFailureDelta: number };
      };
    };

    expect(executeResponse.status).toBe(200);
    expect(executeBody.report.suiteId).toBe(suiteBody.suite.id);
    expect(executeBody.report.caseId).toBe(caseBody.case.id);
    expect(typeof executeBody.report.score).toBe("number");
    expect(["pass", "warn", "fail"]).toContain(executeBody.report.verdict);
    expect(executeBody.report.baseline.memoryIsolationMode).toBe("run_scoped");
    expect(executeBody.report.replay.memoryIsolationMode).toBe("run_scoped");
    expect(typeof executeBody.report.compare.toolFailureDelta).toBe("number");

    const evaluationRunsResponse = await listEvaluationRunsGet(
      new Request("http://localhost/api/evaluations/runs?limit=10"),
    );
    const evaluationRunsBody = (await evaluationRunsResponse.json()) as {
      evaluationRuns: Array<{ id: string }>;
    };
    expect(evaluationRunsResponse.status).toBe(200);
    expect(evaluationRunsBody.evaluationRuns.length).toBeGreaterThan(0);

    const latestEvaluationRunId = evaluationRunsBody.evaluationRuns[0]?.id;
    expect(latestEvaluationRunId).toBeTruthy();

    const evaluationRunResponse = await getEvaluationRunGet(
      new Request(`http://localhost/api/evaluations/runs/${latestEvaluationRunId}`),
      { params: Promise.resolve({ evaluationRunId: latestEvaluationRunId! }) },
    );
    const evaluationRunBody = (await evaluationRunResponse.json()) as {
      evaluationRun: {
        id: string;
        report?: {
          score: number;
          verdict: string;
          baseline: { taskInput?: string };
          replay: { taskInput?: string };
          artifacts: { missingReplayFiles: string[] };
        };
      };
    };
    expect(evaluationRunResponse.status).toBe(200);
    expect(evaluationRunBody.evaluationRun.id).toBe(latestEvaluationRunId);
    expect(typeof evaluationRunBody.evaluationRun.report?.score).toBe("number");
    expect(typeof evaluationRunBody.evaluationRun.report?.baseline.taskInput).toBe("string");
    expect(typeof evaluationRunBody.evaluationRun.report?.replay.taskInput).toBe("string");
    expect(Array.isArray(evaluationRunBody.evaluationRun.report?.artifacts.missingReplayFiles)).toBe(true);
  });
});
