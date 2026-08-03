import { Hono } from 'hono';
import type { Env, PushSubscription } from './types';
import {
  getSystemData,
  updateActivity,
  addPushSubscription,
} from './services/kv';
import { processScheduledCheck } from './services/cron';

const app = new Hono<{ Bindings: Env }>();

// Ping Token Auth Middleware
const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const token = c.req.header('X-Ping-Token');
  if (!token || token !== c.env.PING_SECRET_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
};

// 1. GET /checkin (Zero Trust protected)
app.get('/checkin', async (c) => {
  const data = await getSystemData(c.env.DMS_KV);

  if (data.status === 'DEAD') {
    const deadHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dead Man's Switch - システムロックアウト</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #121212; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e1e1e; border: 1px solid #cf6679; border-radius: 12px; padding: 2rem; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    h1 { color: #cf6679; font-size: 1.5rem; margin-top: 0; }
    p { line-height: 1.6; color: #b0b0b0; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: bold; background: #cf6679; color: #000; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">DEAD</div>
    <h1>死後通知送信完了（システムロックアウト中）</h1>
    <p>不活動期間経過により死後通知の自動送信が完了しました。<br>本システムはロックアウトされており、復帰および通知変更操作は行えません。</p>
  </div>
</body>
</html>`;
    return c.html(deadHtml);
  }

  const lastActiveDate = new Date(data.last_active_at);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));
  const vapidPublicKey = c.env.VAPID_PUBLIC_KEY || '';

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dead Man's Switch - 生存確認ダッシュボード</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 2rem; max-width: 520px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    .header { text-align: center; border-bottom: 1px solid #334155; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem 0; color: #38bdf8; }
    .badge { display: inline-block; padding: 0.35rem 0.85rem; border-radius: 9999px; font-weight: bold; font-size: 0.875rem; text-transform: uppercase; }
    .badge-NORMAL { background: #059669; color: #ecfdf5; }
    .badge-WARNING { background: #d97706; color: #fffbebf; }
    .info-group { margin-bottom: 1.5rem; background: #0f172a; padding: 1rem; border-radius: 8px; font-size: 0.95rem; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .info-row:last-child { margin-bottom: 0; }
    .label { color: #94a3b8; }
    .val { font-weight: 600; color: #e2e8f0; }
    .btn { display: block; width: 100%; padding: 0.85rem; border: none; border-radius: 8px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.2s; margin-bottom: 0.75rem; text-align: center; }
    .btn-primary { background: #0284c7; color: #ffffff; }
    .btn-primary:hover { background: #0369a1; }
    .btn-secondary { background: #334155; color: #f8fafc; }
    .btn-secondary:hover { background: #475569; }
    .msg { margin-top: 1rem; padding: 0.75rem; border-radius: 6px; font-size: 0.9rem; text-align: center; display: none; }
    .msg-success { background: #065f46; color: #a7f3d0; }
    .msg-error { background: #991b1b; color: #fecaca; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Dead Man's Switch</h1>
      <span class="badge badge-${data.status}">${data.status}</span>
    </div>

    <div class="info-group">
      <div class="info-row">
        <span class="label">最終アクティブ日時</span>
        <span class="val">${lastActiveDate.toLocaleString('ja-JP')}</span>
      </div>
      <div class="info-row">
        <span class="label">不活動経過日数</span>
        <span class="val">${diffDays} 日間</span>
      </div>
      <div class="info-row">
        <span class="label">Web Push 登録端末数</span>
        <span class="val">${data.push_subscriptions.length} 台</span>
      </div>
    </div>

    <button id="pingBtn" class="btn btn-primary">手動生存報告（アクティビティ更新）</button>
    <button id="pushBtn" class="btn btn-secondary">この端末の Web Push 通知を許可 / 更新</button>

    <div id="msgBox" class="msg"></div>
  </div>

  <script>
    const vapidPublicKey = "${vapidPublicKey}";

    function showMsg(text, isError = false) {
      const box = document.getElementById('msgBox');
      box.textContent = text;
      box.className = 'msg ' + (isError ? 'msg-error' : 'msg-success');
      box.style.display = 'block';
    }

    document.getElementById('pingBtn').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/ping', {
          method: 'POST',
          headers: { 'X-Ping-Token': '${c.env.PING_SECRET_TOKEN || ''}' }
        });
        if (res.ok) {
          showMsg('生存報告が完了しました。画面を更新します...');
          setTimeout(() => location.reload(), 1500);
        } else {
          const err = await res.json();
          showMsg(err.error || '生存報告に失敗しました。', true);
        }
      } catch (e) {
        showMsg('エラーが発生しました。', true);
      }
    });

    document.getElementById('pushBtn').addEventListener('click', async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showMsg('お使いのブラウザは Web Push に未対応です。', true);
        return;
      }

      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showMsg('通知の許可が得られませんでした。', true);
          return;
        }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKey
        });

        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub)
        });

        if (res.ok) {
          showMsg('Web Push 通知登録が完了しました！');
          setTimeout(() => location.reload(), 1500);
        } else {
          showMsg('登録情報の送信に失敗しました。', true);
        }
      } catch (e) {
        showMsg('Web Push 登録処理エラー: ' + e.message, true);
      }
    });
  </script>
</body>
</html>`;

  return c.html(html);
});

// 2. POST /api/ping
app.post('/api/ping', authMiddleware, async (c) => {
  try {
    const updated = await updateActivity(c.env.DMS_KV);
    return c.json({
      success: true,
      status: updated.status,
      last_active_at: updated.last_active_at,
    });
  } catch (err: any) {
    if (err.message.includes('DEAD')) {
      return c.json({ error: 'System locked out (status is DEAD)' }, 403);
    }
    return c.json({ error: err.message }, 500);
  }
});

// 3. POST /api/push/subscribe (Zero Trust protected)
app.post('/api/push/subscribe', async (c) => {
  try {
    const subscription = await c.req.json<PushSubscription>();
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return c.json({ error: 'Invalid PushSubscription format' }, 400);
    }

    const updated = await addPushSubscription(c.env.DMS_KV, subscription);
    return c.json({
      success: true,
      total_devices: updated.push_subscriptions.length,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. GET /api/status
app.get('/api/status', authMiddleware, async (c) => {
  const data = await getSystemData(c.env.DMS_KV);
  const now = new Date();
  const lastActive = new Date(data.last_active_at);
  const daysSinceActive = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24);

  return c.json({
    status: data.status,
    last_active_at: data.last_active_at,
    days_since_active: daysSinceActive,
    warning_sent_at: data.warning_sent_at,
    dead_sent_at: data.dead_sent_at,
    push_subscriptions_count: data.push_subscriptions.length,
  });
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processScheduledCheck(env));
  },
};
