// Local, offline checks for POST /api/users/request-otp (no network, no Supabase, no Twilio, no SMS).
// Synthetic data only. Run: node --experimental-test-module-mocks --test tests/otp-precheck.mjs
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.PHONE_HASH_SECRET = 'test-phone-secret';
process.env.NULLIFIER_SECRET = 'test-nullifier-secret';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
delete process.env.RECAPTCHA_SECRET;
delete process.env.NODE_ENV;

const PROTEST = '11111111-1111-4111-8111-111111111111';
const JOINED = '+34600000001';   // synthetic number that already adhered to PROTEST
const FRESH = '+34600000002';    // synthetic number that did not
const hashPhone = (p) => createHmac('sha256', process.env.PHONE_HASH_SECRET).update(p).digest('hex');

// What /join really stores: the nullifier computed by the AdhesionService.
const { computeNullifier } = await import('../apps/api/src/lib/adhesionService.js').catch(() => ({}));

const calls = { adhesionsQueried: 0, smsSentTo: [] };
const stored = new Set();

const fakeQuery = (table) => {
  const q = { _f: {} };
  const chain = () => q;
  for (const m of ['select', 'is', 'insert', 'update']) q[m] = () => (m === 'insert' ? Promise.resolve({ error: null }) : chain());
  q.eq = (k, v) => { q._f[k] = v; return q; };
  q.maybeSingle = async () => {
    if (table === 'adhesions') { calls.adhesionsQueried++; return { data: stored.has(q._f.nullifier) ? { id: 'x' } : null }; }
    return { data: null };
  };
  return q;
};
mock.module('../apps/api/src/services/supabase.js', {
  namedExports: {
    supabase: {
      from: fakeQuery,
      rpc: async (name) => (name === 'get_otp_cooldown' ? { data: 0 } : { data: { allowed: true } }),
    },
  },
});
mock.module('../apps/api/src/services/twilio.js', {
  namedExports: {
    sendOtp: async (phone) => { calls.smsSentTo.push(phone); },
    verifyOtp: async () => false,
  },
});

const { default: Fastify } = await import('fastify');
const sensible = (await import('@fastify/sensible')).default;
const { default: userRoutes } = await import('../apps/api/src/routes/users.js');

const app = Fastify();
await app.register(sensible);
await app.register(userRoutes, { prefix: '/api/users' });
await app.ready();

if (computeNullifier) stored.add(computeNullifier({ method: 'phone_otp', subjectHash: hashPhone(JOINED), protestId: PROTEST }));

const requestOtp = (phone) => app.inject({
  method: 'POST', url: '/api/users/request-otp',
  payload: { phone, recaptcha_token: 'dev', device_id: 'device-test-0001', protest_id: PROTEST },
});

test.beforeEach(() => { calls.adhesionsQueried = 0; calls.smsSentTo.length = 0; });

test('the nullifier stored by /join exists for the already-joined number (fixture sanity)', () => {
  assert.ok(computeNullifier, 'computeNullifier must be importable');
  assert.equal(stored.size, 1);
});

test('request-otp gives the SAME status and body for a number that already joined and one that did not', async () => {
  const a = await requestOtp(JOINED);
  const b = await requestOtp(FRESH);
  assert.equal(a.statusCode, b.statusCode);
  assert.equal(a.body, b.body);
  assert.deepEqual(JSON.parse(a.body), { sent: true });
});

test('request-otp does not reveal participation: it never queries adhesions and sends the SMS in both cases', async () => {
  await requestOtp(JOINED);
  await requestOtp(FRESH);
  assert.equal(calls.adhesionsQueried, 0, 'no per-number participation lookup before the SMS');
  assert.deepEqual(calls.smsSentTo, [JOINED, FRESH]);
});
