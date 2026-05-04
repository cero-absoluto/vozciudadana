import { supabase } from '../services/supabase.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function userRoutes(app) {
  // POST /api/users/request-otp
  app.post('/request-otp', async (req, reply) => {
    const { phone_hash, recaptcha_token } = req.body;

    // In production: verify recaptcha_token server-side, then send SMS via Twilio/etc.
    // Here we just record the attempt.
    const { error } = await supabase
      .from('otp_requests')
      .insert({ phone_hash, requested_at: new Date().toISOString() });

    if (error) return reply.internalServerError(error.message);
    return { sent: true };
  });

  // POST /api/users/verify-otp
  app.post('/verify-otp', async (req, reply) => {
    const { phone_hash, otp, device_id } = req.body;

    // In production: validate the OTP against your SMS provider's verification API.
    // On success, upsert the device record.
    const { data, error } = await supabase
      .from('devices')
      .upsert({ id: device_id, phone_hash, verified_at: new Date().toISOString() })
      .select()
      .single();

    if (error) return reply.internalServerError(error.message);
    return { verified: true, device_id: data.id };
  });

  // GET /api/users/device/:id/locks — active protest locks for a device
  app.get('/device/:id/locks', async (req, reply) => {
    const { data, error } = await supabase
      .from('adhesions')
      .select('protest_id, protests(scope, region, ends_at)')
      .eq('device_id', req.params.id);

    if (error) return reply.internalServerError(error.message);
    return data;
  });
}
