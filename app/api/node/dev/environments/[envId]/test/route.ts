import { NextResponse } from "next/server";

import { environmentService } from "@/server/environment/environment-service";

/** POST /api/node/dev/environments/:envId/test — test if environment is working */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ envId: string }> },
) {
  try {
    const { envId } = await params;
    const result = environmentService.test(envId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "测试环境失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
