// Cliente real detrás de un proxy — reproducción LOCAL y SINTÉTICA (sin red, sin producción, sin SMS, sin Railway).
// Run: node --experimental-test-module-mocks --test tests/ip-proxy-trust.mjs
//
// La demostración del defecto sobre el código anterior queda en el commit ad73539 de esta rama (A1, B1, B2, B4 pasan allí).
// Fuente de la IP: X-Real-IP (única cabecera de IP de cliente que documenta Railway) solo si el par TCP es interno; si no, el par.
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
delete process.env.RECAPTCHA_SECRET; delete process.env.NODE_ENV; delete process.env.CLIENT_IP_SOURCE;

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

// Misma composición que server.js (decorador req.clientIp + rate-limit global con la misma clave + rutas reales).
const { registerClientIp } = await import('../apps/api/src/lib/proxyTrust.js');
async function startApi(env = {}) {
  const app = Fastify();
  registerClientIp(app, env);
  await app.register(sensible);
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute', keyGenerator: (req) => req.clientIp });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(protestRoutes, { prefix: '/api/protests' });
  await app.register(ipinfoRoutes, { prefix: '/api/ipinfo' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}
// Proxy local que imita al borde. mode: 'overwrite' (sustituye XFF y X-Real-IP por la IP del cliente),
// 'xff-only' (solo escribe XFF añadiendo a la derecha; no toca X-Real-IP), 'passthrough' (no toca nada).
function startProxy(apiPort, mode) {
  const srv = http.createServer((creq, cres) => {
    const client = creq.socket.remoteAddress.replace('::ffff:', '');
    const h = { ...creq.headers };
    if (mode === 'overwrite') { h['x-forwarded-for'] = client; h['x-real-ip'] = client; }
    if (mode === 'xff-only') h['x-forwarded-for'] = h['x-forwarded-for'] ? `${h['x-forwarded-for']}, ${client}` : client;
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
async function withStack(env, mode, fn) {
  const api = await startApi(env); const proxy = await startProxy(api.server.address().port, mode);
  try { return await fn(proxy.address().port); } finally { proxy.close(); await api.close(); }
}
test.beforeEach(() => { rec.ipHashes.length = 0; rec.fetchUrls.length = 0; rec.sms = 0; db.devices.clear(); });

// ── H-A: límites compartidos ────────────────────────────────────────────────
test('A1 Con CLIENT_IP_SOURCE=peer (equivale a la situación ANTERIOR: se ignoran las cabeceras): 6 usuarios distintos -> el 6.º recibe 429 y todos comparten un único ip_hash', async () => {
  await withStack({ CLIENT_IP_SOURCE: 'peer' }, 'overwrite', async (px) => {
    const res = [];
    for (let i = 1; i <= 6; i++) res.push((await reqOtp(px, U(i), i, `device-user-000${i}`)).status);
    assert.deepEqual(res, [200, 200, 200, 200, 200, 429], 'el límite de 5/5 min de la ruta se agota con 5 PERSONAS distintas');
    assert.equal(new Set(rec.ipHashes).size, 1, 'check_otp_rate_limit recibe el mismo ip_hash para todos');
  });
});

test('A2 CORRECCIÓN (X-Real-IP de un par interno): cada usuario tiene su propio límite y su propio ip_hash; el abuso de UN usuario sigue limitado', async () => {
  await withStack({}, 'overwrite', async (px) => {
    const res = [];
    for (let i = 1; i <= 6; i++) res.push((await reqOtp(px, U(i), i, `device-user-000${i}`)).status);
    assert.deepEqual(res, [200, 200, 200, 200, 200, 200]);
    assert.equal(new Set(rec.ipHashes).size, 6, 'un ip_hash por usuario');
    const same = []; for (let k = 0; k < 6; k++) same.push((await reqOtp(px, U(9), 20 + k, `device-abuser-00${k}`)).status);
    assert.deepEqual(same, [200, 200, 200, 200, 200, 429], 'el mismo usuario agota SU límite (5/5 min)');
  });
});

// ── H-B: suplantación ───────────────────────────────────────────────────────
const ipinfo = (px, ip, headers = {}) => call(px, ip, { path: '/api/ipinfo', headers });
const ipapiTarget = () => rec.fetchUrls.find(u => u.startsWith('https://ipapi.co/'));

test('B3 Con un borde que REEMPLAZA X-Real-IP, lo que el cliente escriba en X-Real-IP / X-Forwarded-For no cuenta (ipinfo y /join)', async () => {
  await withStack({}, 'overwrite', async (px) => {
    await ipinfo(px, U(1), { 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '8.8.4.4' });
    assert.equal(ipapiTarget(), `https://ipapi.co/${U(1)}/json/`);
    const v = await call(px, U(1), { method: 'POST', path: '/api/users/verify-otp', body: { phone: '+34600000001', otp: '123456', device_id: 'device-join-0002' } });
    rec.fetchUrls.length = 0;
    await call(px, U(1), { method: 'POST', path: `/api/protests/${GLOBAL_PROTEST}/join`, headers: { 'x-forwarded-for': '203.0.113.77', 'x-real-ip': '203.0.113.78' }, body: { participation_token: v.json.participation_token, recaptcha_token: 'dev' } });
    assert.equal(ipapiTarget(), `https://ipapi.co/${U(1)}/json/`);
  });
});

test('B4 X-Forwarded-For nunca se lee: un borde que solo añade a XFF deja la dirección del par; el XFF del cliente no se usa', async () => {
  await withStack({}, 'xff-only', async (px) => {
    await ipinfo(px, U(2), { 'x-forwarded-for': '8.8.8.8' });
    assert.equal(ipapiTarget(), 'https://ipapi.co/127.0.0.1/json/', 'par (proxy), no 8.8.8.8 ni la IP del cliente: sin X-Real-IP se falla cerrado');
  });
});

test('B5 LÍMITE DECLARADO: si el borde NO reemplaza un X-Real-IP enviado por el cliente (Railway no lo garantiza), el cliente elige su clientIp; la corrección no lo arregla y no lo pretende', async () => {
  await withStack({}, 'passthrough', async (px) => {
    await ipinfo(px, U(1), { 'x-real-ip': '8.8.8.8' });
    assert.equal(ipapiTarget(), 'https://ipapi.co/8.8.8.8/json/');
  });
  rec.fetchUrls.length = 0;
  await withStack({ CLIENT_IP_SOURCE: 'peer' }, 'passthrough', async (px) => {
    await ipinfo(px, U(1), { 'x-real-ip': '8.8.8.8' });
    assert.equal(ipapiTarget(), 'https://ipapi.co/127.0.0.1/json/', 'CLIENT_IP_SOURCE=peer anula la falsificación (a costa de compartir límites)');
  });
});

// ── Cableado y configuración ────────────────────────────────────────────────
test('C1 ningún sitio lee cabeceras de IP a mano; server.js usa req.clientIp, sin trustProxy, y el rate-limit usa la misma clave', () => {
  for (const f of ['routes/users.js', 'routes/institucional.js', 'routes/geocode.js', 'routes/protests.js']) {
    const src = fs.readFileSync(new URL(`../apps/api/src/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /x-forwarded-for|x-real-ip/i, f);
    assert.doesNotMatch(src, /req\.ip\b/, f);
  }
  const server = fs.readFileSync(new URL('../apps/api/src/server.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.match(server, /registerClientIp\(app\)/);
  assert.match(server, /keyGenerator:\s*\(req\)\s*=>\s*req\.clientIp/);
  assert.doesNotMatch(server, /trustProxy/);
});

test('C2 CLIENT_IP_SOURCE: por defecto x-real-ip; peer válido; cualquier otro valor aborta el arranque', async () => {
  const { clientIpSource } = await import('../apps/api/src/lib/proxyTrust.js');
  assert.equal(clientIpSource({}), 'x-real-ip'); assert.equal(clientIpSource({ CLIENT_IP_SOURCE: '' }), 'x-real-ip');
  assert.equal(clientIpSource({ CLIENT_IP_SOURCE: 'peer' }), 'peer');
  for (const bad of ['xff', 'X-Real-IP', 'true', '1', 'x-forwarded-for']) assert.throws(() => clientIpSource({ CLIENT_IP_SOURCE: bad }), /CLIENT_IP_SOURCE/, bad);
});

// ── Resolución pura: el par debe ser interno, la cabecera exactamente una IP válida ──
test('D1 un par PÚBLICO no se cree: X-Real-IP se ignora y clientIp es su dirección', async () => {
  const { resolveClientIp } = await import('../apps/api/src/lib/proxyTrust.js');
  for (const peer of ['8.8.8.8', '203.0.113.9', '2001:db8::5', '::ffff:8.8.8.8']) assert.equal(resolveClientIp({ peer, realIp: '1.2.3.4' }), peer.replace('::ffff:', ''), peer);
});
test('D2 un par INTERNO (CGNAT/privado/loopback) con X-Real-IP válida: se usa; ausente, repetida, mal formada o con lista: se falla cerrado al par', async () => {
  const { resolveClientIp } = await import('../apps/api/src/lib/proxyTrust.js');
  for (const peer of ['100.64.1.2', '10.0.0.7', '172.20.1.1', '192.168.5.5', '127.0.0.1', 'fd12::9', '::ffff:100.64.1.2']) {
    assert.equal(resolveClientIp({ peer, realIp: '9.9.9.9' }), '9.9.9.9', peer);
    assert.equal(resolveClientIp({ peer, realIp: '2001:db8::9' }), '2001:db8::9', peer);
  }
  const peer = '100.64.1.2';
  for (const bad of [undefined, ['9.9.9.9', '8.8.8.8'], '9.9.9.9, 8.8.8.8', 'abc', '', ' ', '999.1.1.1', '9.9.9.9:80']) {
    assert.equal(resolveClientIp({ peer, realIp: bad }), peer, JSON.stringify(bad));
  }
  assert.equal(resolveClientIp({ peer, realIp: '9.9.9.9' }, 'peer'), peer, 'source=peer ignora la cabecera');
  assert.equal(resolveClientIp({ peer: undefined, realIp: '9.9.9.9' }), undefined);
});
test('D2b integración: req.clientIp sobre un servidor Fastify real (inject) sigue la misma regla y trustProxy no interviene', async () => {
  const app = Fastify({ trustProxy: true }); // aunque alguien lo activara, clientIp no lee XFF
  registerClientIp(app);
  app.get('/ip', async (req) => ({ ip: req.clientIp }));
  await app.ready();
  const get = async (remoteAddress, headers) => (await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers })).json().ip;
  assert.equal(await get('100.64.1.2', { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }), '9.9.9.9');
  assert.equal(await get('100.64.1.2', { 'x-forwarded-for': '1.1.1.1' }), '100.64.1.2');
  assert.equal(await get('8.8.8.8', { 'x-real-ip': '9.9.9.9' }), '8.8.8.8');
  await app.close();
});
test('D3 isInternalAddress: solo privadas/CGNAT/loopback/enlace local/ULA; públicas, mal formadas y no-cadenas son falsas', async () => {
  const { isInternalAddress } = await import('../apps/api/src/lib/proxyTrust.js');
  for (const a of ['127.0.0.1', '::1', '10.1.2.3', '172.16.5.5', '172.31.255.255', '192.168.1.1', '100.64.0.9', '100.127.255.255', '169.254.1.1', '::ffff:100.64.1.2', 'fd12::1', 'fe80::1']) assert.equal(isInternalAddress(a), true, a);
  for (const a of ['172.32.0.1', '100.128.0.1', '100.63.255.255', '8.8.8.8', '::ffff:8.8.8.8', '2001:db8::1', 'abc', '', '1.2.3', '999.1.1.1', undefined, null, 5, {}]) assert.equal(isInternalAddress(a), false, String(a));
});
