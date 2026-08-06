import type { KVNamespace } from '@cloudflare/workers-types';
import type { PushSubscription } from 'web-push';

export type SystemStatus = 'NORMAL' | 'WARNING' | 'DEAD';

export class SystemLockedError extends Error {
  constructor(message = 'System locked out (status is DEAD)') {
    super(message);
    this.name = 'SystemLockedError';
  }
}

export interface SystemData {
  status: SystemStatus;
  last_active_at: string;
  warning_sent_at: string | null;
  dead_sent_at: string | null;
  push_subscriptions: PushSubscription[];
}

export interface Env {
  // KV Namespace
  DMS_KV: KVNamespace;

  // Cloudflare Email agent
  SEND_EMAIL: SendEmail;

  // Environment variables (vars)
  BASE_URL: string;
  SENDER_EMAIL_ADDRESS: string;
  VAPID_SUBJECT: string;
  OWNER_EMAIL_ADDRESS: string;
  KIN_EMAIL_ADDRESS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  WARNING_DAYS: string;
  DEAD_DAYS: string;
  WARNING_EMAIL_SUBJECT: string;
  WARNING_EMAIL_BODY: string;
  DEAD_EMAIL_SUBJECT: string;
  DEAD_EMAIL_BODY?: string;
}
