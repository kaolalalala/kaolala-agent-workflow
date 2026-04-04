import { NextResponse } from "next/server";
import { metaAgentService } from "@/server/meta-agent/meta-agent-service";

/**
 * GET /api/meta-agent/bandit — Get Bandit model statistics
 * POST /api/meta-agent/bandit — Trigger cold-start training or reset
 *   Body: { action: "cold_start" | "reset", limit?: number }
 */
export async function GET() {
  try {
    const stats = metaAgentService.getBanditStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get Bandit stats" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, limit } = body;

    if (action === "cold_start") {
      const result = metaAgentService.coldStartTrain(limit ?? 50);
      return NextResponse.json({
        ok: true,
        action: "cold_start",
        ...result,
      });
    }

    if (action === "reset") {
      metaAgentService.resetBandit();
      return NextResponse.json({ ok: true, action: "reset" });
    }

    return NextResponse.json({ error: "Unknown action. Use 'cold_start' or 'reset'." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bandit operation failed" },
      { status: 500 },
    );
  }
}
