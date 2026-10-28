import { isIP } from 'node:net';
function isUnspecifiedOrMapped(address) {
  if (address === '0.0.0.0') return true;
  if (isIP(address) !== 6 || address.includes('%')) return false;
  const host = new URL(`http://[${address}]/`).hostname;
  // Configure IPv4 ingress in plain IPv4 notation; proxy-addr handles mapped peers.
  return host === '[::]' || host.startsWith('[::ffff:');
}
// No inferred hop count or blanket trust. Deployed environments must supply the actual
// proxy networks after an operator has verified the ingress boundary.
export function proxyTrustFromEnv(env = process.env) {
  const raw = env.TRUSTED_PROXY_CIDRS?.trim();
  if (!raw) {
    if (!['development', 'test'].includes(env.NODE_ENV)) throw new Error('TRUSTED_PROXY_CIDRS must describe the verified ingress proxy');
    return false;
  }
  const entries = raw.split(',').map(s => s.trim());
  if (entries.length > 32) throw new Error('TRUSTED_PROXY_CIDRS contains too many ingress networks');
  for (const entry of entries) {
    const parts = entry.split('/'), version = isIP(parts[0]);
    const max = version === 4 ? 32 : 128, min = version === 4 ? 24 : 64;
    if (!version || entry.includes('%') || isUnspecifiedOrMapped(parts[0]) || parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || +parts[1] < min || +parts[1] > max))) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP addresses or bounded CIDRs');
    }
  }
  return entries;
}
