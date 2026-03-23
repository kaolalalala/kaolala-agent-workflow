import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ runId: string; candidateRunId: string }> },
) {
  try {
    const { runId, candidateRunId } = await params;
    return NextResponse.json(runService.compareRuns(runId, candidateRunId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "运行对比失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
