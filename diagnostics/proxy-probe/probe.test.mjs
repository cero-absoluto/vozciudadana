import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProbe, peerClass } from './server.js';

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const get = (port, path, headers = {}) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ code: r.statusCode, body: JSON.parse(b), raw: b }));
  }).on('error', rej);
});
// Proxy sintético: overwrite = fija XFF al cliente; append = añade al existente.
const proxy = (apiPort, mode) => http.createServer((q, s) => {
  const h = { ...q.headers };
  const client = '203.0.113.9';
  h['x-forwarded-for'] = mode === 'append' && h['x-forwarded-for'] ? `${h['x-forwarded-for']}, ${client}` : client;
  const u = http.request({ host: '127.0.0.1', port: apiPort, path: q.url, headers: h }, (r) => { s.writeHead(r.statusCode, r.headers); r.pipe(s); });
  q.pipe(u);
});

test('peerClass', () => {
  assert.equal(peerClass('100.64.0.5'), 'cgnat');
  assert.equal(peerClass('::ffff:10.1.2.3'), 'private');
  assert.equal(peerClass('127.0.0.1'), 'loopback');
  assert.equal(peerClass('8.8.8.8'), 'public');
  assert.equal(peerClass(undefined), 'unknown');
});

test('directo: marcador en XFF aparece primero y último, longitud 1', async () => {
  const a = createProbe(); const p = await listen(a);
  const r = await get(p, '/probe?m=192.0.2.1', { 'x-forwarded-for': '192.0.2.1' });
  assert.equal(r.body.xffLength, 1); assert.ok(r.body.xffFirstIsMarker && r.body.xffLastIsMarker);
  assert.equal(r.body.peerClass, 'loopback'); a.close();
});

test('overwrite: el marcador del cliente se descarta', async () => {
  const a = createProbe(); const ap = await listen(a); const x = proxy(ap, 'overwrite'); const xp = await listen(x);
  const r = await get(xp, '/probe?m=192.0.2.1', { 'x-forwarded-for': '192.0.2.1, 198.51.100.7' });
  assert.equal(r.body.xffLength, 1); assert.equal(r.body.xffContainsMarker, false); a.close(); x.close();
});

test('append: marcador queda primero, no último', async () => {
  const a = createProbe(); const ap = await listen(a); const x = proxy(ap, 'append'); const xp = await listen(x);
  const r = await get(xp, '/probe?m=192.0.2.1', { 'x-forwarded-for': '192.0.2.1, 198.51.100.7' });
  assert.equal(r.body.xffLength, 3); assert.ok(r.body.xffFirstIsMarker); assert.equal(r.body.xffLastIsMarker, false); a.close(); x.close();
});

test('no devuelve IPs ni cabeceras', async () => {
  const a = createProbe(); const p = await listen(a);
  const r = await get(p, '/probe?m=192.0.2.1', { 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.8' });
  assert.ok(!/192\.0\.2|198\.51|127\.0\.0/.test(r.raw)); a.close();
});

test('marcador inválido, ruta desconocida y presupuesto agotado', async () => {
  const a = createProbe({ maxRequests: 2 }); const p = await listen(a);
  assert.equal((await get(p, '/probe?m=abc%3Cx')).code, 400);
  assert.equal((await get(p, '/otra')).code, 404);
  assert.equal((await get(p, '/probe?m=192.0.2.1')).code, 200);
  assert.equal((await get(p, '/probe?m=192.0.2.1')).code, 410);
  assert.equal((await get(p, '/health')).code, 200);
  a.close();
});
