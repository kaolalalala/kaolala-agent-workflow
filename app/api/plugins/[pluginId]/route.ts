import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function PUT(request: Request, { params }: { params: Promise<{ pluginId: string }> }) {
  try {
    const { pluginId } = await params;
    const body = (await request.json()) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled 必须是 boolean" }, { status: 400 });
    }
    return NextResponse.json(runService.setToolPluginEnabled(pluginId, body.enabled));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新插件状态失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

