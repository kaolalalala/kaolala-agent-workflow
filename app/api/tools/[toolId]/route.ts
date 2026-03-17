import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { ToolDefinition } from "@/server/tools/contracts";

export async function GET(_: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    return NextResponse.json(runService.getTool(toolId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工具详情失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    const body = (await request.json()) as Partial<ToolDefinition>;
    return NextResponse.json(runService.updateTool(toolId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    return NextResponse.json(runService.disableTool(toolId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "停用工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
