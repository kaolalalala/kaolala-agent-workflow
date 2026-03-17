import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function toText(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function includesQuery(query: string, values: unknown[]) {
  return values.some((value) => toText(value).includes(query));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const limitParam = Number(url.searchParams.get("limit") ?? "8");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 20) : 8;

    if (!query) {
      return NextResponse.json({ projects: [], workflows: [], runs: [], files: [] });
    }

    const projects = runService
      .listProjects({ includeArchived: true })
      .projects.filter((item) => includesQuery(query, [item.id, item.name, item.description]))
      .slice(0, limit);

    const workflows = runService
      .listWorkflows()
      .workflows.filter((item) => includesQuery(query, [item.id, item.name, item.description, item.projectId]))
      .slice(0, limit);

    const runs = runService
      .listRuns(Math.max(limit * 4, 40))
      .runs.filter((item) =>
        includesQuery(query, [item.id, item.workflowId, item.workflowName, item.projectId, item.summary]),
      )
      .slice(0, limit);

    const files = runService
      .listRecentFiles(Math.max(limit * 5, 60))
      .files.filter((item) =>
        includesQuery(query, [item.id, item.name, item.type, item.workflowName, item.workflowId, item.runId, item.projectId]),
      )
      .slice(0, limit);

    return NextResponse.json({ projects, workflows, runs, files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "全局搜索失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
