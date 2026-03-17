import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import { memoryStore } from "@/server/store/memory-store";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string; nodeId: string }> }) {
  try {
    const { runId, nodeId } = await params;
    const node = memoryStore.getNodeById(runId, nodeId);
    if (!node) {
      return NextResponse.json({ error: "节点不存在" }, { status: 404 });
    }
    return NextResponse.json(runService.resolveToolsForNode(runId, nodeId, node.role));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询节点工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
