import type { Env, SystemData } from '../types';
import { getSystemData, saveSystemData } from './kv';
import { sendEmail } from './email';
import { sendNotificationToAll } from './push';

export async function processScheduledCheck(env: Env): Promise<SystemData> {
  const data = await getSystemData(env.DMS_KV);
  const now = new Date();
  const lastActive = new Date(data.last_active_at);
  const diffSeconds = (now.getTime() - lastActive.getTime()) / 1000;

  const warningDays = parseInt(env.WARNING_DAYS || '7', 10);
  const deadDays = parseInt(env.DEAD_DAYS || '14', 10);

  // 12時間マージン (43,200秒)
  const warningThreshold = warningDays * 86400 - 43200;
  const deadThreshold = deadDays * 86400 - 43200;

  if (data.status === 'NORMAL') {
    if (diffSeconds >= warningThreshold) {
      data.status = 'WARNING';
      await sendWarningNotifications(env, data, now);
      await saveSystemData(env.DMS_KV, data);
    }
  } else if (data.status === 'WARNING') {
    if (diffSeconds >= deadThreshold && data.warning_sent_at !== null) {
      data.status = 'DEAD';
      await sendDeadNotifications(env, data, now);
      await saveSystemData(env.DMS_KV, data);
    } else if (data.warning_sent_at === null) {
      // 前回警告送信が失敗していた場合のリトライ
      await sendWarningNotifications(env, data, now);
      await saveSystemData(env.DMS_KV, data);
    }
  } else if (data.status === 'DEAD') {
    if (data.dead_sent_at === null) {
      // 前回死後通知送信が失敗していた場合のリトライ
      await sendDeadNotifications(env, data, now);
      await saveSystemData(env.DMS_KV, data);
    }
  }

  return data;
}

async function sendWarningNotifications(env: Env, data: SystemData, now: Date): Promise<void> {
  // 1. Email Warning
  try {
    await sendEmail(env, {
      to: env.OWNER_EMAIL_ADDRESS,
      subject: env.WARNING_EMAIL_SUBJECT,
      bodyTemplate: env.WARNING_EMAIL_BODY,
    });
    data.warning_sent_at = now.toISOString();
  } catch (err) {
    console.error('Failed to send warning email:', err);
  }

  // 2. Web Push Warning
  if (data.push_subscriptions && data.push_subscriptions.length > 0) {
    const results = await sendNotificationToAll(
      env,
      data.push_subscriptions,
      '【Dead Man\'s Switch】アクティビティが途絶えています。生存確認を行ってください。'
    );

    // 404 / 410 エラー端末の自動削除クリーンアップ
    const validSubs = data.push_subscriptions.filter((sub) => {
      const result = results.find((r) => r.endpoint === sub.endpoint);
      if (!result) return true;
      if (!result.success && (result.statusCode === 404 || result.statusCode === 410)) {
        return false;
      }
      return true;
    });

    data.push_subscriptions = validSubs;
  }
}

async function sendDeadNotifications(env: Env, data: SystemData, now: Date): Promise<void> {
  const deadBodyTemplate =
    env.DEAD_EMAIL_BODY ||
    '本通知は Dead Man\'s Switch システムにより自動送信されています。\n規定期間のアクティビティが確認できなかったため、手続情報および案内をお送りいたします。';

  try {
    await sendEmail(env, {
      to: env.KIN_EMAIL_ADDRESS,
      subject: env.DEAD_EMAIL_SUBJECT,
      bodyTemplate: deadBodyTemplate,
    });
    data.dead_sent_at = now.toISOString();
  } catch (err) {
    console.error('Failed to send dead email:', err);
  }
}
