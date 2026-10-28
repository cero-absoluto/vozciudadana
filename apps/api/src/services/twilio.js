import twilio from 'twilio';
import {OtpProviderError, runOtpProvider} from '../lib/otpProvider.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const verifySid  = process.env.TWILIO_VERIFY_SID;

let client;
let verifyService;

function getClient() {
  if (!accountSid || !authToken || !verifySid) {
    throw new Error('Twilio env vars not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID)');
  }
  if (!client) {
    client        = twilio(accountSid, authToken, {timeout: 8000, autoRetry: false});
    verifyService = client.verify.v2.services(verifySid);
  }
  return verifyService;
}

/**
 * Send an OTP via Twilio Verify.
 * @param {string} phoneE164 - Phone number in E.164 format, e.g. +34612345678
 */
export async function sendOtp(phoneE164) {
  return runOtpProvider(async () => {
    try {
      const result = await getClient().verifications.create({ to: phoneE164, channel: 'sms' });
      if (result?.status !== 'pending') throw new OtpProviderError();
    } catch (error) {
      if ([60203, 60207, 60212].includes(error?.code) || error?.status === 429) throw new OtpProviderError('limited');
      throw new OtpProviderError();
    }
  });
}

/**
 * Verify an OTP via Twilio Verify.
 * @param {string} phoneE164 - Phone number in E.164 format
 * @param {string} code      - 6-digit code entered by the user
 * @returns {boolean} true if approved
 */
export async function verifyOtp(phoneE164, code, {onMaxAttempts} = {}) {
  // Operational signal only, with no identity/code/provider details. A broken
  // telemetry callback must not change the authentication decision.
  const exhausted = () => { try { onMaxAttempts?.(); } catch {} };
  return runOtpProvider(async () => {
    try {
      const check = await getClient().verificationChecks.create({ to: phoneE164, code });
      if (check?.status === 'approved') return true;
      if (check?.status === 'max_attempts_reached') { exhausted(); return false; }
      if (['pending', 'canceled', 'max_attempts_reached', 'deleted', 'failed', 'expired'].includes(check?.status)) return false;
      throw new OtpProviderError();
    } catch (error) {
      // Verify removes expired, consumed and exhausted challenges. Never retry
      // a check automatically: an approval can already have consumed the code.
      if (error?.code === 60202) { exhausted(); return false; }
      if (error?.status === 404 && error?.code === 20404) return false;
      if ([60207, 60212].includes(error?.code) || error?.status === 429) throw new OtpProviderError('limited');
      throw new OtpProviderError();
    }
  });
}
