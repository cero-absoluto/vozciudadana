// Credentials are scoped to a convocatoria and kept only in this tab session.
const key = id => `vc_census_session:${id}`;
export function getCensusSession(id) { try { return sessionStorage.getItem(key(id)) || ''; } catch { return ''; } }
export function saveCensusSession(id, token) {
  if (typeof token !== 'string' || !token.startsWith('v1.')) throw new Error('CENSUS_AUTH_REQUIRED');
  sessionStorage.setItem(key(id), token);
  sessionStorage.removeItem('vc_email_hash');
}
export function clearCensusSession(id) { try { sessionStorage.removeItem(key(id)); } catch {} }
export async function censusRecaptcha() {
  const siteKey = import.meta.env.VITE_RECAPTCHA_KEY;
  if (!siteKey || !window.grecaptcha) throw new Error('RECAPTCHA_UNAVAILABLE');
  return new Promise((resolve,reject) => window.grecaptcha.ready(() => {
    window.grecaptcha.execute(siteKey,{action:'institutional_send_otp'}).then(resolve,reject);
  }));
}
