import { NextResponse } from "next/server";

import { evaluationService } from "@/server/evaluation/evaluation-service";

export async function GET(_: Request, { params }: { params: Promise<{ suiteId: string }> }) {
  try {
    const { suiteId } = await params;
    return NextResponse.json({ cases: evaluationService.listCases(suiteId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取评测用例失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ suiteId: string }> }) {
  try {
    const { suiteId } = await params;
    const body = (await request.json()) as {
      name?: string;
      taskInput?: string;
      replayMode?: "full";
      expectedOutputContains?: string;
      expectedOutputRegex?: string;
      enabled?: boolean;
    };
    return NextResponse.json({
      case: evaluationService.createCase({
        suiteId,
        ...body,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建评测用例失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
