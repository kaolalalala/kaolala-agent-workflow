import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    return NextResponse.json(runService.getEvents(runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询事件失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
