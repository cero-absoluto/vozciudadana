import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ── Participation token (VP-SEC-001 / VP-SEC-002 / VP-SEC-003 fix, 23 July 2026) ──
//
// Before this, POST /join trusted a client-supplied `phone_hash` directly —
// nothing checked that the `device_id` sent alongside it had ever actually
// completed OTP verification for that exact phone number. A person could
// edit the request body and attach any device_id's adhesion, or any
// phone_hash, to their own device_id, or vice versa. A comment in this same
// file previously asserted that reaching the insert "requires having
// completed real OTP verification for the exact phone number" — that
// assertion was never actually enforced in code.
//
// This token closes that gap. It is issued ONLY as a direct result of a
// real OTP completion (or, for a returning device, proof of possessing that
// device's `device_secret` — see routes/users.js) and is short-lived
// (PARTICIPATION_TOKEN_TTL_MS). POST /join now requires this token instead
// of raw phone_hash/device_id, and derives both from the token's signed
// payload — never from anything the client asserts directly.
//
// This also addresses VP-SEC-003 (OTP verification becoming an unbounded,
// effectively 270-day authorization via device_id alone): device
// *registration* can still persist for 270 days (unchanged, and reasonable
// — it's what lets a returning device skip re-typing a phone number), but
// *authorization to join* now expires in minutes, separately, every time.

const PARTICIPATION_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function must(name) {
  const v = process.env[name];
  if (!v) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[SECURITY] ${name} is required in production`);
    }
    return 'dev-secret';
  }
  return v;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/**
 * Sign a participation token binding a device_id to a phone_hash for one
 * specific purpose, expiring shortly. The payload is plain (not encrypted)
 * — phone_hash is already a one-way hash, not the raw phone number, so
 * there is nothing here more sensitive than what the token consumer (our
 * own backend) already handles elsewhere. What matters is that the
 * signature makes it unforgeable without PARTICIPATION_TOKEN_SECRET.
 */
export function signParticipationToken({ device_id, phone_hash, purpose }) {
  const payload = {
    device_id,
    phone_hash,
    purpose,
    iat: Date.now(),
    exp: Date.now() + PARTICIPATION_TOKEN_TTL_MS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', must('PARTICIPATION_TOKEN_SECRET'))
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a participation token and return its payload, or null if invalid,
 * expired, or issued for a different purpose. Never throws on a bad token
 * — a forged or expired token is an ordinary rejection, not a server error.
 */
export function verifyParticipationToken(token, { expectedPurpose } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = createHmac('sha256', must('PARTICIPATION_TOKEN_SECRET'))
    .update(payloadB64)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload.device_id || !payload.phone_hash) return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (expectedPurpose && payload.purpose !== expectedPurpose) return null;

  return payload;
}

/**
 * Generate a new device secret (returned once, to the client, at first
 * verification) and its server-stored HMAC (VP-SEC-002 fix — replaces
 * treating a bare device_id as a bearer credential). The client persists
 * the raw secret locally (localStorage) and must present it again to
 * re-authenticate a returning device without a fresh OTP.
 */
export function generateDeviceSecret() {
  const secret = randomBytes(32).toString('hex');
  const hash = hashDeviceSecret(secret);
  return { secret, hash };
}

export function hashDeviceSecret(secret) {
  return createHmac('sha256', must('DEVICE_SECRET_PEPPER')).update(secret).digest('hex');
}

export function deviceSecretMatches(providedSecret, storedHash) {
  if (!providedSecret || !storedHash) return false;
  const computed = hashDeviceSecret(providedSecret);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
