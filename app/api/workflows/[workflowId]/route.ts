import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await params;
    const versionId = new URL(request.url).searchParams.get("versionId") ?? undefined;
    return NextResponse.json(runService.getWorkflow(workflowId, versionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取工作流失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await params;
    const body = (await request.json()) as { name?: string; description?: string; projectId?: string };
    return NextResponse.json(
      runService.updateWorkflowMeta({
        workflowId,
        projectId: body.projectId,
        name: body.name,
        description: body.description,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工作流失败";
    const status = message.includes("不能为空") ? 400 : message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await params;
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    return NextResponse.json(runService.deleteWorkflow(workflowId, projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除工作流失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
