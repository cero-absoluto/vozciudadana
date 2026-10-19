// ── Numbering-plan country of a verified phone number (H7) ──────────────────
//
// What this is: the country the NUMBERING PLAN assigns to an E.164 number the
// OTP provider already verified, read server-side from versioned metadata
// (libphonenumber-js, version pinned in package.json). It identifies numbering.
// It is NOT nationality, residence, location, or the country where the SIM is
// really registered (portability, roaming, virtual operators, eSIM and VoIP
// numbers of another country remain possible).
//
// Why it exists: national eligibility used to compare the convocatoria's
// country with a `country_code` the CLIENT declared at verify-otp. A direct API
// client could verify a number of one country and declare another. The value
// that applies the rule must come from the verified number, never from the client.
//
// This module only READS the number. It does not normalise, hash, store or
// change it (E.164 handling, HMACs and nullifiers are untouched).
//
// Resolution (docs/proposals/H7_National_Eligibility_Country_Source_v0.2.md):
//   resolved_unshared    the library returns a country AND the calling code is
//                        assigned to exactly one ISO in the metadata.
//   shared_calling_code  the calling code is assigned to several ISOs in the
//                        metadata (e.g. +1, +44, +358). The country is NOT
//                        attributed here, even if the library would return one.
//   no_result            the library returns no country (unassigned code,
//                        unparsable number).
// A shared calling code is deliberately NOT treated as an unresolvable number:
// it is a distinct outcome with its own code, so any future refinement of the
// criterion is an explicit, auditable change (see NUMBERING_RESOLUTION).

import { createRequire } from 'node:module';
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from 'libphonenumber-js/max';

const require = createRequire(import.meta.url);
const LIB_VERSION = require('libphonenumber-js/package.json').version;

/** Identifies which metadata produced a stored derivation. */
export const NUMBERING_META_VERSION = `libphonenumber-js@${LIB_VERSION}/max`;

export const NUMBERING_RESOLUTION = Object.freeze({
  RESOLVED_UNSHARED: 'resolved_unshared',
  SHARED_CALLING_CODE: 'shared_calling_code',
  NO_RESULT: 'no_result',
});

let isoPerCallingCode = null;
function isoCountForCallingCode(cc) {
  if (!isoPerCallingCode) {
    isoPerCallingCode = new Map();
    for (const iso of getCountries()) {
      const code = String(getCountryCallingCode(iso));
      isoPerCallingCode.set(code, (isoPerCallingCode.get(code) ?? 0) + 1);
    }
  }
  return isoPerCallingCode.get(String(cc)) ?? 0;
}

/**
 * @param {string} e164  E.164 number that the OTP provider verified (e.g. "+34600000001")
 * @returns {{ resolution: string, country: string|null, callingCode: string|null, metaVersion: string }}
 *   `country` is an ISO 3166-1 alpha-2 code ONLY when resolution is 'resolved_unshared'; null otherwise.
 */
export function deriveNumberingCountry(e164) {
  const metaVersion = NUMBERING_META_VERSION;
  let parsed;
  try {
    parsed = typeof e164 === 'string' && e164.startsWith('+') ? parsePhoneNumberFromString(e164) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!parsed) return { resolution: NUMBERING_RESOLUTION.NO_RESULT, country: null, callingCode: null, metaVersion };

  const callingCode = String(parsed.countryCallingCode);
  if (isoCountForCallingCode(callingCode) > 1) {
    return { resolution: NUMBERING_RESOLUTION.SHARED_CALLING_CODE, country: null, callingCode, metaVersion };
  }
  if (!parsed.country || !/^[A-Z]{2}$/.test(parsed.country)) {
    return { resolution: NUMBERING_RESOLUTION.NO_RESULT, country: null, callingCode, metaVersion };
  }
  return { resolution: NUMBERING_RESOLUTION.RESOLVED_UNSHARED, country: parsed.country, callingCode, metaVersion };
}
