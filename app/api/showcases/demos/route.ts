import { NextResponse } from "next/server";

import {
  showcaseDemoService,
  type ShowcaseDemoScenarioId,
} from "../../../../src/server/showcase/showcase-demo-service";

function resolveApiErrorStatus(message: string) {
  if (message.includes("not configured") || message.includes("disabled")) {
    return 400;
  }
  if (message.includes("不存在") || message.includes("not found")) {
    return 404;
  }
  return 500;
}

function parseScenarioId(value: unknown): ShowcaseDemoScenarioId | null {
  if (
    value === "durable-runtime"
    || value === "adaptive-reflection"
    || value === "whitebox-trace"
    || value === "parallel-wave"
    || value === "budget-guardrails"
    || value === "evaluation-gate"
  ) {
    return value;
  }
  return null;
}

export async function GET() {
  try {
    return NextResponse.json(showcaseDemoService.getStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取 showcase demo 状态失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "provision_all" | "provision_scenario" | "launch";
      scenarioId?: ShowcaseDemoScenarioId;
    };
    const action = body.action ?? "provision_all";

    if (action === "provision_all") {
      return NextResponse.json({
        ok: true,
        action,
        status: showcaseDemoService.provisionAll(),
      });
    }

    const scenarioId = parseScenarioId(body.scenarioId);
    if (!scenarioId) {
      return NextResponse.json({ error: "缺少 scenarioId" }, { status: 400 });
    }

    if (action === "provision_scenario") {
      return NextResponse.json({
        ok: true,
        action,
        scenarioId,
        status: showcaseDemoService.provisionScenario(scenarioId),
      });
    }

    if (action === "launch") {
      return NextResponse.json({
        ok: true,
        action,
        scenarioId,
        launch: await showcaseDemoService.launchScenario(scenarioId),
        status: showcaseDemoService.getStatus(),
      });
    }

    return NextResponse.json({ error: `不支持的 action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "showcase demo 操作失败";
    return NextResponse.json({ error: message }, { status: resolveApiErrorStatus(message) });
  }
}
