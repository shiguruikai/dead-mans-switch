import { html } from 'hono/html';

import type { SystemData } from '../types';

export function renderDeadPage() {
  return html`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dead Man's Switch - システムロックアウト</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="dead-page">
  <div class="card card-dead">
    <div class="badge badge-dead">DEAD</div>
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
  <link rel="stylesheet" href="/style.css">
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

    <button id="pingBtn" class="btn btn-primary">手動で生存報告を行う</button>
    <button id="pushBtn" class="btn btn-secondary">この端末の Web Push 通知を許可</button>
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
