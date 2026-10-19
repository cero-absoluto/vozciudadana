// Offline checks for apps/web/src/lib/nationalPreCheck.js and its wiring in the screens.
// The screens are not mounted here (no browser/DOM harness in this repo): the decision
// logic lives in the pure module, which is tested directly, and the wiring is asserted statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { SHARED_CALLING_CODES, startsWithSharedCallingCode, sharedCodeBlocksNational, markForceOtp, clearForceOtp, shouldSkipFastPath, FORCE_OTP_KEY } from '../apps/web/src/lib/nationalPreCheck.js';
import { deriveNumberingCountry } from '../apps/api/src/lib/numberingCountry.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const lib = require('libphonenumber-js/max');
const fakeStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };

test('client list of shared calling codes equals the pinned library (no drift)', () => {
  const g = {};
  for (const iso of lib.getCountries()) (g[lib.getCountryCallingCode(iso)] ??= []).push(iso);
  const expected = Object.entries(g).filter(([, v]) => v.length > 1).map(([c]) => c).sort();
  assert.deepEqual([...SHARED_CALLING_CODES].sort(), expected);
});

test('client pre-check agrees with the server derivation for sample numbers of every shared code and unshared ones', () => {
  const samples = { '+14155552671': true, '+442071838750': true, '+393123456789': true, '+358401234567': true, '+79123456789': true,
    '+34600000001': false, '+33612345678': false, '+598991234567': false, '+4930123456': false, '+351912345678': false };
  for (const [e164, shared] of Object.entries(samples)) {
    assert.equal(startsWithSharedCallingCode(e164.slice(1)), shared, e164);
    assert.equal(deriveNumberingCountry(e164).resolution === 'shared_calling_code', shared, e164);
  }
});

test('pre-SMS warning only for national scope with a known convocatoria country', () => {
  const base = { scope: 'national', protestCountry: 'GB', dialCode: 44, localDigits: '7911123456' };
  assert.equal(sharedCodeBlocksNational(base), true);
  assert.equal(sharedCodeBlocksNational({ ...base, scope: 'global' }), false);
  assert.equal(sharedCodeBlocksNational({ ...base, scope: 'local' }), false);
  assert.equal(sharedCodeBlocksNational({ ...base, scope: 'regional' }), false);
  assert.equal(sharedCodeBlocksNational({ ...base, protestCountry: null }), false);
  assert.equal(sharedCodeBlocksNational({ ...base, dialCode: 34, localDigits: '600000001' }), false);
  // independent of any participation data: the function has no such input
  assert.deepEqual(Object.keys(base).sort(), ['dialCode', 'localDigits', 'protestCountry', 'scope']);
});

test('reverification journey: flag set on rejection, fast path skipped, flag survives abandon and retry, cleared after OTP success', () => {
  const st = fakeStorage();
  assert.equal(shouldSkipFastPath(st), false, 'normal device: fast path allowed');
  markForceOtp(st);                                   // VerifyScreen after NATIONAL_REVERIFICATION_REQUIRED
  assert.equal(shouldSkipFastPath(st), true, 'AuthScreen.sendSMS skips reauth and asks a fresh OTP');
  assert.equal(shouldSkipFastPath(st), true, 'user abandons before OTP and presses send again: still no loop through reauth');
  clearForceOtp(st);                                  // AuthScreen.verifyOTP success
  assert.equal(shouldSkipFastPath(st), false, 'after a successful OTP the device-secret fast path is back');
  assert.equal(st._m.size, 0);
});

test('storage failures never break the flow', () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => { markForceOtp(broken); clearForceOtp(broken); });
  assert.equal(shouldSkipFastPath(broken), false);
});

test('wiring in the screens (static)', () => {
  const auth = fs.readFileSync(new URL('../apps/web/src/screens/AuthScreen.vue', import.meta.url), 'utf8');
  const ver = fs.readFileSync(new URL('../apps/web/src/screens/VerifyScreen.vue', import.meta.url), 'utf8');
  assert.match(ver, /if \(rejection\.forceOtp\) markForceOtp\(sessionStorage\)/);
  assert.match(auth, /const forceOtp = shouldSkipFastPath\(sessionStorage\)/);
  assert.match(auth, /forceOtp \? null : device\.getDeviceSecret\(\)/);
  assert.match(auth, /clearForceOtp\(sessionStorage\)/);
  // the shared-code warning sits BEFORE requestGpsFlow and api.requestOtp (no SMS, no GPS prompt)
  const w = auth.indexOf("ui.showToast(t('verify.toastNationalSharedCode'))");
  assert.ok(w > 0 && w < auth.indexOf('await requestGpsFlow()') && w < auth.indexOf('api.requestOtp('));
  assert.equal(FORCE_OTP_KEY, 'vc_force_otp');
});
