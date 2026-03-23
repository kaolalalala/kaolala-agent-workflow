import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET() {
  try {
    return NextResponse.json(runService.listCredentials());
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询凭证失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { provider?: string; label?: string; apiKey?: string };
    return NextResponse.json(runService.createCredential(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "新增凭证失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
