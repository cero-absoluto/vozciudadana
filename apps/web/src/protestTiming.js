export function protestTiming(protest, now = Date.now()) {
  const parse = value => value ? Date.parse(value) : NaN;
  const start = parse(protest.starts_at);
  const end = parse(protest.ends_at);
  if (!Number.isFinite(end)) return { state: 'unknown', start, end };
  if (now >= end) return { state: 'ended', start, end };
  if (Number.isFinite(start) && start > now) {
    return { state: 'upcoming', start, end, seconds: Math.ceil((start - now) / 1000) };
  }
  return { state: 'open', start, end };
}
