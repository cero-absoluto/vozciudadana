// ── Client IP behind Railway's edge proxy ───────────────────────────────────
// Without `trustProxy`, Fastify's `req.ip` is the address of whatever opened the
// TCP connection — behind Railway, the edge proxy — so every user shares one IP:
// @fastify/rate-limit keys (global 120/min, request-otp 5/5 min, …) and the
// `ip_hash` that check_otp_rate_limit counts (10/hour) became service-wide
// limits. Reproduced locally in tests/ip-proxy-trust.mjs.
//
// What this does: trust a fixed NUMBER OF HOPS (default 1 = only the directly
// connected proxy). `req.ip` is then the address that proxy appended to
// X-Forwarded-For (rightmost entry), never an entry the client wrote itself.
// Why hops and not `trustProxy: true` or a CIDR list: `true` takes the LEFTmost
// entry, which a client controls whenever the edge appends instead of replacing;
// Railway publishes no stable proxy address range (its staff say the 100.x range
// "is not guaranteed to be stable"), so a CIDR list would silently break.
//
// Worst case if the real chain has MORE than one proxy: req.ip is an inner
// proxy address — the same sharing as before this change, never a client-chosen
// value. Raise TRUST_PROXY_HOPS only after verifying the chain in the deployment.
// If no proxy rewrites the header at all, the application cannot tell (see B5).
//
// Every place that needs the client address uses `req.ip`; nothing reads
// X-Forwarded-For by hand.

export function trustProxyHops(env = process.env) {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return 1;
  if (!/^\d+$/.test(raw) || Number(raw) > 5) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer from 0 to 5 (got "${raw}")`);
  }
  return Number(raw);
}

/** Value for Fastify's `trustProxy` option. */
export function fastifyTrustProxy(env = process.env) {
  const hops = trustProxyHops(env);
  return hops === 0 ? false : hops;
}
