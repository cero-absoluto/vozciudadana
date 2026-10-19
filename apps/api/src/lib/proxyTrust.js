// ── Client IP behind Railway's edge proxy ───────────────────────────────────
// Without `trustProxy`, Fastify's `req.ip` is the address of whatever opened the
// TCP connection — behind Railway, the edge proxy — so every user shares one IP:
// @fastify/rate-limit keys (global 120/min, request-otp 5/5 min, …) and the
// `ip_hash` that check_otp_rate_limit counts (10/hour) became service-wide
// limits. Reproduced locally in tests/ip-proxy-trust.mjs.
//
// What this does: trust a proxy only if (a) it is the directly connected peer
// within HOPS hops (default 1) AND (b) its address is INTERNAL (loopback,
// RFC 1918, 100.64.0.0/10 CGNAT, link-local, ULA). `req.ip` is then the address
// that proxy appended to X-Forwarded-For (rightmost entry), never an entry the
// client wrote. A caller that reaches the origin from a PUBLIC address is never
// trusted: its X-Forwarded-For is ignored and `req.ip` is its own address.
//
// Why not the numeric `trustProxy: 1`: Fastify 5.8.3–5.12.0 ignore the connecting
// address for the numeric form (GHSA-3m5p-2c4r-xxw2), so a direct caller could
// pick `req.ip`; 5.12.1 removes the numeric form at runtime. Why not `true`: it
// takes the LEFTmost entry, which a client controls when the edge appends. Why
// not a fixed CIDR list: Railway publishes no stable proxy range (its staff say
// the 100.x range "is not guaranteed to be stable"); the internal-address CLASS
// is stable.
//
// Worst case if the real chain has MORE hops than configured: req.ip is an inner
// proxy address — the same sharing as before this change, never a client-chosen
// value. Raise TRUST_PROXY_HOPS only after verifying the chain in the deployment.
// Limits: a peer inside the private network that does not rewrite the header
// (e.g. another service of the same project) is trusted; and if no proxy
// rewrites the header at all, the application cannot tell (test B5).
//
// Every place that needs the client address uses `req.ip`; nothing reads
// X-Forwarded-For by hand.

import net from 'node:net';

const INTERNAL = new net.BlockList();
for (const [addr, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16]]) INTERNAL.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['fc00::', 7], ['fe80::', 10]]) INTERNAL.addSubnet(addr, bits, 'ipv6');
INTERNAL.addAddress('::1', 'ipv6');

/** True only for loopback / private / CGNAT / link-local / ULA addresses. Anything else (or unparseable) is false. */
export function isInternalAddress(address) {
  if (typeof address !== 'string') return false;
  let a = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a); // IPv4-mapped IPv6
  if (mapped) a = mapped[1];
  const family = net.isIP(a);
  if (!family) return false;
  return INTERNAL.check(a, family === 4 ? 'ipv4' : 'ipv6');
}

export function trustProxyHops(env = process.env) {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return 1;
  if (!/^\d+$/.test(raw) || Number(raw) > 5) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer from 0 to 5 (got "${raw}")`);
  }
  return Number(raw);
}

/** Value for Fastify's `trustProxy`: `false` (0 hops) or a function validating the connecting address. */
export function fastifyTrustProxy(env = process.env) {
  const hops = trustProxyHops(env);
  if (hops === 0) return false;
  return (address, hop) => hop < hops && isInternalAddress(address);
}
