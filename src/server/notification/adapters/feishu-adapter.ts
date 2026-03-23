import { createHmac } from "node:crypto";

import type { NotificationAdapter, NotificationPayload } from "../types";
import { buildMessage } from "./generic-webhook-adapter";

export const feishuAdapter: NotificationAdapter = {
  async send(config, payload) {
    const url = config.webhookUrl as string;
    if (!url) throw new Error("飞书 Webhook URL is required");

    const body: Record<string, unknown> = {
      msg_type: "text",
      content: { text: buildMessage(payload) },
    };

    // 飞书签名验证（可选）
    if (config.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const stringToSign = `${timestamp}\n${config.secret}`;
      const sign = createHmac("sha256", stringToSign).update("").digest("base64");
      body.timestamp = timestamp;
      body.sign = sign;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Feishu HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  },
};
