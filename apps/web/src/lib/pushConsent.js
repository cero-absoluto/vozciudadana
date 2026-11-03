// Per-event server consent and browser transport have independent lifecycles.
// This controller never revokes a shared PushSubscription.
export function createPushConsentController(options) {
  const {getContext, onChange = () => {}, deadline, fetchImpl, baseUrl = '', browser} = options;
  let active = true, epoch = 0;
  let state = 'loading', pending = false, revision = null;
  const key = context => context ? JSON.stringify([context.device_id, context.device_secret, context.protest_id]) : null;
  const current = () => { try { return active ? getContext() : null; } catch { return null; } };
  const emit = () => { if (active) onChange({state, pending, revision}); };
  const unavailable = () => { state = 'unavailable'; revision = null; pending = false; emit(); };
  const validRevision = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
  function begin() {
    if (!active || pending) return null;
    const context = current();
    if (!context) { unavailable(); return null; }
    const request = {epoch: ++epoch, context, key: key(context)};
    pending = true; emit();
    return request;
  }
  const owns = request => active && request.epoch === epoch && key(current()) === request.key;
  function finish(request) {
    if (!active || request.epoch !== epoch) return;
    if (!owns(request)) { unavailable(); return; }
    pending = false; emit();
  }
  async function requestJson(path, body, request) {
    return deadline(async signal => {
      if (!owns(request)) throw new Error('PUSH_CONTEXT_CHANGED');
      const response = await fetchImpl(baseUrl + path, {method:'POST', headers:{'Content-Type':'application/json'}, signal, body:JSON.stringify(body)});
      let data;
      try { data = await response.json(); } catch { throw new Error('INVALID_PUSH_RESPONSE'); }
      if (!response.ok) {
        const error = new Error('PUSH_REQUEST_REJECTED');
        error.status = response.status;
        error.code = typeof data?.error === 'string' ? data.error : null;
        throw error;
      }
      return data;
    });
  }
  function failed(error, request, mutationSubmitted) {
    if (!owns(request)) return;
    revision = null;
    if ([401,403,404].includes(error?.status)) state = 'unavailable';
    else if (mutationSubmitted && (!Number.isInteger(error?.status) || error.status >= 500)) state = 'uncertain';
    else state = 'error';
    emit();
  }
  function transportSnapshot(subscription) {
    const data = typeof subscription?.toJSON === 'function' ? subscription.toJSON() : subscription;
    if (typeof data?.endpoint !== 'string' || !data.endpoint || data.endpoint.length > 2048 || typeof data.keys?.p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}={0,1}$/.test(data.keys.p256dh) || typeof data.keys?.auth !== 'string' || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(data.keys.auth)) return null;
    // Copy strings only: a mutable browser object must not change the metadata
    // compared with the server response while that request is pending.
    return {endpoint:data.endpoint, keys:{p256dh:data.keys.p256dh, auth:data.keys.auth}};
  }
  async function inspectTransport(request) {
    // Read only. An unavailable provider must never prevent server revocation.
    try {
      const registration = await deadline(() => browser.getRegistration());
      if (!owns(request) || !registration?.pushManager) return null;
      const subscription = await deadline(() => registration.pushManager.getSubscription());
      if (!owns(request)) return null;
      return transportSnapshot(subscription);
    } catch { return null; }
  }
  const sameTransport = (left, right) => !!left && !!right && left.endpoint === right.endpoint && left.keys.p256dh === right.keys.p256dh && left.keys.auth === right.keys.auth;
  async function refresh() {
    const request = begin(); if (!request) return;
    state = 'loading'; emit();
    try {
      const sentTransport = await inspectTransport(request);
      if (!owns(request)) return;
      const body = {...request.context, ...(sentTransport ? {subscription:sentTransport} : {})};
      const data = await requestJson('/api/push/preferences', body, request);
      if (!owns(request)) return;
      if (data?.ok !== true || typeof data.enabled !== 'boolean' || !validRevision(data.revision) || !['present','missing'].includes(data.registration)) throw new Error('INVALID_PUSH_RESPONSE');
      let matchingTransport = false;
      if (data.enabled && data.registration === 'present' && sentTransport) {
        const currentTransport = await inspectTransport(request);
        if (!owns(request)) return;
        matchingTransport = sameTransport(sentTransport, currentTransport);
      }
      revision = data.revision;
      state = data.enabled ? data.registration === 'present' && matchingTransport ? 'enabled' : 'repair' : 'disabled';
      emit();
    } catch (error) { failed(error, request, false); }
    finally { finish(request); }
  }
  async function enable() {
    if (!active || pending) return;
    if (!['disabled','repair'].includes(state) || !validRevision(revision) || revision === 2147483647) return;
    const expectedRevision = revision, request = begin(); if (!request) return;
    let submitted = false;
    try {
      const permission = await browser.requestPermission();
      if (!owns(request) || permission !== 'granted') return;
      const registration = await deadline(() => browser.ready());
      if (!owns(request)) return;
      let subscription = await deadline(() => registration.pushManager.getSubscription());
      if (!owns(request)) return;
      if (!subscription) {
        const publicKey = await deadline(async signal => {
          const response = await fetchImpl(baseUrl + '/api/push/vapid-public-key', {signal});
          if (!response.ok) throw new Error('VAPID_UNAVAILABLE');
          const data = await response.json();
          if (typeof data?.publicKey !== 'string' || !data.publicKey) throw new Error('INVALID_VAPID');
          return data.publicKey;
        });
        if (!owns(request)) return;
        subscription = await deadline(() => registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:browser.decodeKey(publicKey)}));
      }
      if (!owns(request)) return;
      const subscriptionJson = typeof subscription?.toJSON === 'function' ? subscription.toJSON() : subscription;
      if (!subscriptionJson || typeof subscriptionJson.endpoint !== 'string' || !subscriptionJson.endpoint || typeof subscriptionJson.keys?.p256dh !== 'string' || typeof subscriptionJson.keys?.auth !== 'string') throw new Error('INVALID_PUSH_SUBSCRIPTION');
      const body = {...request.context, consent_revision:expectedRevision, subscription:subscriptionJson, locale:browser.locale(), timezone:browser.timezone()};
      if (!owns(request)) return;
      submitted = true;
      const data = await requestJson('/api/push/subscribe', body, request);
      if (!owns(request)) return;
      if (data?.ok !== true || data.enabled !== true || !validRevision(data.revision) || data.revision <= expectedRevision) throw new Error('INVALID_PUSH_RESPONSE');
      revision = data.revision; state = 'enabled'; emit();
    } catch (error) { failed(error, request, submitted); }
    finally { finish(request); }
  }
  async function revoke() {
    const request = begin(); if (!request) return;
    const previousRevision = revision;
    try {
      const data = await requestJson('/api/push/revoke', request.context, request);
      if (!owns(request)) return;
      if (data?.ok !== true || data.enabled !== false || !validRevision(data.revision) || data.revision < 1 || validRevision(previousRevision) && data.revision <= previousRevision) throw new Error('INVALID_PUSH_RESPONSE');
      revision = data.revision; state = 'disabled'; emit();
    } catch (error) { failed(error, request, true); }
    finally { finish(request); }
  }
  function invalidate() { epoch += 1; revision = null; pending = false; state = 'unavailable'; emit(); }
  function dispose() { active = false; epoch += 1; pending = false; }
  return {refresh, enable, revoke, invalidate, dispose, snapshot:() => ({state,pending,revision})};
}
