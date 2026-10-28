export function normalizeInstitutionalDomain(value) {
  if (value == null || value.trim() === '') return null;
  const input = value.trim().toLowerCase();
  // Keep the same ASCII/punycode representation used by email OTP identity hashes.
  if (!/^[a-z0-9.-]+$/.test(input)) throw new Error('INSTITUTIONAL_DOMAIN_INVALID');
  const domain = input;
  const labels = domain.split('.');
  if (!domain || domain.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1))) {
    throw new Error('INSTITUTIONAL_DOMAIN_INVALID');
  }
  return domain;
}
