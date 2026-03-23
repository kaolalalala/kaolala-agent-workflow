import { NextResponse } from "next/server";

import {
  extractMarkdownFilesFromUploads,
  planWorkflowFromSkillPack,
  type SkillPackUploadFile,
} from "@/server/planner/skill-pack-planner";

function resolveApiErrorStatus(message: string) {
  if (message.includes("不存在")) {
    return 404;
  }
  if (
    message.includes("未检测到")
    || message.includes("未发现")
    || message.includes("不能为空")
    || message.includes("过大")
    || message.includes("无效")
  ) {
    return 400;
  }
  return 500;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    await params; // 保留 projectId 语义，确保请求在项目上下文中处理
    const form = await request.formData();
    const workflowName = String(form.get("workflowName") || "").trim();
    const workflowDescription = String(form.get("workflowDescription") || "").trim();
    const preferLlmRaw = String(form.get("preferLlm") || "1").trim();

    const uploads: SkillPackUploadFile[] = [];
    for (const value of form.values()) {
      if (!(value instanceof File)) {
        continue;
      }
      const bytes = new Uint8Array(await value.arrayBuffer());
      uploads.push({
        name: value.name,
        bytes,
      });
    }

    const markdownFiles = await extractMarkdownFilesFromUploads(uploads);
    const result = await planWorkflowFromSkillPack({
      markdownFiles,
      workflowName: workflowName || undefined,
      workflowDescription: workflowDescription || undefined,
      preferLlm: preferLlmRaw !== "0",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Skill Pack 解析失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

