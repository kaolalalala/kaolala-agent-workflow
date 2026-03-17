import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function PUT(request: Request, { params }: { params: Promise<{ promptId: string }> }) {
  try {
    const { promptId } = await params;
    const body = (await request.json()) as Partial<{
      name: string;
      templateType: "system" | "agent" | "workflow";
      description: string;
      content: string;
      enabled: boolean;
    }>;
    return NextResponse.json(runService.updatePromptTemplateAsset(promptId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新 Prompt 模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ promptId: string }> }) {
  try {
    const { promptId } = await params;
    return NextResponse.json(runService.deletePromptTemplateAsset(promptId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除 Prompt 模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
