import type { PushSubscription } from 'web-push';

import type { Env, SystemData } from '@/types';
import { differenceInSeconds, isValidDate } from '@/utils/date';

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
  const lastActiveAt = new Date(data.last_active_at);
  // 不正な日時は経過時間 0 と計算されスイッチが作動しなくなるため、エラーとして記録する
  if (!isValidDate(lastActiveAt)) {
    throw new TypeError(`Invalid last_active_at in KV: ${data.last_active_at}`);
  }
  const now = new Date();
  const diffSeconds = differenceInSeconds(now, lastActiveAt);

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
    const text = env.WARNING_EMAIL_BODY.replaceAll('${BASE_URL}', env.BASE_URL);
    await sendEmail(env.SEND_EMAIL, {
      from: env.SENDER_EMAIL_ADDRESS,
      to: env.OWNER_EMAIL_ADDRESS,
      subject: env.WARNING_EMAIL_SUBJECT,
      text,
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
        body: '生存シグナルが途絶えています。生存報告を行ってください。',
        url: '/',
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

const DEFAULT_DEAD_EMAIL_BODY
  = '本通知は Dead Man\'s Switch システムにより自動送信されています。\n規定期間の生存シグナルが確認できなかったため、手続情報および案内をお送りいたします。';

async function sendDeadNotifications(env: Env, now: Date): Promise<DeadResult> {
  // 未設定だけでなく空文字・空白のみの場合も既定の本文を使用する
  const deadBodyTemplate = env.DEAD_EMAIL_BODY?.trim() ? env.DEAD_EMAIL_BODY : DEFAULT_DEAD_EMAIL_BODY;

  let deadSentAt: string | null = null;

  try {
    const text = deadBodyTemplate.replaceAll('${BASE_URL}', env.BASE_URL);
    await sendEmail(env.SEND_EMAIL, {
      from: env.SENDER_EMAIL_ADDRESS,
      to: env.KIN_EMAIL_ADDRESS,
      subject: env.DEAD_EMAIL_SUBJECT,
      text,
    });
    deadSentAt = now.toISOString();
  } catch (err) {
    console.error('Failed to send dead email:', err);
  }

  return { deadSentAt };
}
