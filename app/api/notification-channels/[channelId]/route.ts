import { NextResponse } from "next/server";
import { notificationService } from "@/server/notification/notification-service";

export async function GET(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const channel = notificationService.getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "通道不存在" }, { status: 404 });
  return NextResponse.json(channel);
}

export async function PUT(request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const { channelId } = await params;
    const body = await request.json();
    const channel = notificationService.updateChannel(channelId, body);
    return NextResponse.json(channel);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  notificationService.deleteChannel(channelId);
  return NextResponse.json({ ok: true });
}
