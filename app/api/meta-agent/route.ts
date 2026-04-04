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
    const {
      goal,
      projectId,
      maxPlanningRounds,
      maxStepLimit,
      maxIterations,
      qualityThreshold,
      workflowTemplateId,
      mode,
    } = body;

    if (!goal || typeof goal !== "string" || !goal.trim()) {
      return NextResponse.json({ error: "goal is required" }, { status: 400 });
    }

    const payload = {
      goal: goal.trim(),
      projectId: typeof projectId === "string" && projectId.trim() ? projectId.trim() : "default_project",
      maxPlanningRounds: maxPlanningRounds ?? maxIterations ?? 3,
      maxStepLimit: maxStepLimit ?? Math.max(12, ((maxPlanningRounds ?? maxIterations ?? 3)) * 4),
      maxIterations: maxIterations ?? maxPlanningRounds ?? 3,
      qualityThreshold: qualityThreshold ?? 0.7,
      workflowTemplateId,
    };

    // Backward-compatible: allow sync mode for API callers that still expect final result.
    if (mode === "sync") {
      const result = await metaAgentService.run(payload);
      return NextResponse.json(result);
    }

    const session = metaAgentService.start(payload);
    return NextResponse.json(
      {
        ok: true,
        mode: "async",
        ...session,
      },
      { status: 202 },
    );
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
  const projectId = url.searchParams.get("projectId");
  const limitParam = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, Math.floor(limitParam))) : undefined;

  if (sessionId) {
    const session = metaAgentService.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  }

  const sessions = metaAgentService.listSessions()
    .filter((session) => !projectId || session.projectId === projectId)
    .slice(0, limit ?? undefined);

  return NextResponse.json({
    message: "Meta-Agent API. POST with { goal } to start.",
    sessions,
  });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    const result = metaAgentService.deleteSession(sessionId);
    if (!result.deleted) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete session";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
