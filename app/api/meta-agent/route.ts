import { NextResponse } from "next/server";
import { metaAgentService } from "@/server/meta-agent/meta-agent-service";

/**
 * POST /api/meta-agent — Start a Meta-Agent session
 * Body: { goal: string, maxIterations?: number, qualityThreshold?: number, workflowTemplateId?: string }
 *
 * GET /api/meta-agent?sessionId=xxx — Poll session status
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { goal, maxIterations, qualityThreshold, workflowTemplateId } = body;

    if (!goal || typeof goal !== "string" || !goal.trim()) {
      return NextResponse.json({ error: "goal is required" }, { status: 400 });
    }

    // Run meta-agent (this is a long-running operation)
    const result = await metaAgentService.run({
      goal: goal.trim(),
      maxIterations: maxIterations ?? 3,
      qualityThreshold: qualityThreshold ?? 0.7,
      workflowTemplateId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta-Agent 执行失败" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (sessionId) {
    const session = metaAgentService.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  }

  return NextResponse.json({ message: "Meta-Agent API. POST with { goal } to start." });
}
