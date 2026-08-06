import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { Link, Script, ViteClient } from 'vite-ssr-components/hono';
import * as z from 'zod';

import { CheckInPage } from '@/pages/CheckIn';
import { DeadPage } from '@/pages/Dead';
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
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <ViteClient />
          <Link href="/public/style.css" rel="stylesheet" />
          <Script src="/src/client.tsx" type="module" />
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

      return c.render(<CheckInPage data={data} vapidPublicKey={c.env.VAPID_PUBLIC_KEY} />);
    },
  )

  .post('/ping', handlePing)

  .post('/api/ping', handlePing)

  .post(
    '/api/push/subscribe',
    zValidator(
      'json',
      z.object({
        endpoint: z.url(),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
      }),
    ),
    async (c) => {
      const sub = c.req.valid('json');
      const updated = await addPushSubscription(c.env.DMS_KV, sub);
      return c.json({
        success: true,
        total_devices: updated.push_subscriptions.length,
      });
    },
  )

  .delete(
    '/api/push/subscribe',
    zValidator(
      'json',
      z.object({
        endpoint: z.url(),
      }),
    ),
    async (c) => {
      const { endpoint } = c.req.valid('json');
      const updated = await removePushSubscription(c.env.DMS_KV, endpoint);
      return c.json({
        success: true,
        total_devices: updated.push_subscriptions.length,
      });
    },
  )

  .get(
    '/api/status',
    async (c) => {
      const data = await getSystemData(c.env.DMS_KV);
      return c.json({
        status: data.status,
        last_active_at: data.last_active_at,
        days_since_active: getDaysSince(data.last_active_at),
        warning_sent_at: data.warning_sent_at,
        dead_sent_at: data.dead_sent_at,
        push_subscriptions_count: data.push_subscriptions.length,
      });
    },
  );

export type AppType = typeof app;
export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await processScheduledCheck(env);
  },
};
