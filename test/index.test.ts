import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../src/index';
import { processScheduledCheck } from '../src/services/cron';
import {
  addPushSubscription,
  getSystemData,
  removePushSubscription,
  saveSystemData,
  updateActivity,
} from '../src/services/kv';
import type { Env, PushSubscription } from '../src/types';

// In-Memory Mock for KVNamespace
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

function createMockEnv(kv: MockKVNamespace): Env {
  return {
    DMS_KV: kv as any,
    EMAIL_SEND: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    BASE_URL: 'https://dead-mans-switch.example.workers.dev',
    WARNING_DAYS: '7',
    DEAD_DAYS: '14',
    WARNING_EMAIL_SUBJECT: '【重要】生存確認リマインダー',
    WARNING_EMAIL_BODY: 'アクティビティが途絶えています: ${BASE_URL}/checkin',
    DEAD_EMAIL_SUBJECT: '【重要通知】手続情報案内',
    VAPID_SUBJECT: 'mailto:owner@example.com',
    SENDER_EMAIL_ADDRESS: 'noreply@yourdomain.com',
    PING_SECRET_TOKEN: 'test-secret-token-123',
    OWNER_EMAIL_ADDRESS: 'owner@example.com',
    KIN_EMAIL_ADDRESS: 'kin@example.com',
    DEAD_EMAIL_BODY: '死後通知本文',
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
  };
}

describe('KV Service (src/services/kv.ts)', () => {
  let mockKv: MockKVNamespace;

  beforeEach(() => {
    mockKv = new MockKVNamespace();
  });

  it('should initialize system data with default values when KV is empty', async () => {
    const data = await getSystemData(mockKv as any);
    expect(data.status).toBe('NORMAL');
    expect(data.warning_sent_at).toBeNull();
    expect(data.dead_sent_at).toBeNull();
    expect(data.push_subscriptions).toEqual([]);
    expect(typeof data.last_active_at).toBe('string');
  });

  it('should update activity and recover from WARNING to NORMAL', async () => {
    const initial = await getSystemData(mockKv as any);
    initial.status = 'WARNING';
    initial.warning_sent_at = new Date().toISOString();
    await saveSystemData(mockKv as any, initial);

    const updated = await updateActivity(mockKv as any);
    expect(updated.status).toBe('NORMAL');
    expect(updated.warning_sent_at).toBeNull();
  });

  it('should throw an error when updating activity if status is DEAD', async () => {
    const initial = await getSystemData(mockKv as any);
    initial.status = 'DEAD';
    await saveSystemData(mockKv as any, initial);

    await expect(updateActivity(mockKv as any)).rejects.toThrow(
      'System locked out (status is DEAD)',
    );
  });

  it('should add and update push subscriptions correctly', async () => {
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
    expect(data.push_subscriptions.length).toBe(2);

    const updatedSub1: PushSubscription = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1_updated', auth: 'auth1_updated' },
    };
    data = await addPushSubscription(mockKv as any, updatedSub1);
    expect(data.push_subscriptions.length).toBe(2);
    expect(data.push_subscriptions[0].keys.p256dh).toBe('key1_updated');
  });

  it('should remove push subscription by endpoint', async () => {
    const sub1: PushSubscription = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    };
    await addPushSubscription(mockKv as any, sub1);

    const data = await removePushSubscription(mockKv as any, 'https://push.example.com/sub1');
    expect(data.push_subscriptions.length).toBe(0);
  });
});

describe('Hono API Endpoints (src/index.ts)', () => {
  let mockKv: MockKVNamespace;
  let env: Env;

  beforeEach(() => {
    mockKv = new MockKVNamespace();
    env = createMockEnv(mockKv);
  });

  it('GET /checkin returns HTML dashboard for NORMAL status', async () => {
    const res = await app.request('/checkin', {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Dead Man\'s Switch');
    expect(html).toContain('NORMAL');
    expect(html).toContain('手動生存報告');
  });

  it('GET /checkin returns lockout page for DEAD status', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'DEAD';
    await saveSystemData(mockKv as any, data);

    const res = await app.request('/checkin', {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('死後通知送信完了（システムロックアウト中）');
    expect(html).not.toContain('pingBtn');
  });

  it('POST /checkin/ping updates activity without X-Ping-Token (Access protected)', async () => {
    const res = await app.request('/checkin/ping', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.success).toBe(true);
    expect(body.status).toBe('NORMAL');
  });

  it('POST /api/ping requires X-Ping-Token header or Access Email header', async () => {
    const resUnauthorized = await app.request('/api/ping', { method: 'POST' }, env);
    expect(resUnauthorized.status).toBe(401);

    const resValid = await app.request(
      '/api/ping',
      { method: 'POST', headers: { 'X-Ping-Token': 'test-secret-token-123' } },
      env,
    );
    expect(resValid.status).toBe(200);
    const body = await resValid.json<any>();
    expect(body.success).toBe(true);
    expect(body.status).toBe('NORMAL');
  });

  it('POST /api/ping returns 403 when system status is DEAD', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'DEAD';
    await saveSystemData(mockKv as any, data);

    const res = await app.request(
      '/api/ping',
      { method: 'POST', headers: { 'X-Ping-Token': 'test-secret-token-123' } },
      env,
    );
    expect(res.status).toBe(403);
  });

  it('POST /api/push/subscribe stores subscription and validates format', async () => {
    const resInvalid = await app.request(
      '/api/push/subscribe',
      {
        method: 'POST',
        headers: { 'X-Ping-Token': 'test-secret-token-123', 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'http://example.com' }),
      },
      env,
    );
    expect(resInvalid.status).toBe(400);

    const sub: PushSubscription = {
      endpoint: 'https://push.example.com/test-endpoint',
      keys: { p256dh: 'p256', auth: 'auth' },
    };

    const res = await app.request(
      '/api/push/subscribe',
      {
        method: 'POST',
        headers: { 'X-Ping-Token': 'test-secret-token-123', 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.success).toBe(true);
    expect(body.total_devices).toBe(1);
  });

  it('DELETE /api/push/subscribe removes subscription', async () => {
    const sub: PushSubscription = {
      endpoint: 'https://push.example.com/test-endpoint',
      keys: { p256dh: 'p256', auth: 'auth' },
    };
    await addPushSubscription(mockKv as any, sub);

    const res = await app.request(
      '/api/push/subscribe',
      {
        method: 'DELETE',
        headers: { 'X-Ping-Token': 'test-secret-token-123', 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/test-endpoint' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.success).toBe(true);
    expect(body.total_devices).toBe(0);
  });

  it('GET /api/status returns status details', async () => {
    const res = await app.request(
      '/api/status',
      { headers: { 'X-Ping-Token': 'test-secret-token-123' } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.status).toBe('NORMAL');
    expect(typeof body.days_since_active).toBe('number');
  });
});

describe('Scheduled Cron Trigger (src/services/cron.ts)', () => {
  let mockKv: MockKVNamespace;
  let env: Env;

  beforeEach(() => {
    mockKv = new MockKVNamespace();
    env = createMockEnv(mockKv);
  });

  it('should validate WARNING_DAYS and DEAD_DAYS configuration', async () => {
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

  it('should remain NORMAL if activity is recent', async () => {
    const result = await processScheduledCheck(env);
    expect(result.status).toBe('NORMAL');
    expect(env.EMAIL_SEND.send).not.toHaveBeenCalled();
  });

  it('should transition to WARNING when inactive >= 6.5 days (12h margin)', async () => {
    const data = await getSystemData(mockKv as any);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000);
    data.last_active_at = sevenDaysAgo.toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('WARNING');
    expect(result.warning_sent_at).not.toBeNull();
    expect(env.EMAIL_SEND.send).toHaveBeenCalledTimes(1);
  });

  it('should retry warning notification if status is WARNING but warning_sent_at is null', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'WARNING';
    data.warning_sent_at = null;
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('WARNING');
    expect(result.warning_sent_at).not.toBeNull();
    expect(env.EMAIL_SEND.send).toHaveBeenCalledTimes(1);
  });

  it('should transition to DEAD when inactive >= 13.5 days (12h margin) and warning_sent_at is set', async () => {
    const data = await getSystemData(mockKv as any);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400 * 1000);
    data.last_active_at = fourteenDaysAgo.toISOString();
    data.status = 'WARNING';
    data.warning_sent_at = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(result.dead_sent_at).not.toBeNull();
    expect(env.EMAIL_SEND.send).toHaveBeenCalledTimes(1);
  });

  it('should retry dead notification if status is DEAD but dead_sent_at is null', async () => {
    const data = await getSystemData(mockKv as any);
    data.status = 'DEAD';
    data.dead_sent_at = null;
    await saveSystemData(mockKv as any, data);

    const result = await processScheduledCheck(env);
    expect(result.status).toBe('DEAD');
    expect(result.dead_sent_at).not.toBeNull();
    expect(env.EMAIL_SEND.send).toHaveBeenCalledTimes(1);
  });
});
