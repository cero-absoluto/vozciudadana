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

export const PARTICIPATION_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function must(name) {
  const v = process.env[name];
  if (!v) {
    if (!['test','development'].includes(process.env.NODE_ENV)) {
      throw new Error(`[SECURITY] ${name} is required outside explicit development/test`);
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
 * — it contains a pseudonymous phone hash and must still be treated as
 * a bearer credential, not as anonymous or encrypted data. What matters is that the
 * signature makes it unforgeable without PARTICIPATION_TOKEN_SECRET.
 */
const PURPOSE='join_protest';
const HASH=/^[0-9a-f]{64}$/;
const B64=/^[A-Za-z0-9_-]+$/;
const CLAIMS=['device_id','phone_hash','purpose','iat','exp'];
// Older issuers sampled Date.now twice; accept at most 1s of that sampling gap.
// The signed exp is never extended. New issuers use a single sample.
const LEGACY_SAMPLING_GAP_MS=1000;
function validClaims(payload,now) {
  return payload!==null && typeof payload==='object' && !Array.isArray(payload)
    && Object.keys(payload).length===CLAIMS.length && CLAIMS.every(key=>Object.hasOwn(payload,key))
    && typeof payload.device_id==='string' && payload.device_id.length>=1 && payload.device_id.length<=128
    && typeof payload.phone_hash==='string' && HASH.test(payload.phone_hash) && payload.purpose===PURPOSE
    && Number.isSafeInteger(now) && now>=0 && Number.isSafeInteger(payload.iat) && payload.iat>=0 && payload.iat<=now
    && Number.isSafeInteger(payload.exp) && payload.exp>now
    && payload.exp-payload.iat>=PARTICIPATION_TOKEN_TTL_MS
    && payload.exp-payload.iat<=PARTICIPATION_TOKEN_TTL_MS+LEGACY_SAMPLING_GAP_MS;
}
export function signParticipationToken({device_id,phone_hash,purpose},now=Date.now()) {
  const payload={device_id,phone_hash,purpose,iat:now,exp:now+PARTICIPATION_TOKEN_TTL_MS};
  if(!validClaims(payload,now))throw new TypeError('Invalid verified participation identity');
  const payloadB64=b64url(JSON.stringify(payload));
  const sig=createHmac('sha256',must('PARTICIPATION_TOKEN_SECRET')).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/** Return authenticated claims only; malformed/untrusted token input is an ordinary rejection. */
export function verifyParticipationToken(token,{expectedPurpose,now=Date.now()}={}) {
  if(typeof token!=='string'||token.length>2048||(expectedPurpose!==undefined&&expectedPurpose!==PURPOSE))return null;
  const parts=token.split('.');
  if(parts.length!==2||!B64.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))return null;
  const [payloadB64,sig]=parts;
  const signature=Buffer.from(sig,'base64url');
  if(signature.length!==32||signature.toString('base64url')!==sig)return null;
  const expected=createHmac('sha256',must('PARTICIPATION_TOKEN_SECRET')).update(payloadB64).digest();
  if(!timingSafeEqual(signature,expected))return null;
  try {
    const bytes=Buffer.from(payloadB64,'base64url');
    if(bytes.toString('base64url')!==payloadB64)return null;
    const payload=JSON.parse(bytes.toString('utf8'));
    return validClaims(payload,now)?payload:null;
  }catch{return null;}
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
  if (typeof providedSecret!=='string'||!HASH.test(providedSecret)||typeof storedHash!=='string'||!HASH.test(storedHash)) return false;
  const computed = hashDeviceSecret(providedSecret);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
