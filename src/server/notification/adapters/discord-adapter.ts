import type { NotificationAdapter } from "../types";
import { buildMessage } from "./generic-webhook-adapter";

export const discordAdapter: NotificationAdapter = {
  async send(config, payload) {
    const url = config.webhookUrl as string;
    if (!url) throw new Error("Discord Webhook URL is required");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: buildMessage(payload) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  },
};
