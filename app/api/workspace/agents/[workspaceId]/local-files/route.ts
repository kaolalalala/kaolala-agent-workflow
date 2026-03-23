import { NextResponse } from "next/server";

import { localProjectService } from "@/server/workspace/local-project-service";

/** GET — list files in local project directory */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }
    const files = localProjectService.listFiles(config.localPath);
    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取文件列表失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** POST — create a file in local project directory */
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }

    const body = (await request.json()) as { path: string; content?: string; isDirectory?: boolean };
    if (!body.path) {
      return NextResponse.json({ error: "缺少文件路径" }, { status: 400 });
    }

    let fileInfo;
    if (body.isDirectory) {
      fileInfo = localProjectService.createDirectory(config.localPath, body.path);
    } else {
      fileInfo = localProjectService.createFile(config.localPath, body.path, body.content);
    }

    return NextResponse.json(fileInfo, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建文件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
