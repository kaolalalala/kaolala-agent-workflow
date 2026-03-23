import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { ToolDefinition } from "@/server/tools/contracts";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function GET() {
  try {
    return NextResponse.json(runService.listTools());
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取工具资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      toolId?: string;
      pluginId?: string;
      name?: string;
      description?: string;
      category?: ToolDefinition["category"];
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      sourceType?: ToolDefinition["sourceType"];
      sourceConfig?: Record<string, unknown>;
      authRequirements?: ToolDefinition["authRequirements"];
      policy?: ToolDefinition["policy"];
      enabled?: boolean;
    };
    return NextResponse.json(runService.createTool(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建工具资产失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
