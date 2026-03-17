import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      input?: Record<string, unknown>;
      timeoutMs?: number;
      maxRetries?: number;
    };
    return NextResponse.json(await runService.testCallTool(toolId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "测试调用工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
