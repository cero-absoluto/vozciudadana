import { createHash } from 'node:crypto';
import { supabase } from '../services/supabase.js';
import { sendOtp, verifyOtp } from '../services/twilio.js';

/** Hash a phone number to avoid storing it in plain text. */
function hashPhone(phoneE164) {
  return createHash('sha256').update(phoneE164).digest('hex');
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
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone, recaptcha_token } = req.body;

    await verifyRecaptcha(recaptcha_token, 'request_otp', req, reply);

    const phone_hash = hashPhone(phone);

    const { error } = await supabase
      .from('otp_requests')
      .insert({ phone_hash, requested_at: new Date().toISOString() });

    if (error) throw error;

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
          phone:     { type: 'string', minLength: 8, maxLength: 16, pattern: '^\\+[1-9]\\d{7,14}$' },
          otp:       { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
          device_id: { type: 'string', minLength: 8, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone, otp, device_id } = req.body;

    const approved = await verifyOtp(phone, otp);
    if (!approved) return reply.unauthorized('OTP inválido o expirado');

    const phone_hash = hashPhone(phone);

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
