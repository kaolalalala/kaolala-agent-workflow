import { NextResponse } from "next/server";

import { evaluationService } from "@/server/evaluation/evaluation-service";

export async function GET() {
  try {
    return NextResponse.json({ suites: evaluationService.listSuites() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取评测套件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      workflowId?: string;
      workflowVersionId?: string;
      enabled?: boolean;
    };
    return NextResponse.json({
      suite: evaluationService.createSuite(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建评测套件失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
