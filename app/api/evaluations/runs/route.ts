import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  return NextResponse.json(runService.listEvaluationRuns(limit));
}
