import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params;
    return NextResponse.json(runService.deleteDocument(documentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除文档失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
