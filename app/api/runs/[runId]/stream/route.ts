import { eventStreamHub } from "@/server/api/event-stream";
import { runService } from "@/server/api/run-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    runService.getRunSnapshot(runId);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        const write = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // 流已关闭，忽略写入错误
          }
        };

        write({ type: "connected", runId });

        const unsubscribe = eventStreamHub.subscribe(runId, (event) => {
          write({ type: "event", event });
        });

        const heartbeat = setInterval(() => {
          write({ type: "heartbeat", t: Date.now() });
        }, 15000);

        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          unsubscribe();
          controller.close();
        });
      },
      cancel() {
        return;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
