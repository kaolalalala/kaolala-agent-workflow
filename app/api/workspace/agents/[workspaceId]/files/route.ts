import { NextResponse } from "next/server";

import { workspaceService } from "@/server/workspace/workspace-service";

/** GET /api/workspace/agents/:workspaceId/files — list all files */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const tree = workspaceService.listFiles(workspaceId);
    return NextResponse.json(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取文件列表失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** POST /api/workspace/agents/:workspaceId/files — create/upload a file */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const body = (await request.json()) as {
      path: string;
      content?: string;
      base64Content?: string;
    };

    if (!body.path) {
      return NextResponse.json({ error: "缺少文件路径" }, { status: 400 });
    }

    workspaceService.ensureWorkspace(workspaceId);

    let fileInfo;
    if (body.base64Content) {
      fileInfo = workspaceService.uploadFile(workspaceId, body.path, body.base64Content);
    } else {
      fileInfo = workspaceService.writeFile(workspaceId, body.path, body.content ?? "");
    }

    return NextResponse.json(fileInfo, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
