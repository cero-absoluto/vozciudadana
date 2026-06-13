import { supabase } from '../services/supabase.js';
import { createHash } from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/** @param {import('fastify').FastifyInstance} app */
const EMAIL_TEXTS = {
  es: {
    subject: (otp) => `Tu código de verificación: ${otp}`,
    title: 'Voice Protest',
    body: (title) => `Tu código de verificación para <strong>${title}</strong> es:`,
    expiry: 'Este código caduca en 24 horas.',
    privacy: 'Tu email no se guarda — solo su huella matemática irreversible.',
  },
  en: {
    subject: (otp) => `Your verification code: ${otp}`,
    title: 'Voice Protest',
    body: (title) => `Your verification code for <strong>${title}</strong> is:`,
    expiry: 'This code expires in 24 hours.',
    privacy: 'Your email is not stored — only its irreversible cryptographic fingerprint.',
  },
  fr: {
    subject: (otp) => `Votre code de vérification : ${otp}`,
    title: 'Voice Protest',
    body: (title) => `Votre code de vérification pour <strong>${title}</strong> est :`,
    expiry: 'Ce code expire dans 24 heures.',
    privacy: "Votre email n'est pas conservé — uniquement son empreinte cryptographique irréversible.",
  },
  zh: {
    subject: (otp) => `您的验证码：${otp}`,
    title: 'Voice Protest',
    body: (title) => `您在<strong>${title}</strong>的验证码是：`,
    expiry: '此验证码在24小时后失效。',
    privacy: '您的电子邮件不会被保存——仅保留其不可逆的加密指纹。',
  },
};

function getLocale(req) {
  const lang = req.headers['accept-language']?.split(',')[0]?.split('-')[0]?.toLowerCase();
  return ['es', 'en', 'fr', 'zh'].includes(lang) ? lang : 'es';
}

export default async function institucionalRoutes(app) {

  // POST /api/institucional/send-otp
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

    // 1. Obtener la convocatoria
    const { data: protest, error: protestErr } = await supabase
      .from('protests')
      .select('dominio_email, title')
      .eq('id', protest_id)
      .single();

    if (protestErr || !protest) return reply.notFound('Convocatoria no encontrada');
    if (!protest.dominio_email) return reply.badRequest('Esta convocatoria no tiene verificación institucional');

    // 2. Validar dominio
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== protest.dominio_email.toLowerCase()) {
      return reply.badRequest(`El email debe ser del dominio @${protest.dominio_email}`);
    }

    // 3. Hash del email
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');

    // 4. Rate limiting
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

    // 5. Generar OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 6. Guardar OTP en base de datos
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('email_otp_requests').insert({
      email_hash: emailHash,
      protest_id,
      otp_code: otp,
      expires_at: expiresAt,
    });

    // 7. Actualizar rate limiting
    if (rateLimit) {
      await supabase.from('email_otp_rate_limit')
        .update({ attempt_count: rateLimit.attempt_count + 1 })
        .eq('email_hash', emailHash).eq('protest_id', protest_id);
    } else {
      await supabase.from('email_otp_rate_limit')
        .insert({ email_hash: emailHash, protest_id, attempt_count: 1 });
    }

    // 8. Enviar email con Resend
    const locale = getLocale(req);
    const t = EMAIL_TEXTS[locale];

    await resend.emails.send({
      from: 'Voice Protest <noreply@ceroabsoluto.es>',
      to: email,
      subject: t.subject(otp),
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <h2 style="color:#7C6FFF">${t.title}</h2>
          <p>${t.body(protest.title)}</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#7C6FFF;margin:24px 0;text-align:center">
            ${otp}
          </div>
          <p style="color:#888;font-size:12px">${t.expiry}</p>
          <p style="color:#888;font-size:12px">${t.privacy}</p>
        </div>
      `,
    });

    return { sent: true };
  });

  // POST /api/institucional/verify-otp
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

    // 1. Hash del email
    const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex');

    // 2. Buscar OTP válido
    const { data: otpRecord } = await supabase
      .from('email_otp_requests')
      .select('id, otp_code, expires_at')
      .eq('email_hash', emailHash)
      .eq('protest_id', protest_id)
      .gt('expires_at', new Date().toISOString())
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) return reply.badRequest('Código incorrecto o caducado');

    // 3. Validar OTP
    if (otpRecord.otp_code !== otp) return reply.badRequest('Código incorrecto o caducado');

    // 4. Destruir OTP
    await supabase.from('email_otp_requests').delete().eq('id', otpRecord.id);

    // 5. Comprobar si ya está registrado
    const { data: existing } = await supabase
      .from('institutional_members')
      .select('id')
      .eq('email_hash', emailHash)
      .eq('protest_id', protest_id)
      .maybeSingle();

    if (existing) return reply.conflict('Ya estás registrado en esta convocatoria');

    // 6. Registrar en institutional_members
    const expiresAt = new Date(new Date().getFullYear(), 7, 31).toISOString();
    const { data: member, error: memberErr } = await supabase
      .from('institutional_members')
      .insert({ email_hash: emailHash, protest_id, expires_at: expiresAt })
      .select()
      .single();

    if (memberErr) throw memberErr;

    // 7. Registrar en adhesions
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    let ciudad = null, region = null, pais = null;
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,countryCode,country&lang=es`);
      const geo = await geoRes.json();
      ciudad = geo.city || null;
      region = geo.regionName || null;
      pais = geo.country || null;
    } catch { /* silencioso */ }

    const idioma = req.headers['accept-language']?.split(',')[0] || null;
    const created_at = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();

    await supabase.from('adhesions').insert({
      protest_id,
      phone_hash:  emailHash,
      device_id:   emailHash.substring(0, 32),
      ciudad, region, pais, idioma,
      nullifier:   emailHash,
      created_at,
      fiabilidad:  90,
      senales:     'email_otp',
    });

    // 8. Incrementar contador
    await supabase.rpc('increment_protest_count', { protest_id });
    await supabase.rpc('update_cities_count', { protest_id });

    return { receipt: member.id, verified: true };
  });
}
