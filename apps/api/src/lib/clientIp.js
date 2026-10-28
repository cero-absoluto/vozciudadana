import { isIP } from 'node:net';
export function isValidClientIp(ip) { return typeof ip === 'string' && ip.length <= 45 && !ip.includes('%') && isIP(ip) !== 0; }

// Keep the provider host and path fixed even if client IP validation evolves.
export function ipapiUrl(ip) {
  if (!isValidClientIp(ip) || !/^[0-9A-Fa-f:.]+$/.test(ip)) throw new TypeError('Invalid IP literal');
  return `https://ipapi.co/${ip}/json/`;
}
