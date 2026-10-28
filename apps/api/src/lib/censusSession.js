import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export const CENSUS_SESSION_TTL_MS = 30 * 60 * 1000;
const PURPOSE = 'census_management';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;

// Reuse an existing server secret with cryptographic domain separation.
// No development fallback: a management session must never use a public key.
function key() {
  const secret = process.env.PARTICIPATION_TOKEN_SECRET;
  if (!secret) throw new Error('PARTICIPATION_TOKEN_SECRET is required for census sessions');
  return createHmac('sha256', secret).update('VoiceProtest:census-management:aes256gcm:v1').digest();
}

/** Call only after successful server-side email verification, never from a hash supplied by the client. */
export function issueCensusSession({ emailHash, protestId, emailHint }, now = Date.now()) {
  if (!HASH.test(emailHash ?? '') || !UUID.test(protestId ?? '') || !Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('Invalid verified census identity');
  }
  const payload = { purpose: PURPOSE, emailHash, protestId, iat: now, exp: now + CENSUS_SESSION_TTL_MS };
  if (emailHint !== undefined) {
    if (typeof emailHint !== 'string' || !/^[^@]\*\*\*@[^@]+$/.test(emailHint) || emailHint.length > 254) throw new TypeError('Invalid email hint');
    payload.emailHint = emailHint;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(PURPOSE + ':v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

/** Returns only authenticated claims for this convocatoria, with no embedded membership/role grants. */
export function verifyCensusSession(token, expectedProtestId, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048 || !UUID.test(expectedProtestId ?? '') || !Number.isSafeInteger(now)) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some(p => !B64.test(p))) return null;
  try {
    const encryptionKey = key();
    const [iv, ciphertext, tag] = parts.slice(1).map(s => Buffer.from(s, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null;
    if ([iv,ciphertext,tag].some((bytes,i) => bytes.toString('base64url') !== parts[i+1])) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAAD(Buffer.from(PURPOSE + ':v1'));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    if (payload?.purpose !== PURPOSE || payload.protestId !== expectedProtestId || !HASH.test(payload.emailHash ?? '')) return null;
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat < 0 || payload.iat > now || payload.exp <= now || payload.exp - payload.iat !== CENSUS_SESSION_TTL_MS) return null;
    if (payload.emailHint !== undefined && (typeof payload.emailHint !== 'string' || !/^[^@]\*\*\*@[^@]+$/.test(payload.emailHint))) return null;
    return { ...(payload.emailHint ? { emailHint: payload.emailHint } : {}), emailHash: payload.emailHash, protestId: payload.protestId, expiresAt: payload.exp };
  } catch { return null; }
}
