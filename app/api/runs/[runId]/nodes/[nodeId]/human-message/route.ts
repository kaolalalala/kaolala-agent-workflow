import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import { HumanMessageAttachment } from "@/server/domain";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    const { runId, nodeId } = await params;
    const body = (await request.json()) as { content?: string; attachments?: HumanMessageAttachment[] };
    const payload = runService.sendHumanMessage(runId, nodeId, body.content ?? "", body.attachments ?? []);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送人工消息失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
