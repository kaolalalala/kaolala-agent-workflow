import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    const nodeId = url.searchParams.get("nodeId");
    if (!runId || !nodeId) {
      return NextResponse.json({ error: "缺少 runId 或 nodeId" }, { status: 400 });
    }
    return NextResponse.json(runService.listSkillBindings(runId, nodeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取技能绑定失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      runId?: string;
      nodeId?: string;
      skillId?: string;
      enabled?: boolean;
    };
    if (!body.runId || !body.nodeId || !body.skillId) {
      return NextResponse.json({ error: "缺少 runId、nodeId 或 skillId" }, { status: 400 });
    }
    return NextResponse.json(
      runService.upsertSkillBinding(body.runId, body.nodeId, body.skillId, body.enabled !== false),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存技能绑定失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const bindingId = url.searchParams.get("bindingId");
    if (!bindingId) {
      return NextResponse.json({ error: "缺少 bindingId" }, { status: 400 });
    }
    return NextResponse.json(runService.deleteSkillBinding(bindingId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除技能绑定失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
