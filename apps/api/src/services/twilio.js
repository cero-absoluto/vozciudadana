import twilio from 'twilio';

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
    client        = twilio(accountSid, authToken);
    verifyService = client.verify.v2.services(verifySid);
  }
  return verifyService;
}

/**
 * Send an OTP via Twilio Verify.
 * @param {string} phoneE164 - Phone number in E.164 format, e.g. +34612345678
 */
export async function sendOtp(phoneE164) {
  const svc = getClient();
  await svc.verifications.create({ to: phoneE164, channel: 'sms' });
}

/**
 * Verify an OTP via Twilio Verify.
 * @param {string} phoneE164 - Phone number in E.164 format
 * @param {string} code      - 6-digit code entered by the user
 * @returns {boolean} true if approved
 */
export async function verifyOtp(phoneE164, code) {
  const svc  = getClient();
  const check = await svc.verificationChecks.create({ to: phoneE164, code });
  return check.status === 'approved';
}
