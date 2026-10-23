import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushSubscription } from 'web-push';

import { app } from '@/index';
import { processScheduledCheck } from '@/services/cron';
import {
  addPushSubscription,
  getSystemData,
  MAX_PUSH_SUBSCRIPTIONS,
  removePushSubscription,
  saveSystemData,
  updateActivity,
} from '@/services/kv';
import type { Env } from '@/types';
import { SystemLockedError } from '@/types';
import { subDays } from '@/utils/date';

// KVNamespace のインメモリ用モック
class MockKVNamespace {
  private store = new Map<string, string>();

  get<T>(key: string, type?: 'text' | 'json'): Promise<T | null> {
    const val = this.store.get(key);
    if (!val) return Promise.resolve(null);
    if (type === 'json') {
      return Promise.resolve(JSON.parse(val) as T);
    }
    return Promise.resolve(val as unknown as T);
  }

  put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}

function createMockEnv(mockKv: MockKVNamespace): Env {
  return {
    DMS_KV: mockKv as any,
    SEND_EMAIL: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    BASE_URL: 'https://dms.example.com',
    SENDER_EMAIL_ADDRESS: 'dms@example.com',
    VAPID_SUBJECT: 'mailto:dms@example.com',
    OWNER_EMAIL_ADDRESS: 'owner@example.com',
    KIN_EMAIL_ADDRESS: 'kin@example.com',
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    WARNING_DAYS: '7',
    DEAD_DAYS: '14',
    WARNING_EMAIL_SUBJECT: '【要確認】生存確認リマインダー',
    WARNING_EMAIL_BODY: '生存確認を行ってください: ${BASE_URL}/',
    DEAD_EMAIL_SUBJECT: '【重要】死後通知',
    DEAD_EMAIL_BODY: '契約者の生存確認が途絶えました。',
  };
}

describe('KV サービス層（src/services/kv.ts）', () => {
  let mockKv: MockKVNamespace;

  beforeEach(() => {
    mockKv = new MockKVNamespace();
  });

  it('KV が空のときにデフォルト値で初期化データを生成すること', async () => {
    const data = await getSystemData(mockKv as any);
    expect(data.status).toBe('NORMAL');
    expect(data.warning_sent_at).toBeNull();
    expect(data.dead_sent_at).toBeNull();
    expect(data.push_subscriptions).toEqual([]);
    expect(typeof data.last_active_at).toBe('string');
  });

  it('生存報告によりアクティビティが更新され WARNING から NORMAL へ復帰すること', async () => {
    const initial = await getSystemData(mockKv as any);
    initial.status = 'WARNING';
    initial.warning_sent_at = new Date().toISOString();
    await saveSystemData(mockKv as any, initial);

    const updated = await updateActivity(mockKv as any);
    expect(updated.status).toBe('NORMAL');
    expect(updated.warning_sent_at).toBeNull();
  });

  it('ステータスが DEAD の場合は SystemLockedError 例外を発生させること', async () => {
    const initial = await getSystemData(mockKv as any);
    initial.status = 'DEAD';
    await saveSystemData(mockKv as any, initial);

    await expect(updateActivity(mockKv as any)).rejects.toThrow(SystemLockedError);
  });

  it('Web Push 端末情報を追加および重複時に更新できること', async () => {
    const sub1: PushSubscription = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    };
    const sub2: PushSubscription = {
      endpoint: 'https://push.example.com/sub2',
      keys: { p256dh: 'key2', auth: 'auth2' },
    };

    await addPushSubscription(mockKv as any, sub1);
    let data = await addPushSubscription(mockKv as any, sub2);
    expect(data.push_subscriptions).toHaveLength(2);

    const updatedSub1: PushSubscription = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1_updated', auth: 'auth1_updated' },
    };
    data = await addPushSubscription(mockKv as any, updatedSub1);
    expect(data.push_subscriptions).toHaveLength(2);
    expect(data.push_subscriptions[0].keys.p256dh).toBe('key1_updated');
  });

  it('指定エンドポイントの Web Push 端末情報を削除できること', async () => {
    const sub1: PushSubscription = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    };
    await addPushSubscription(mockKv as any, sub1);

    const data = await removePushSubscription(mockKv as any, 'https://push.example.com/sub1');
    expect(data.push_subscriptions).toHaveLength(0);
  });
});

describe('Hono API エンドポイント（src/index.tsx）', () => {
  let mockKv: MockKVNamespace;
  let env: Env;

  beforeEach(() => {
    mockKv = new MockKVNamespace();
    env = createMockEnv(mockKv);
  });

  it('GET / は NORMAL ステータス時に生存確認画面の HTML を返すこと', async () => {
    const client = testClient(app, env);
    const res = await client.index.$get();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-island="CheckInContent"');
    expect(html).toContain('data-props');
    expect(html).toContain('NORMAL');
    expect(html).toContain('/src/client.tsx');
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it('GET / は DEAD ステータス時にロックアウト画面の HTML を返すこと', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'DEAD';
    await saveSystemData(mockKv as any, data);

    const client = testClient(app, env);
    const res = await client.index.$get();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('死後通知送信済み');
    expect(html).not.toContain('pingBtn');
  });

  it('POST /api/ping は生存報告を受理してアクティビティを更新すること', async () => {
    const client = testClient(app, env);
    const res = await client.api.ping.$post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      status: 'NORMAL',
      last_active_at: expect.any(String),
    });
  });

  it('POST /api/ping は DEAD ステータス時に 403 エラーを返すこと', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'DEAD';
    await saveSystemData(mockKv as any, data);

    const client = testClient(app, env);
    const res = await client.api.ping.$post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'System locked out (status is DEAD)',
    });
  });

  it('POST /api/push/subscribe は Web Push 端末を登録しバリデーションチェックを行うこと', async () => {
    const client = testClient(app, env);
    const resInvalid = await client.api.push.subscribe.$post({
      json: { endpoint: 'http://example.com' } as any,
    });
    expect(resInvalid.status).toBe(400);
    expect(await resInvalid.json()).toMatchObject({
      success: false,
    });

    const sub: PushSubscription = {
      endpoint: 'https://push.example.com/test-endpoint',
      keys: { p256dh: 'p256', auth: 'auth' },
    };

    const res = await client.api.push.subscribe.$post({
      json: sub,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      total_devices: 1,
    });
  });

  it('POST /api/push/subscribe は登録端末数の上限を超える場合に 409 を返すこと', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
    for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS; i++) {
      await addPushSubscription(mockKv as any, {
        endpoint: `https://push.example.com/sub${i.toString()}`,
        keys: { p256dh: 'p256', auth: 'auth' },
      });
    }

    const client = testClient(app, env);
    const res = await client.api.push.subscribe.$post({
      json: { endpoint: 'https://push.example.com/over-limit', keys: { p256dh: 'p256', auth: 'auth' } },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: `Push subscriptions limit exceeded (max ${MAX_PUSH_SUBSCRIPTIONS.toString()})` });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('DELETE /api/push/subscribe は Web Push 端末を解除しバリデーションチェックを行うこと', async () => {
    const client = testClient(app, env);
    const resInvalid = await client.api.push.subscribe.$delete({
      json: {} as any,
    });
    expect(resInvalid.status).toBe(400);
    expect(await resInvalid.json()).toMatchObject({
      success: false,
    });

    const sub: PushSubscription = {
      endpoint: 'https://push.example.com/test-endpoint',
      keys: { p256dh: 'p256', auth: 'auth' },
    };
    await addPushSubscription(mockKv as any, sub);

    const res = await client.api.push.subscribe.$delete({
      json: { endpoint: 'https://push.example.com/test-endpoint' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      total_devices: 0,
    });
  });

  it('不正な JSON ボディには 500 ではなく 400 を返すこと', async () => {
    const res = await app.request('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Malformed JSON in request body',
    });
  });

  it('予期しない例外は 500 を返しエラーログを出力すること', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
    vi.spyOn(mockKv, 'get').mockRejectedValue(new Error('KV unavailable'));

    const client = testClient(app, env);
    const res = await client.api.status.$get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'KV unavailable' });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled error:', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it('GET /api/status はシステム詳細状態を返却すること', async () => {
    const client = testClient(app, env);
    const res = await client.api.status.$get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'NORMAL',
      days_since_active: expect.any(Number),
      warning_sent_at: null,
      dead_sent_at: null,
      push_subscriptions_count: 0,
    });
  });
});

describe('定時実行 Cron タスク（src/services/cron.ts）', () => {
  let mockKv: MockKVNamespace;
  let env: Env;

  beforeEach(() => {
    mockKv = new MockKVNamespace();
    env = createMockEnv(mockKv);
  });

  it('WARNING_DAYS および DEAD_DAYS の設定値を正常に検証すること', async () => {
    env.WARNING_DAYS = 'invalid';
    await expect(processScheduledCheck(env)).rejects.toThrow(TypeError);
    await expect(processScheduledCheck(env)).rejects.toThrow('WARNING_DAYS and DEAD_DAYS must be valid integers');

    env.WARNING_DAYS = '7.5';
    await expect(processScheduledCheck(env)).rejects.toThrow(TypeError);

    env.WARNING_DAYS = '14';
    env.DEAD_DAYS = '7';
    await expect(processScheduledCheck(env)).rejects.toThrow(RangeError);
    await expect(processScheduledCheck(env)).rejects.toThrow('WARNING_DAYS must be strictly less than DEAD_DAYS');
  });

  it('last_active_at が不正な日時の場合は通知を送らずに例外をスローすること', async () => {
    const data = await getSystemData(mockKv as any);
    data.last_active_at = 'invalid-date';
    await saveSystemData(mockKv as any, data);

    await expect(processScheduledCheck(env)).rejects.toThrow('Invalid last_active_at in KV');
    expect(env.SEND_EMAIL.send).not.toHaveBeenCalled();
  });

  it('最終アクティビティが最近の場合は NORMAL 状態を維持すること', async () => {
    const result = await processScheduledCheck(env);
    expect(result.status).toBe('NORMAL');
    expect(env.SEND_EMAIL.send).not.toHaveBeenCalled();
  });

  it('無活動期間が 6.5 日以上の場合は WARNING 状態へ遷移すること', async () => {
    const data = await getSystemData(mockKv as any);
    data.last_active_at = subDays(new Date(), 7).toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('WARNING');
    expect(result.warning_sent_at).not.toBeNull();
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it('WARNING 状態で warning_sent_at が null の場合は警告通知を再試行すること', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'WARNING';
    data.warning_sent_at = null;
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('WARNING');
    expect(result.warning_sent_at).not.toBeNull();
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it('無活動期間が 13.5 日以上で警告済みの場合 DEAD 状態へ遷移すること', async () => {
    const data = await getSystemData(mockKv as any);
    data.last_active_at = subDays(new Date(), 14).toISOString();
    data.status = 'WARNING';
    data.warning_sent_at = subDays(new Date(), 7).toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(result.dead_sent_at).not.toBeNull();
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it('DEAD 状態で dead_sent_at が null の場合は死後通知を再試行すること', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'DEAD';
    data.dead_sent_at = null;
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(result.dead_sent_at).not.toBeNull();
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it.each(['', '   \n'])('DEAD_EMAIL_BODY が空（%j）の場合は既定の本文で死後通知を送信すること', async (body) => {
    env.DEAD_EMAIL_BODY = body;

    const data = await getSystemData(mockKv as any);
    data.last_active_at = subDays(new Date(), 14).toISOString();
    data.status = 'WARNING';
    data.warning_sent_at = subDays(new Date(), 7).toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(1);
    expect(env.SEND_EMAIL.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'kin@example.com',
      text: expect.stringContaining('本通知は Dead Man\'s Switch システムにより自動送信されています。'),
    }));
  });

  it('DEAD_EMAIL_BODY が設定されている場合はその本文で死後通知を送信すること', async () => {
    const data = await getSystemData(mockKv as any);
    data.last_active_at = subDays(new Date(), 14).toISOString();
    data.status = 'WARNING';
    data.warning_sent_at = subDays(new Date(), 7).toISOString();
    await saveSystemData(mockKv as any, data);

    await processScheduledCheck(env);
    expect(env.SEND_EMAIL.send).toHaveBeenCalledWith(expect.objectContaining({
      text: '契約者の生存確認が途絶えました。',
    }));
  });

  it('複数のメールアドレス設定時に各宛先へ個別送信が行われること', async () => {
    env.OWNER_EMAIL_ADDRESS = 'owner1@example.com, owner2@example.com';
    env.KIN_EMAIL_ADDRESS = 'kin1@example.com, kin2@example.com, kin3@example.com';

    const data = await getSystemData(mockKv as any);
    data.last_active_at = subDays(new Date(), 14).toISOString();
    data.status = 'WARNING';
    data.warning_sent_at = subDays(new Date(), 7).toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(result.dead_sent_at).not.toBeNull();
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(3);
    expect(env.SEND_EMAIL.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ to: 'kin1@example.com' }));
    expect(env.SEND_EMAIL.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: 'kin2@example.com' }));
    expect(env.SEND_EMAIL.send).toHaveBeenNthCalledWith(3, expect.objectContaining({ to: 'kin3@example.com' }));
  });

  it('一部の宛先への送信が失敗しても DEAD 状態へ更新完了すること', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
    env.KIN_EMAIL_ADDRESS = 'kin1@example.com, failed@example.com';
    env.SEND_EMAIL.send = vi.fn().mockImplementation(({ to }) => {
      if (to === 'failed@example.com') {
        return Promise.reject(new Error('Failed delivery'));
      }
      return Promise.resolve(undefined);
    });

    const data = await getSystemData(mockKv as any);
    data.last_active_at = subDays(new Date(), 14).toISOString();
    data.status = 'WARNING';
    data.warning_sent_at = subDays(new Date(), 7).toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(result.dead_sent_at).not.toBeNull();
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
