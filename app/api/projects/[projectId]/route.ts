import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function resolveApiErrorStatus(message: string) {
  if (message.includes("不存在")) {
    return 404;
  }
  if (message.includes("不能为空") || message.includes("无效") || message.includes("invalid json") || message.includes("0 到 2")) {
    return 400;
  }
  if (message.includes("UNIQUE constraint failed") || message.includes("已存在")) {
    return 409;
  }
  return 500;
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    return NextResponse.json(runService.getProject(projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取项目详情失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      archived?: boolean;
      settings?: {
        defaultProvider?: string;
        defaultModel?: string;
        defaultBaseUrl?: string;
        defaultCredentialId?: string;
        defaultTemperature?: number;
        projectNotes?: string;
      };
    };
    return NextResponse.json(runService.updateProject(projectId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新项目失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    return NextResponse.json(runService.deleteProject(projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除项目失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
