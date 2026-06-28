import { createHash, createHmac } from 'node:crypto';
import { supabase } from '../services/supabase.js';
import { sendOtp, verifyOtp } from '../services/twilio.js';

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

    // If phone already verified on another device, return it
    const { data: existing } = await supabase
      .from('devices')
      .select('id')
      .eq('phone_hash', phone_hash)
      .maybeSingle();

    if (existing) return { verified: true, device_id: existing.id, phone_hash };

    const user_agent = req.headers['user-agent'] || null;
    const { data, error } = await supabase
      .from('devices')
      .upsert({ id: device_id, phone_hash, verified_at: new Date().toISOString(), user_agent, country_code: country_code ?? null })
      .select()
      .single();

    if (error) throw error;
    return { verified: true, device_id: data.id, phone_hash };
  });

  // GET /api/users/device/:id/locks
  app.get('/device/:id/locks', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 8, maxLength: 128 } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data, error } = await supabase
      .from('adhesions')
      .select('protest_id, protests(scope, region, ends_at)')
      .eq('device_id', req.params.id)
      .is('anonymized_at', null);

    if (error) throw error;
    return data;
  });

  // GET /api/users/device/:id — return the device's canonical (server-side HMAC)
  // phone_hash. Used by the "already verified, skip OTP" fast path so the client
  // never has to (and never should) compute an identity hash itself. The hash is
  // produced only as a side effect of a prior OTP verification, never on demand,
  // so this is not a hashing oracle: it only returns a hash that already exists.
  app.get('/device/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 8, maxLength: 128 } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data } = await supabase
      .from('devices')
      .select('id, phone_hash, country_code')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!data) return reply.notFound('Device not found');
    return { device_id: data.id, phone_hash: data.phone_hash, country_code: data.country_code };
  });
}

async function verifyRecaptcha(token, expectedAction, req, reply) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return;

  const res = await fetch(
    `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const json = await res.json();

  if (!json.success) {
    req.log.warn({ errorCodes: json['error-codes'] }, 'recaptcha: token invalid');
    throw reply.badRequest('reCAPTCHA verification failed');
  }
  if (json.action !== expectedAction) {
    req.log.warn({ actual: json.action, expected: expectedAction }, 'recaptcha: action mismatch');
    throw reply.badRequest('reCAPTCHA verification failed');
  }
  if (json.score < 0.5) {
    req.log.warn({ score: json.score }, 'recaptcha: score too low');
    throw reply.badRequest('reCAPTCHA verification failed');
  }
}
