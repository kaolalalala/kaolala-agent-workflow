import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

interface RouteContext {
  params: Promise<{
    evaluationRunId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { evaluationRunId } = await context.params;
  return NextResponse.json(runService.getEvaluationRun(evaluationRunId));
}
