import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { ToolDefinition } from "@/server/tools/contracts";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function GET(_request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    return NextResponse.json(runService.getTool(toolId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取工具资产详情失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    const body = (await request.json()) as Partial<ToolDefinition>;
    return NextResponse.json(runService.updateTool(toolId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工具资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    return NextResponse.json(runService.deleteTool(toolId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除工具资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
