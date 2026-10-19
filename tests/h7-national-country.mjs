// H7 — reproducción local: de dónde sale el país que usa la comprobación NACIONAL de /join.
// Sin red, sin Supabase, sin Twilio, sin SMS, sin producción. Datos sintéticos.
// Ejecutar: node --experimental-test-module-mocks --test tests/h7-national-country.mjs
//
// QUÉ PRUEBA (recorrido real del código de apps/api, con servicios simulados):
//   POST /api/users/verify-otp  -> devices.country_code
//   POST /api/users/device/:id/reauth -> participation_token (sin OTP)
//   POST /api/protests/:id/join -> createVerifiedAdhesion -> NationalCountryMismatchError
// QUÉ NO PRUEBA: Twilio real, la base real (claves, FK a country_codes, RLS), el cliente web,
// ni qué hace el despliegue en producción. Es un modelo del código, no un ataque a la API.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.PHONE_HASH_SECRET = 'test-phone-secret';
process.env.NULLIFIER_SECRET = 'test-nullifier-secret';
process.env.PARTICIPATION_TOKEN_SECRET = 'test-token-secret';
process.env.DEVICE_SECRET_PEPPER = 'test-pepper';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
delete process.env.RECAPTCHA_SECRET;
delete process.env.NODE_ENV;

// Fixtures sintéticas
const PROTEST_ES = '22222222-2222-4222-8222-222222222222'; // convocatoria NACIONAL de España
const PHONE_ES = '+34600000001';
const PHONE_FR = '+33600000002';
const OTP = '123456'; // el mock de Twilio "aprueba" este código para cualquier número

// ── Base de datos simulada (solo lo que tocan estas rutas) ─────────────────
const db = { devices: new Map(), adhesions: [] };
const protestRow = { id: PROTEST_ES, scope: 'national', country: 'ES', saldo_euros: null,
  convocatoria_osm_id: null, convocatoria_ciudad_nombre: null };

function exec(st, single) {
  const { table, op, filters, payload } = st;
  let data = null; let error = null;
  if (table === 'devices') {
    if (op === 'upsert') { db.devices.set(payload.id, { ...(db.devices.get(payload.id) ?? {}), ...payload }); data = db.devices.get(payload.id); }
    else if (op === 'select') {
      data = [...db.devices.values()].find(d => Object.entries(filters).every(([k, v]) => d[k] === v)) ?? null;
    }
  } else if (table === 'protests' && op === 'select') {
    data = filters.id === PROTEST_ES ? protestRow : null;
  }
  return Promise.resolve({ data: single ? data : data, error });
}
const from = (table) => {
  const st = { table, op: 'select', filters: {}, payload: null };
  const b = {
    select: () => b, is: () => b, order: () => b, limit: () => b,
    upsert: (p) => { st.op = 'upsert'; st.payload = p; return b; },
    update: (p) => { st.op = 'update'; st.payload = p; return b; },
    insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
    eq: (k, v) => { st.filters[k] = v; return b; },
    maybeSingle: () => exec(st, true), single: () => exec(st, true),
    then: (res, rej) => exec(st, false).then(res, rej),
  };
  return b;
};
const rpc = async (name, args) => {
  if (name === 'create_verified_adhesion') { db.adhesions.push(args); return { data: { id: 'adh-1', created_at: '2026-01-01T00:00:00Z', ciudad: null, region: null, pais: null, adhesion_osm_id: null }, error: null }; }
  if (name === 'get_otp_cooldown') return { data: 0, error: null };
  if (name === 'check_otp_rate_limit') return { data: { allowed: true }, error: null };
  return { data: null, error: null };
};
mock.module('../apps/api/src/services/supabase.js', { namedExports: { supabase: { from, rpc } } });
mock.module('../apps/api/src/services/twilio.js', { namedExports: {
  sendOtp: async () => {},
  verifyOtp: async (_phone, code) => code === OTP, // "el OTP se verificó para ESTE número exacto"
} });
// La evidencia de ubicación llama a servicios externos: aquí falla rápido y degrada (no bloquea la adhesión).
globalThis.fetch = async () => { throw new Error('no network in tests'); };

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
const join = (token) => app.inject({ method: 'POST', url: `/api/protests/${PROTEST_ES}/join`,
  payload: { participation_token: token, recaptcha_token: 'dev' } });
const reauth = (deviceId, secret) => app.inject({ method: 'POST', url: `/api/users/device/${deviceId}/reauth`, payload: { device_secret: secret } });

test.beforeEach(() => { db.devices.clear(); db.adhesions.length = 0; });

test('1. control: número español que declara ES entra en la convocatoria nacional de España', async () => {
  const v = (await verify(PHONE_ES, 'device-es-0001', 'ES')).json();
  assert.equal(db.devices.get('device-es-0001').country_code, 'ES');
  const r = await join(v.participation_token);
  assert.equal(r.statusCode, 201);
  assert.equal(db.adhesions.length, 1);
});

test('2. control: número francés que declara FR es rechazado (NATIONAL_ONLY) — la comprobación existe', async () => {
  const v = (await verify(PHONE_FR, 'device-fr-0001', 'FR')).json();
  const r = await join(v.participation_token);
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().code, 'NATIONAL_ONLY');
  assert.equal(db.adhesions.length, 0);
});

test('3. H7: número FRANCÉS verificado que DECLARA country_code=ES supera la comprobación nacional de España', async () => {
  const v = (await verify(PHONE_FR, 'device-fr-0002', 'ES')).json();
  assert.equal(v.verified, true);
  // verify-otp guardó el valor declarado, no uno derivado del número verificado:
  assert.equal(db.devices.get('device-fr-0002').country_code, 'ES');
  const r = await join(v.participation_token);
  assert.equal(r.statusCode, 201, 'la elusión llega hasta la creación de la adhesión');
  assert.equal(db.adhesions.length, 1);
  assert.equal(db.adhesions[0].p_verification_method, 'phone_otp');
});

test('4. H7: el valor declarado "gana la primera vez": un segundo verify-otp del mismo número no lo corrige', async () => {
  await verify(PHONE_FR, 'device-fr-0003', 'ES');                       // primera verificación: declara ES
  const v2 = (await verify(PHONE_FR, 'device-fr-0004', 'FR')).json();   // otro dispositivo, declara FR (honesto)
  assert.equal(v2.device_id, 'device-fr-0003', 'se reutiliza la fila existente de ese número');
  assert.equal(db.devices.get('device-fr-0003').country_code, 'ES', 'no se actualiza ni se contrasta con el número');
});

test('5. H7: un dispositivo ya verificado con país declarado falso vuelve a entrar con device_secret, sin OTP', async () => {
  const v = (await verify(PHONE_FR, 'device-fr-0005', 'ES')).json();
  assert.ok(v.device_secret);
  const ra = (await reauth('device-fr-0005', v.device_secret)).json();
  assert.equal(ra.authenticated, true);
  assert.equal(ra.country_code, 'ES');
  const r = await join(ra.participation_token);
  assert.equal(r.statusCode, 201, 'las verificaciones ya existentes arrastran el valor declarado');
});

test('6. H7: el país sigue a la última declaración del mismo device_id (upsert por id)', async () => {
  await verify(PHONE_ES, 'device-x-0001', 'ES');
  await verify(PHONE_FR, 'device-x-0001', 'ES'); // mismo dispositivo, otro número
  const row = db.devices.get('device-x-0001');
  assert.equal(row.country_code, 'ES');
});

test('7. límite de la prueba: sin country_code declarado, el dispositivo queda con país nulo y /join lo rechaza', async () => {
  const v = (await verify(PHONE_ES, 'device-es-0002', null)).json();
  assert.equal(db.devices.get('device-es-0002').country_code ?? null, null);
  const r = await join(v.participation_token);
  assert.equal(r.statusCode, 403, 'país ausente = rechazo; hoy el país es obligatorio de facto, pero lo aporta el cliente');
});

test('8. prefijos compartidos en la tabla de referencia: el prefijo no determina un único país', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260503_country_codes.sql', import.meta.url), 'utf8');
  const by = {}; let m; const re = /\('([A-Z]{2})',\s*(\d+),/g;
  while ((m = re.exec(sql))) (by[m[2]] ??= []).push(m[1]);
  const shared = Object.entries(by).filter(([, v]) => v.length > 1);
  assert.deepEqual(shared, [['1', ['US', 'CA', 'DO']]]);
  // y la tabla solo cubre los países sembrados: un prefijo fuera de ella no tiene ISO2 posible aquí
  assert.ok(Object.keys(by).length < 250);
});
