import { NextResponse } from "next/server";

import { workspaceService } from "@/server/workspace/workspace-service";

/** GET /api/workspace/agents/:workspaceId/files/:filePath — read a file */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; filePath: string[] }> },
) {
  try {
    const { workspaceId, filePath } = await params;
    const path = filePath.join("/");
    const file = workspaceService.readFile(workspaceId, path);
    return NextResponse.json(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取文件失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

/** PUT /api/workspace/agents/:workspaceId/files/:filePath — update a file */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; filePath: string[] }> },
) {
  try {
    const { workspaceId, filePath } = await params;
    const path = filePath.join("/");
    const body = (await request.json()) as { content: string };

    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "缺少 content 字段" }, { status: 400 });
    }

    workspaceService.ensureWorkspace(workspaceId);
    const fileInfo = workspaceService.writeFile(workspaceId, path, body.content);
    return NextResponse.json(fileInfo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存文件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** DELETE /api/workspace/agents/:workspaceId/files/:filePath — delete a file */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; filePath: string[] }> },
) {
  try {
    const { workspaceId, filePath } = await params;
    const path = filePath.join("/");
    workspaceService.deleteFile(workspaceId, path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除文件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
