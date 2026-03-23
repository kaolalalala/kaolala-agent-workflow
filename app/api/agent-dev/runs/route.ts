import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");

    if (runId) {
      return NextResponse.json(runService.getDevRunDetail(runId));
    }

    const limitParam = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, Math.floor(limitParam))) : 20;
    return NextResponse.json(runService.listDevRuns(limit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取开发运行记录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
