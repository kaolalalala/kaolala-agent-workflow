import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { StoredWorkflowEdge, StoredWorkflowNode, StoredWorkflowTask } from "@/server/domain";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    return NextResponse.json(runService.getWorkflowTemplate(templateId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取工作流模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const body = (await request.json()) as Partial<{
      name: string;
      description: string;
      rootTaskInput: string;
      nodes: StoredWorkflowNode[];
      edges: StoredWorkflowEdge[];
      tasks: StoredWorkflowTask[];
      enabled: boolean;
    }>;
    return NextResponse.json(runService.updateWorkflowTemplate(templateId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工作流模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    return NextResponse.json(runService.deleteWorkflowTemplate(templateId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除工作流模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
