// Diagnóstico temporal de cabeceras de proxy. Sin dependencias, sin variables,
// sin base de datos, sin registro de peticiones. Nunca devuelve IPs ni cabeceras:
// solo clase del peer, longitud de X-Forwarded-For y booleanos frente a un
// marcador sintético y una referencia (la IP de salida del cliente de prueba,
// cabecera X-Probe-Ref) que envía quien prueba; de la referencia solo se
// conserva un booleano de comparación, nunca se devuelve ni se registra.
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

const INTERNAL = new Set(['loopback', 'cgnat', 'private', 'link_local']);
// Clasificación prudente. Un salto solo se da por justificado con exactamente una
// entrada, peer interno y coincidencia con la IP de salida conocida del cliente.
// Cero entradas nunca es éxito; varias entradas se informan sin dar un salto por
// justificado (un borde que añade al final puede ser compatible con #31, pero lo
// decide una persona).
export function classify({ peer, length, refPresent, lastIsRef }) {
  let classification;
  if (length === 0) classification = 'header_absent_or_removed';
  else if (!refPresent) classification = 'reference_missing';
  else if (length === 1) classification = lastIsRef ? 'single_entry_matches_client' : 'single_entry_not_client';
  else classification = 'chain_observed';
  return {
    classification,
    oneHopJustified: INTERNAL.has(peer) && length === 1 && refPresent && lastIsRef,
  };
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
    const refRaw = req.headers['x-probe-ref'];
    const ref = typeof refRaw === 'string' && MARKER.test(refRaw.trim()) ? refRaw.trim() : null;
    const last = entries.length ? entries[entries.length - 1] : null;
    const lastIsRef = ref !== null && last === ref;
    const peer = peerClass(req.socket.remoteAddress);
    send(200, { ...classify({ peer, length: entries.length, refPresent: ref !== null, lastIsRef }),
      peerClass: peer,
      xffLength: entries.length,
      xffFirstIsMarker: entries[0] === m,
      xffLastIsMarker: last === m,
      xffContainsMarker: entries.includes(m),
      refPresent: ref !== null,
      xffLastIsClientRef: lastIsRef,
      xRealIpPresent: realIp !== undefined,
      xRealIpIsMarker: realIp === m,
      xRailwayEdgePresent: req.headers['x-railway-edge'] !== undefined,
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createProbe().listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}
