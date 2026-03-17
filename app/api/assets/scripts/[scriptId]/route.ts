import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function PUT(request: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  try {
    const { scriptId } = await params;
    const body = (await request.json()) as Partial<{
      name: string;
      description: string;
      localPath: string;
      runCommand: string;
      parameterSchema: Record<string, unknown>;
      defaultEnvironmentId: string;
      enabled: boolean;
    }>;
    return NextResponse.json(runService.updateScriptAsset(scriptId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新脚本资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  try {
    const { scriptId } = await params;
    return NextResponse.json(runService.deleteScriptAsset(scriptId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除脚本资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
