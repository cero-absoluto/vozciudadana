// lib/recaptcha.js — disponibilidad: una verificación de reCAPTCHA que no responde no debe dejar la petición colgada. Sin red: fetch simulado, datos sintéticos.
// Run: node --test tests/recaptcha-availability.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as rc from '../apps/api/src/lib/recaptcha.js';

const SECRET = 'synthetic-secret-do-not-use';
const reply = () => { const calls = []; const mk = (n) => (m) => { calls.push([n, m]); }; return { calls, badRequest: mk('badRequest'), internalServerError: mk('internalServerError'), serviceUnavailable: mk('serviceUnavailable') }; };
const reqLog = () => { const logs = []; return { logs, log: { warn: (o, m) => logs.push([o, m]) } }; };
const withEnv = (t, env) => { const old = {}; for (const [k, v] of Object.entries(env)) { old[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }); };
const HUNG = Symbol('hung');
const settle = (p, ms = 1500) => Promise.race([p.then(() => 'resolved', (e) => e), new Promise((r) => setTimeout(() => r(HUNG), ms))]);
// fetch simulado que no responde nunca, salvo que se le pase una señal de cancelación (como hace el fetch real)
const hangingFetch = (init) => new Promise((_, rej) => { if (init?.signal) init.signal.addEventListener('abort', () => rej(init.signal.reason ?? new DOMException('aborted', 'AbortError'))); });
const okFetch = (json, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const GOOD = { success: true, action: 'join_protest', hostname: 'voiceprotest.org', score: 0.9 };

test('RA1 un reCAPTCHA que no responde acaba en error 503 (serviceUnavailable) y la petición falla cerrada (no queda colgada)', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: SECRET, NODE_ENV: 'test', RECAPTCHA_TIMEOUT_MS: '50' });
  t.mock.method(globalThis, 'fetch', async (_url, init) => hangingFetch(init));
  const r = reply(); const out = await settle(rc.verifyRecaptcha('tok', 'join_protest', reqLog(), r));
  assert.notEqual(out, HUNG, 'la verificación quedó colgada: sin tiempo máximo');
  assert.equal(out?.message, 'recaptcha_unavailable'); assert.deepEqual(r.calls.map((c) => c[0]), ['serviceUnavailable']);
});
test('RA2 errores de red, respuesta no JSON o HTTP no 2xx → serviceUnavailable y fallo cerrado, nunca pasa', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: SECRET, NODE_ENV: 'test' });
  const cases = { red: async () => { throw new TypeError('fetch failed'); }, 'no JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }), 'HTTP 500': okFetch({}, 500), 'HTTP 429': okFetch({ success: true }, 429) };
  for (const [name, impl] of Object.entries(cases)) {
    t.mock.method(globalThis, 'fetch', impl); const r = reply(); const out = await settle(rc.verifyRecaptcha('tok', 'join_protest', reqLog(), r));
    assert.equal(out?.message, 'recaptcha_unavailable', name); assert.deepEqual(r.calls.map((c) => c[0]), ['serviceUnavailable'], name); t.mock.restoreAll();
  }
});
test('RA3 la petición lleva una señal de cancelación y el límite sale de RECAPTCHA_TIMEOUT_MS (5 s por defecto, acotado)', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: SECRET, NODE_ENV: 'test' });
  let init; t.mock.method(globalThis, 'fetch', async (_u, i) => { init = i; return okFetch(GOOD)(); });
  await rc.verifyRecaptcha('tok', 'join_protest', reqLog(), reply()); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.method, 'POST');
  for (const [v, want] of [[undefined, 5000], ['', 5000], ['abc', 5000], ['0', 5000], ['-5', 5000], ['1.5', 5000], ['100000', 5000], ['1', 1], ['250', 250], ['30000', 30000]]) assert.equal(rc.recaptchaTimeoutMs({ RECAPTCHA_TIMEOUT_MS: v }), want, String(v));
});
test('RA4 el camino correcto y los rechazos existentes no cambian', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: SECRET, NODE_ENV: 'test' });
  t.mock.method(globalThis, 'fetch', okFetch(GOOD)); let r = reply(); assert.equal(await settle(rc.verifyRecaptcha('tok', 'join_protest', reqLog(), r)), 'resolved'); assert.equal(r.calls.length, 0);
  const bad = { 'token inválido': { success: false, 'error-codes': ['invalid-input-response'] }, 'acción distinta': { ...GOOD, action: 'otra' }, 'hostname ajeno': { ...GOOD, hostname: 'evil.example' }, 'puntuación baja': { ...GOOD, score: 0.1 } };
  for (const [name, json] of Object.entries(bad)) { t.mock.method(globalThis, 'fetch', okFetch(json)); r = reply(); const out = await settle(rc.verifyRecaptcha('tok', 'join_protest', reqLog(), r)); assert.equal(out?.message, 'recaptcha', name); assert.deepEqual(r.calls.map((c) => c[0]), ['badRequest'], name); t.mock.restoreAll(); }
});
test('RA5 sin secreto: en producción falla cerrado (500); fuera de producción se omite con aviso (comportamiento previo)', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: undefined, NODE_ENV: 'production' }); t.mock.method(globalThis, 'fetch', async () => { throw new Error('no debe llamarse'); });
  let r = reply(); assert.equal((await settle(rc.verifyRecaptcha('tok', 'x', reqLog(), r)))?.message, 'recaptcha_not_configured'); assert.deepEqual(r.calls.map((c) => c[0]), ['internalServerError']);
  process.env.NODE_ENV = 'test'; t.mock.method(console, 'warn', () => {}); r = reply(); assert.equal(await settle(rc.verifyRecaptcha('tok', 'x', reqLog(), r)), 'resolved'); assert.equal(r.calls.length, 0);
});
test('RA6 los registros del fallo no filtran el secreto (la URL de verificación lo lleva en la consulta) ni el token', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: SECRET, NODE_ENV: 'test', RECAPTCHA_TIMEOUT_MS: '30' });
  t.mock.method(globalThis, 'fetch', async (url, init) => { const e = new TypeError(`fetch failed ${url}`); await new Promise((r) => setTimeout(r, 5)); throw e; });
  const lg = reqLog(); const warns = []; t.mock.method(console, 'warn', (...a) => warns.push(a));
  await settle(rc.verifyRecaptcha('USER-TOKEN-123', 'join_protest', lg, reply())); const dump = JSON.stringify([lg.logs, warns]);
  assert.ok(!dump.includes(SECRET) && !dump.includes('USER-TOKEN-123') && !dump.includes('secret='), dump); assert.ok(lg.logs.length >= 1, 'se registra el fallo (solo el tipo de error)');
});
test('RA7 integración con Fastify real y @fastify/sensible: la ruta falla cerrada con 5xx en el plazo, sin quedar colgada ni filtrar el secreto', async (t) => {
  withEnv(t, { RECAPTCHA_SECRET: SECRET, NODE_ENV: 'test', RECAPTCHA_TIMEOUT_MS: '50' });
  const { default: Fastify } = await import('fastify'); const { default: sensible } = await import('@fastify/sensible');
  const app = Fastify(); await app.register(sensible);
  app.setErrorHandler((err, req, reply) => { const status = err.statusCode ?? 500; if (reply.sent) return; if (status < 500) return reply.status(status).send({ error: err.message }); reply.status(500).send({ error: 'Internal server error' }); });
  app.post('/probe', async (req, reply) => { await rc.verifyRecaptcha(req.body?.t, 'join_protest', req, reply); return { ok: true }; });
  t.after(() => app.close()); t.mock.method(globalThis, 'fetch', async (_u, init) => hangingFetch(init));
  const t0 = Date.now(); const res = await Promise.race([app.inject({ method: 'POST', url: '/probe', payload: { t: 'x' } }), new Promise((r) => setTimeout(() => r(HUNG), 1500))]);
  assert.notEqual(res, HUNG, 'petición colgada'); assert.ok(res.statusCode >= 500, `fallo cerrado: ${res.statusCode}`); assert.ok(Date.now() - t0 < 1000); /* server.js colapsa todo >=500 en 500 'Internal server error' en su manejador central: el cliente ve 500 aunque aquí se pida 503; cambiar ese manejador queda fuera de esta mejora */ assert.ok(!res.body.includes(SECRET));
  t.mock.method(globalThis, 'fetch', okFetch(GOOD)); const ok = await app.inject({ method: 'POST', url: '/probe', payload: { t: 'x' } }); assert.equal(ok.statusCode, 200);
});
