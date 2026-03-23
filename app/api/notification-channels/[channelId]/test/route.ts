import { NextResponse } from "next/server";
import { notificationService } from "@/server/notification/notification-service";

export async function POST(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const result = await notificationService.testChannel(channelId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
