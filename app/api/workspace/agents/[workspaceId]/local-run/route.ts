import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";
import { localProjectService } from "@/server/workspace/local-project-service";

/** POST — execute a command in local project directory (tracked as dev_run) */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;

    const config = localProjectService.getConfig(workspaceId);
    if (!config) {
      return NextResponse.json({ error: "未配置本地工程" }, { status: 404 });
    }

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
      cwdOverride: config.localPath,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行脚本失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
