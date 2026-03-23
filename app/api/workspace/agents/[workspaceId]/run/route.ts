import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

/** POST /api/workspace/agents/:workspaceId/run — execute a script in workspace (tracked as dev_run) */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const body = (await request.json()) as {
      entryFile: string;
      runCommand: string;
      env?: Record<string, string>;
      input?: string;
      environmentId?: string;
    };

    if (!body.runCommand) {
      return NextResponse.json({ error: "缺少 runCommand" }, { status: 400 });
    }

    const result = await runService.createDevRun({
      workspaceId,
      entryFile: body.entryFile || undefined,
      runCommand: body.runCommand,
      resolvedInput: body.input ?? "",
      env: body.env,
      environmentId: body.environmentId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行脚本失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
