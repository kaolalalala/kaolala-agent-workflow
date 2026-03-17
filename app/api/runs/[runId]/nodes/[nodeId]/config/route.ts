import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    const { runId, nodeId } = await params;
    return NextResponse.json(runService.getNodeConfig(runId, nodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询节点配置失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    const { runId, nodeId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(runService.updateNodeConfig(runId, nodeId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新节点配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
