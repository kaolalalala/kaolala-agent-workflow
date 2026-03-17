import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { AgentDocumentType } from "@/server/domain";

function isValidType(value: string): value is AgentDocumentType {
  return value === "prompt" || value === "skill" || value === "reference";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    const { runId, nodeId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    const typeRaw = String(form.get("type") ?? "prompt");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少文件" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".md")) {
      return NextResponse.json({ error: "仅支持 .md 文件" }, { status: 400 });
    }

    if (!isValidType(typeRaw)) {
      return NextResponse.json({ error: "文档类型非法" }, { status: 400 });
    }

    const content = await file.text();

    return NextResponse.json(
      runService.uploadNodeDocument(runId, nodeId, {
        type: typeRaw,
        name: file.name,
        content,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传文档失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
