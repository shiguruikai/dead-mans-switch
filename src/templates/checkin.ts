import { html } from 'hono/html';

import type { SystemData } from '../types';

export function renderDeadPage() {
  return html`<!DOCTYPE html>
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
}

export function renderDashboardPage(data: SystemData, vapidPublicKey: string) {
  const lastActiveDate = new Date(data.last_active_at);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));
  const formattedDate = lastActiveDate.toLocaleString('ja-JP');

  return html`<!DOCTYPE html>
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
    .badge-WARNING { background: #d97706; color: #fffbeb; }
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
    .btn-danger { background: #7f1d1d; color: #fecaca; }
    .btn-danger:hover { background: #991b1b; }
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
        <span class="val">${formattedDate}</span>
      </div>
      <div class="info-row">
        <span class="label">不活動経過日数</span>
        <span class="val">${diffDays.toString()} 日間</span>
      </div>
      <div class="info-row">
        <span class="label">Web Push 登録端末数</span>
        <span class="val">${data.push_subscriptions.length.toString()} 台</span>
      </div>
    </div>

    <button id="pingBtn" class="btn btn-primary">手動生存報告（アクティビティ更新）</button>
    <button id="pushBtn" class="btn btn-secondary">この端末の Web Push 通知を許可 / 更新</button>
    <button id="unsubBtn" class="btn btn-danger">この端末の Web Push 通知登録を解除</button>

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
        const res = await fetch('/checkin/ping', { method: 'POST' });
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
          const err = await res.json();
          showMsg(err.error || '登録情報の送信に失敗しました。', true);
        }
      } catch (e) {
        showMsg('Web Push 登録処理エラー: ' + e.message, true);
      }
    });

    document.getElementById('unsubBtn').addEventListener('click', async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showMsg('お使いのブラウザは Web Push に未対応です。', true);
        return;
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          showMsg('この端末は Web Push 未登録です。', true);
          return;
        }

        const endpoint = sub.endpoint;
        await sub.unsubscribe();

        const res = await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint })
        });

        if (res.ok) {
          showMsg('Web Push 通知登録を解除しました。');
          setTimeout(() => location.reload(), 1500);
        } else {
          showMsg('サーバーでの解除処理に失敗しました。', true);
        }
      } catch (e) {
        showMsg('解除処理エラー: ' + e.message, true);
      }
    });
  </script>
</body>
</html>`;
}
