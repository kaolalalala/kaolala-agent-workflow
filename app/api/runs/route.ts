import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

type RunStatusFilter = "running" | "success" | "failed";
type RunSort = "time_desc" | "time_asc" | "duration_desc" | "duration_asc" | "tokens_desc" | "tokens_asc";

function resolveApiErrorStatus(message: string) {
  if (message.includes("不存在")) {
    return 404;
  }
  if (message.includes("不能为空") || message.includes("无效") || message.includes("invalid")) {
    return 400;
  }
  return 500;
}

function parseRunStatus(value: string | null): RunStatusFilter | undefined {
  if (value === "running" || value === "success" || value === "failed") {
    return value;
  }
  return undefined;
}

function parseRunSort(value: string | null): RunSort | undefined {
  if (
    value === "time_desc"
    || value === "time_asc"
    || value === "duration_desc"
    || value === "duration_asc"
    || value === "tokens_desc"
    || value === "tokens_asc"
  ) {
    return value;
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const limitParam = Number(url.searchParams.get("limit") ?? "40");
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.floor(limitParam))) : 40;

    if (projectId) {
      return NextResponse.json(runService.listProjectRuns(projectId, limit));
    }

    const status = parseRunStatus(url.searchParams.get("status"));
    const sort = parseRunSort(url.searchParams.get("sort"));
    const q = url.searchParams.get("q") ?? undefined;
    const workflowId = url.searchParams.get("workflowId") ?? undefined;
    const runTypeParam = url.searchParams.get("runType");
    const runType = runTypeParam === "workflow_run" || runTypeParam === "dev_run" ? runTypeParam : undefined;

    return NextResponse.json(runService.listRuns({
      limit,
      status,
      q,
      workflowId,
      sort,
      runType,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取运行记录失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      task?: string;
      runMode?: "standard" | "sequential" | "safe";
      workflowId?: string;
      workflowVersionId?: string;
      workflow?: {
        nodes?: Array<{
          id: string;
          name: string;
          role: string;
          status?: string;
          taskSummary?: string;
          responsibilitySummary?: string;
          position?: { x: number; y: number };
          width?: number;
          height?: number;
        }>;
        edges?: Array<{
          id: string;
          sourceNodeId: string;
          targetNodeId: string;
          type: "task_flow" | "output_flow";
          condition?: string;
        }>;
        tasks?: Array<{
          id: string;
          title: string;
          status: string;
          parentTaskId?: string;
          assignedNodeId?: string;
          summary?: string;
        }>;
      };
    };
    const payload = runService.createRun({
      task: body.task ?? "",
      runMode: body.runMode,
      workflowId: body.workflowId,
      workflowVersionId: body.workflowVersionId,
      workflow: body.workflow
        ? {
            nodes: body.workflow.nodes ?? [],
            edges: body.workflow.edges ?? [],
            tasks: body.workflow.tasks ?? [],
          }
        : undefined,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建运行失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
