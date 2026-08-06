import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { Link, ViteClient } from 'vite-ssr-components/hono';
import * as z from 'zod';

import { processScheduledCheck } from '@/services/cron';
import {
  addPushSubscription,
  getSystemData,
  removePushSubscription,
  updateActivity,
} from '@/services/kv';
import type { Env } from '@/types';
import { SystemLockedError } from '@/types';
import { getDaysSince } from '@/utils/date';
import { CheckInPage } from '@/views/check-in';
import { DeadPage } from '@/views/dead';

const handlePing = async (c: Context<{ Bindings: Env }>) => {
  const updated = await updateActivity(c.env.DMS_KV);
  return c.json({
    success: true,
    status: updated.status,
    last_active_at: updated.last_active_at,
  });
};

const app = new Hono<{ Bindings: Env }>()

  .onError((err, c) => {
    if (err instanceof SystemLockedError) {
      return c.json({ error: err.message }, 403);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  })

  .use(
    '*',
    jsxRenderer(({ children }) => (
      <html lang="ja">
        <head>
          <meta charSet="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <Link href="/public/style.css" rel="stylesheet" />
          <ViteClient />
        </head>
        <body>{children}</body>
      </html>
    )))

  .get(
    '/',
    async (c) => {
      const data = await getSystemData(c.env.DMS_KV);

      if (data.status === 'DEAD') {
        return c.render(<DeadPage />);
      }

      const vapidPublicKey = c.env.VAPID_PUBLIC_KEY || '';
      return c.render(<CheckInPage data={data} vapidPublicKey={vapidPublicKey} />);
    })

  .post('/ping', handlePing)

  .post('/api/ping', handlePing)

  .post(
    '/api/push/subscribe',
    zValidator('json', z.object({
      endpoint: z.string(),
      keys: z.object({
        p256dh: z.string(),
        auth: z.string(),
      }),
    })),
    async (c) => {
      const body = c.req.valid('json');
      const updated = await addPushSubscription(c.env.DMS_KV, body);
      return c.json({
        success: true,
        total_devices: updated.push_subscriptions.length,
      });
    })

  .delete(
    '/api/push/subscribe',
    zValidator('json', z.object({
      endpoint: z.string(),
    })),
    async (c) => {
      const body = c.req.valid('json');
      const updated = await removePushSubscription(c.env.DMS_KV, body.endpoint);
      return c.json({
        success: true,
        total_devices: updated.push_subscriptions.length,
      });
    })

  .get(
    '/api/status',
    async (c) => {
      const data = await getSystemData(c.env.DMS_KV);
      const daysSinceActive = getDaysSince(data.last_active_at);
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

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processScheduledCheck(env));
  },
};
