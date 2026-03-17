import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function resolveApiErrorStatus(message: string) {
  if (message.includes("不存在")) {
    return 404;
  }
  if (message.includes("不能为空") || message.includes("无效") || message.includes("invalid")) {
    return 400;
  }
  return 500;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const daysParam = Number(url.searchParams.get("days") ?? "7");
    const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(90, Math.floor(daysParam))) : 7;
    const runTypeParam = url.searchParams.get("runType");
    const runType = runTypeParam === "workflow_run" || runTypeParam === "dev_run" ? runTypeParam : undefined;
    return NextResponse.json(runService.getRunsAnalytics(days, runType));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取运行分析失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
