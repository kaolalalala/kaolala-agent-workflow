import { db } from "@/server/persistence/sqlite";
import { encodeSecret, decodeSecret } from "@/server/config/config-service";
import { makeId } from "@/lib/utils";

import type {
  NotificationChannel,
  NotificationPayload,
  NotificationAdapter,
  CreateChannelInput,
  UpdateChannelInput,
  AdapterType,
} from "./types";

import { genericWebhookAdapter } from "./adapters/generic-webhook-adapter";
import { feishuAdapter } from "./adapters/feishu-adapter";
import { dingtalkAdapter } from "./adapters/dingtalk-adapter";
import { slackAdapter } from "./adapters/slack-adapter";
import { discordAdapter } from "./adapters/discord-adapter";
import { emailAdapter } from "./adapters/email-adapter";

// ── Row mapping ──

interface ChannelRow {
  id: string;
  name: string;
  channel_type: string;
  adapter_type: string;
  enabled: number;
  config_json: string;
  trigger_on_success: number;
  trigger_on_failure: number;
  last_test_at: string | null;
  last_test_ok: number | null;
  created_at: string;
  updated_at: string;
}

function rowToChannel(row: ChannelRow): NotificationChannel {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type as NotificationChannel["channelType"],
    adapterType: row.adapter_type as NotificationChannel["adapterType"],
    enabled: row.enabled === 1,
    configJson: row.config_json,
    triggerOnSuccess: row.trigger_on_success === 1,
    triggerOnFailure: row.trigger_on_failure === 1,
    lastTestAt: row.last_test_at ?? undefined,
    lastTestOk: row.last_test_ok === null ? undefined : row.last_test_ok === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Adapter registry ──

const adapters: Record<AdapterType, NotificationAdapter> = {
  generic: genericWebhookAdapter,
  feishu: feishuAdapter,
  dingtalk: dingtalkAdapter,
  slack: slackAdapter,
  discord: discordAdapter,
  smtp: emailAdapter,
};

// ── Service ──

class NotificationService {
  listChannels(): NotificationChannel[] {
    const rows = db
      .prepare("SELECT * FROM notification_channel ORDER BY updated_at DESC")
      .all() as ChannelRow[];
    return rows.map(rowToChannel);
  }

  getChannel(id: string): NotificationChannel | null {
    const row = db
      .prepare("SELECT * FROM notification_channel WHERE id = ?")
      .get(id) as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  }

  createChannel(input: CreateChannelInput): NotificationChannel {
    const id = makeId("notif");
    const now = new Date().toISOString();
    const encrypted = encodeSecret(JSON.stringify(input.config));

    db.prepare(
      `INSERT INTO notification_channel
        (id, name, channel_type, adapter_type, enabled, config_json,
         trigger_on_success, trigger_on_failure, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.channelType,
      input.adapterType,
      input.enabled !== false ? 1 : 0,
      encrypted,
      input.triggerOnSuccess !== false ? 1 : 0,
      input.triggerOnFailure !== false ? 1 : 0,
      now,
      now,
    );
    return this.getChannel(id)!;
  }

  updateChannel(id: string, input: UpdateChannelInput): NotificationChannel {
    const existing = this.getChannel(id);
    if (!existing) throw new Error("通知通道不存在");

    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (input.name !== undefined) {
      sets.push("name = ?");
      params.push(input.name);
    }
    if (input.config !== undefined) {
      sets.push("config_json = ?");
      params.push(encodeSecret(JSON.stringify(input.config)));
    }
    if (input.triggerOnSuccess !== undefined) {
      sets.push("trigger_on_success = ?");
      params.push(input.triggerOnSuccess ? 1 : 0);
    }
    if (input.triggerOnFailure !== undefined) {
      sets.push("trigger_on_failure = ?");
      params.push(input.triggerOnFailure ? 1 : 0);
    }
    if (input.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(input.enabled ? 1 : 0);
    }

    params.push(id);
    db.prepare(`UPDATE notification_channel SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return this.getChannel(id)!;
  }

  deleteChannel(id: string): void {
    db.prepare("DELETE FROM notification_channel WHERE id = ?").run(id);
    db.prepare("DELETE FROM notification_log WHERE channel_id = ?").run(id);
  }

  async testChannel(id: string): Promise<{ ok: boolean; error?: string }> {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, error: "通道不存在" };

    const payload: NotificationPayload = { eventType: "test" };
    const now = new Date().toISOString();

    try {
      const config = JSON.parse(decodeSecret(channel.configJson));
      const adapter = adapters[channel.adapterType];
      if (!adapter) throw new Error(`未知适配器: ${channel.adapterType}`);
      await adapter.send(config, payload);

      db.prepare("UPDATE notification_channel SET last_test_at = ?, last_test_ok = 1 WHERE id = ?").run(now, id);
      this.logDelivery(id, null, "test", "sent");
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE notification_channel SET last_test_at = ?, last_test_ok = 0 WHERE id = ?").run(now, id);
      this.logDelivery(id, null, "test", "failed", msg);
      return { ok: false, error: msg };
    }
  }

  async notifyRunEvent(runId: string, eventType: "run_completed" | "run_failed", info: Partial<NotificationPayload>): Promise<void> {
    const channels = this.listChannels().filter((ch) => {
      if (!ch.enabled) return false;
      if (eventType === "run_completed" && !ch.triggerOnSuccess) return false;
      if (eventType === "run_failed" && !ch.triggerOnFailure) return false;
      return true;
    });

    if (channels.length === 0) return;

    const payload: NotificationPayload = { eventType, runId, ...info };

    await Promise.allSettled(
      channels.map(async (ch) => {
        try {
          const config = JSON.parse(decodeSecret(ch.configJson));
          const adapter = adapters[ch.adapterType];
          if (!adapter) throw new Error(`未知适配器: ${ch.adapterType}`);
          await adapter.send(config, payload);
          this.logDelivery(ch.id, runId, eventType, "sent");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logDelivery(ch.id, runId, eventType, "failed", msg);
          console.warn(`[Notification] Channel ${ch.name} failed:`, msg);
        }
      }),
    );
  }

  getLogs(channelId?: string, limit = 20): Array<Record<string, unknown>> {
    const where = channelId ? "WHERE channel_id = ?" : "";
    const params = channelId ? [channelId, limit] : [limit];
    return db
      .prepare(`SELECT * FROM notification_log ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Array<Record<string, unknown>>;
  }

  private logDelivery(channelId: string, runId: string | null, eventType: string, status: string, error?: string): void {
    db.prepare(
      "INSERT INTO notification_log (id, channel_id, run_id, event_type, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(makeId("notif"), channelId, runId, eventType, status, error ?? null, new Date().toISOString());
  }
}

export const notificationService = new NotificationService();
