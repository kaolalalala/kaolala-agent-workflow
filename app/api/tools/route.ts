import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { ToolDefinition } from "@/server/tools/contracts";

export async function GET() {
  try {
    return NextResponse.json(runService.listTools());
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工具列表失败";
    return NextResponse.json({ error: message }, { status: 400 });
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
    const message = error instanceof Error ? error.message : "注册工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
