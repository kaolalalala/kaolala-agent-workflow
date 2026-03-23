import { NextResponse } from "next/server";
import { notificationService } from "@/server/notification/notification-service";

export async function GET() {
  try {
    const channels = notificationService.listChannels();
    return NextResponse.json({ channels });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "列表获取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, channelType, adapterType, config, triggerOnSuccess, triggerOnFailure, enabled } = body;
    if (!name || !channelType || !adapterType || !config) {
      return NextResponse.json({ error: "缺少必要参数: name, channelType, adapterType, config" }, { status: 400 });
    }
    const channel = notificationService.createChannel({
      name,
      channelType,
      adapterType,
      config,
      triggerOnSuccess,
      triggerOnFailure,
      enabled,
    });
    return NextResponse.json(channel, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}
