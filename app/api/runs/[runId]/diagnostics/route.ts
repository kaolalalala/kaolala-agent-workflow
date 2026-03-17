import { NextResponse } from "next/server";

import { runService } from "@/server/api/run-service";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const report = runService.exportRunDiagnostics(runId);
    const url = new URL(request.url);
    const download = url.searchParams.get("download");

    if (download === "1" || download === "true") {
      return new NextResponse(JSON.stringify(report, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="run-${runId}-diagnostics.json"`,
        },
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出诊断失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
