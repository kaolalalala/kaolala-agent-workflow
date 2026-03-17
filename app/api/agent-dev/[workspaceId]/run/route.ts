import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  return 500;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const body = (await request.json()) as {
      runCommand?: string;
      entryFile?: string;
      environmentId?: string;
    };
    const result = await runService.createDevRun({
      workspaceId,
      runCommand: body.runCommand ?? "",
      entryFile: body.entryFile,
      environmentId: body.environmentId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "开发运行失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
