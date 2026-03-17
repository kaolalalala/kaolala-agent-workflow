import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function GET(request: Request) {
  try {
    const templateType = new URL(request.url).searchParams.get("templateType");
    return NextResponse.json(
      runService.listPromptTemplateAssets(
        templateType === "system" || templateType === "agent" || templateType === "workflow"
          ? templateType
          : undefined,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取 Prompt 模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      templateType?: "system" | "agent" | "workflow";
      description?: string;
      content?: string;
      enabled?: boolean;
    };
    return NextResponse.json(runService.createPromptTemplateAsset(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建 Prompt 模板失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
