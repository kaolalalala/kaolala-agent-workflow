import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(_: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await params;
    return NextResponse.json(runService.listWorkflowVersions(workflowId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工作流版本失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
