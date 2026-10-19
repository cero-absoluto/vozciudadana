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
// Resolution (criterion R-N2, see docs/canonical/6.-Participation_Verification_Methodology.md §4):
//   resolved_unshared      the library returns a country AND the calling code is assigned
//                          to exactly one ISO in the metadata. (Unchanged.)
//   resolved_shared_unique the calling code is assigned to several ISOs, but exactly ONE of
//                          them validates the full number with the versioned metadata
//                          (each ISO evaluated separately), AND the library's own country
//                          for the number is that same ISO. The library alone is not
//                          enough: it returns the first candidate, not the list of those
//                          that fit.
//   shared_calling_code    shared calling code, NOT resolved: 0 ISOs validate the number,
//                          2+ validate it (overlapping territorial ranges: e.g. IT/VA,
//                          FI/AX, AU/CC/CX, NO/SJ, MA/EH, GP/BL/MF, GB/IM, or +1 toll-free),
//                          or the library disagrees with the single valid ISO. Nothing is
//                          attributed. `reason` says which.
//   no_result              the library returns no country (unassigned code, unparsable).
// Never used: the country the client declares, GPS, IP.
// A shared calling code is deliberately NOT treated as an unresolvable number: it is
// resolved when the metadata distinguish it, so a refinement of the criterion is always an
// explicit, auditable change (NUMBERING_CRITERION).

import { createRequire } from 'node:module';
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from 'libphonenumber-js/max';
import { PhoneNumber } from 'libphonenumber-js/core'; // core class: (country, nationalNumber, metadata)

const require = createRequire(import.meta.url);
const LIB_VERSION = require('libphonenumber-js/package.json').version;

const METADATA = require('libphonenumber-js/metadata.max.json');

/** Version of OUR criterion on top of the library (bump on any rule change). */
export const NUMBERING_CRITERION = 'R-N2';

/** Identifies which metadata AND which criterion produced a stored derivation. */
export const NUMBERING_META_VERSION = `libphonenumber-js@${LIB_VERSION}/max;${NUMBERING_CRITERION}`;

export const NUMBERING_RESOLUTION = Object.freeze({
  RESOLVED_UNSHARED: 'resolved_unshared',
  RESOLVED_SHARED_UNIQUE: 'resolved_shared_unique',
  SHARED_CALLING_CODE: 'shared_calling_code',
  NO_RESULT: 'no_result',
});

let isosPerCallingCode = null;
function isosForCallingCode(cc) {
  if (!isosPerCallingCode) {
    isosPerCallingCode = new Map();
    for (const iso of getCountries()) {
      const code = String(getCountryCallingCode(iso));
      if (!isosPerCallingCode.has(code)) isosPerCallingCode.set(code, []);
      isosPerCallingCode.get(code).push(iso);
    }
  }
  return isosPerCallingCode.get(String(cc)) ?? [];
}

/** ISOs (of one shared calling code) whose own metadata validates this national number. */
function validatingIsos(isos, nationalNumber) {
  const out = [];
  for (const iso of isos) {
    try {
      if (new PhoneNumber(iso, nationalNumber, METADATA).isValid()) out.push(iso);
    } catch { /* an ISO that cannot evaluate the number does not validate it */ }
  }
  return out;
}

/**
 * @param {string} e164  E.164 number that the OTP provider verified (e.g. "+34600000001")
 * @returns {{ resolution: string, country: string|null, callingCode: string|null, metaVersion: string, reason?: string, candidates?: string[] }}
 *   `country` is an ISO 3166-1 alpha-2 code ONLY for the two resolved_* outcomes; null otherwise.
 *   `reason`/`candidates` are diagnostic (tests, logs); they are not stored.
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
  const isos = isosForCallingCode(callingCode);
  if (isos.length > 1) {
    const candidates = validatingIsos(isos, parsed.nationalNumber);
    const libCountry = parsed.country && /^[A-Z]{2}$/.test(parsed.country) ? parsed.country : null;
    const unresolved = (reason) => ({ resolution: NUMBERING_RESOLUTION.SHARED_CALLING_CODE, country: null, callingCode, metaVersion, reason, candidates });
    if (candidates.length === 0) return unresolved('no_iso_validates');
    if (candidates.length > 1) return unresolved('several_iso_validate');
    if (libCountry !== candidates[0]) return unresolved('library_disagrees');
    return { resolution: NUMBERING_RESOLUTION.RESOLVED_SHARED_UNIQUE, country: candidates[0], callingCode, metaVersion, candidates };
  }
  if (!parsed.country || !/^[A-Z]{2}$/.test(parsed.country)) {
    return { resolution: NUMBERING_RESOLUTION.NO_RESULT, country: null, callingCode, metaVersion };
  }
  return { resolution: NUMBERING_RESOLUTION.RESOLVED_UNSHARED, country: parsed.country, callingCode, metaVersion };
}
