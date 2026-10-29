import {nextInstitutionalExpiry} from '../lib/institutionalExpiry.js';
import {institutionalSecret} from '../lib/institutionalSecret.js';
import {OtpProviderError, runOtpProvider, otpProviderFailure} from '../lib/otpProvider.js';
import {consumeOtpDeliveryQuota,consumeOtpVerificationQuota} from '../lib/requestQuotas.js';
import {ipQuotaKey} from '../lib/ipQuotaKey.js';
import { issueCensusSession } from '../lib/censusSession.js';
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
  const secret = institutionalSecret('PHONE_HASH_SECRET');
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
  const secret = institutionalSecret('EMAIL_OTP_SECRET');
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] EMAIL_OTP_SECRET is required in production. Server cannot start without it.');
    }
    console.warn('[SECURITY] EMAIL_OTP_SECRET not set — using PHONE_HASH_SECRET as a fallback (dev only).');
    return createHmac('sha256', process.env.PHONE_HASH_SECRET || 'dev-secret').update(`${protestId}:${emailHash}:${otp}`).digest('hex');
  }
  return createHmac('sha256', secret).update(`${protestId}:${emailHash}:${otp}`).digest('hex');
}

// Quota material uses the shared network key; raw IP remains location evidence.
function hashIp(ip) {
  const secret = institutionalSecret('PHONE_HASH_SECRET');
  const base = secret
    ? createHmac('sha256', secret).update(ipQuotaKey(ip))
    : createHash('sha256').update(ipQuotaKey(ip));
  return base.digest('hex').substring(0, 32);
}

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

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

  app.addHook('onRequest', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); });

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
          email:           { type: 'string', format: 'email', maxLength:254 },
          protest_id:      { type: 'string', format: 'uuid' },
          recaptcha_token: { type: 'string', minLength: 1 },
          purpose: { type: 'string', enum: ['adhesion', 'census'] },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { email, protest_id, recaptcha_token } = req.body;
    const census = req.body.purpose === 'census';

    await verifyRecaptcha(recaptcha_token, 'institutional_send_otp', req, reply);

    // 1. Obtener la convocatoria
    const { data: protest, error: protestErr } = await supabase
      .from('protests')
      .select('dominio_email, title, requiere_censo, ends_at')
      .eq('id', protest_id)
      .single();

    if (protestErr || !protest) return reply.notFound('Convocatoria no encontrada');
    if (!protest.dominio_email) return reply.badRequest('Esta convocatoria no tiene verificación institucional');

    if (census && (!protest.requiere_censo || Date.parse(protest.ends_at) <= Date.now())) return reply.badRequest('CENSUS_UNAVAILABLE');

    // 2. Validar dominio
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== protest.dominio_email.toLowerCase()) {
      return reply.badRequest('INSTITUTIONAL_DOMAIN_MISMATCH');
    }

    if(!await consumeOtpDeliveryQuota(req,reply))return;

    // 3. Hash del email (HMAC — ver hashEmail)
    const emailHash = hashEmail(email);
    const ipHash = hashIp(req.ip);

    // 5. Generar OTP — VP-SEC-011 fix: crypto.randomInt, not Math.random()
    // (which is not a cryptographically secure source of randomness).
    const otp = randomInt(100000, 1_000_000).toString();
    const otpHash = census ? hashOtp('census:' + protest_id, emailHash, otp) : hashOtp(protest_id, emailHash, otp);

    // 6. Guardar únicamente el hash — VP-SEC-009/010 fix: no plaintext, and
    // 10 minutes instead of the previous 24 hours (a 6-digit code valid for
    // a full day is a needlessly wide window for something meant to prove
    // "you read this a moment ago").
    const { data: reserved, error: reservationError } = await supabase.rpc('reserve_institutional_otp', {
      p_email_hash: emailHash, p_protest_id: protest_id, p_otp_hash: otpHash,
      p_ip_hash: ipHash, p_domain: emailDomain, p_purpose: census ? 'census' : 'adhesion',
    });
    if (reservationError || typeof reserved?.allowed !== 'boolean') return reply.code(503).send({error:'OTP_STATE_UNAVAILABLE',code:'otp_temporarily_unavailable'});
    if (!reserved?.allowed) return reply.tooManyRequests('OTP_RATE_LIMITED');
    if (typeof reserved.challenge_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reserved.challenge_id)) return reply.code(503).send({error:'OTP_STATE_UNAVAILABLE',code:'otp_temporarily_unavailable'});

    // 7. Enviar email con Resend
    const locale = getLocale(req);
    const t = EMAIL_TEXTS[locale];

    try {
    await runOtpProvider(async signal => {
    const delivery = await resend.emails.send({
      from: 'Voice Protest <noreply@ceroabsoluto.es>',
      to: email,
      subject: t.subject(otp),
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <h2 style="color:#7C6FFF">${t.title}</h2>
          <p>${t.body(escapeEmailHtml(protest.title))}</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#7C6FFF;margin:24px 0;text-align:center">
            ${otp}
          </div>
          <p style="color:#888;font-size:12px">${t.expiry}</p>
          <p style="color:#888;font-size:12px">${t.privacy}</p>
        </div>
      `,
    }, {signal, redirect:'error'});
    if (delivery?.error || typeof delivery?.data?.id !== 'string' || !delivery.data.id) throw new OtpProviderError();
    });
    } catch (error) { return otpProviderFailure(reply,error,'DELIVERY'); }
    reply.header('Cache-Control', 'no-store');
    return { sent: true, challenge_id: reserved.challenge_id };
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
        required: ['email', 'otp', 'protest_id', 'challenge_id'],
        properties: {
          email:      { type: 'string', format: 'email', maxLength:254 },
          challenge_id: { type: 'string', format: 'uuid' },
          creator_key: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          otp:        { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
          protest_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { email, otp, protest_id } = req.body;

    if(!await consumeOtpVerificationQuota(req,reply))return;
    const emailHash = hashEmail(email);
    const submittedOtpHash = hashOtp(protest_id, emailHash, otp);
    const ip = req.ip;
    const idioma = req.headers['accept-language']?.split(',')[0] || null;

    // Future academic boundary, independent of server timezone; no historical rewrite.
    const institutionalExpiresAt = nextInstitutionalExpiry();

    let data;
    try {
      data = await verifyInstitutionalOtpAndCreateAdhesion({
        emailHash, protestId: protest_id, submittedOtpHash,
        location: { ip, language: idioma },
        institutionalExpiresAt, challengeId: req.body.challenge_id,
        creatorKeyHash: req.body.creator_key ? createHash('sha256').update(req.body.creator_key).digest('hex') : undefined,
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
      if (/CENSUS_MEMBERSHIP_REQUIRED|CREATOR_PROOF_REQUIRED/.test(err.message || '')) return reply.forbidden('CENSUS_MEMBERSHIP_REQUIRED');
      throw err;
    }

    // VP-SEC-015 fix: email_hash is no longer returned — the client never
    // needed it, and it is a persistent, potentially correlatable
    // identifier with no reason to leave the server.
    reply.header('Cache-Control', 'no-store');
    return { receipt: data.id, verified: true, census_session: issueCensusSession({ emailHash, protestId: protest_id, emailHint: email.slice(0,1) + '***@' + email.split('@')[1].toLowerCase() }) };
  });
  // Authentication for census management: never calls the adhesion service.
  app.post('/census-session', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: { body: { type: 'object', required: ['email','otp','protest_id','challenge_id'], additionalProperties: false,
      properties: { challenge_id:{type:'string',format:'uuid'},email:{type:'string',format:'email',maxLength:254},otp:{type:'string',pattern:'^[0-9]{6}$'},protest_id:{type:'string',format:'uuid'} } } },
  }, async (req,reply) => {
    const {email,otp,protest_id}=req.body;
    if(!await consumeOtpVerificationQuota(req,reply))return;
    const {data:p,error}=await supabase.from('protests').select('dominio_email,requiere_censo,ends_at').eq('id',protest_id).maybeSingle();
    if(error)throw error;
    if(!p?.requiere_censo || !p.dominio_email || Date.parse(p.ends_at)<=Date.now() || email.split('@')[1].toLowerCase()!==p.dominio_email.toLowerCase())return reply.badRequest('CENSUS_VERIFICATION_FAILED');
    const emailHash=hashEmail(email);
    const result=await supabase.rpc('consume_census_otp',{p_email_hash:emailHash,p_protest_id:protest_id,p_otp_hash:hashOtp('census:'+protest_id,emailHash,otp),p_challenge_id:req.body.challenge_id});
    if(result.error)throw result.error;
    if(!result.data?.verified)return reply.badRequest('CENSUS_VERIFICATION_FAILED');
    reply.header('Cache-Control','no-store');
    return {verified:true,census_session:issueCensusSession({emailHash,protestId:protest_id,emailHint:email.slice(0,1)+'***@'+email.split('@')[1].toLowerCase()})};
  });

}
