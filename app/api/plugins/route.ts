import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { ToolPluginManifest } from "@/server/tools/contracts";

export async function GET() {
  try {
    return NextResponse.json(runService.listToolPlugins());
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询插件列表失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ToolPluginManifest;
    return NextResponse.json(runService.installToolPlugin(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "安装插件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

