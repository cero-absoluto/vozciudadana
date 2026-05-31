import webpush from 'web-push';
import { supabase } from '../services/supabase.js';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

export default async function pushRoutes(app) {

  // GET /api/push/vapid-public-key — frontend needs this to subscribe
  app.get('/vapid-public-key', async () => ({
    publicKey: process.env.VAPID_PUBLIC_KEY,
  }));

  // POST /api/push/subscribe — save subscription
  app.post('/subscribe', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'subscription'],
        properties: {
          device_id:    { type: 'string' },
          subscription: {
            type: 'object',
            required: ['endpoint', 'keys'],
            properties: {
              endpoint: { type: 'string' },
              keys: {
                type: 'object',
                required: ['p256dh', 'auth'],
                properties: {
                  p256dh: { type: 'string' },
                  auth:   { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { device_id, subscription } = req.body;
    const { endpoint, keys: { p256dh, auth } } = subscription;

    await supabase.from('push_subscriptions').upsert({
      device_id,
      endpoint,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

    return reply.code(201).send({ ok: true });
  });

  // POST /api/push/unsubscribe — remove subscription
  app.post('/unsubscribe', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id'],
        properties: {
          device_id: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    await supabase.from('push_subscriptions')
      .delete()
      .eq('device_id', req.body.device_id);
    return { ok: true };
  });

  // POST /api/push/notify — send notification to subscribers of a protest
  // Called internally when adhesion milestones are reached
  app.post('/notify', {
    schema: {
      body: {
        type: 'object',
        required: ['protest_id', 'title', 'body', 'admin_secret'],
        properties: {
          protest_id:   { type: 'string', format: 'uuid' },
          title:        { type: 'string' },
          body:         { type: 'string' },
          url:          { type: 'string', nullable: true },
          admin_secret: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { protest_id, title, body, url, admin_secret } = req.body;

    if (admin_secret !== process.env.ADMIN_SECRET) {
      return reply.status(401).send({ error: 'No autorizado' });
    }

    // Get all device_ids that joined this protest
    const { data: adhesions } = await supabase
      .from('adhesions')
      .select('device_id')
      .eq('protest_id', protest_id);

    if (!adhesions?.length) return { sent: 0 };

    const deviceIds = adhesions.map(a => a.device_id);

    // Get their push subscriptions
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('device_id', deviceIds);

    if (!subs?.length) return { sent: 0 };

    const payload = JSON.stringify({
      title,
      body,
      icon:  '/vozciudadana/icon-192.png',
      badge: '/vozciudadana/icon-72.png',
      url:   url || 'https://cero-absoluto.github.io/vozciudadana',
    });

    let sent = 0;
    const dead = [];

    await Promise.allSettled(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(sub.endpoint);
        }
      }
    }));

    // Clean up expired subscriptions
    if (dead.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', dead);
    }

    return { sent, dead: dead.length };
  });

}
