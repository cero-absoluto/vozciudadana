// Offline checks for apps/web/src/lib/nationalPreCheck.js and its wiring in the screens.
// The screens are not mounted here (no browser/DOM harness in this repo): the decision
// logic lives in the pure module, which is tested directly, and the wiring is asserted statically.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preSmsRejectionKey, markForceOtp, clearForceOtp, shouldSkipFastPath, FORCE_OTP_KEY } from '../apps/web/src/lib/nationalPreCheck.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const loc = Object.fromEntries(['es', 'en', 'fr', 'zh'].map(l => [l, JSON.parse(fs.readFileSync(new URL(`../apps/web/src/locales/${l}.json`, import.meta.url), 'utf8'))]));

test('request-otp 403 codes map to fixed translated keys; anything else is not a pre-SMS notice', () => {
  assert.equal(preSmsRejectionKey({ code: 'NATIONAL_COUNTRY_SHARED_CODE', message: 'server text' }), 'verify.toastNationalSharedCode');
  assert.equal(preSmsRejectionKey({ code: 'NATIONAL_COUNTRY_UNRESOLVED' }), 'verify.toastNationalUnresolved');
  for (const e of [null, undefined, {}, new Error('x'), { code: 'otp_rate_limited' }, { code: 'NATIONAL_ONLY' }, { code: 'NATIONAL_COUNTRY_SHARED_CODE_X' }, { code: 'toString' }, { code: '__proto__' }, { message: 'NATIONAL_COUNTRY_SHARED_CODE' }]) {
    assert.equal(preSmsRejectionKey(e), null, JSON.stringify(e));
  }
  for (const l of Object.keys(loc)) for (const k of ['toastNationalSharedCode', 'toastNationalUnresolved']) assert.ok(loc[l].verify[k].length > 30, `${l}.${k}`);
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
  // the notice comes from the server (full number, no SMS sent); no client-side prefix guess remains
  assert.match(auth, /const preSms = preSmsRejectionKey\(err\);\s*if \(preSms\) \{[\s\S]*ui\.showToast\(t\(preSms\)\)/);
  assert.doesNotMatch(auth, /sharedCodeBlocksNational|SHARED_CALLING_CODES/);
  assert.equal(FORCE_OTP_KEY, 'vc_force_otp');
});
