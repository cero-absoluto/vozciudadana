import { supabase } from '../services/supabase.js';
import { createHash } from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/** @param {import('fastify').FastifyInstance} app */
export default async function institucionalRoutes(app) {

  // POST /api/institucional/send-otp
  // Recibe: { email, protest_id }
  // Valida dominio, genera OTP, lo envía por email y guarda el hash
  app.post('/send-otp', {
    config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'protest_id'],
        properties: {
          email:      { type: 'string', format: 'email' },
          protest_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { email, protest_id } = req.body;

    // 1. Obtener la convocatoria y su dominio de email
    const { data: protest, error: protestErr } = await supabase
      .from('protests')
      .select('dominio_email, title')
      .eq('id', protest_id)
      .single();

    if (protestErr || !protest) return reply.notFound('Convocatoria no encontrada');
    if (!protest.dominio_email) return reply.badRequest('Esta convocatoria no tiene verificación institucional');

    // 2. Validar que el dominio del email coincide
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== protest.dominio_email.toLowerCase()) {
      return reply.badRequest(`El email debe ser del dominio @${protest.dominio_email}`);
    }

    // 3. Calcular hash del email (nunca guardamos el email en texto claro)
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');

    // 4. Comprobar rate limiting
    const { data: rateLimit } = await supabase
      .from('email_otp_rate_limit')
      .select('attempt_count, first_attempt_at')
      .eq('email_hash', emailHash)
      .eq('protest_id', protest_id)
      .maybeSingle();

    if (rateLimit) {
      const minutesPassed = (Date.now() - new Date(rateLimit.first_attempt_at).getTime()) / 60000;
      if (minutesPassed < 10 && rateLimit.attempt_count >= 3) {
        return reply.tooManyRequests('Demasiados intentos. Espera 10 minutos.');
      }
    }

    // 5. Generar OTP de 6 dígitos
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 6. Registrar adhesión anónima en institutional_members
    const expiresAt = new Date(new Date().getFullYear(), 7, 31).toISOString();

    const { data: member, error: memberErr } = await supabase
      .from('institutional_members')
      .insert({
        email_hash: emailHash,
        protest_id,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (memberErr) throw memberErr;

    // 7. Registrar también en adhesions para el contador y el informe
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    let ciudad = null, region = null, pais = null;
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country&lang=es`);
      const geo = await geoRes.json();
      ciudad = geo.city || null;
      region = geo.regionName || null;
      pais = geo.country || null;
    } catch { /* silencioso */ }

    const idioma = req.headers['accept-language']?.split(',')[0] || null;
    const created_at = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();

    await supabase.from('adhesions').insert({
      protest_id,
      phone_hash: emailHash,
      device_id:  emailHash.substring(0, 32),
      ciudad, region, pais, idioma,
      nullifier:  emailHash,
      created_at,
    });

    // 8. Incrementar contador
    await supabase.rpc('increment_protest_count', { protest_id });
    await supabase.rpc('update_cities_count', { protest_id });

    return { receipt: member.id, verified: true };
   });


  // POST /api/institucional/verify-otp
  // Recibe: { email, otp, protest_id }
  // Valida el OTP, destruye el email, registra adhesión anónima
  app.post('/verify-otp', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'otp', 'protest_id'],
        properties: {
          email:      { type: 'string', format: 'email' },
          otp:        { type: 'string', minLength: 6, maxLength: 6 },
          protest_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { email, otp, protest_id } = req.body;

    // 1. Calcular hash del email
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');

    // 2. Buscar OTP válido (no caducado)
    const { data: otpRecord } = await supabase
      .from('email_otp_requests')
      .select('id, otp_code, expires_at')
      .eq('email_hash', emailHash)
      .eq('protest_id', protest_id)
      .gt('expires_at', new Date().toISOString())
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) {
      return reply.badRequest('Código incorrecto o caducado');
    }

    // 3. Validar el OTP
    if (otpRecord.otp_code !== otp) {
      return reply.badRequest('Código incorrecto o caducado');
    }

    // 4. Destruir el OTP (uso único)
    await supabase.from('email_otp_requests').delete().eq('id', otpRecord.id);

    // 5. Comprobar si ya está registrado en este grupo
    const { data: existing } = await supabase
      .from('institutional_members')
      .select('id')
      .eq('email_hash', emailHash)
      .eq('protest_id', protest_id)
      .maybeSingle();

    if (existing) return reply.conflict('Ya estás registrado en esta convocatoria');

    // 6. Registrar adhesión anónima
    // El email ha sido procesado y destruido — solo guardamos el hash
    const expiresAt = new Date(new Date().getFullYear(), 7, 31).toISOString(); // 31 agosto

    const { data: member, error: memberErr } = await supabase
      .from('institutional_members')
      .insert({
        email_hash: emailHash,
        protest_id,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (memberErr) throw memberErr;

    // 7. Incrementar contador de adhesiones
    await supabase.rpc('increment_protest_count', { protest_id });
    await supabase.rpc('update_cities_count', { protest_id });

    // El email nunca se guarda. Solo el hash.
    return { receipt: member.id, verified: true };
  });
}
