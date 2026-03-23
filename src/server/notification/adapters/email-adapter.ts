import nodemailer from "nodemailer";

import type { NotificationAdapter, NotificationPayload } from "../types";

function buildHtml(p: NotificationPayload): string {
  const icon = p.eventType === "run_completed" ? "✅" : p.eventType === "run_failed" ? "❌" : "🔔";
  const status =
    p.eventType === "run_completed" ? "运行成功" : p.eventType === "run_failed" ? "运行失败" : "通知测试";

  const rows: string[] = [];
  if (p.runName) rows.push(`<tr><td style="color:#666;padding:4px 8px">运行名称</td><td style="padding:4px 8px">${p.runName}</td></tr>`);
  if (p.workflowName) rows.push(`<tr><td style="color:#666;padding:4px 8px">工作流</td><td style="padding:4px 8px">${p.workflowName}</td></tr>`);
  if (p.durationMs) rows.push(`<tr><td style="color:#666;padding:4px 8px">耗时</td><td style="padding:4px 8px">${(p.durationMs / 1000).toFixed(1)}s</td></tr>`);
  if (p.tokenTotal) rows.push(`<tr><td style="color:#666;padding:4px 8px">Token</td><td style="padding:4px 8px">${p.tokenTotal}</td></tr>`);
  if (p.error) rows.push(`<tr><td style="color:#666;padding:4px 8px">错误</td><td style="padding:4px 8px;color:#dc2626">${p.error}</td></tr>`);

  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="margin:0 0 12px">${icon} ${status}</h2>
      ${rows.length ? `<table style="border-collapse:collapse;width:100%;font-size:14px">${rows.join("")}</table>` : "<p>通道配置测试成功！</p>"}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
      <p style="font-size:12px;color:#9ca3af">Agent Workflow Platform</p>
    </div>
  `;
}

export const emailAdapter: NotificationAdapter = {
  async send(config, payload) {
    const host = config.host as string;
    const port = Number(config.port) || 465;
    const secure = config.secure !== false;
    const user = config.user as string;
    const pass = config.pass as string;
    const from = (config.from as string) || user;
    const to = config.to as string | string[];

    if (!host || !user || !pass || !to) {
      throw new Error("邮件配置不完整：需要 host, user, pass, to");
    }

    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    const status =
      payload.eventType === "run_completed" ? "运行成功" : payload.eventType === "run_failed" ? "运行失败" : "通知测试";
    const subject = `[Agent Workflow] ${status}${payload.runName ? ` — ${payload.runName}` : ""}`;

    await transporter.sendMail({
      from,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html: buildHtml(payload),
    });
  },
};
