// The deadline covers transport AND response-body consumption. No retry is made.
export function withClientDeadline(operation, {timeoutMs = 15000} = {}) {
  const controller = new AbortController();
  let timer;
  return Promise.race([
    new Promise((resolve,reject) => {
      try { resolve(operation(controller.signal)); } catch (error) { reject(error); }
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error('REQUEST_TIMEOUT'), {code: 'REQUEST_TIMEOUT'});
        controller.abort();
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function requestJson(url, options, {fetchImpl = fetch, timeoutMs = 15000} = {}) {
  return withClientDeadline(async signal => {
    let response;
    try { response = await fetchImpl(url, {...options, signal}); }
    catch (cause) { throw Object.assign(new Error('API_NETWORK_ERROR'), {code: 'API_NETWORK_ERROR', cause}); }
    let json;
    try { json = await response.json(); }
    catch {
      if (response.ok) throw Object.assign(new Error('INVALID_API_RESPONSE'), {code: 'INVALID_API_RESPONSE', status: response.status});
      json = {};
    }
    if (!response.ok) {
      const error = new Error(json?.error ?? json?.message ?? `API error ${response.status}`);
      if (typeof json?.code === 'string') error.code = json.code;
      error.status = response.status;
      error.reason = json?.reason ?? null;
      throw error;
    }
    if (json === null || typeof json !== 'object') throw Object.assign(new Error('INVALID_API_RESPONSE'), {code: 'INVALID_API_RESPONSE', status: response.status});
    return json;
  }, {timeoutMs});
}

export function recaptchaToken(captcha, siteKey, action) {
  return withClientDeadline(() => new Promise((resolve,reject) => {
    if (!captcha || !siteKey) { reject(new Error('RECAPTCHA_UNAVAILABLE')); return; }
    captcha.ready(() => Promise.resolve().then(() => captcha.execute(siteKey,{action})).then(resolve,reject));
  }));
}
