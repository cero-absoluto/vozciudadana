export function protestTiming(protest, now = Date.now()) {
  const parse = value => value ? Date.parse(value) : NaN;
  const created = parse(protest.created_at);
  const start = parse(protest.starts_at);
  const end = parse(protest.ends_at);
  if (!Number.isFinite(end)) return { state: 'unknown', created, start, end };
  if (now >= end) return { state: 'ended', created, start, end };
  if (Number.isFinite(start) && start > now) {
    return { state: 'upcoming', created, start, end, seconds: Math.ceil((start - now) / 1000) };
  }
  return { state: 'open', created, start, end };
}
