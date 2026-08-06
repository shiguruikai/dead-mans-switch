import type { PushSubscription, RequestOptions } from 'web-push';
import { sendNotification as sendNotification_ } from 'web-push';

import type { Env } from '@/types';

export interface PushResult {
  endpoint: string;
  success: boolean;
  statusCode?: number;
  error?: unknown;
}

export interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

export async function sendNotification(
  env: Env,
  subscription: PushSubscription,
  payload: string | PushPayload,
): Promise<PushResult> {
  const options: RequestOptions = {
    vapidDetails: {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
  };

  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    const res = await sendNotification_(subscription, payloadString, options);
    return {
      endpoint: subscription.endpoint,
      success: true,
      statusCode: res.statusCode,
    };
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    return {
      endpoint: subscription.endpoint,
      success: false,
      statusCode,
      error: err,
    };
  }
}

export async function sendNotificationToAll(
  env: Env,
  subscriptions: PushSubscription[],
  payload: string | PushPayload,
): Promise<PushResult[]> {
  return Promise.all(
    subscriptions.map((sub) => sendNotification(env, sub, payload)),
  );
}
