import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(_: Request, { params }: { params: Promise<{ toolId: string }> }) {
  try {
    const { toolId } = await params;
    return NextResponse.json(runService.validateTool(toolId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "验证工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
