import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    const { runId, nodeId } = await params;
    const body = (await request.json().catch(() => ({}))) as { includeDownstream?: boolean };
    const payload = await runService.rerunFromNode(runId, nodeId, body.includeDownstream ?? true);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "节点重跑失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

