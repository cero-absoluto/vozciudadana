import { createHash, createHmac } from 'node:crypto';
import { supabase } from '../services/supabase.js';
import { sendOtp, verifyOtp } from '../services/twilio.js';
import { verifyRecaptcha } from '../lib/recaptcha.js';
import {
  signParticipationToken, generateDeviceSecret, deviceSecretMatches,
} from '../lib/participationToken.js';

/** Hash a phone number using HMAC-SHA256 with a server-side secret. */
function hashPhone(phoneE164) {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] PHONE_HASH_SECRET is required in production. Server cannot start without it.');
    }
    console.warn('[SECURITY] PHONE_HASH_SECRET not set — using plain SHA-256. Set this variable in production.');
    return createHash('sha256').update(phoneE164).digest('hex');
  }
  return createHmac('sha256', secret).update(phoneE164).digest('hex');
}

/** Hash an IP address using HMAC-SHA256 with same secret as phone hashing. */
function hashIp(ip) {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) {
    return createHash('sha256').update(ip || '').digest('hex').substring(0, 32);
  }
  return createHmac('sha256', secret).update(ip || '').digest('hex').substring(0, 32);
}

/** @param {import('fastify').FastifyInstance} app */
export default async function userRoutes(app) {

  // POST /api/users/request-otp
  app.post('/request-otp', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'recaptcha_token'],
        properties: {
          phone:           { type: 'string', minLength: 8, maxLength: 16, pattern: '^\\+[1-9]\\d{7,14}$' },
          recaptcha_token: { type: 'string', minLength: 1 },
          device_id:       { type: 'string', minLength: 8, maxLength: 128, nullable: true },
          protest_id:      { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone, recaptcha_token, device_id, protest_id } = req.body;

    // ── 1. Verify reCAPTCHA first ──────────────────────────────────────────
    await verifyRecaptcha(recaptcha_token, 'request_otp', req, reply);

    const phone_hash = hashPhone(phone);
    const ip_hash    = hashIp(req.ip || req.headers['x-forwarded-for']);

    // ── 2. Check progressive cooldown for this device ──────────────────────
    if (device_id) {
      const { data: cooldown } = await supabase.rpc('get_otp_cooldown', { p_device_id: device_id });
      if (cooldown > 0) {
        return reply.tooManyRequests('For security reasons, please wait a few minutes before requesting another code.');
      }
    }

    // ── 3. Check rate limits (phone, device, IP, device+protest) ──────────
    const { data: limitCheck } = await supabase.rpc('check_otp_rate_limit', {
      p_phone_hash: phone_hash,
      p_device_id:  device_id || null,
      p_ip_hash:    ip_hash,
      p_protest_id: protest_id || null,
    });

    if (!limitCheck?.allowed) {
      req.log.warn({ reason: limitCheck?.reason }, 'OTP rate limit exceeded');
      return reply.code(429).send({ error: 'RATE_LIMITED', code: 'otp_rate_limited' });
    }

    // ── 4. Nullifier check — before sending SMS ─────────────────────────
    // If protest_id provided, check if this number already adhered.
    // Returns neutral 200 {sent:false} — does not reveal the reason,
    // preventing enumeration attacks on participation status.
    if (protest_id && phone_hash) {
      const nullifierCheck = createHmac('sha256', process.env.NULLIFIER_SECRET || 'dev-secret')
        .update(phone_hash + protest_id)
        .digest('hex');
      const { data: existingNullifier } = await supabase
        .from('adhesions')
        .select('id')
        .eq('protest_id', protest_id)
        .eq('nullifier', nullifierCheck)
        .is('deleted_at', null)
        .is('anonymized_at', null)
        .maybeSingle();
      if (existingNullifier) {
        return reply.code(200).send({ sent: false });
      }
    }

    // ── 5. Log OTP request ────────────────────────────────────────────────
    const { error } = await supabase
      .from('otp_requests')
      .insert({
        phone_hash,
        device_id:   device_id || null,
        ip_hash,
        protest_id:  protest_id || null,
        status:      'sent',
        requested_at: new Date().toISOString(),
      });

    if (error) throw error;

    // ── 6. Send SMS ───────────────────────────────────────────────────────
    await sendOtp(phone);
    return { sent: true };
  });

  // POST /api/users/verify-otp
  //
  // VP-SEC-001/002/003 fix (23 July 2026): this used to return the raw
  // phone_hash to the client, which then sent it straight back at /join —
  // nothing bound that value to having actually come from this
  // verification. It now returns a short-lived, signed participation_token
  // instead (join now reads phone_hash from inside that token, not from
  // anything the client asserts — see routes/protests.js). It also
  // generates a device_secret on first verification, returned once: the
  // client must present this (not just its device_id) to re-authenticate
  // a returning device later without a fresh OTP (see /device/:id/reauth
  // below), closing the "device_id as a bearer credential" gap.
  app.post('/verify-otp', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'otp', 'device_id'],
        properties: {
          phone:        { type: 'string', minLength: 8, maxLength: 16, pattern: '^\\+[1-9]\\d{7,14}$' },
          otp:          { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
          device_id:    { type: 'string', minLength: 8, maxLength: 128 },
          country_code: { type: 'string', minLength: 2, maxLength: 2, pattern: '^[A-Z]{2}$', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone, otp, device_id, country_code } = req.body;

    const approved = await verifyOtp(phone, otp);
    if (!approved) {
      // Mark OTP as expired on failure
      await supabase
        .from('otp_requests')
        .update({ status: 'expired' })
        .eq('device_id', device_id)
        .eq('status', 'sent');
      return reply.unauthorized('OTP inválido o expirado');
    }

    const phone_hash = hashPhone(phone);

    // Mark OTP as completed
    await supabase
      .from('otp_requests')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('device_id', device_id)
      .eq('phone_hash', phone_hash)
      .eq('status', 'sent');

    // If phone already verified on another device, return it — a fresh
    // participation_token is still issued (a real OTP was just completed,
    // regardless of which device row is canonical for this phone_hash), but
    // no device_secret is minted here: this device_id did not create that
    // row, so it cannot vouch for it going forward — see the comment below.
    const { data: existing } = await supabase
      .from('devices')
      .select('id')
      .eq('phone_hash', phone_hash)
      .maybeSingle();

    if (existing) {
      const participation_token = signParticipationToken({ device_id: existing.id, phone_hash, purpose: 'join_protest' });
      return { verified: true, device_id: existing.id, participation_token };
    }

    const { secret: device_secret, hash: device_secret_hash } = generateDeviceSecret();
    const user_agent = req.headers['user-agent'] || null;
    const { data, error } = await supabase
      .from('devices')
      .upsert({
        id: device_id, phone_hash, verified_at: new Date().toISOString(), user_agent,
        country_code: country_code ?? null, device_secret_hash,
      })
      .select()
      .single();

    if (error) throw error;

    const participation_token = signParticipationToken({ device_id: data.id, phone_hash, purpose: 'join_protest' });
    // device_secret is returned exactly once, here, at the moment it is
    // generated. It is never stored in recoverable form server-side (only
    // its HMAC is) and this endpoint never returns it again after this call.
    return { verified: true, device_id: data.id, participation_token, device_secret };
  });

  // POST /api/users/device/:id/reauth
  //
  // Replaces the old GET /device/:id (VP-SEC-002 fix, 23 July 2026), which
  // returned a device's phone_hash and country_code to anyone who simply
  // knew — or obtained, via browser storage, logs, a malicious extension, a
  // future XSS, a debug capture, or a shared computer — its device_id. A
  // bare device_id acted as a permanent bearer credential with no second
  // factor. This endpoint requires the device_secret minted at first
  // verification (see POST /verify-otp) and issues a fresh, short-lived
  // participation_token instead of any raw identity data — this is what
  // lets a returning device skip re-typing a phone number without ever
  // exposing phone_hash to whoever merely knows the device_id string.
  app.post('/device/:id/reauth', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 8, maxLength: 128 } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['device_secret'],
        properties: { device_secret: { type: 'string', minLength: 32, maxLength: 256 } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { data } = await supabase
      .from('devices')
      .select('id, phone_hash, verified_at, device_secret_hash, country_code')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!data || !data.verified_at || !deviceSecretMatches(req.body.device_secret, data.device_secret_hash)) {
      // Same response whether the device doesn't exist, was never verified,
      // or the secret is wrong — distinguishing these would tell an
      // attacker which device_ids are real.
      return reply.code(401).send({ error: 'REAUTH_FAILED' });
    }

    const participation_token = signParticipationToken({ device_id: data.id, phone_hash: data.phone_hash, purpose: 'join_protest' });
    return { authenticated: true, participation_token, country_code: data.country_code };
  });

  // POST /api/users/device/:id/locks
  //
  // VP-SEC-002 fix: previously GET, unauthenticated, returning every
  // convocatoria this device had joined to anyone who knew its device_id.
  // Now requires the same device_secret proof as reauth above, and returns
  // only what the app actually needs (whether a lock exists per scope),
  // not each convocatoria's identity.
  app.post('/device/:id/locks', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 8, maxLength: 128 } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['device_secret'],
        properties: { device_secret: { type: 'string', minLength: 32, maxLength: 256 } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { data: device } = await supabase
      .from('devices')
      .select('device_secret_hash')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!device || !deviceSecretMatches(req.body.device_secret, device.device_secret_hash)) {
      return reply.code(401).send({ error: 'REAUTH_FAILED' });
    }

    const { data, error } = await supabase
      .from('adhesions')
      .select('protest_id, protests(scope, region, ends_at)')
      .eq('device_id', req.params.id)
      .is('anonymized_at', null);

    if (error) throw error;
    return data;
  });
}

