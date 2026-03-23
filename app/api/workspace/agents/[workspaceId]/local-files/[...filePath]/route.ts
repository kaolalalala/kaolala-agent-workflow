import { NextResponse } from "next/server";

import { localProjectService } from "@/server/workspace/local-project-service";

type Params = Promise<{ workspaceId: string; filePath: string[] }>;

/** GET — read a file from local project */
export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const { workspaceId, filePath } = await params;
    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }

    const path = filePath.join("/");
    const file = localProjectService.readFile(config.localPath, path);
    return NextResponse.json(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取文件失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

/** PUT — write a file to local project */
export async function PUT(request: Request, { params }: { params: Params }) {
  try {
    const { workspaceId, filePath } = await params;
    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }

    const path = filePath.join("/");
    const body = (await request.json()) as { content: string };
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "缺少 content 字段" }, { status: 400 });
    }

    const fileInfo = localProjectService.writeFile(config.localPath, path, body.content);
    return NextResponse.json(fileInfo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存文件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** DELETE — delete a file from local project */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  try {
    const { workspaceId, filePath } = await params;
    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }

    const path = filePath.join("/");
    localProjectService.deleteFile(config.localPath, path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除文件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
