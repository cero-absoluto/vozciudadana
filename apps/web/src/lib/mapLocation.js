// Presentation only: never feed estimates into participation eligibility.
export function mapLocation(device) {
  const valid = value => typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : '';
  const measured = (device.gpsReady && valid(device.gpsCountryCode)) || valid(device.ipCountry);
  if (measured) return { country: measured, approximate: false };
  const estimate = valid(device.tzCountry);
  return { country: estimate, approximate: Boolean(estimate) };
}
