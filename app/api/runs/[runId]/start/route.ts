import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const result = await runService.startRun(runId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "启动运行失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
