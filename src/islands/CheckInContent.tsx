import { hc } from 'hono/client';
import { useEffect, useState } from 'hono/jsx';

import type { AppType } from '@/index';
import type { SystemData } from '@/types';
import { differenceInDays, isValidDate } from '@/utils/date';

function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return fallback;
}

export interface CheckInContentProps {
  data: SystemData;
  vapidPublicKey: string;
}

export function CheckInContent({ data: initialData, vapidPublicKey }: Readonly<CheckInContentProps>) {
  const client = hc<AppType>('/');
  const [systemData, setSystemData] = useState<SystemData>(initialData);
  const [deviceCount, setDeviceCount] = useState<number>(initialData.push_subscriptions.length);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);

  const lastActiveDate = new Date(systemData.last_active_at);
  const formattedDate = isValidDate(lastActiveDate) ? lastActiveDate.toLocaleString('ja-JP') : '-';
  const diffDays = differenceInDays(new Date(), lastActiveDate);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      void (async () => {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          setIsSubscribed(sub !== null);
        } catch {
          setIsSubscribed(false);
        }
      })();
    }
  }, []);

  const handlePing = async () => {
    try {
      const res = await client.api.ping.$post();
      if (res.ok) {
        const resData = await res.json();
        setSystemData((prev) => ({
          ...prev,
          status: resData.status,
          last_active_at: resData.last_active_at,
        }));
        setMsg({ text: '生存報告が正常に完了しました。', isError: false });
      } else {
        const resData = await res.json();
        setMsg({ text: extractErrorMessage(resData, '生存報告に失敗しました。'), isError: true });
      }
    } catch {
      setMsg({ text: 'エラーが発生しました。', isError: true });
    }
  };

  const handlePushSubscribe = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMsg({ text: 'お使いのブラウザは Web Push に未対応です。', isError: true });
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMsg({ text: '通知の許可が得られませんでした。', isError: true });
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
      });
      const subJson = sub.toJSON() as ({ endpoint: string; keys: { p256dh: string; auth: string } });

      const res = await client.api.push.subscribe.$post({ json: subJson });

      if (res.ok) {
        const resData = await res.json();
        setDeviceCount(resData.total_devices);
        setIsSubscribed(true);
        setMsg({ text: 'Web Push 通知登録が完了しました！', isError: false });
      } else {
        const resData = await res.json();
        setMsg({ text: extractErrorMessage(resData, '登録情報の送信に失敗しました。'), isError: true });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMsg({ text: `Web Push 登録処理エラー: ${errMsg}`, isError: true });
    }
  };

  const handlePushUnsubscribe = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMsg({ text: 'お使いのブラウザは Web Push に未対応です。', isError: true });
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setMsg({ text: 'この端末は Web Push 未登録です。', isError: true });
        return;
      }

      await sub.unsubscribe();

      const res = await client.api.push.subscribe.$delete({ json: { endpoint: sub.endpoint } });

      if (res.ok) {
        const resData = await res.json();
        setDeviceCount(resData.total_devices);
        setIsSubscribed(false);
        setMsg({ text: 'Web Push 通知登録を解除しました。', isError: false });
      } else {
        const resData = await res.json();
        setMsg({ text: extractErrorMessage(resData, 'サーバーでの解除処理に失敗しました。'), isError: true });
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMsg({ text: `解除処理エラー: ${errMsg}`, isError: true });
    }
  };

  return (
    <div class="card">
      <title>Check-in - Dead Man's Switch</title>
      <div class="header">
        <h1>Dead Man's Switch</h1>
        <span class={`badge badge-${systemData.status}`}>{systemData.status}</span>
      </div>

      <div class="info-group">
        <div class="info-row">
          <span class="label">最終生存確認日時</span>
          <span class="val">
            <time class="local-datetime" dateTime={systemData.last_active_at}>{formattedDate}</time>
          </span>
        </div>
        <div class="info-row">
          <span class="label">最終生存確認日からの経過日数</span>
          <span class="val">{`${diffDays.toString()} 日`}</span>
        </div>
        <div class="info-row">
          <span class="label">Web Push 登録端末数</span>
          <span class="val">{`${deviceCount.toString()} 台`}</span>
        </div>
      </div>

      <button id="pingBtn" type="button" class="btn btn-primary" onClick={() => { void handlePing(); }}>生存報告を行う</button>
      {isSubscribed === true
        ? (
            <button id="unsubBtn" type="button" class="btn btn-danger" onClick={() => { void handlePushUnsubscribe(); }}>この端末の Web Push 通知登録を解除</button>
          )
        : (
            <button id="pushBtn" type="button" class="btn btn-secondary" onClick={() => { void handlePushSubscribe(); }}>この端末の Web Push 通知を許可</button>
          )}

      {msg && (
        <div id="msgBox" class={`msg ${msg.isError ? 'msg-error' : 'msg-success'}`} style={{ display: 'block' }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
