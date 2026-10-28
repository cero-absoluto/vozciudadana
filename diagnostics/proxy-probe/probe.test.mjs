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
// Borde sintético. Cada salto fija o modifica XFF según `mode` usando la dirección
// de origen real de la conexión (127.0.0.N distingue cliente, salto 1 y salto 2).
const CLIENT = '127.0.0.5';
const hop = (target, mode, from) => http.createServer((q, s) => {
  const h = { ...q.headers };
  const peer = q.socket.remoteAddress.replace('::ffff:', '');
  const prior = h['x-forwarded-for'];
  if (mode === 'remove') delete h['x-forwarded-for'];
  else if (mode === 'overwrite') h['x-forwarded-for'] = peer;
  else if (mode === 'fixed') h['x-forwarded-for'] = '198.51.100.7';
  else if (mode === 'append') h['x-forwarded-for'] = prior ? `${prior}, ${peer}` : peer;
  const u = http.request({ host: '127.0.0.1', port: target, path: q.url, headers: h, localAddress: from },
    (r) => { s.writeHead(r.statusCode, r.headers); r.pipe(s); });
  q.pipe(u);
});
const call = (port, xff, ref = CLIENT) => new Promise((res, rej) => {
  const headers = { 'x-probe-ref': ref }; if (xff) headers['x-forwarded-for'] = xff;
  if (ref === null) delete headers['x-probe-ref'];
  http.get({ host: '127.0.0.1', port, path: '/probe?m=192.0.2.1', headers, localAddress: CLIENT }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ ...JSON.parse(b), _raw: b }));
  }).on('error', rej);
});
async function stack(modes) { // modes: lista de saltos de cliente a app
  const servers = []; const app = createProbe(); let port = await listen(app); servers.push(app);
  for (let i = modes.length - 1; i >= 0; i--) {
    const h = hop(port, modes[i], `127.0.0.${6 + i}`); port = await listen(h); servers.push(h);
  }
  return { port, close: () => servers.forEach((x) => x.close()) };
}
const CASES = {
  // [modos, XFF del cliente, clasificación, oneHopJustified, xffLength]
  'borde que sobrescribe (un salto, XFF de cliente descartado)': [['overwrite'], '192.0.2.1, 198.51.100.7', 'single_entry_matches_client', true, 1],
  'borde que añade a una entrada del cliente': [['append'], '192.0.2.1', 'chain_observed', false, 2],
  'cabecera eliminada (cero entradas no es éxito)': [['remove'], '192.0.2.1', 'header_absent_or_removed', false, 0],
  'valor reemplazado por otro distinto del cliente': [['fixed'], '192.0.2.1', 'single_entry_not_client', false, 1],
  'dos proxies que eliminan el marcador (cadena)': [['overwrite', 'append'], '192.0.2.1', 'chain_observed', false, 2],
  'dos proxies, el segundo sustituye: una entrada pero no es el cliente': [['overwrite', 'overwrite'], '192.0.2.1', 'single_entry_not_client', false, 1],
};
for (const [name, [modes, xff, cls, just, len]] of Object.entries(CASES)) {
  test(`caso: ${name}`, async () => {
    const st = await stack(modes);
    const r = await call(st.port, xff);
    assert.equal(r.classification, cls); assert.equal(r.oneHopJustified, just); assert.equal(r.xffLength, len);
    assert.ok(!/127\.0\.0|198\.51|192\.0\.2/.test(r._raw), 'no devuelve IPs');
    st.close();
  });
}

test('el marcador ausente no basta: eliminada y reemplazada dan xffContainsMarker=false sin justificar', async () => {
  for (const m of ['remove', 'fixed']) {
    const st = await stack([m]); const r = await call(st.port, '192.0.2.1');
    assert.equal(r.xffContainsMarker, false); assert.equal(r.oneHopJustified, false); st.close();
  }
});

test('un borde que añade al final: última entrada coincide con el cliente, informado sin justificar salto', async () => {
  const st = await stack(['append']); const r = await call(st.port, '192.0.2.1, 198.51.100.7');
  assert.equal(r.xffLength, 3); assert.equal(r.xffLastIsClientRef, true);
  assert.equal(r.classification, 'chain_observed'); assert.equal(r.oneHopJustified, false); st.close();
});

test('sin referencia no hay justificación', async () => {
  const st = await stack(['overwrite']); const r = await call(st.port, '192.0.2.1', null);
  assert.equal(r.classification, 'reference_missing'); assert.equal(r.oneHopJustified, false); st.close();
});

test('borde que no toca XFF (passthrough): con marcador no se justifica; la referencia nunca va en XFF', async () => {
  const st = await stack(['passthrough']); const r = await call(st.port, '192.0.2.1');
  assert.equal(r.classification, 'single_entry_not_client'); assert.equal(r.oneHopJustified, false);
  assert.equal(r.xffFirstIsMarker, true); st.close();
  // Límite documentado: si el probador pusiera la referencia en XFF y el borde no la tocara, se justificaría en falso.
  const st2 = await stack(['passthrough']); const bad = await call(st2.port, CLIENT);
  assert.equal(bad.oneHopJustified, true); st2.close();
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
