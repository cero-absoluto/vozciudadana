// Cliente real detrás de un proxy — reproducción LOCAL y SINTÉTICA (sin red, sin producción, sin SMS, sin Railway).
// Run: node --experimental-test-module-mocks --test tests/ip-proxy-trust.mjs
//
// La demostración del defecto sobre el código anterior queda en el commit previo de esta rama (A1, B1, B2, B4 pasan allí).
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
test.beforeEach(() => { rec.ipHashes.length = 0; rec.fetchUrls.length = 0; rec.sms = 0; db.devices.clear(); });

// ── H-A ─────────────────────────────────────────────────────────────────────
test('A1 Sin trustProxy (la configuración ANTERIOR a esta corrección; sigue siendo lo que ocurre si se desactiva con TRUST_PROXY_HOPS=0): 6 usuarios distintos, 1 petición cada uno -> el 6.º recibe 429 y todos comparten un único ip_hash', async () => {
  await withStack({}, 'overwrite', async (px) => {
    const res = [];
    for (let i = 1; i <= 6; i++) res.push((await reqOtp(px, U(i), i, `device-user-000${i}`)).status);
    assert.deepEqual(res, [200, 200, 200, 200, 200, 429], 'el límite de 5/5 min de la ruta se agota con 5 PERSONAS distintas');
    assert.equal(new Set(rec.ipHashes).size, 1, 'check_otp_rate_limit recibe el mismo ip_hash para todos (límite SQL de 10/hora compartido por todo el servicio)');
  });
});

test('A2 CORRECCIÓN (trustProxy = 1 salto): cada usuario tiene su propio límite y su propio ip_hash; el abuso de UN usuario sigue limitado', async () => {
  const { fastifyTrustProxy } = await import('../apps/api/src/lib/proxyTrust.js');
  await withStack({ trustProxy: fastifyTrustProxy() }, 'overwrite', async (px) => {
    const res = [];
    for (let i = 1; i <= 6; i++) res.push((await reqOtp(px, U(i), i, `device-user-000${i}`)).status);
    assert.deepEqual(res, [200, 200, 200, 200, 200, 200]);
    assert.equal(new Set(rec.ipHashes).size, 6, 'un ip_hash por usuario');
    const same = []; for (let k = 0; k < 6; k++) same.push((await reqOtp(px, U(9), 20 + k, `device-abuser-00${k}`)).status);
    assert.deepEqual(same, [200, 200, 200, 200, 200, 429], 'el mismo usuario agota SU límite (5/5 min)');
  });
});

// ── H-B ─────────────────────────────────────────────────────────────────────
const ipinfo = (px, ip, xff) => call(px, ip, { path: '/api/ipinfo', headers: xff ? { 'x-forwarded-for': xff } : {} });
const ipapiTarget = () => rec.fetchUrls.find(u => u.startsWith('https://ipapi.co/'));

test('B3 CORRECCIÓN: con 1 salto de confianza el valor que se usa es la IP que añadió el proxy, no lo que el cliente antepuso (ipinfo y /join)', async () => {
  const { fastifyTrustProxy } = await import('../apps/api/src/lib/proxyTrust.js');
  await withStack({ trustProxy: fastifyTrustProxy() }, 'append', async (px) => {
    await ipinfo(px, U(1), '8.8.8.8');
    assert.equal(ipapiTarget(), `https://ipapi.co/${U(1)}/json/`);
    const v = await call(px, U(1), { method: 'POST', path: '/api/users/verify-otp', body: { phone: '+34600000001', otp: '123456', device_id: 'device-join-0002' } });
    rec.fetchUrls.length = 0;
    await call(px, U(1), { method: 'POST', path: `/api/protests/${GLOBAL_PROTEST}/join`, headers: { 'x-forwarded-for': '203.0.113.77' }, body: { participation_token: v.json.participation_token, recaptcha_token: 'dev' } });
    assert.equal(ipapiTarget(), `https://ipapi.co/${U(1)}/json/`);
  });
});

test('B4 con un borde que REEMPLAZA (lo que afirma el moderador de Railway) la corrección tampoco es suplantable y usa la IP del cliente', async () => {
  const { fastifyTrustProxy } = await import('../apps/api/src/lib/proxyTrust.js');
  await withStack({ trustProxy: fastifyTrustProxy() }, 'overwrite', async (px) => {
    rec.fetchUrls.length = 0;
    await ipinfo(px, U(2), '8.8.8.8');
    assert.equal(ipapiTarget(), `https://ipapi.co/${U(2)}/json/`);
  });
});

test('B5 LÍMITE DECLARADO: si NADIE reescribe la cabecera (passthrough) la app no puede distinguir; la corrección no lo arregla y no lo pretende', async () => {
  const { fastifyTrustProxy } = await import('../apps/api/src/lib/proxyTrust.js');
  await withStack({ trustProxy: fastifyTrustProxy() }, 'passthrough', async (px) => {
    await ipinfo(px, U(1), '8.8.8.8');
    assert.equal(ipapiTarget(), 'https://ipapi.co/8.8.8.8/json/', 'borde que no escribe nada = frontera de confianza inexistente (decisión de infraestructura, no de aplicación)');
  });
});

// ── Cableado y configuración ────────────────────────────────────────────────
test('C1 ningún sitio lee ya x-forwarded-for a mano y server.js usa la configuración común', () => {
  for (const f of ['routes/users.js', 'routes/institucional.js', 'routes/geocode.js', 'routes/protests.js']) {
    const src = fs.readFileSync(new URL(`../apps/api/src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /x-forwarded-for/i, f);
  }
  const server = fs.readFileSync(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  assert.match(server, /trustProxy:\s*fastifyTrustProxy\(\)/);
});

test('C2 TRUST_PROXY_HOPS: por defecto 1; valores válidos 0..5; inválidos abortan el arranque', async () => {
  const { trustProxyHops, fastifyTrustProxy } = await import('../apps/api/src/lib/proxyTrust.js');
  assert.equal(trustProxyHops({}), 1); assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '' }), 1);
  assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: '2' }), 2); assert.equal(fastifyTrustProxy({ TRUST_PROXY_HOPS: '0' }), false); assert.equal(fastifyTrustProxy({ TRUST_PROXY_HOPS: '1' }), 1);
  for (const bad of ['-1', '6', '1.5', 'true', 'abc', '1e1']) assert.throws(() => trustProxyHops({ TRUST_PROXY_HOPS: bad }), /TRUST_PROXY_HOPS/, bad);
});
