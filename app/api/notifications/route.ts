import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

interface NotificationItem {
  id: string;
  type: "run_success" | "run_failed" | "template_created";
  title: string;
  description: string;
  time: string;
  href?: string;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

    const runEvents: NotificationItem[] = runService
      .listRuns(Math.max(limit * 3, 40))
      .runs.filter((run) => run.status === "success" || run.status === "failed")
      .map((run) => {
        const time = run.updatedAt || run.finishedAt || run.startedAt;
        const statusText = run.status === "success" ? "成功" : "失败";
        return {
          id: `run:${run.id}:${time}`,
          type: run.status === "success" ? "run_success" : "run_failed",
          title: `工作流运行${statusText}`,
          description: `${run.workflowName} · ${new Date(time).toLocaleString("zh-CN")}`,
          time,
          href: run.projectId ? `/projects/${run.projectId}/runs/${run.id}` : `/runs?runId=${run.id}`,
        };
      });

    const templateEvents: NotificationItem[] = runService
      .listWorkflowTemplates()
      .workflowTemplates.map((item) => ({
        id: `template:${item.id}:${item.createdAt}`,
        type: "template_created" as const,
        title: "模板创建成功",
        description: `${item.name} · ${new Date(item.createdAt).toLocaleString("zh-CN")}`,
        time: item.createdAt,
        href: "/assets",
      }));

    const notifications = [...runEvents, ...templateEvents]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, limit);

    return NextResponse.json({ notifications });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取通知失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

