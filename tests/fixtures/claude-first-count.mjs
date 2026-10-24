export function formatPilotCount(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('count must be a non-negative safe integer');
  }
  return String(value);
}
