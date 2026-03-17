import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function GET() {
  try {
    return NextResponse.json(runService.listScriptAssets());
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取脚本资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      localPath?: string;
      runCommand?: string;
      description?: string;
      parameterSchema?: Record<string, unknown>;
      defaultEnvironmentId?: string;
      enabled?: boolean;
    };
    return NextResponse.json(runService.createScriptAsset(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建脚本资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
