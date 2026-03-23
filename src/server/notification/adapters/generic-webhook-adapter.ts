import type { NotificationAdapter, NotificationPayload } from "../types";

function buildMessage(p: NotificationPayload): string {
  if (p.eventType === "test") return "🔔 通知测试 — 如果你收到了这条消息，说明通道配置正确！";
  const icon = p.eventType === "run_completed" ? "✅" : "❌";
  const status = p.eventType === "run_completed" ? "成功" : "失败";
  const parts = [`${icon} 运行${status}: ${p.runName || p.runId || "unknown"}`];
  if (p.workflowName) parts.push(`工作流: ${p.workflowName}`);
  if (p.durationMs) parts.push(`耗时: ${(p.durationMs / 1000).toFixed(1)}s`);
  if (p.tokenTotal) parts.push(`Token: ${p.tokenTotal}`);
  if (p.error) parts.push(`错误: ${p.error}`);
  return parts.join("\n");
}

export const genericWebhookAdapter: NotificationAdapter = {
  async send(config, payload) {
    const url = config.url as string;
    if (!url) throw new Error("Webhook URL is required");
    const method = (config.method as string) || "POST";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.headers && typeof config.headers === "object") {
      Object.assign(headers, config.headers);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify({ text: buildMessage(payload), ...payload }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    } finally {
      clearTimeout(timer);
    }
  },
};

export { buildMessage };
