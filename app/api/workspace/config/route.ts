import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET() {
  try {
    return NextResponse.json(runService.getWorkspaceConfig());
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工作区配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      defaultProvider?: string;
      defaultModel?: string;
      defaultBaseUrl?: string;
      defaultCredentialId?: string;
      defaultTemperature?: number;
    };

    return NextResponse.json(runService.updateWorkspaceConfig(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新工作区配置失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
