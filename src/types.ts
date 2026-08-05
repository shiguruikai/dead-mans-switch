import type { KVNamespace } from '@cloudflare/workers-types';

export type SystemStatus = 'NORMAL' | 'WARNING' | 'DEAD';

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface SystemData {
  status: SystemStatus;
  last_active_at: string;
  warning_sent_at: string | null;
  dead_sent_at: string | null;
  push_subscriptions: PushSubscription[];
}

export interface EmailMessageBuilder {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailSendBinding {
  send: (message: EmailMessageBuilder) => Promise<unknown>;
}

export interface Env {
  // KV Namespace
  DMS_KV: KVNamespace;

  // Cloudflare Email Send
  EMAIL_SEND: EmailSendBinding;

  // Non-secret vars
  BASE_URL: string;
  WARNING_DAYS: string;
  DEAD_DAYS: string;
  WARNING_EMAIL_SUBJECT: string;
  WARNING_EMAIL_BODY: string;
  DEAD_EMAIL_SUBJECT: string;
  DEAD_EMAIL_BODY?: string;
  VAPID_SUBJECT: string;
  SENDER_EMAIL_ADDRESS: string;

  // Secrets
  PING_SECRET_TOKEN: string;
  OWNER_EMAIL_ADDRESS: string;
  KIN_EMAIL_ADDRESS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}
