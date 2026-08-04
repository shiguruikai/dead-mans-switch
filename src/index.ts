import type { Context } from 'hono';
import { Hono } from 'hono';

import { processScheduledCheck } from './services/cron';
import {
  addPushSubscription,
  getSystemData,
  removePushSubscription,
  updateActivity,
} from './services/kv';
import { renderDashboardPage, renderDeadPage } from './templates/checkin';
import type { Env, PushSubscription } from './types';

const app = new Hono<{ Bindings: Env }>();

// Auth Middleware: X-Ping-Token または Zero Trust Access Email
const authMiddleware = async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
  const token = c.req.header('X-Ping-Token');
  const cfEmail = c.req.header('Cf-Access-Authenticated-User-Email');

  if (cfEmail || (token && token === c.env.PING_SECRET_TOKEN)) {
    await next();
    return;
  }

  if (!token || token !== c.env.PING_SECRET_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};

// 1. GET /checkin (Zero Trust protected)
app.get('/checkin', async (c) => {
  const data = await getSystemData(c.env.DMS_KV);

  if (data.status === 'DEAD') {
    return c.html(renderDeadPage());
  }

  const vapidPublicKey = c.env.VAPID_PUBLIC_KEY || '';
  return c.html(renderDashboardPage(data, vapidPublicKey));
});

// 2. POST /checkin/ping (Zero Trust protected for dashboard)
app.post('/checkin/ping', async (c) => {
  try {
    const updated = await updateActivity(c.env.DMS_KV);
    return c.json({
      success: true,
      status: updated.status,
      last_active_at: updated.last_active_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('DEAD')) {
      return c.json({ error: 'System locked out (status is DEAD)' }, 403);
    }
    return c.json({ error: message }, 500);
  }
});

// 3. POST /api/ping (X-Ping-Token protected for external scripts)
app.post('/api/ping', authMiddleware, async (c) => {
  try {
    const updated = await updateActivity(c.env.DMS_KV);
    return c.json({
      success: true,
      status: updated.status,
      last_active_at: updated.last_active_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('DEAD')) {
      return c.json({ error: 'System locked out (status is DEAD)' }, 403);
    }
    return c.json({ error: message }, 500);
  }
});

// 4. POST /api/push/subscribe (Zero Trust / Auth protected)
app.post('/api/push/subscribe', authMiddleware, async (c) => {
  try {
    const subscription = (await c.req.json()) as unknown as Partial<PushSubscription>;
    if (!subscription.endpoint || !subscription.keys) {
      return c.json({ error: 'Invalid PushSubscription format' }, 400);
    }

    const updated = await addPushSubscription(c.env.DMS_KV, subscription as PushSubscription);
    return c.json({
      success: true,
      total_devices: updated.push_subscriptions.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// 5. DELETE /api/push/subscribe (Zero Trust / Auth protected)
app.delete('/api/push/subscribe', authMiddleware, async (c) => {
  try {
    const body = (await c.req.json()) as unknown as { endpoint?: string };
    if (!body.endpoint || typeof body.endpoint !== 'string') {
      return c.json({ error: 'Invalid endpoint' }, 400);
    }

    const updated = await removePushSubscription(c.env.DMS_KV, body.endpoint);
    return c.json({
      success: true,
      total_devices: updated.push_subscriptions.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// 6. GET /api/status
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
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processScheduledCheck(env));
  },
};
