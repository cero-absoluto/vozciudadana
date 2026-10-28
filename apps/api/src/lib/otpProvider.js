import {withRequestDeadline} from './requestDeadline.js';

// Never attach provider errors: they can contain addresses, codes or credentials.
export class OtpProviderError extends Error {
  constructor(kind = 'unavailable') {
    super('OTP provider unavailable');
    this.kind = kind;
  }
}

export async function runOtpProvider(operation, {timeoutMs = 10000} = {}) {
  try {
    return await withRequestDeadline(timeoutMs, operation);
  } catch (error) {
    if (error instanceof OtpProviderError) throw error;
    throw new OtpProviderError();
  }
}

export function otpProviderFailure(reply, error, operation) {
  const limited = error instanceof OtpProviderError && error.kind === 'limited';
  if (limited) reply.header('Retry-After', '60');
  return reply.code(limited ? 429 : 503).send({
    error: limited ? 'OTP_RATE_LIMITED' : `OTP_${operation}_UNAVAILABLE`,
    code: limited ? 'otp_rate_limited' : 'otp_temporarily_unavailable',
  });
}
