import type { PushSubscription } from 'web-push';

export type SystemStatus = 'NORMAL' | 'WARNING' | 'DEAD';

export class SystemLockedError extends Error {
  constructor(message = 'System locked out (status is DEAD)') {
    super(message);
    this.name = 'SystemLockedError';
  }
}

export class PushSubscriptionLimitError extends Error {
  constructor(max: number) {
    super(`Push subscriptions limit exceeded (max ${max.toString()})`);
    this.name = 'PushSubscriptionLimitError';
  }
}

export interface SystemData {
  status: SystemStatus;
  last_active_at: string;
  warning_sent_at: string | null;
  dead_sent_at: string | null;
  push_subscriptions: PushSubscription[];
}

// wrangler.jsonc から `wrangler types` で生成されるバインディング型（worker-configuration.d.ts）を使用する。
// DEAD_EMAIL_BODY は未設定時に既定の本文を使用するため省略可能とする
export type Env = Omit<CloudflareBindings, 'DEAD_EMAIL_BODY'> & {
  DEAD_EMAIL_BODY?: string;
};
