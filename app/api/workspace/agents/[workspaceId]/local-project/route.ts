import { NextResponse } from "next/server";

import { localProjectService } from "@/server/workspace/local-project-service";

/** GET — get local project config */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }
    return NextResponse.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取本地工程配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** PUT — create or update local project config */
export async function PUT(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const body = (await request.json()) as {
      localPath: string;
      entryFile?: string;
      runCommand?: string;
      environmentId?: string;
    };

    if (!body.localPath) {
      return NextResponse.json({ error: "缺少 localPath" }, { status: 400 });
    }

    const config = localProjectService.saveConfig(workspaceId, body);
    return NextResponse.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存本地工程配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** DELETE — remove local project binding */
export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    localProjectService.deleteConfig(workspaceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除本地工程配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
