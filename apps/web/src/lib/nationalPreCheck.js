// Presentation-only helpers for the national-eligibility flow (H7).
// They never decide eligibility (the server does, from the verified number); they
// only avoid asking for an SMS that cannot change the outcome, and decide whether
// the device-secret fast path is skipped once.

// Calling codes the numbering metadata assigns to more than one country, so the
// server records `shared_calling_code` for them and no national adhesion.
// Generated from libphonenumber-js@1.12.10/max; tests/national-precheck.test.mjs
// fails if this list drifts from the pinned library.
export const SHARED_CALLING_CODES = Object.freeze(['1', '7', '39', '44', '47', '61', '212', '262', '290', '358', '590', '599']);

// Calling codes are prefix-free, so a prefix test on the digits is exact.
export function startsWithSharedCallingCode(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  return SHARED_CALLING_CODES.some(c => d.startsWith(c));
}

// True only for a national convocatoria whose number can never be resolved (known
// before any SMS). Says nothing about whether the number has participated.
export function sharedCodeBlocksNational({ scope, protestCountry, dialCode, localDigits }) {
  if (scope !== 'national' || !protestCountry) return false;
  return startsWithSharedCallingCode(`${dialCode ?? ''}${localDigits ?? ''}`);
}

export const FORCE_OTP_KEY = 'vc_force_otp';
export const markForceOtp = (storage) => { try { storage.setItem(FORCE_OTP_KEY, '1'); } catch { /* ignore */ } };
export const clearForceOtp = (storage) => { try { storage.removeItem(FORCE_OTP_KEY); } catch { /* ignore */ } };
export const shouldSkipFastPath = (storage) => { try { return storage.getItem(FORCE_OTP_KEY) === '1'; } catch { return false; } };
