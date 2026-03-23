import { NextRequest, NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET() {
  try {
    return NextResponse.json(runService.listWorkspaces());
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取工作台列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspace = runService.createWorkspace(body);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建工作台失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId 参数缺失" }, { status: 400 });
    }
    runService.deleteWorkspace(workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除工作台失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId, ...payload } = body;
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId 不能为空" }, { status: 400 });
    }
    const workspace = runService.updateWorkspace(workspaceId, payload);
    return NextResponse.json({ workspace });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工作台失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
