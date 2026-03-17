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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeArchived = ["1", "true", "yes"].includes((url.searchParams.get("includeArchived") ?? "").toLowerCase());
    return NextResponse.json(runService.listProjects({ includeArchived }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取项目列表失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; description?: string };
    return NextResponse.json(runService.createProject(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建项目失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
