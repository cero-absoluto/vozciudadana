import { createHash, createHmac, randomInt } from 'crypto';
import { supabase } from '../services/supabase.js';
import { Resend } from 'resend';
import { verifyRecaptcha } from '../lib/recaptcha.js';
import {
  verifyInstitutionalOtpAndCreateAdhesion,
  OtpNotFoundError, OtpAlreadyUsedError, OtpExpiredError,
  TooManyAttemptsError, WrongOtpError, AlreadyJoinedError,
  MembershipAlreadyExistsError, ProtestNotFoundError, ProtestClosedError,
  BalanceExhaustedError,
} from '../lib/adhesionService.js';

// Identity hash for institutional emails. Mirrors hashPhone() in users.js:
// low-entropy identifiers — phone numbers, and institutional emails such as
// name.surname@university.edu — must be HMAC'd with a server-side secret, never
// plain SHA-256, or they are trivially recoverable by dictionary attack. Reuses
// PHONE_HASH_SECRET, which is conceptually an identity-hash secret, not phone-specific.
function hashEmail(email) {
  const secret = process.env.PHONE_HASH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] PHONE_HASH_SECRET is required in production. Server cannot start without it.');
    }
    console.warn('[SECURITY] PHONE_HASH_SECRET not set — using plain SHA-256 for email. Set this variable in production.');
    return createHash('sha256').update(email.toLowerCase()).digest('hex');
  }
  return createHmac('sha256', secret).update(email.toLowerCase()).digest('hex');
}

// VP-SEC-009 fix (24 July 2026): the 6-digit code itself used to be stored
// and compared in plain text (otp_code) — a small search space, so a keyed
// HMAC, not a plain hash, protects it even from someone with read access to
// the table. Computed identically at send-otp (to store) and verify-otp (to
// compare) — the actual comparison happens inside
// verify_institutional_otp_and_create_adhesion(), which never sees the
// secret; only this function does.
function hashOtp(protestId, emailHash, otp) {
  const secret = process.env.EMAIL_OTP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] EMAIL_OTP_SECRET is required in production. Server cannot start without it.');
    }
    console.warn('[SECURITY] EMAIL_OTP_SECRET not set — using PHONE_HASH_SECRET as a fallback (dev only).');
    return createHmac('sha256', process.env.PHONE_HASH_SECRET || 'dev-secret').update(`${protestId}:${emailHash}:${otp}`).digest('hex');
  }
  return createHmac('sha256', secret).update(`${protestId}:${emailHash}:${otp}`).digest('hex');
}

// Same construction as hashIp() in users.js — kept local here rather than
// imported, since it is a two-line pure function and importing across
// route files for something this small would be more indirection than
// value. If a third route ever needs it, it should move to a shared lib.
function hashIp(ip) {
  const secret = process.env.PHONE_HASH_SECRET;
  const base = secret
    ? createHmac('sha256', secret).update(ip || '')
    : createHash('sha256').update(ip || '');
  return base.digest('hex').substring(0, 32);
}

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_TEXTS = {
  es: {
    subject: (otp) => `Tu código de verificación: ${otp}`,
    title: 'Voice Protest',
    body: (title) => `Tu código de verificación para <strong>${title}</strong> es:`,
    expiry: 'Este código caduca en 10 minutos.',
    privacy: 'Tu email no se guarda — solo su huella matemática irreversible.',
  },
  en: {
    subject: (otp) => `Your verification code: ${otp}`,
    title: 'Voice Protest',
    body: (title) => `Your verification code for <strong>${title}</strong> is:`,
    expiry: 'This code expires in 10 minutes.',
    privacy: 'Your email is not stored — only its irreversible cryptographic fingerprint.',
  },
  fr: {
    subject: (otp) => `Votre code de vérification : ${otp}`,
    title: 'Voice Protest',
    body: (title) => `Votre code de vérification pour <strong>${title}</strong> est :`,
    expiry: 'Ce code expire dans 10 minutes.',
    privacy: "Votre email n'est pas conservé — uniquement son empreinte cryptographique irréversible.",
  },
  zh: {
    subject: (otp) => `您的验证码：${otp}`,
    title: 'Voice Protest',
    body: (title) => `您在<strong>${title}</strong>的验证码是：`,
    expiry: '此验证码将在10分钟后失效。',
    privacy: '您的电子邮件不会被保存——仅保留其不可逆的加密指纹。',
  },
};

function getLocale(req) {
  const lang = req.headers['accept-language']?.split(',')[0]?.split('-')[0]?.toLowerCase();
  return ['es', 'en', 'fr', 'zh'].includes(lang) ? lang : 'es';
}

/** @param {import('fastify').FastifyInstance} app */
export default async function institucionalRoutes(app) {

  // POST /api/institucional/send-otp
  //
  // VP-SEC-012 fix (24 July 2026): this endpoint had no reCAPTCHA at all —
  // the only protection was a per-process Fastify rate limit plus the
  // now-superseded email_otp_rate_limit counter. reCAPTCHA added, matching
  // every other OTP-sending endpoint in the project.
  app.post('/send-otp', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'protest_id', 'recaptcha_token'],
        properties: {
          email:           { type: 'string', format: 'email' },
          protest_id:      { type: 'string', format: 'uuid' },
          recaptcha_token: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { email, protest_id, recaptcha_token } = req.body;

    await verifyRecaptcha(recaptcha_token, 'institutional_send_otp', req, reply);

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

    // 3. Hash del email (HMAC — ver hashEmail)
    const emailHash = hashEmail(email);
    const ipHash = hashIp(req.headers['x-forwarded-for']?.split(',')[0] || req.ip);

    // 4. Rate limiting (VP-SEC-013 fix — atomic, multi-dimensional, race-free;
    // replaces the SELECT-then-UPDATE/INSERT counter this used to be, which
    // could let two near-simultaneous requests both read the same
    // pre-increment count and both pass.)
    const { data: limitCheck } = await supabase.rpc('check_institutional_otp_rate_limit', {
      p_email_hash: emailHash,
      p_protest_id: protest_id,
      p_ip_hash:    ipHash,
      p_domain:     emailDomain,
    });
    if (!limitCheck?.allowed) {
      req.log.warn({ reason: limitCheck?.reason }, 'institutional OTP rate limit exceeded');
      return reply.tooManyRequests('Demasiados intentos. Inténtalo de nuevo más tarde.');
    }

    // 5. Generar OTP — VP-SEC-011 fix: crypto.randomInt, not Math.random()
    // (which is not a cryptographically secure source of randomness).
    const otp = randomInt(100000, 1_000_000).toString();
    const otpHash = hashOtp(protest_id, emailHash, otp);

    // 6. Guardar únicamente el hash — VP-SEC-009/010 fix: no plaintext, and
    // 10 minutes instead of the previous 24 hours (a 6-digit code valid for
    // a full day is a needlessly wide window for something meant to prove
    // "you read this a moment ago").
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('email_otp_requests').insert({
      email_hash: emailHash,
      protest_id,
      otp_hash: otpHash,
      ip_hash: ipHash,
      institutional_domain: emailDomain,
      expires_at: expiresAt,
      attempt_count: 0,
    });

    // 7. Enviar email con Resend
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
  //
  // VP-SEC-008 Despliegue B fix (24 July 2026): this endpoint used to
  // perform its own direct INSERT INTO adhesions — a second, independently
  // maintained path outside the AdhesionService the SMS route now uses.
  // It now only verifies the identity (the OTP) and hands off to the same
  // authorised creation path (via verifyInstitutionalOtpAndCreateAdhesion,
  // which locks/consumes the OTP and calls create_verified_adhesion()
  // internally, atomically) — this route's job is to prove the identity is
  // authentic, not to decide what it may do, mirroring the SMS route.
  app.post('/verify-otp', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'otp', 'protest_id'],
        properties: {
          email:      { type: 'string', format: 'email' },
          otp:        { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
          protest_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { email, otp, protest_id } = req.body;

    const emailHash = hashEmail(email);
    const submittedOtpHash = hashOtp(protest_id, emailHash, otp);
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const idioma = req.headers['accept-language']?.split(',')[0] || null;

    // Membership validity: 31 August of the current academic year — unchanged
    // from the previous behaviour.
    const institutionalExpiresAt = new Date(new Date().getFullYear(), 7, 31).toISOString();

    let data;
    try {
      data = await verifyInstitutionalOtpAndCreateAdhesion({
        emailHash, protestId: protest_id, submittedOtpHash,
        location: { ip, language: idioma },
        institutionalExpiresAt,
      });
    } catch (err) {
      // Every OTP-specific failure returns the same generic message
      // ("Código incorrecto o caducado") regardless of which one it
      // actually was — mirroring the deliberately neutral design already
      // used for the SMS request-otp duplicate check (24 June 2026): an
      // external party should not be able to distinguish "no code was ever
      // sent to this email" from "wrong code" from "code expired" from
      // these responses alone.
      if (err instanceof OtpNotFoundError || err instanceof OtpAlreadyUsedError ||
          err instanceof OtpExpiredError || err instanceof WrongOtpError) {
        return reply.badRequest(err.message);
      }
      if (err instanceof TooManyAttemptsError) return reply.tooManyRequests(err.message);
      if (err instanceof AlreadyJoinedError) return reply.code(409).send({ error: err.code, reason: err.message });
      if (err instanceof MembershipAlreadyExistsError) return reply.conflict(err.message);
      if (err instanceof ProtestNotFoundError) return reply.notFound(err.message);
      if (err instanceof ProtestClosedError) return reply.code(410).send({ error: err.code, reason: err.message });
      if (err instanceof BalanceExhaustedError) return reply.status(402).send({ code: 'SALDO_AGOTADO', error: err.message });
      throw err;
    }

    // VP-SEC-015 fix: email_hash is no longer returned — the client never
    // needed it, and it is a persistent, potentially correlatable
    // identifier with no reason to leave the server.
    return { receipt: data.id, verified: true };
  });
}
