import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const nodeId = url.searchParams.get("nodeId") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    return NextResponse.json(runService.queryLongTermMemory(runId, { query, nodeId, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "长期记忆检索失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

