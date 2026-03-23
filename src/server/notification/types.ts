/**
 * Notification Channel types — domain types for the notification system.
 */

export type ChannelType = "webhook" | "email";
export type AdapterType = "feishu" | "dingtalk" | "slack" | "discord" | "generic" | "smtp";

export interface NotificationChannel {
  id: string;
  name: string;
  channelType: ChannelType;
  adapterType: AdapterType;
  enabled: boolean;
  configJson: string;
  triggerOnSuccess: boolean;
  triggerOnFailure: boolean;
  lastTestAt?: string;
  lastTestOk?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPayload {
  eventType: "run_completed" | "run_failed" | "test";
  runId?: string;
  runName?: string;
  workflowName?: string;
  projectName?: string;
  status?: string;
  durationMs?: number;
  tokenTotal?: number;
  error?: string;
  finishedAt?: string;
  platformUrl?: string;
}

export interface NotificationAdapter {
  send(config: Record<string, unknown>, payload: NotificationPayload): Promise<void>;
}

export interface CreateChannelInput {
  name: string;
  channelType: ChannelType;
  adapterType: AdapterType;
  config: Record<string, unknown>;
  triggerOnSuccess?: boolean;
  triggerOnFailure?: boolean;
  enabled?: boolean;
}

export interface UpdateChannelInput {
  name?: string;
  config?: Record<string, unknown>;
  triggerOnSuccess?: boolean;
  triggerOnFailure?: boolean;
  enabled?: boolean;
}
