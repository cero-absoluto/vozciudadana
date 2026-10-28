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

import { withRequestDeadline } from './requestDeadline.js';

export async function verifyRecaptcha(token, expectedAction, req, reply, {
  fetchImpl = globalThis.fetch, timeoutMs = 5000, env = process.env,
} = {}) {
  const secret = env.RECAPTCHA_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      reply.internalServerError('Server misconfiguration: reCAPTCHA is not configured.');
      throw new Error('recaptcha_not_configured');
    }
    console.warn('[SECURITY] RECAPTCHA_SECRET not set — skipping verification (non-production only).');
    return;
  }
  const reject = () => {
    req?.log?.warn?.({ reason: 'invalid_response' }, 'recaptcha: verification failed');
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  };
  if (typeof token !== 'string' || !token.trim() || typeof expectedAction !== 'string' || !expectedAction) return reject();
  let json;
  try {
    json = await withRequestDeadline(timeoutMs, async (signal, wait) => {
      const res = await wait(fetchImpl('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }),
      }));
      if (!res.ok) { res.body?.cancel().catch(() => {}); throw new Error('provider_http_error'); }
      return await wait(res.json());
    });
  } catch {
    req?.log?.warn?.({ reason: 'provider_unavailable' }, 'recaptcha: verification unavailable');
    reply.serviceUnavailable('reCAPTCHA verification temporarily unavailable');
    throw new Error('recaptcha_unavailable');
  }
  const hostnames = (env.RECAPTCHA_EXPECTED_HOSTNAMES || 'voiceprotest.org,www.voiceprotest.org')
    .split(',').map(h => h.trim()).filter(Boolean);
  if (!json || typeof json !== 'object' || Array.isArray(json)
      || json.success !== true || json.action !== expectedAction
      || typeof json.hostname !== 'string' || !hostnames.includes(json.hostname)
      || typeof json.score !== 'number' || !Number.isFinite(json.score)
      || json.score < 0.5 || json.score > 1
      || (json['error-codes'] !== undefined
          && (!Array.isArray(json['error-codes']) || json['error-codes'].length !== 0))) return reject();
}
