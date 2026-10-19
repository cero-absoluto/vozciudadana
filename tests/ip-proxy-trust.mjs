// Cliente real detrás de un proxy — reproducción LOCAL y SINTÉTICA (sin red, sin producción, sin SMS, sin Railway).
// Run: node --experimental-test-module-mocks --test tests/ip-proxy-trust.mjs
//
// ESTADO: reproducción SOBRE EL CÓDIGO ACTUAL (antes de cualquier corrección); estas pruebas pasan demostrando el defecto.
// Hipótesis: (H-A) sin `trustProxy`, `req.ip` es la dirección del proxy: todos los usuarios comparten la clave de
// @fastify/rate-limit y el `ip_hash` que usa check_otp_rate_limit; (H-B) varios sitios leen `x-forwarded-for[0]`, que
// controla el cliente si el proxy añade en vez de reemplazar.
// Montaje: API real (rutas reales, Supabase/Twilio simulados) escuchando en loopback, detrás de un proxy HTTP local que
// imita al borde. Cada "usuario" es una IP de origen distinta (127.0.0.N) que conecta al proxy.
// Qué NO prueba: el comportamiento real del borde de Railway (no accesible desde aquí).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

process.env.PHONE_HASH_SECRET = 'test-phone-secret';
process.env.NULLIFIER_SECRET = 'test-nullifier-secret';
process.env.PARTICIPATION_TOKEN_SECRET = 'test-token-secret';
process.env.DEVICE_SECRET_PEPPER = 'test-pepper';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
delete process.env.RECAPTCHA_SECRET; delete process.env.NODE_ENV; delete process.env.TRUST_PROXY_HOPS;

const GLOBAL_PROTEST = '33333333-3333-4333-8333-000000000001';
const rec = { ipHashes: [], fetchUrls: [], sms: 0 };
const db = { devices: new Map() };
const from = (table) => {
  const st = { table, op: 'select', filters: {}, payload: null };
  const run = async () => {
    if (table === 'devices') {
      if (st.op === 'upsert') { db.devices.set(st.payload.id, { ...(db.devices.get(st.payload.id) ?? {}), ...st.payload }); return { data: db.devices.get(st.payload.id), error: null }; }
      if (st.op === 'select') return { data: [...db.devices.values()].find(d => Object.entries(st.filters).every(([k, v]) => d[k] === v)) ?? null, error: null };
    }
    if (table === 'protests' && st.op === 'select') return { data: { id: GLOBAL_PROTEST, scope: 'global', country: null, saldo_euros: null, convocatoria_osm_id: null, convocatoria_ciudad_nombre: null }, error: null };
    return { data: null, error: null };
  };
  const b = { select: () => b, is: () => b, order: () => b, limit: () => b,
    upsert: (p) => { st.op = 'upsert'; st.payload = p; return b; }, update: (p) => { st.op = 'update'; st.payload = p; return b; }, insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
    eq: (k, v) => { st.filters[k] = v; return b; }, maybeSingle: run, single: run, then: (res, rej) => run().then(res, rej) };
  return b;
};
const rpc = async (name, args) => {
  if (name === 'get_otp_cooldown') return { data: 0, error: null };
  if (name === 'check_otp_rate_limit') { rec.ipHashes.push(args.p_ip_hash); return { data: { allowed: true }, error: null }; }
  if (name === 'create_verified_adhesion') return { data: { id: 'a1', created_at: '2026-01-01T00:00:00Z', ciudad: null, region: null, pais: null, adhesion_osm_id: null }, error: null };
  return { data: null, error: null };
};
mock.module('../apps/api/src/services/supabase.js', { namedExports: { supabase: { from, rpc } } });
mock.module('../apps/api/src/services/twilio.js', { namedExports: { sendOtp: async () => { rec.sms++; }, verifyOtp: async () => true } });
globalThis.fetch = async (url) => { rec.fetchUrls.push(String(url)); return { ok: true, json: async () => ({ country_code: 'ES', city: 'X' }) }; };

const { default: Fastify } = await import('fastify');
const sensible = (await import('@fastify/sensible')).default;
const rateLimit = (await import('@fastify/rate-limit')).default;
const { default: userRoutes } = await import('../apps/api/src/routes/users.js');
const { default: protestRoutes } = await import('../apps/api/src/routes/protests.js');
const { ipinfoRoutes } = await import('../apps/api/src/routes/geocode.js');

// Misma composición que server.js (rate-limit global + rutas reales). `fastifyOpts` es lo único que cambia.
async function startApi(fastifyOpts) {
  const app = Fastify(fastifyOpts);
  await app.register(sensible);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(protestRoutes, { prefix: '/api/protests' });
  await app.register(ipinfoRoutes, { prefix: '/api/ipinfo' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}
// Proxy local que imita al borde. mode: 'overwrite' (sustituye XFF/X-Real-IP por la IP del cliente),
// 'append' (añade la IP del cliente a la derecha de lo que el cliente envió), 'passthrough' (no toca nada).
function startProxy(apiPort, mode) {
  const srv = http.createServer((creq, cres) => {
    const client = creq.socket.remoteAddress.replace('::ffff:', '');
    const h = { ...creq.headers };
    if (mode === 'overwrite') { h['x-forwarded-for'] = client; h['x-real-ip'] = client; }
    if (mode === 'append') h['x-forwarded-for'] = h['x-forwarded-for'] ? `${h['x-forwarded-for']}, ${client}` : client;
    const up = http.request({ host: '127.0.0.1', port: apiPort, path: creq.url, method: creq.method, headers: h }, (ures) => { cres.writeHead(ures.statusCode, ures.headers); ures.pipe(cres); });
    creq.pipe(up);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
function call(proxyPort, userIp, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: proxyPort, localAddress: userIp, path, method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const U = (n) => `127.0.0.${n + 1}`;
const reqOtp = (px, ip, n, deviceId) => call(px, ip, { method: 'POST', path: '/api/users/request-otp', body: { phone: `+3460000${String(n).padStart(4, '0')}`, recaptcha_token: 'dev', device_id: deviceId } });
async function withStack(fastifyOpts, mode, fn) {
  const api = await startApi(fastifyOpts); const proxy = await startProxy(api.server.address().port, mode);
  try { return await fn(proxy.address().port); } finally { proxy.close(); await api.close(); }
}
const ipinfo = (px, ip, xff) => call(px, ip, { path: '/api/ipinfo', headers: xff ? { 'x-forwarded-for': xff } : {} });
const ipapiTarget = () => rec.fetchUrls.find(u => u.startsWith('https://ipapi.co/'));
test.beforeEach(() => { rec.ipHashes.length = 0; rec.fetchUrls.length = 0; rec.sms = 0; db.devices.clear(); });

// ── H-A ─────────────────────────────────────────────────────────────────────
test('A1 DEFECTO (configuración actual, sin trustProxy): 6 usuarios distintos, 1 petición cada uno -> el 6.º recibe 429 y todos comparten un único ip_hash', async () => {
  await withStack({}, 'overwrite', async (px) => {
    const res = [];
    for (let i = 1; i <= 6; i++) res.push((await reqOtp(px, U(i), i, `device-user-000${i}`)).status);
    assert.deepEqual(res, [200, 200, 200, 200, 200, 429], 'el límite de 5/5 min de la ruta se agota con 5 PERSONAS distintas');
    assert.equal(new Set(rec.ipHashes).size, 1, 'check_otp_rate_limit recibe el mismo ip_hash para todos (límite SQL de 10/hora compartido por todo el servicio)');
  });
});

test('B1 DEFECTO (configuración actual): con un borde que AÑADE, el primer valor de X-Forwarded-For lo elige el cliente y llega al servicio de geolocalización', async () => {
  await withStack({}, 'append', async (px) => {
    await ipinfo(px, U(1), '8.8.8.8');
    assert.equal(ipapiTarget(), 'https://ipapi.co/8.8.8.8/json/', 'el cliente decide la IP que se geolocaliza');
    rec.fetchUrls.length = 0;
    await ipinfo(px, U(1), '1.2.3.4/../../x?q=');
    assert.match(ipapiTarget(), /1\.2\.3\.4\/\.\.\/\.\.\/x\?q=/, 'sin validar: el valor del cliente entra en la ruta de la URL saliente');
  });
});

test('B2 /join: con un borde que AÑADE, la IP que se geolocaliza (y de la que sale la señal «IP country» de fiabilidad) la elige el cliente (configuración actual)', async () => {
  await withStack({}, 'append', async (px) => {
    const v = await call(px, U(1), { method: 'POST', path: '/api/users/verify-otp', body: { phone: '+34600000001', otp: '123456', device_id: 'device-join-0001' } });
    assert.equal(v.status, 200);
    rec.fetchUrls.length = 0;
    const j = await call(px, U(1), { method: 'POST', path: `/api/protests/${GLOBAL_PROTEST}/join`, headers: { 'x-forwarded-for': '203.0.113.77' }, body: { participation_token: v.json.participation_token, recaptcha_token: 'dev' } });
    assert.equal(j.status, 201);
    assert.equal(ipapiTarget(), 'https://ipapi.co/203.0.113.77/json/');
  });
});

test('B4 con un borde que REEMPLAZA (lo que afirma el moderador de Railway) la cabecera no es suplantable en la configuración actual', async () => {
  await withStack({}, 'overwrite', async (px) => {
    rec.fetchUrls.length = 0;
    await ipinfo(px, U(2), '8.8.8.8');
    assert.equal(ipapiTarget(), `https://ipapi.co/${U(2)}/json/`);
  });
});

