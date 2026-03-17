import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const url = new URL(request.url);
    const nodeId = url.searchParams.get("nodeId") ?? undefined;
    return NextResponse.json(runService.getTraces(runId, nodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询调试追踪失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
