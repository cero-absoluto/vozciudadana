// Classifies a rejection of the final adhesion call (POST /api/protests/:id/join)
// into (a) an i18n message key and (b) where to send the person next.
//
// Presentation and navigation ONLY. It never decides whether a person may
// participate (the backend does) and it never reads or changes authentication,
// privacy or funding data.
//
// Safety rule: no text that comes from the server (err.message, err.reason) is
// ever returned or shown. Only fixed, translated keys are returned, so an
// unexpected or technical server message cannot reach the person.
//
// Order matters and preserves the pre-existing behaviour for NATIONAL_ONLY,
// 409 and 402 exactly (same predicates, same keys, same destination).

export const JOIN_REJECTION_KIND = Object.freeze({
  NATIONAL: 'national',
  ALREADY: 'already',
  NO_FUNDS: 'no_funds',
  VERIFICATION_REQUIRED: 'verification_required',
  CLOSED: 'closed',
  NATIONAL_SHARED_CODE: 'national_shared_code',
  NATIONAL_UNRESOLVED: 'national_unresolved',
  NATIONAL_REVERIFICATION: 'national_reverification',
  GENERIC: 'generic',
});

const KEY = Object.freeze({
  national: 'verify.toastNational',
  national_no_country: 'verify.toastNationalNoCountry',
  already: 'verify.toastAlready',
  no_funds: 'verify.toastSinSaldo',
  verification_required: 'verify.toastVerificationRequired',
  closed: 'verify.toastClosed',
  national_shared_code: 'verify.toastNationalSharedCode',
  national_unresolved: 'verify.toastNationalUnresolved',
  national_reverification: 'verify.toastNationalReverification',
  generic: 'verify.toastErrorGeneric',
});

// api.js puts json.code on err.code when the body has `code`; the backend sends
// the machine identifier either as `code` (402, 403) or as `error` (401, 409,
// 410), and `error` ends up in err.message. Accept either, but only ever
// compare it against fixed identifiers.
function identifier(err) {
  if (typeof err?.code === 'string' && err.code) return err.code;
  if (typeof err?.message === 'string') return err.message;
  return '';
}

/**
 * @param {unknown} err  error thrown by api.joinProtest()
 * @returns {{ kind: string, toastKey: string, destination: 'home'|'auth'|'informe', forceOtp?: boolean }}
 */
export function classifyJoinRejection(err) {
  const status = err?.status;
  const message = typeof err?.message === 'string' ? err.message : undefined;

  if (status === 403 && identifier(err) === 'INSTITUTIONAL_VERIFICATION_REQUIRED') {
    return { kind: 'institutional_required', toastKey: 'verify.toastInstitutionalRequired', destination: 'home' };
  }

  // --- server-derived national country (H7). Exact codes only; checked before the
  // loose 409/402 predicates. None of these says the person belongs to another country. ---
  if (err?.code === 'NATIONAL_COUNTRY_SHARED_CODE') {
    return { kind: 'national_shared_code', toastKey: KEY.national_shared_code, destination: 'home' };
  }
  if (err?.code === 'NATIONAL_COUNTRY_UNRESOLVED') {
    return { kind: 'national_unresolved', toastKey: KEY.national_unresolved, destination: 'home' };
  }
  if (err?.code === 'NATIONAL_REVERIFICATION_REQUIRED') {
    // forceOtp: the device has no provenance, so the secret-based re-auth must be
    // skipped once and a fresh OTP requested (otherwise /auth would loop back here).
    return { kind: 'national_reverification', toastKey: KEY.national_reverification, destination: 'auth', forceOtp: true };
  }

  // --- unchanged from VerifyScreen.vue (predicates copied verbatim) ---
  if (err?.code === 'NATIONAL_ONLY') {
    return { kind: 'national', toastKey: KEY.national, destination: 'home' };
  }
  if (status === 409 || message?.includes('409') || message?.includes('already')) {
    return { kind: 'already', toastKey: KEY.already, destination: 'home' };
  }
  if (status === 402 || message?.includes('402') || message?.includes('SALDO')) {
    return { kind: 'no_funds', toastKey: KEY.no_funds, destination: 'home' };
  }
  // --- new: ONLY these two exact status + identifier pairs ---
  if (status === 401 && identifier(err) === 'VERIFICATION_REQUIRED') {
    return { kind: 'verification_required', toastKey: KEY.verification_required, destination: 'auth' };
  }
  if (status === 410 && identifier(err) === 'PROTEST_CLOSED') {
    return { kind: 'closed', toastKey: KEY.closed, destination: 'informe' };
  }
  // Everything else (other 401/410, 400, 403, 5xx, network, unknown shapes).
  return { kind: 'generic', toastKey: KEY.generic, destination: 'home' };
}

/** Router path for a classification. `protestId` is the convocatoria being joined. */
export function joinRejectionPath(rejection, protestId) {
  if (rejection.destination === 'auth') return '/auth';
  if (rejection.destination === 'informe' && protestId != null && String(protestId) !== '') {
    return `/informe/${encodeURIComponent(String(protestId))}`;
  }
  return '/';
}

/**
 * Message key + interpolation params for a classification.
 * verify.toastNational needs {country}: use the convocatoria's country name when
 * there is one, otherwise a complete variant that does not mention a country.
 * Presentation only: it never changes whether the person may join.
 * @param {{ kind: string, toastKey: string }} rejection
 * @param {unknown} countryName  display name of the convocatoria's country, if known
 * @returns {{ key: string, params: Record<string,string> }}
 */
export function joinRejectionToast(rejection, countryName) {
  if (rejection.kind === 'national') {
    const name = typeof countryName === 'string' ? countryName.trim() : '';
    return name
      ? { key: KEY.national, params: { country: name } }
      : { key: KEY.national_no_country, params: {} };
  }
  return { key: rejection.toastKey, params: {} };
}
