import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

function statusOf(message: string) {
  if (message.includes("不存在")) return 404;
  if (message.includes("不能为空") || message.includes("无效")) return 400;
  if (message.includes("已存在") || message.includes("UNIQUE")) return 409;
  return 500;
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ referenceId: string }> }) {
  try {
    const { referenceId } = await params;
    return NextResponse.json(runService.deleteWorkflowAssetReference(referenceId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除资产引用失败";
    return NextResponse.json({ error: message }, { status: statusOf(message) });
  }
}
