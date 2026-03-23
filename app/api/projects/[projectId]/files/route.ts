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
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitParam) ? limitParam : 200;
    return NextResponse.json(runService.listProjectFiles(projectId, limit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取项目文件失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
