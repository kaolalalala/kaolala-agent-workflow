import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      autoStart?: boolean;
    };
    const payload = runService.createReplayRun({
      baselineRunId: runId,
      replayMode: "full",
      autoStart: body.autoStart ?? true,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建回放运行失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
