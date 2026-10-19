// Diagnóstico temporal de cabeceras de proxy. Sin dependencias, sin variables,
// sin base de datos, sin registro de peticiones. Nunca devuelve IPs ni cabeceras:
// solo clase del peer, longitud de X-Forwarded-For y booleanos frente a un
// marcador sintético que envía quien prueba.
import http from 'node:http';
import net from 'node:net';

const CLASSES = [
  ['loopback', ['127.0.0.0/8'], ['::1/128']],
  ['cgnat', ['100.64.0.0/10'], []],
  ['private', ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'], ['fc00::/7']],
  ['link_local', ['169.254.0.0/16'], ['fe80::/10']],
];
const lists = CLASSES.map(([name, v4, v6]) => {
  const l = new net.BlockList();
  for (const c of v4) { const [a, p] = c.split('/'); l.addSubnet(a, Number(p), 'ipv4'); }
  for (const c of v6) { const [a, p] = c.split('/'); l.addSubnet(a, Number(p), 'ipv6'); }
  return [name, l];
});

export function peerClass(address) {
  if (typeof address !== 'string') return 'unknown';
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  const fam = net.isIP(a);
  if (!fam) return 'unknown';
  for (const [name, l] of lists) if (l.check(a, fam === 4 ? 'ipv4' : 'ipv6')) return name;
  return 'public';
}

const MARKER = /^[0-9a-fA-F.:]{3,45}$/;
const MAX_REQUESTS = 300;

export function createProbe({ maxRequests = MAX_REQUESTS } = {}) {
  let served = 0;
  return http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(200, { ok: true });
    if (url.pathname !== '/probe') return send(404, { error: 'not_found' });
    if (++served > maxRequests) return send(410, { error: 'request_budget_exhausted' });
    const m = url.searchParams.get('m');
    if (!m || !MARKER.test(m)) return send(400, { error: 'marker_required' });
    const raw = req.headers['x-forwarded-for'];
    const entries = (Array.isArray(raw) ? raw.join(',') : raw ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const realIp = req.headers['x-real-ip'];
    send(200, {
      peerClass: peerClass(req.socket.remoteAddress),
      xffLength: entries.length,
      xffFirstIsMarker: entries[0] === m,
      xffLastIsMarker: entries.length > 0 && entries[entries.length - 1] === m,
      xffContainsMarker: entries.includes(m),
      xRealIpPresent: realIp !== undefined,
      xRealIpIsMarker: realIp === m,
      xRailwayEdgePresent: req.headers['x-railway-edge'] !== undefined,
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createProbe().listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}
