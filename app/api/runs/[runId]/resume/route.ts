import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

/**
 * POST /api/runs/:runId/resume
 * Resume a run that was interrupted by a process crash.
 * Uses durable execution checkpoints to skip already-completed nodes.
 */
export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const result = await runService.resumeRun(runId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "恢复运行失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
