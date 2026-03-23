import { NextResponse } from "next/server";

import { environmentService } from "@/server/environment/environment-service";

/** GET /api/node/dev/environments — list available Python/Conda environments */
export async function GET() {
  try {
    const environments = environmentService.list();
    return NextResponse.json({ environments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取环境列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/node/dev/environments — force refresh environment list */
export async function POST() {
  try {
    const environments = environmentService.refresh();
    return NextResponse.json({ environments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "刷新环境列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
