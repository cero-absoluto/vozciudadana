import webpush from 'web-push';
import { supabase } from '../services/supabase.js';

function initVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_EMAIL) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    return true;
  }
  return false;
}

export default async function pushRoutes(app) {

  // GET /api/push/vapid-public-key — frontend needs this to subscribe
  app.get('/vapid-public-key', async () => ({
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
  }));

  // POST /api/push/subscribe — save subscription
  app.post('/subscribe', {
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'subscription'],
        properties: {
          device_id:    { type: 'string' },
          protest_id:   { type: 'string', nullable: true },
          ends_at:      { type: 'string', nullable: true },
          locale:       { type: 'string', nullable: true },
          timezone:     { type: 'string', nullable: true },
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
    const { device_id, protest_id, ends_at, locale, timezone, subscription } = req.body;
    const { endpoint, keys: { p256dh, auth } } = subscription;

    await supabase.from('push_subscriptions').upsert({
      device_id,
      endpoint,
      p256dh,
      auth,
      protest_id: protest_id || null,
      ends_at:    ends_at    || null,
      locale:     locale || 'en',
      timezone:   timezone   || null,
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
      .eq('protest_id', protest_id)
      .is('anonymized_at', null);

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
      icon:  '/icon-192.png',
      badge: '/icon-72.png',
      url:   url || 'https://voiceprotest.org',
    });

    if (!initVapid()) return { sent: 0, error: 'VAPID not configured' };

    let sent = 0;
    const dead = [];

    await Promise.allSettled(subs.map(async sub => {
      if (type === 'closing' && isNighttime(sub.timezone)) return;
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

  // ── Helper: send push to all subscribers of a protest ──────────────────
  const NOTIF_TEXTS = {
    started: {
      en: { title: '🗳️ Protest has started', body: (t) => `${t} — Share now to add more voices` },
      es: { title: '🗳️ La protesta ha comenzado', body: (t) => `${t} — Compártela ahora para sumar más voces` },
      fr: { title: '🗳️ La protestation a commencé', body: (t) => `${t} — Partagez maintenant pour ajouter des voix` },
      zh: { title: '🗳️ 抗议已开始', body: (t) => `${t} — 立即分享以获得更多支持` },
    },
    closing: {
      en: { title: '⏰ Last hour', body: (t) => `${t} — Closes in 1 hour. Share to add more adhesions` },
      es: { title: '⏰ Última hora', body: (t) => `${t} — Cierra en 1 hora. Comparte para sumar más adhesiones` },
      fr: { title: '⏰ Dernière heure', body: (t) => `${t} — Ferme dans 1 heure. Partagez pour plus d'adhésions` },
      zh: { title: '⏰ 最后一小时', body: (t) => `${t} — 1小时后关闭。分享以获得更多参与` },
    },
    closed: {
      en: { title: '✅ Final result', body: (t, c, ci) => `${t} — ${c} verified participants in ${ci} cities. See report →` },
      es: { title: '✅ Resultado final', body: (t, c, ci) => `${t} — ${c} participantes verificados en ${ci} ciudades. Ver informe →` },
      fr: { title: '✅ Résultat final', body: (t, c, ci) => `${t} — ${c} participants vérifiés dans ${ci} villes. Voir rapport →` },
      zh: { title: '✅ 最终结果', body: (t, c, ci) => `${t} — ${c}名经验证参与者来自${ci}个城市。查看报告 →` },
    },
  };

  async function sendToProtest(protestId, type, protestTitle, url, count = 0, cities = 0) {
    const { data: adhesions } = await supabase
      .from('adhesions')
      .select('device_id')
      .eq('protest_id', protestId)
      .is('deleted_at', null)
      .is('anonymized_at', null);

    if (!adhesions?.length) return 0;
    const deviceIds = adhesions.map(a => a.device_id);

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, locale, timezone')
      .in('device_id', deviceIds);

    if (!subs?.length || !initVapid()) return 0;

    // Night filter — don't send 'closing' push between 23:00 and 07:00 local time
    function isNighttime(timezone) {
      if (!timezone) return false;
      try {
        const hour = parseInt(
          new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: timezone })
            .format(new Date())
        );
        return hour >= 23 || hour < 7;
      } catch { return false; }
    }

    let sent = 0;
    const dead = [];
    await Promise.allSettled(subs.map(async sub => {
      if (type === 'closing' && isNighttime(sub.timezone)) return;
      try {
        const lang = (sub.locale || 'en').substring(0, 2);
        const texts = NOTIF_TEXTS[type]?.[lang] || NOTIF_TEXTS[type]?.['en'];
        const payload = JSON.stringify({
          title: texts.title,
          body:  texts.body(protestTitle, count, cities),
          icon: '/icon-192.png',
          badge: '/icon-72.png',
          url,
        });
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
      }
    }));

    if (dead.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', dead);
    }
    return sent;
  }

  // ── HOURLY JOB — 3 notification triggers ─────────────────────────────
  async function hourlyJob() {
    const now = new Date();
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const ago1h = new Date(now.getTime() - 60 * 60 * 1000);

    // ── NOTIFICATION 1: Protest just started (starts_at in last hour) ──
    const { data: justStarted } = await supabase
      .from('protests')
      .select('id, title, starts_at, ends_at, count')
      .eq('status', 'active')
      .gte('starts_at', ago1h.toISOString())
      .lte('starts_at', now.toISOString());

    for (const protest of (justStarted || [])) {
      await sendToProtest(protest.id, 'started', protest.title, `https://voiceprotest.org/#/informe/${protest.id}`);
    }

    // ── NOTIFICATION 2: Closing in 1 hour ──────────────────────────────
    const { data: closingSoon } = await supabase
      .from('protests')
      .select('id, title, ends_at, count')
      .eq('status', 'active')
      .gte('ends_at', now.toISOString())
      .lte('ends_at', in1h.toISOString());

    for (const protest of (closingSoon || [])) {
      await sendToProtest(protest.id, 'closing', protest.title, `https://voiceprotest.org/#/informe/${protest.id}`);
    }

    // ── NOTIFICATION 3: Just closed (ends_at in last hour, status=closed) ──
    const { data: justClosed } = await supabase
      .from('protests')
      .select('id, title, ends_at, count, cities_count')
      .eq('status', 'closed')
      .gte('ends_at', ago1h.toISOString())
      .lte('ends_at', now.toISOString());

    for (const protest of (justClosed || [])) {
      await sendToProtest(protest.id, 'closed', protest.title, `https://voiceprotest.org/#/informe/${protest.id}`, protest.count, protest.cities_count);
    }

    // ── Cleanup: delete subscriptions for protests closed >24h ago ──────
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await supabase
      .from('push_subscriptions')
      .delete()
      .not('ends_at', 'is', null)
      .lt('ends_at', ago24h.toISOString());
  }

  // Run every 60 minutes + once at startup
  setInterval(hourlyJob, 60 * 60 * 1000);
  setTimeout(hourlyJob, 5000);

}
