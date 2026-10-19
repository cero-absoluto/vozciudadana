// Local, offline checks for apps/web/src/lib/joinRejection.js and the verify.* messages.
// No backend, no network, no Supabase. Run: node --test tests/join-rejection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createI18n } from 'vue-i18n';
import { classifyJoinRejection, joinRejectionPath, joinRejectionToast, JOIN_REJECTION_KIND } from '../apps/web/src/lib/joinRejection.js';

const L = ['es', 'en', 'fr', 'zh'];
const loc = Object.fromEntries(L.map(l => [l, JSON.parse(fs.readFileSync(new URL(`../apps/web/src/locales/${l}.json`, import.meta.url), 'utf8'))]));

// Shapes exactly as services/api.js request() builds them from the backend bodies in routes/protests.js.
const E = (status, body) => { const e = new Error(body.error ?? body.message ?? `API error ${status}`); if (body.code) e.code = body.code; e.status = status; e.reason = body.reason ?? null; return e; };
const BACKEND = {
  verification: E(401, { error: 'VERIFICATION_REQUIRED', reason: 'Missing, invalid, or expired verification. Please verify your phone number again.' }),
  closed:       E(410, { error: 'PROTEST_CLOSED', reason: 'This convocatoria has closed' }),
  already:      E(409, { error: 'ALREADY_JOINED', reason: 'You have already joined this convocatoria — one verified adhesion per person, per event.' }),
  noFunds:      E(402, { code: 'SALDO_AGOTADO', error: 'Esta convocatoria no tiene saldo. Apóyala con una donación.' }),
  national:     E(403, { code: 'NATIONAL_ONLY', error: 'protests country does not match device country' }),
  shared:       E(403, { code: 'NATIONAL_COUNTRY_SHARED_CODE', error: 'The country of this number cannot be established from its calling code, which several countries share. This does not mean the number belongs to another country.' }),
  unresolved:   E(403, { code: 'NATIONAL_COUNTRY_UNRESOLVED', error: 'The country of this number could not be established. This does not mean the number belongs to another country.' }),
  reverify:     E(403, { code: 'NATIONAL_REVERIFICATION_REQUIRED', error: 'This national convocatoria requires a fresh phone verification to establish the country of your number.' }),
};

// The ORIGINAL decision of VerifyScreen.vue (before this change), kept here as an oracle.
function original(e) {
  if (e.code === 'NATIONAL_ONLY') return ['verify.toastNational', '/'];
  if (e.status === 409 || e.message?.includes('409') || e.message?.includes('already')) return ['verify.toastAlready', '/'];
  if (e.status === 402 || e.message?.includes('402') || e.message?.includes('SALDO')) return ['verify.toastSinSaldo', '/'];
  return ['verify.toastError', '/'];
}
const decide = (e) => { const r = classifyJoinRejection(e); return [r.toastKey, joinRejectionPath(r, 'P1')]; };

test('409, 402 and NATIONAL_ONLY behave exactly as before (backend shapes and loose shapes)', () => {
  for (const e of [BACKEND.already, BACKEND.noFunds, BACKEND.national,
    E(409, {}), E(402, {}), Object.assign(new Error('x'), { code: 'NATIONAL_ONLY' }),
    new Error('You have already joined'), new Error('HTTP 409 conflict'), new Error('error 402'), new Error('SALDO_AGOTADO')]) {
    assert.deepEqual(decide(e), original(e), `message=${e.message} status=${e.status}`);
  }
});

test('401 VERIFICATION_REQUIRED -> auth with its own message; destination is /auth', () => {
  const r = classifyJoinRejection(BACKEND.verification);
  assert.equal(r.kind, JOIN_REJECTION_KIND.VERIFICATION_REQUIRED);
  assert.equal(r.toastKey, 'verify.toastVerificationRequired');
  assert.equal(joinRejectionPath(r, 'P1'), '/auth');
});

test('410 PROTEST_CLOSED -> the public report of THAT convocatoria with its own message', () => {
  const r = classifyJoinRejection(BACKEND.closed);
  assert.equal(r.kind, JOIN_REJECTION_KIND.CLOSED);
  assert.equal(r.toastKey, 'verify.toastClosed');
  assert.equal(joinRejectionPath(r, 'abc-123'), '/informe/abc-123');
  assert.equal(joinRejectionPath(r, 'a b/c'), '/informe/a%20b%2Fc');
  assert.equal(joinRejectionPath(r, null), '/', 'no id -> never an invalid route');
});

test('a 401 or 410 WITHOUT the exact identifier is NOT treated as expiry/closure', () => {
  for (const e of [E(401, { error: 'Unauthorized' }), E(401, {}), E(401, { error: 'RECAPTCHA_FAILED' }), E(401, { error: 'VERIFICATION_REQUIRED_X' }),
    E(410, { error: 'Token expired' }), E(410, {}), E(410, { error: 'GONE' }), E(403, { error: 'VERIFICATION_REQUIRED' }), E(400, { error: 'PROTEST_CLOSED' }), E(500, { error: 'VERIFICATION_REQUIRED' })]) {
    const r = classifyJoinRejection(e);
    assert.equal(r.kind, 'generic', `status=${e.status} msg=${e.message}`);
    assert.equal(joinRejectionPath(r, 'P1'), '/');
  }
});

test('identifier may arrive as err.code (if api.js ever copies it) or as err.message', () => {
  assert.equal(classifyJoinRejection(Object.assign(new Error('x'), { status: 401, code: 'VERIFICATION_REQUIRED' })).kind, 'verification_required');
  assert.equal(classifyJoinRejection(Object.assign(new Error('x'), { status: 410, code: 'PROTEST_CLOSED' })).kind, 'closed');
});

test('generic: fixed translated key; server text is never returned', () => {
  const secrets = ['SELECT * FROM devices WHERE phone_hash = \'abc\'', 'TypeError: Cannot read properties of undefined', 'ECONNREFUSED 10.0.0.5:5432', 'stack at /srv/app/routes/protests.js:640'];
  for (const s of secrets) for (const e of [E(500, { error: s, reason: s }), Object.assign(new Error(s), { status: 400, reason: s }), new Error(s), Object.assign(new TypeError(s), { status: undefined })]) {
    const r = classifyJoinRejection(e);
    assert.equal(r.toastKey, 'verify.toastErrorGeneric');
    assert.ok(!JSON.stringify(r).includes(s), 'server text must not appear in the result');
  }
  for (const e of [null, undefined, {}, 'boom', 42, { status: 'x' }]) assert.equal(classifyJoinRejection(e).kind, 'generic');
});

test('locales: the four new messages exist in es/en/fr/zh, non-empty, no placeholders, and the old keys are untouched', () => {
  for (const l of L) {
    for (const k of ['toastVerificationRequired', 'toastClosed', 'toastErrorGeneric', 'toastProtestNotFound', 'toastNationalNoCountry']) {
      const v = loc[l].verify[k];
      assert.equal(typeof v, 'string', `${l}.${k}`); assert.ok(v.trim().length > 15, `${l}.${k} too short`);
      assert.ok(!/[{}]/.test(v), `${l}.${k} must not contain placeholders`);
    }
    for (const k of ['toastError', 'toastNational', 'toastAlready', 'toastSinSaldo', 'toast']) assert.ok(loc[l].verify[k], `${l}.${k} must still exist`);
  }
  // key sets of verify.* are identical across languages
  const keys = l => Object.keys(loc[l].verify).sort().join(',');
  for (const l of L) assert.equal(keys(l), keys('es'));
});

test('rendered with vue-i18n in every language: complete messages, never ending in an empty detail', () => {
  for (const l of L) {
    const i18n = createI18n({ legacy: false, locale: l, messages: { [l]: loc[l] } });
    for (const kind of Object.values(JOIN_REJECTION_KIND)) {
      const key = classifyJoinRejection(kind === 'generic' ? new Error('x') : { national: BACKEND.national, already: BACKEND.already, no_funds: BACKEND.noFunds, verification_required: BACKEND.verification, closed: BACKEND.closed, national_shared_code: BACKEND.shared, national_unresolved: BACKEND.unresolved, national_reverification: BACKEND.reverify }[kind]).toastKey;
      if (kind === 'national') continue; // verify.toastNational has a {country} placeholder: covered by the dedicated national test below
      const out = i18n.global.t(key);
      assert.ok(out.trim().length > 15, `${l} ${key}`); assert.ok(!/[:：]\s*$/.test(out), `${l} ${key} ends with empty detail: "${out}"`);
    }
  }
});

test('NATIONAL_ONLY toast: country name when known, complete variant without country otherwise; other kinds untouched', () => {
  const nat = classifyJoinRejection(BACKEND.national);
  assert.deepEqual(joinRejectionToast(nat, 'España'), { key: 'verify.toastNational', params: { country: 'España' } });
  assert.deepEqual(joinRejectionToast(nat, '  Spain '), { key: 'verify.toastNational', params: { country: 'Spain' } });
  for (const missing of [undefined, null, '', '   ', 42, {}, []]) {
    assert.deepEqual(joinRejectionToast(nat, missing), { key: 'verify.toastNationalNoCountry', params: {} }, String(missing));
  }
  // admission decision/destination unchanged: still kind=national, key verify.toastNational, back to '/'
  assert.equal(nat.kind, 'national'); assert.equal(nat.toastKey, 'verify.toastNational'); assert.equal(joinRejectionPath(nat, 'P1'), '/');
  for (const e of [BACKEND.already, BACKEND.noFunds, BACKEND.verification, BACKEND.closed, new Error('x')]) {
    const r = classifyJoinRejection(e); assert.deepEqual(joinRejectionToast(r, 'España'), { key: r.toastKey, params: {} });
  }
});

test('NATIONAL_ONLY rendered in es/en/fr/zh: with country (no empty "de ." ending, no placeholder) and without country (complete)', () => {
  const countries = { es: 'España', en: 'Spain', fr: 'Espagne', zh: '西班牙' };
  const nat = classifyJoinRejection(BACKEND.national);
  for (const l of L) {
    const i18n = createI18n({ legacy: false, locale: l, messages: { [l]: loc[l] } });
    const withC = joinRejectionToast(nat, countries[l]); const out1 = i18n.global.t(withC.key, withC.params);
    assert.ok(out1.includes(countries[l]), `${l}: ${out1}`); assert.ok(!/[{}]/.test(out1), `${l}: ${out1}`); assert.ok(!/\s[.。]$/.test(out1), `${l} empty ending: ${out1}`);
    const noC = joinRejectionToast(nat, undefined); const out2 = i18n.global.t(noC.key, noC.params);
    assert.ok(out2.trim().length > 15, `${l}: ${out2}`); assert.ok(!/[{}]/.test(out2), `${l} placeholder: ${out2}`);
    assert.ok(!/\s[.。]$/.test(out2) && !/(\bde|\bof|的)\s*[.。]$/.test(out2), `${l} ends with empty country: ${out2}`);
    assert.notEqual(out1, out2);
  }
});

test('H7 derived-country codes: own kinds, fixed keys, never server text, never "other country" wording', () => {
  const cases = [[BACKEND.shared, 'national_shared_code', 'verify.toastNationalSharedCode', 'home'],
    [BACKEND.unresolved, 'national_unresolved', 'verify.toastNationalUnresolved', 'home'],
    [BACKEND.reverify, 'national_reverification', 'verify.toastNationalReverification', 'auth']];
  for (const [e, kind, key, dest] of cases) {
    const r = classifyJoinRejection(e);
    assert.equal(r.kind, kind); assert.equal(r.toastKey, key); assert.equal(r.destination, dest);
    assert.ok(!JSON.stringify(r).includes(e.message), 'server text must not appear');
    assert.deepEqual(joinRejectionToast(r, 'España'), { key, params: {} });
  }
  // only the reverification asks AuthScreen to skip the device-secret fast path
  assert.equal(classifyJoinRejection(BACKEND.reverify).forceOtp, true);
  for (const e of [BACKEND.shared, BACKEND.unresolved, BACKEND.national, BACKEND.already]) assert.ok(!classifyJoinRejection(e).forceOtp);
  // the exact code is required (a status alone or a lookalike code is generic/unchanged)
  assert.equal(classifyJoinRejection(E(403, { code: 'NATIONAL_COUNTRY_SHARED_CODE_X' })).kind, 'generic');
  assert.equal(classifyJoinRejection(E(403, {})).kind, 'generic');
  for (const l of L) for (const k of ['toastNationalSharedCode', 'toastNationalUnresolved']) {
    assert.ok(loc[l].verify[k].length > 30, `${l}.${k}`); assert.ok(!/[{}]/.test(loc[l].verify[k]));
  }
  // the two "cannot resolve" messages explicitly deny that the number is from another country
  assert.match(loc.es.verify.toastNationalSharedCode, /no significa que tu número sea de otro país/);
  assert.match(loc.es.verify.toastNationalUnresolved, /no significa que tu número sea de otro país/);
  assert.match(loc.en.verify.toastNationalUnresolved, /does not mean your number belongs to another country/);
});

