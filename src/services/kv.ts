import type { KVNamespace } from '@cloudflare/workers-types';

import type { PushSubscription, SystemData } from '../types';

const KV_KEY = 'system_data';

export const DEFAULT_SYSTEM_DATA: SystemData = {
  status: 'NORMAL',
  last_active_at: new Date().toISOString(),
  warning_sent_at: null,
  dead_sent_at: null,
  push_subscriptions: [],
};

export async function getSystemData(kv: KVNamespace): Promise<SystemData> {
  const data = await kv.get<SystemData>(KV_KEY, 'json');
  if (!data) {
    const initialData: SystemData = {
      ...DEFAULT_SYSTEM_DATA,
      last_active_at: new Date().toISOString(),
    };
    await saveSystemData(kv, initialData);
    return initialData;
  }
  return data;
}

export async function saveSystemData(kv: KVNamespace, data: SystemData): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(data));
}

export async function updateActivity(kv: KVNamespace): Promise<SystemData> {
  const current = await getSystemData(kv);
  if (current.status === 'DEAD') {
    throw new Error('System locked out (status is DEAD)');
  }

  const updated: SystemData = {
    ...current,
    last_active_at: new Date().toISOString(),
    status: 'NORMAL',
    warning_sent_at: null,
  };

  await saveSystemData(kv, updated);
  return updated;
}

export async function addPushSubscription(
  kv: KVNamespace,
  subscription: PushSubscription,
): Promise<SystemData> {
  const current = await getSystemData(kv);
  const existingIndex = current.push_subscriptions.findIndex(
    (sub) => sub.endpoint === subscription.endpoint,
  );

  let updatedSubs: PushSubscription[];
  if (existingIndex >= 0) {
    updatedSubs = [...current.push_subscriptions];
    updatedSubs[existingIndex] = subscription;
  } else {
    updatedSubs = [...current.push_subscriptions, subscription];
  }

  const updated: SystemData = {
    ...current,
    push_subscriptions: updatedSubs,
  };

  await saveSystemData(kv, updated);
  return updated;
}

export async function removePushSubscription(
  kv: KVNamespace,
  endpoint: string,
): Promise<SystemData> {
  const current = await getSystemData(kv);
  const updatedSubs = current.push_subscriptions.filter(
    (sub) => sub.endpoint !== endpoint,
  );

  const updated: SystemData = {
    ...current,
    push_subscriptions: updatedSubs,
  };

  await saveSystemData(kv, updated);
  return updated;
}
