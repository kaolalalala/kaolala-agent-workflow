import { createHmac } from "node:crypto";

import type { NotificationAdapter, NotificationPayload } from "../types";
import { buildMessage } from "./generic-webhook-adapter";

export const dingtalkAdapter: NotificationAdapter = {
  async send(config, payload) {
    let url = config.webhookUrl as string;
    if (!url) throw new Error("钉钉 Webhook URL is required");

    // 钉钉签名验证（可选）
    if (config.secret) {
      const timestamp = Date.now().toString();
      const stringToSign = `${timestamp}\n${config.secret}`;
      const sign = encodeURIComponent(
        createHmac("sha256", config.secret as string).update(stringToSign).digest("base64"),
      );
      url += `${url.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${sign}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: buildMessage(payload) },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`DingTalk HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  },
};
