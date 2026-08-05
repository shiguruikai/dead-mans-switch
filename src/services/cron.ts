import type { Env, PushSubscription, SystemData } from '../types';
import { sendEmail } from './email';
import { getSystemData, saveSystemData } from './kv';
import { sendNotificationToAll } from './push';

export async function processScheduledCheck(env: Env): Promise<SystemData> {
  const warningDays = Number(env.WARNING_DAYS);
  const deadDays = Number(env.DEAD_DAYS);

  if (!Number.isInteger(warningDays) || !Number.isInteger(deadDays)) {
    throw new TypeError('WARNING_DAYS and DEAD_DAYS must be valid integers');
  }
  if (warningDays <= 0 || deadDays <= 0) {
    throw new RangeError('WARNING_DAYS and DEAD_DAYS must be greater than 0');
  }
  if (warningDays >= deadDays) {
    throw new RangeError('WARNING_DAYS must be strictly less than DEAD_DAYS');
  }

  const data = await getSystemData(env.DMS_KV);
  const now = new Date();
  const lastActive = new Date(data.last_active_at);
  const diffSeconds = (now.getTime() - lastActive.getTime()) / 1000;

  // 12時間マージン (43,200秒)
  const warningThreshold = warningDays * 86400 - 43200;
  const deadThreshold = deadDays * 86400 - 43200;

  let updatedData: SystemData = { ...data };

  if (data.status === 'NORMAL') {
    if (diffSeconds >= warningThreshold) {
      const result = await sendWarningNotifications(env, data.push_subscriptions, now);
      updatedData = {
        ...data,
        status: 'WARNING',
        warning_sent_at: result.warningSentAt,
        push_subscriptions: result.validSubscriptions,
      };
      await saveSystemData(env.DMS_KV, updatedData);
    }
  } else if (data.status === 'WARNING') {
    if (diffSeconds >= deadThreshold && data.warning_sent_at !== null) {
      const result = await sendDeadNotifications(env, now);
      updatedData = {
        ...data,
        status: 'DEAD',
        dead_sent_at: result.deadSentAt,
      };
      await saveSystemData(env.DMS_KV, updatedData);
    } else if (data.warning_sent_at === null) {
      // 前回警告送信が失敗していた場合のリトライ
      const result = await sendWarningNotifications(env, data.push_subscriptions, now);
      updatedData = {
        ...data,
        status: 'WARNING',
        warning_sent_at: result.warningSentAt,
        push_subscriptions: result.validSubscriptions,
      };
      await saveSystemData(env.DMS_KV, updatedData);
    }
  } else if (data.dead_sent_at === null) {
    // 前回死後通知送信が失敗していた場合のリトライ
    const result = await sendDeadNotifications(env, now);
    updatedData = {
      ...data,
      status: 'DEAD',
      dead_sent_at: result.deadSentAt,
    };
    await saveSystemData(env.DMS_KV, updatedData);
  }

  return updatedData;
}

interface WarningResult {
  warningSentAt: string | null;
  validSubscriptions: PushSubscription[];
}

async function sendWarningNotifications(
  env: Env,
  subscriptions: PushSubscription[],
  now: Date,
): Promise<WarningResult> {
  let warningSentAt: string | null = null;

  // 1. Email Warning
  try {
    await sendEmail(env, {
      to: env.OWNER_EMAIL_ADDRESS,
      subject: env.WARNING_EMAIL_SUBJECT,
      bodyTemplate: env.WARNING_EMAIL_BODY,
    });
    warningSentAt = now.toISOString();
  } catch (err) {
    console.error('Failed to send warning email:', err);
  }

  // 2. Web Push Warning
  let validSubscriptions = [...subscriptions];
  if (subscriptions.length > 0) {
    const results = await sendNotificationToAll(
      env,
      subscriptions,
      {
        title: '【Dead Man\'s Switch】生存確認リマインダー',
        body: 'アクティビティが途絶えています。生存確認を行ってください。',
        url: '/checkin',
      },
    );

    // 404 / 410 エラー端末の自動削除クリーンアップ
    validSubscriptions = subscriptions.filter((sub) => {
      const result = results.find((r) => r.endpoint === sub.endpoint);
      if (!result) return true;
      if (!result.success && (result.statusCode === 404 || result.statusCode === 410)) {
        return false;
      }
      return true;
    });
  }

  return {
    warningSentAt,
    validSubscriptions,
  };
}

interface DeadResult {
  deadSentAt: string | null;
}

async function sendDeadNotifications(env: Env, now: Date): Promise<DeadResult> {
  const deadBodyTemplate
    = env.DEAD_EMAIL_BODY
      ?? '本通知は Dead Man\'s Switch システムにより自動送信されています。\n規定期間のアクティビティが確認できなかったため、手続情報および案内をお送りいたします。';

  let deadSentAt: string | null = null;

  try {
    await sendEmail(env, {
      to: env.KIN_EMAIL_ADDRESS,
      subject: env.DEAD_EMAIL_SUBJECT,
      bodyTemplate: deadBodyTemplate,
    });
    deadSentAt = now.toISOString();
  } catch (err) {
    console.error('Failed to send dead email:', err);
  }

  return { deadSentAt };
}
