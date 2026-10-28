import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

// An independent c-ares resolver: cancellation does not abandon getaddrinfo
// work in the shared libuv threadpool. The outer request owns the deadline.
export async function resolveSourceAddresses(hostname, { signal,
  resolverFactory = () => new Resolver({ timeout: 5000, tries: 1 }),
} = {}) {
  signal?.throwIfAborted();
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal)) return [{ address: literal, family: isIP(literal) }];
  const resolver = resolverFactory();
  const cancel = () => resolver.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    signal?.throwIfAborted();
    // A missing family is normal; unexpected failures must not hide an
    // unchecked family that could resolve to a private address.
    const absent = new Set(['ENODATA', 'ENOTFOUND']);
    if (results.some(r => r.status === 'rejected' && !absent.has(r.reason?.code))) throw new Error('dns_error');
    return results.flatMap((r, i) => r.status === 'fulfilled'
      ? r.value.map(address => ({ address, family: i === 0 ? 4 : 6 })) : []);
  } finally {
    signal?.removeEventListener('abort', cancel);
    resolver.cancel();
  }
}
