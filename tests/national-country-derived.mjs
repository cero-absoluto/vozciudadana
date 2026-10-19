// H7 — elegibilidad nacional con país DERIVADO en el servidor. Sin red, sin Supabase, sin Twilio, sin SMS, sin producción.
// Datos sintéticos. Ejecutar: node --experimental-test-module-mocks --test tests/national-country-derived.mjs
// Recorre el código real de routes/users.js, routes/protests.js y lib/adhesionService.js con la base y Twilio simulados.
// No prueba: Twilio real, la base real (la migración se prueba aparte en tests/devices-numbering-migration.mjs), el cliente web.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.PHONE_HASH_SECRET = 'test-phone-secret';
process.env.NULLIFIER_SECRET = 'test-nullifier-secret';
process.env.PARTICIPATION_TOKEN_SECRET = 'test-token-secret';
process.env.DEVICE_SECRET_PEPPER = 'test-pepper';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
delete process.env.RECAPTCHA_SECRET;
delete process.env.NODE_ENV;

const P = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const PROTESTS = {
  [P(1)]: { id: P(1), scope: 'national', country: 'ES' },
  [P(2)]: { id: P(2), scope: 'national', country: 'CA' },
  [P(3)]: { id: P(3), scope: 'national', country: 'UY' },
  [P(4)]: { id: P(4), scope: 'global', country: null },
  [P(5)]: { id: P(5), scope: 'local', country: 'ES', convocatoria_osm_id: 1, convocatoria_ciudad_nombre: 'X' },
  [P(6)]: { id: P(6), scope: 'regional', country: 'ES', convocatoria_osm_id: 2, convocatoria_ciudad_nombre: 'Y' },
  [P(7)]: { id: P(7), scope: 'national', country: 'US' },
};
const NAT_ES = P(1), NAT_CA = P(2), NAT_UY = P(3), GLOBAL = P(4), LOCAL = P(5), REGIONAL = P(6), NAT_US = P(7);

const PH = { ES: '+34600000001', FR: '+33600000002', FR2: '+33600000003', CA: '+14165550123', US: '+12015550123', UY: '+59899123456', NONE: '+99912345678' };
const OTP = '123456';
const hashPhone = (p) => createHmac('sha256', process.env.PHONE_HASH_SECRET).update(p).digest('hex');

const db = { devices: new Map(), adhesions: [] };
const calls = { verifyOtp: 0 };
const protestFor = (id) => (PROTESTS[id] ? { saldo_euros: null, convocatoria_osm_id: null, convocatoria_ciudad_nombre: null, ...PROTESTS[id] } : null);

function exec(st) {
  const { table, op, filters, payload } = st;
  let data = null; let error = null;
  if (table === 'devices') {
    const find = () => [...db.devices.values()].find(d => Object.entries(filters).every(([k, v]) => d[k] === v)) ?? null;
    if (op === 'upsert') { db.devices.set(payload.id, { ...(db.devices.get(payload.id) ?? {}), ...payload }); data = db.devices.get(payload.id); }
    else if (op === 'update') { const row = find(); if (row) Object.assign(row, payload); }
    else if (op === 'select') data = find();
  } else if (table === 'protests' && op === 'select') data = protestFor(filters.id);
  return Promise.resolve({ data, error });
}
const from = (table) => {
  const st = { table, op: 'select', filters: {}, payload: null };
  const b = {
    select: () => b, is: () => b, order: () => b, limit: () => b,
    upsert: (p) => { st.op = 'upsert'; st.payload = p; return b; },
    update: (p) => { st.op = 'update'; st.payload = p; return b; },
    insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
    eq: (k, v) => { st.filters[k] = v; return b; },
    maybeSingle: () => exec(st), single: () => exec(st),
    then: (res, rej) => exec(st).then(res, rej),
  };
  return b;
};
const rpc = async (name, args) => {
  if (name === 'create_verified_adhesion') { db.adhesions.push(args); return { data: { id: 'adh-1', created_at: '2026-01-01T00:00:00Z', ciudad: null, region: null, pais: null, adhesion_osm_id: null }, error: null }; }
  return { data: null, error: null };
};
mock.module('../apps/api/src/services/supabase.js', { namedExports: { supabase: { from, rpc } } });
mock.module('../apps/api/src/services/twilio.js', { namedExports: {
  sendOtp: async () => {},
  verifyOtp: async (_p, code) => { calls.verifyOtp++; return code === OTP; },
} });
globalThis.fetch = async () => { throw new Error('no network in tests'); };

const { generateDeviceSecret } = await import('../apps/api/src/lib/participationToken.js');
const { default: Fastify } = await import('fastify');
const sensible = (await import('@fastify/sensible')).default;
const { default: userRoutes } = await import('../apps/api/src/routes/users.js');
const { default: protestRoutes } = await import('../apps/api/src/routes/protests.js');
const app = Fastify();
await app.register(sensible);
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(protestRoutes, { prefix: '/api/protests' });
await app.ready();

const verify = (phone, deviceId, declared) => app.inject({ method: 'POST', url: '/api/users/verify-otp',
  payload: { phone, otp: OTP, device_id: deviceId, ...(declared ? { country_code: declared } : {}) } });
const join = (protestId, token) => app.inject({ method: 'POST', url: `/api/protests/${protestId}/join`,
  payload: { participation_token: token, recaptcha_token: 'dev' } });
const reauth = (deviceId, secret) => app.inject({ method: 'POST', url: `/api/users/device/${deviceId}/reauth`, payload: { device_secret: secret } });
const body = (r) => r.json();
function legacyDevice(id, phone, declared) { // verificado ANTES de la derivación: sin procedencia
  const { secret, hash } = generateDeviceSecret();
  db.devices.set(id, { id, phone_hash: hashPhone(phone), verified_at: '2026-01-01T00:00:00Z', country_code: declared, device_secret_hash: hash });
  return secret;
}

test.beforeEach(() => { db.devices.clear(); db.adhesions.length = 0; calls.verifyOtp = 0; });

test('1. número ES entra en la nacional de España aunque declare otro país o ninguno (la declaración no concede ni quita)', async () => {
  for (const [i, declared] of ['FR', null, 'ES'].entries()) {
    db.adhesions.length = 0;
    const v = body(await verify(PH.ES, `device-es-000${i}`, declared));
    const row = db.devices.get(`device-es-000${i}`);
    assert.equal(row.numbering_country, 'ES');
    assert.equal(row.numbering_resolution, 'resolved_unshared');
    assert.match(row.numbering_meta_version, /^libphonenumber-js@1\.12\.10\/max$/);
    const r = await join(NAT_ES, v.participation_token);
    assert.equal(r.statusCode, 201, `declarado=${declared}`);
    assert.equal(db.adhesions.length, 1);
    db.devices.clear();
  }
});

test('2. H7 cerrado: número FR que DECLARA ES (y FR que declara FR) es rechazado NATIONAL_ONLY; no se crea adhesión', async () => {
  for (const declared of ['ES', 'FR']) {
    const v = body(await verify(PH.FR, `device-fr-${declared}`, declared));
    const r = await join(NAT_ES, v.participation_token);
    assert.equal(r.statusCode, 403);
    assert.equal(body(r).code, 'NATIONAL_ONLY');
    db.devices.clear();
  }
  assert.equal(db.adhesions.length, 0);
});

test('3. la fuente es la numeración, no la tabla country_codes: número UY (fuera de la tabla) entra en una nacional de UY', async () => {
  const v = body(await verify(PH.UY, 'device-uy-0001', 'ES'));
  assert.equal(db.devices.get('device-uy-0001').numbering_country, 'UY');
  assert.equal((await join(NAT_UY, v.participation_token)).statusCode, 201);
});

test('4. código compartido (+1): no se registra adhesión nacional, con un código propio y un mensaje que no atribuye otro país', async () => {
  for (const [phone, protest, declared] of [[PH.CA, NAT_CA, 'CA'], [PH.US, NAT_US, 'US'], [PH.US, NAT_CA, 'CA']]) {
    const v = body(await verify(phone, `device-${phone}`, declared));
    const row = db.devices.get(`device-${phone}`);
    assert.equal(row.numbering_resolution, 'shared_calling_code');
    assert.equal(row.numbering_country, null, 'no se atribuye país derivado');
    const r = await join(protest, v.participation_token);
    assert.equal(r.statusCode, 403);
    assert.equal(body(r).code, 'NATIONAL_COUNTRY_SHARED_CODE');
    assert.notEqual(body(r).code, 'NATIONAL_ONLY', 'no se afirma que sea de otro país');
    assert.match(body(r).error, /does not mean the number belongs to another country/);
    db.devices.clear();
  }
  assert.equal(db.adhesions.length, 0);
});

test('5. código compartido y número sin resolver son resultados DISTINTOS (no se equiparan)', async () => {
  const a = body(await verify(PH.US, 'device-shared-1', 'US'));
  const b = body(await verify(PH.NONE, 'device-none-0001', 'ES'));
  assert.equal(db.devices.get('device-shared-1').numbering_resolution, 'shared_calling_code');
  assert.equal(db.devices.get('device-none-0001').numbering_resolution, 'no_result');
  const ra = await join(NAT_ES, a.participation_token);
  const rb = await join(NAT_ES, b.participation_token);
  assert.equal(body(ra).code, 'NATIONAL_COUNTRY_SHARED_CODE');
  assert.equal(body(rb).code, 'NATIONAL_COUNTRY_UNRESOLVED');
  assert.match(body(rb).error, /does not mean the number belongs to another country/);
});

test('6. global, local y regional no cambian: FR, +1 y sin resolver siguen pudiendo adherirse', async () => {
  for (const phone of [PH.FR, PH.US, PH.NONE]) {
    const v = body(await verify(phone, `device-${phone}`, 'ES'));
    for (const protest of [GLOBAL, LOCAL, REGIONAL]) {
      const r = await join(protest, v.participation_token);
      assert.equal(r.statusCode, 201, `${phone} en ${PROTESTS[protest].scope}`);
    }
    db.devices.clear();
  }
});

test('7. dispositivo existente (legado, sin procedencia): entra por reauth, pero la nacional exige nueva verificación; global no', async () => {
  const secret = legacyDevice('device-legacy-1', PH.ES, 'ES');
  const ra = body(await reauth('device-legacy-1', secret));
  assert.equal(ra.authenticated, true);
  const natural = await join(NAT_ES, ra.participation_token);
  assert.equal(natural.statusCode, 403);
  assert.equal(body(natural).code, 'NATIONAL_REVERIFICATION_REQUIRED');
  assert.equal((await join(GLOBAL, ra.participation_token)).statusCode, 201, 'el legado sigue funcionando fuera de lo nacional');
  assert.equal(calls.verifyOtp, 0, 'la reautenticación no usa OTP');
});

test('8. nueva verificación del MISMO número otorga procedencia a la fila existente (mismo device_id, la declaración no la pisa)', async () => {
  legacyDevice('device-legacy-2', PH.ES, 'FR'); // el legado declaró FR para un número español
  const v = body(await verify(PH.ES, 'device-other-browser-1', 'FR'));
  assert.equal(v.device_id, 'device-legacy-2', 'se reutiliza la fila existente');
  const row = db.devices.get('device-legacy-2');
  assert.equal(row.numbering_country, 'ES');
  assert.equal(row.country_code, 'FR', 'el valor declarado queda como dato informativo, sin tocar');
  assert.equal((await join(NAT_ES, v.participation_token)).statusCode, 201);
});

test('9. legado FR que declaró ES: tras reverificar se rechaza (derivado FR)', async () => {
  legacyDevice('device-legacy-3', PH.FR, 'ES');
  const v = body(await verify(PH.FR, 'device-other-browser-2', 'ES'));
  assert.equal(db.devices.get('device-legacy-3').numbering_country, 'FR');
  const r = await join(NAT_ES, v.participation_token);
  assert.equal(r.statusCode, 403);
  assert.equal(body(r).code, 'NATIONAL_ONLY');
});

test('10. reautenticación de un dispositivo CON procedencia: entra en la nacional sin nuevo OTP', async () => {
  const v = body(await verify(PH.ES, 'device-prov-0001', 'ES'));
  assert.ok(v.device_secret);
  const otpAfterVerify = calls.verifyOtp;
  const ra = body(await reauth('device-prov-0001', v.device_secret));
  assert.equal((await join(NAT_ES, ra.participation_token)).statusCode, 201);
  assert.equal(calls.verifyOtp, otpAfterVerify, 'sin OTP en la reautenticación');
});

test('11. mismo device_id con otro número legítimo: la fila toma la derivación del número NUEVO (no es 403 automático)', async () => {
  await verify(PH.FR, 'device-same-0001', 'FR');
  assert.equal(db.devices.get('device-same-0001').numbering_country, 'FR');
  const v2 = body(await verify(PH.ES, 'device-same-0001', 'FR')); // otro número, mismo device_id
  const row = db.devices.get('device-same-0001');
  assert.equal(row.numbering_country, 'ES');
  assert.equal((await join(NAT_ES, v2.participation_token)).statusCode, 201);
});

test('12. otros métodos no se tocan: el método institucional no pasa por esta comprobación nacional', async () => {
  const { createVerifiedAdhesion } = await import('../apps/api/src/lib/adhesionService.js');
  await assert.doesNotReject(createVerifiedAdhesion({
    protestId: NAT_ES,
    identity: { subjectHash: 'e'.repeat(64), method: 'institutional_email_otp', deviceId: null, numbering: null, institutionalDomain: null },
    location: {}, documentHash: null, institutionalMembership: null,
  }));
});
