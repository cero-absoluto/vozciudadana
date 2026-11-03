import webpush from 'web-push';
import {createHash,timingSafeEqual} from 'node:crypto';
import { deviceSecretMatches } from '../lib/participationToken.js';
import { isAllowedPushEndpoint } from '../lib/pushEndpoint.js';
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
  const rpc = (name,args) => supabase.rpc(name,args).abortSignal(AbortSignal.timeout(8000));
  const preferenceSchema = {
    type:'object',required:['device_id','device_secret','protest_id'],additionalProperties:false,
    properties:{device_id:{type:'string',minLength:8,maxLength:128},device_secret:{type:'string',minLength:32,maxLength:256},protest_id:{type:'string',format:'uuid'}},
  };
  const validPreference = data => data?.ok===true && typeof data.enabled==='boolean' && Number.isInteger(data.revision) && data.revision>=0 && data.revision<=2147483647;
  function preferenceError(error,reply) {
    const known={VP_PUSH_DEVICE_UNVERIFIED:[401,'PUSH_AUTH_REQUIRED'],VP_PUSH_PROTEST_NOT_FOUND:[404,'PUSH_PROTEST_NOT_FOUND'],VP_PUSH_PARTICIPATION_REQUIRED:[403,'PUSH_PARTICIPATION_REQUIRED'],VP_PUSH_CONSENT_STALE:[409,'PUSH_CONSENT_STALE']};
    const mapped=typeof error?.message==='string' && Object.hasOwn(known,error.message)?known[error.message]:null;
    if(mapped)return reply.code(mapped[0]).send({error:mapped[1]});
    throw new Error('PUSH_CONSENT_UNAVAILABLE');
  }

  async function authenticatedDevice(req, reply) {
    const {data,error}=await supabase.from('devices').select('id,verified_at,device_secret_hash').eq('id',req.body.device_id).maybeSingle();
    if(error)throw new Error('PUSH_AUTH_UNAVAILABLE');
    if(!data?.verified_at||!deviceSecretMatches(req.body.device_secret,data.device_secret_hash)) {
      reply.code(401).send({error:'PUSH_AUTH_REQUIRED'});return false;
    }
    return true;
  }


  for(const [path,name] of [['/preferences','get_push_notification_preferences'],['/revoke','revoke_push_notification_preferences']]) {
    app.post(path,{config:{rateLimit:{max:10,timeWindow:'5 minutes'}},schema:{body:preferenceSchema}},async(req,reply)=>{
      if(!await authenticatedDevice(req,reply))return;
      const {data,error}=await rpc(name,{p_device_id:req.body.device_id,p_protest_id:req.body.protest_id});
      if(error)return preferenceError(error,reply);
      if(!validPreference(data) || (path==='/preferences' && !['present','missing'].includes(data.registration)) || (path==='/revoke' && (data.enabled!==false || data.revision<1)))throw new Error('PUSH_CONSENT_UNAVAILABLE');
      return {ok:true,enabled:data.enabled,revision:data.revision,...(path==='/preferences'?{registration:data.registration}:{})};
    });
  }

  // GET /api/push/vapid-public-key — frontend needs this to subscribe
  app.get('/vapid-public-key', async () => ({
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
  }));

  // POST /api/push/subscribe — save subscription
  app.post('/subscribe', {
    preValidation:async(req,reply)=>{
      // Fastify/Ajv otherwise coerces null, false or numeric strings to revision 0.
      if(req.body && Object.hasOwn(req.body,'consent_revision') && !Number.isInteger(req.body.consent_revision))return reply.code(400).send({error:'PUSH_CONSENT_REVISION_INVALID'});
    },
    config: {rateLimit:{max:10,timeWindow:'5 minutes'}},
    schema: {
      body: {
        type: 'object',
        required: ['device_id', 'device_secret', 'subscription'],
        additionalProperties: false,
        properties: {
          device_id:    { type: 'string', minLength: 8, maxLength: 128 },
          device_secret: { type: 'string', minLength: 32, maxLength: 256 },
          protest_id:   { type: 'string', format: 'uuid', nullable: true },
          consent_revision: { type:'integer',minimum:0,maximum:2147483646 },
          ends_at:      { type: 'string', nullable: true },
          locale:       { type: 'string', maxLength: 16, nullable: true },
          timezone:     { type: 'string', maxLength: 100, nullable: true },
          subscription: {
            type: 'object',
            required: ['endpoint', 'keys'],
            properties: {
              endpoint: { type: 'string', maxLength: 2048 },
              keys: {
                type: 'object',
                required: ['p256dh', 'auth'],
                properties: {
                  p256dh: { type: 'string', pattern: '^[A-Za-z0-9_-]{87}={0,1}$' },
                  auth:   { type: 'string', pattern: '^[A-Za-z0-9_-]{22}={0,2}$' },
                },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    if(!await authenticatedDevice(req,reply))return;
    const {device_id,protest_id,locale,timezone,subscription}=req.body;
    if(!isAllowedPushEndpoint(subscription.endpoint))return reply.code(400).send({error:'PUSH_ENDPOINT_INVALID'});
    const scoped=Object.hasOwn(req.body,'consent_revision');
    if(scoped && !protest_id)return reply.code(400).send({error:'PUSH_PROTEST_REQUIRED'});
    const {data,error}=await rpc(scoped?'save_scoped_push_subscription':'save_owned_push_subscription',{
      p_device_id:device_id,p_endpoint:subscription.endpoint,p_p256dh:subscription.keys.p256dh,
      p_auth:subscription.keys.auth,p_protest_id:protest_id||null,
      p_locale:['es','en','fr','zh'].includes(locale)?locale:'en',p_timezone:timezone||null,
      ...(scoped?{p_consent_revision:req.body.consent_revision}:{}),
    });
    if(error)return preferenceError(error,reply);
    if(scoped){
      if(data?.ok===false && data.error==='PUSH_ENDPOINT_OWNED')return reply.code(409).send({error:'PUSH_ENDPOINT_OWNED'});
      if(!validPreference(data) || data.enabled!==true || data.revision<1)throw new Error('PUSH_CONSENT_UNAVAILABLE');
      return reply.code(201).send({ok:true,enabled:true,revision:data.revision});
    }
    if(data!==true)return reply.code(409).send({error:'PUSH_ENDPOINT_OWNED'});
    return reply.code(201).send({ok:true});
  });

  // POST /api/push/unsubscribe — remove subscription
  app.post('/unsubscribe', {
    config: {rateLimit:{max:10,timeWindow:'5 minutes'}},
    schema: {
      body: {
        type: 'object',
        required: ['device_id','device_secret','endpoint'],
        additionalProperties: false,
        properties: {
          device_id: { type: 'string', minLength: 8, maxLength: 128 },
          device_secret: { type: 'string', minLength: 32, maxLength: 256 },
          endpoint: { type: 'string', maxLength: 2048 },
        },
      },
    },
  }, async (req, reply) => {
    if(!await authenticatedDevice(req,reply))return;
    const {error}=await supabase.from('push_subscriptions').delete().eq('device_id',req.body.device_id).eq('endpoint',req.body.endpoint);
    if(error)throw new Error('PUSH_DELETE_FAILED');
    return { ok: true };
  });

  async function deliveryTargets(protestId) {
    const {data,error}=await rpc('list_scoped_push_subscriptions',{p_protest_id:protestId});
    if(error || !Array.isArray(data))throw new Error('PUSH_DELIVERY_UNAVAILABLE');
    return data;
  }
  async function canDeliver(sub,protestId) {
    if(typeof sub.device_id!=='string')return false;
    const {data,error}=await rpc('push_subscription_can_deliver',{p_device_id:sub.device_id,p_protest_id:protestId,p_endpoint:sub.endpoint});
    // Recheck after loading a batch. A send already authorized/in flight cannot be recalled.
    return !error && data===true;
  }

  async function removeDeadSubscriptions(dead) {
    for(const sub of dead){
      // A late provider failure must not delete a replacement owner/key pair.
      const {error}=await supabase.from('push_subscriptions').delete().eq('device_id',sub.device_id)
        .eq('endpoint',sub.endpoint).eq('p256dh',sub.p256dh).eq('auth',sub.auth);
      if(error)throw new Error('PUSH_CLEANUP_UNAVAILABLE');
    }
  }

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

    const expectedSecret=process.env.ADMIN_SECRET;
    if (!expectedSecret || !timingSafeEqual(createHash('sha256').update(admin_secret).digest(),createHash('sha256').update(expectedSecret).digest())) {
      return reply.status(401).send({ error: 'No autorizado' });
    }

    const subs=await deliveryTargets(protest_id);
    if(!subs.length)return {sent:0};

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
      if (!isAllowedPushEndpoint(sub.endpoint)) return;
      if(!await canDeliver(sub,protest_id))return;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload, {timeout:5000},
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(sub);
        }
      }
    }));

    // Clean up expired subscriptions
    if (dead.length) {
      await removeDeadSubscriptions(dead);
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
    const subs=await deliveryTargets(protestId);
    if(!subs.length || !initVapid())return 0;

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
      if (!isAllowedPushEndpoint(sub.endpoint)) return;
      if(!await canDeliver(sub,protestId))return;
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
          payload, {timeout:5000}
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub);
      }
    }));

    if (dead.length) {
      await removeDeadSubscriptions(dead);
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

    // Never delete a shared endpoint solely because its last legacy event expired.
    // The SQL cleanup keeps active/unknown references and serializes registrations.
    // Operational cleanup is prepared but disabled by default. Deployment and
    // validation never enable deletion of existing rows implicitly.
    if(process.env.PUSH_SCOPED_ORPHAN_CLEANUP_ENABLED==='true'){
      const {error}=await rpc('prune_scoped_push_orphans',{});
      if(error)throw new Error('PUSH_CLEANUP_UNAVAILABLE');
    }
  }

  // Run every 60 minutes + once at startup
  const runHourly=()=>hourlyJob().catch(()=>app.log.warn('Push notification job unavailable'));
  setInterval(runHourly,60*60*1000);
  setTimeout(runHourly,5000);

}
