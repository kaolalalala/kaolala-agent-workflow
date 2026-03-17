import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import type { ToolScopeType } from "@/server/tools/contracts";

function parseScope(searchParams: URLSearchParams) {
  const scopeType = searchParams.get("scopeType") as ToolScopeType | null;
  const scopeId = searchParams.get("scopeId");
  return { scopeType: scopeType ?? undefined, scopeId: scopeId ?? undefined };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { scopeType, scopeId } = parseScope(url.searchParams);
    return NextResponse.json(runService.listToolBindings(scopeType, scopeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工具绑定失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      scopeType?: ToolScopeType;
      scopeId?: string;
      bindings?: Array<{
        toolId: string;
        enabled?: boolean;
        priority?: number;
        overrideConfig?: Record<string, unknown>;
      }>;
    };

    if (!body.scopeType || !body.scopeId) {
      return NextResponse.json({ error: "scopeType 和 scopeId 不能为空" }, { status: 400 });
    }

    return NextResponse.json(
      runService.replaceToolBindings(body.scopeType, body.scopeId, body.bindings ?? []),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工具绑定失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
