import { NextResponse } from "next/server";

import { evaluationService } from "@/server/evaluation/evaluation-service";

export async function POST(_: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await params;
    return NextResponse.json({
      report: await evaluationService.executeCase(caseId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行评测用例失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
