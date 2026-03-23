import { NextResponse } from "next/server";

import { workspaceService } from "@/server/workspace/workspace-service";

/** POST /api/workspace/agents/:workspaceId/upload-zip — import a ZIP archive */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "缺少 ZIP 文件" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await workspaceService.importZip(workspaceId, buffer);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入 ZIP 失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
