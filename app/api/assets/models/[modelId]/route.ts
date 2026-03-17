import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function PUT(request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const { modelId } = await params;
    const body = (await request.json()) as Partial<{
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      credentialId: string;
      enabled: boolean;
    }>;
    return NextResponse.json(runService.updateModelAsset(modelId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新模型资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const { modelId } = await params;
    return NextResponse.json(runService.deleteModelAsset(modelId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除模型资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
