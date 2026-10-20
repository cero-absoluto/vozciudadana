// ── Shared reCAPTCHA verification (VP-SEC-007 fix, 23 July 2026) ──
//
// This used to exist as two separate, drifted copies — one in
// routes/protests.js, one in routes/users.js — each with the same bug:
// `if (!secret) return;` skipped verification entirely instead of
// rejecting, so an unset RECAPTCHA_SECRET in production would silently
// disable bot protection on every endpoint that used it, with nothing in
// the logs to say so. Unifying them here means there is now exactly one
// place this can go wrong, and it fails closed in production.
//
// Also checks the response's `hostname` field against the expected site
// domain(s) — Google's siteverify response includes the hostname the
// token was generated on, so a token obtained on a different site cannot
// be replayed against this one.

const EXPECTED_HOSTNAMES = (process.env.RECAPTCHA_EXPECTED_HOSTNAMES || 'voiceprotest.org,www.voiceprotest.org')
  .split(',').map(h => h.trim()).filter(Boolean);

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30000;
/** Tiempo máximo de la verificación: RECAPTCHA_TIMEOUT_MS si es un entero entre 1 y 30000; si no, 5000. */
export function recaptchaTimeoutMs(env = process.env) {
  const raw = env.RECAPTCHA_TIMEOUT_MS;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return n >= 1 && n <= MAX_TIMEOUT_MS ? n : DEFAULT_TIMEOUT_MS;
}

export async function verifyRecaptcha(token, expectedAction, req, reply) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      reply.internalServerError('Server misconfiguration: reCAPTCHA is not configured.');
      throw new Error('recaptcha_not_configured');
    }
    console.warn('[SECURITY] RECAPTCHA_SECRET not set — skipping verification (non-production only).');
    return;
  }

  // Disponibilidad: sin tiempo máximo, un reCAPTCHA que no responde dejaba cada petición (alta, OTP, adhesión) colgada hasta el límite del servidor.
  // Si no se puede verificar, se falla CERRADO (serviceUnavailable; el manejador central de server.js lo expone como 5xx): nunca se da por válida una verificación que no se completó.
  const log = req?.log?.warn ? (obj, msg) => req.log.warn(obj, msg) : (obj, msg) => console.warn(msg, obj);
  let json;
  try {
    const res = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
      { method: 'POST', signal: AbortSignal.timeout(recaptchaTimeoutMs()) }
    );
    if (!res.ok) throw new Error(`http_${res.status}`);
    json = await res.json();
  } catch (err) {
    // Solo el tipo de error: el mensaje de fetch puede incluir la URL, y la URL lleva el secreto en la consulta.
    log({ error: err?.name ?? 'Error' }, 'recaptcha: verification service unavailable');
    reply.serviceUnavailable('reCAPTCHA verification unavailable');
    throw new Error('recaptcha_unavailable');
  }

  if (!json.success) {
    log({ errorCodes: json['error-codes'] }, 'recaptcha: token invalid');
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
  if (expectedAction && json.action !== expectedAction) {
    log({ actual: json.action, expected: expectedAction }, 'recaptcha: action mismatch');
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
  if (json.hostname && !EXPECTED_HOSTNAMES.includes(json.hostname)) {
    log({ hostname: json.hostname }, 'recaptcha: unexpected hostname — token from a different site');
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
  if (typeof json.score === 'number' && json.score < 0.5) {
    log({ score: json.score }, 'recaptcha: score too low');
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
}
