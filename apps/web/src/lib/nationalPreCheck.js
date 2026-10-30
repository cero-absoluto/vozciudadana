// Presentation-only helpers for the national-eligibility flow (H7).
// They never decide eligibility (the server does, from the verified number).

// request-otp answers 403 with one of these codes BEFORE any SMS when the country
// of the number cannot be established for a national convocatoria. Fixed keys only:
// server text is never shown.
const PRE_SMS_KEYS = Object.freeze({
  INSTITUTIONAL_VERIFICATION_REQUIRED: 'verify.toastInstitutionalRequired',
  NATIONAL_COUNTRY_SHARED_CODE: 'verify.toastNationalSharedCode',
  NATIONAL_COUNTRY_UNRESOLVED: 'verify.toastNationalUnresolved',
});
export function preSmsRejectionKey(err) {
  const code = typeof err?.code === 'string' ? err.code : '';
  return Object.prototype.hasOwnProperty.call(PRE_SMS_KEYS, code) ? PRE_SMS_KEYS[code] : null;
}

// vc_force_otp: set when a national join was rejected because the device has no
// numbering provenance; the device-secret fast path would loop back, so it is
// skipped once and a fresh OTP is requested.
export const FORCE_OTP_KEY = 'vc_force_otp';
export const markForceOtp = (storage) => { try { storage.setItem(FORCE_OTP_KEY, '1'); } catch { /* ignore */ } };
export const clearForceOtp = (storage) => { try { storage.removeItem(FORCE_OTP_KEY); } catch { /* ignore */ } };
export const shouldSkipFastPath = (storage) => { try { return storage.getItem(FORCE_OTP_KEY) === '1'; } catch { return false; } };
