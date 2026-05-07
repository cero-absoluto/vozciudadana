import { supabase } from '../services/supabase.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function userRoutes(app) {
  // POST /api/users/request-otp
  app.post('/request-otp', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['phone_hash', 'recaptcha_token'],
        properties: {
          phone_hash:      { type: 'string', minLength: 64, maxLength: 64 },
          recaptcha_token: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone_hash, recaptcha_token } = req.body;

    await verifyRecaptcha(recaptcha_token, 'request_otp', req, reply);

    const { error } = await supabase
      .from('otp_requests')
      .insert({ phone_hash, requested_at: new Date().toISOString() });

    if (error) throw error;

    // TODO: send SMS via Twilio Verify or similar:
    //   await twilioVerify.services(VERIFY_SID).verifications.create({ to: phoneE164, channel: 'sms' });
    return { sent: true };
  });

  // POST /api/users/verify-otp
  app.post('/verify-otp', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['phone_hash', 'otp', 'device_id'],
        properties: {
          phone_hash: { type: 'string', minLength: 64, maxLength: 64 },
          otp:        { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
          device_id:  { type: 'string', minLength: 8, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone_hash, otp, device_id } = req.body;

    // TODO: validate OTP against SMS provider before upserting:
    //   const check = await twilioVerify.services(VERIFY_SID).verificationChecks.create({ to: phoneE164, code: otp });
    //   if (check.status !== 'approved') return reply.unauthorized('OTP inválido o expirado');
    if (process.env.NODE_ENV === 'production') {
      return reply.notImplemented('OTP verification not yet configured');
    }

    const { data, error } = await supabase
      .from('devices')
      .upsert({ id: device_id, phone_hash, verified_at: new Date().toISOString() })
      .select()
      .single();

    if (error) throw error;
    return { verified: true, device_id: data.id };
  });

  // GET /api/users/device/:id/locks — active protest locks for a device
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
      .eq('device_id', req.params.id);

    if (error) throw error;
    return data;
  });
}

/**
 * Verify a reCAPTCHA v3 token server-side.
 * @param {string} token
 * @param {string} expectedAction
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
async function verifyRecaptcha(token, expectedAction, req, reply) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return; // Skip when secret not configured (dev)

  const res = await fetch(
    `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const json = await res.json();

  if (!json.success || json.action !== expectedAction || json.score < 0.5) {
    req.log.warn({ json }, 'recaptcha verification failed');
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
}
