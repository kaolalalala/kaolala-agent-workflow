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
    return NextResponse.json(runService.listModelAssets());
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取模型资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      provider?: string;
      model?: string;
      baseUrl?: string;
      credentialId?: string;
      enabled?: boolean;
    };
    return NextResponse.json(runService.createModelAsset(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建模型资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
