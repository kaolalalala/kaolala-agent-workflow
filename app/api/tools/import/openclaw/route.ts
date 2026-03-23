import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tools?: Array<{
        id?: string;
        name?: string;
        description?: string;
        category?: "search" | "retrieval" | "automation" | "analysis" | "integration" | "custom";
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        sourceConfig?: Record<string, unknown>;
        authRequirements?: {
          type?: "none" | "credential_ref" | "api_key" | "oauth2" | "custom";
          required?: boolean;
          fields?: string[];
          description?: string;
        };
        policy?: {
          timeoutMs?: number;
          maxRetries?: number;
          retryBackoffMs?: number;
        };
        enabled?: boolean;
      }>;
    };
    return NextResponse.json(runService.importOpenClawTools(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入 OpenClaw 工具失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
