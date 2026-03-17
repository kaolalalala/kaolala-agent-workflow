import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await params;
    const body = (await request.json().catch(() => ({}))) as { versionId?: string };
    return NextResponse.json(runService.publishWorkflowVersion(workflowId, body.versionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布工作流失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
