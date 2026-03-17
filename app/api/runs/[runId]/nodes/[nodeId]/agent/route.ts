import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    const { runId, nodeId } = await params;
    const payload = runService.getNodeAgent(runId, nodeId);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询节点 Agent 失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

