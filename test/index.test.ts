import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSystemData,
  saveSystemData,
  updateActivity,
  addPushSubscription,
  removePushSubscription,
} from '../src/services/kv';
import type { SystemData, PushSubscription } from '../src/types';

// In-Memory Mock for KVNamespace
class MockKVNamespace {
  private store = new Map<string, string>();

  async get<T>(key: string, type?: 'text' | 'json'): Promise<T | null> {
    const val = this.store.get(key);
    if (!val) return null;
    if (type === 'json') {
      return JSON.parse(val) as T;
    }
    return val as unknown as T;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
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
      'System locked out (status is DEAD)'
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

    // Update existing subscription
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
