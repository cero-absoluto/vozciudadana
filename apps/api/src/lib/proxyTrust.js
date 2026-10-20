// ── Client IP behind Railway's edge proxy ───────────────────────────────────
// Without any handling, Fastify's `req.ip` is the address of whatever opened the
// TCP connection — behind Railway, the edge proxy — so every user shares a few
// IPs: @fastify/rate-limit keys (global 120/min, request-otp 5/5 min, …) and the
// `ip_hash` that check_otp_rate_limit counts (10/hour) become service-wide limits
// (reproduced locally in tests/ip-proxy-trust.mjs). The previous code read
// X-Forwarded-For[0] by hand, which the client controls if the edge appends.
//
// What this does: `req.clientIp` is
//   • X-Real-IP, when (a) the TCP peer is an INTERNAL address (loopback, RFC 1918,
//     100.64.0.0/10 CGNAT, link-local, ULA) and (b) the header is exactly one valid
//     IP address; otherwise
//   • the TCP peer address itself (fail-closed: a caller reaching the origin from
//     a PUBLIC address is never believed, and its headers are ignored).
// X-Forwarded-For is never read: no hop count is guessed (a synthetic probe through
// Railway showed a 2-entry chain whose entries could not be tied to the client).
//
// Why X-Real-IP: it is the only client-address header Railway documents
// (docs.railway.com/networking/public-networking/specs-and-limits: "`X-Real-IP` for
// identifying client's remote IP"). WHAT RAILWAY DOES NOT GUARANTEE: the docs do not
// say that the edge replaces a copy sent by the caller, nor that it cannot be
// forged. The only statements are forum posts by a Railway moderator ("X-Real-IP and
// X-Forwarded-For are overwritten at Railway's edge", station.railway.com) — not a
// contract — and one user reports the opposite. The synthetic probe sent no
// X-Real-IP value, so it neither confirms nor refutes replacement. The proxy range is
// also stated as not stable, hence the address CLASS check instead of a CIDR list.
// KNOWN LIMIT: if the edge does not replace a caller-supplied X-Real-IP, a client can
// choose its own `clientIp` (test B5). Do not rely on `clientIp` alone for anything
// that needs unforgeability; the SQL/per-route limits are best-effort abuse brakes.
//
// CLIENT_IP_SOURCE (env): `x-real-ip` (default) or `peer` (ignore every header —
// unforgeable, but users sharing the edge peers share limits). `peer` is the
// switch-off if the replacement guarantee is found false in production.
//
// Every place that needs the client address uses `req.clientIp`; nothing reads
// X-Forwarded-For or X-Real-IP by hand, and Fastify's `trustProxy` stays off.

import net from 'node:net';

const INTERNAL = new net.BlockList();
for (const [addr, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16]]) INTERNAL.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['fc00::', 7], ['fe80::', 10]]) INTERNAL.addSubnet(addr, bits, 'ipv6');
INTERNAL.addAddress('::1', 'ipv6');

const unmap = (a) => {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  return m ? m[1] : a;
};

/** True only for loopback / private / CGNAT / link-local / ULA addresses. Anything else (or unparseable) is false. */
export function isInternalAddress(address) {
  if (typeof address !== 'string') return false;
  const a = unmap(address.trim());
  const family = net.isIP(a);
  if (!family) return false;
  return INTERNAL.check(a, family === 4 ? 'ipv4' : 'ipv6');
}

export function clientIpSource(env = process.env) {
  const raw = env.CLIENT_IP_SOURCE;
  if (raw === undefined || raw === '') return 'x-real-ip';
  if (raw !== 'x-real-ip' && raw !== 'peer') {
    throw new Error(`CLIENT_IP_SOURCE must be "x-real-ip" or "peer" (got "${raw}")`);
  }
  return raw;
}

/** Pure resolver: `peer` = TCP peer address, `realIp` = raw X-Real-IP header value (string | string[] | undefined). */
export function resolveClientIp({ peer, realIp }, source = 'x-real-ip') {
  const peerAddr = typeof peer === 'string' ? unmap(peer.trim()) : peer;
  if (source !== 'x-real-ip' || !isInternalAddress(peerAddr)) return peerAddr;
  if (typeof realIp !== 'string') return peerAddr; // absent or repeated header
  const v = unmap(realIp.trim());
  return net.isIP(v) ? v : peerAddr; // exactly one valid address, else fail closed
}

/** Fastify plugin (use with fastify-plugin semantics: registered directly on the root instance). Adds `req.clientIp`. */
export function registerClientIp(app, env = process.env) {
  const source = clientIpSource(env);
  app.decorateRequest('clientIp', {
    getter() {
      return resolveClientIp({ peer: this.socket?.remoteAddress, realIp: this.headers['x-real-ip'] }, source);
    },
  });
}
