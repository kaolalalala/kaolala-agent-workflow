import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function resolveApiErrorStatus(message: string) {
  if (message.includes("不存在")) {
    return 404;
  }
  if (message.includes("不能为空") || message.includes("无效") || message.includes("invalid json") || message.includes("0 到 2")) {
    return 400;
  }
  if (message.includes("UNIQUE constraint failed") || message.includes("已存在")) {
    return 409;
  }
  return 500;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; fileId: string }> },
) {
  try {
    const { projectId, fileId } = await params;
    return NextResponse.json(runService.getProjectFile(projectId, fileId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取文件详情失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
