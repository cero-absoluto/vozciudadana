import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {createSharedFundingAuthStore} from './sharedAuthStore.js';

export class FundingError extends Error {
  constructor(code, statusCode = 400) { super(code); this.code = code; this.statusCode = statusCode; }
}
const requireThat = (condition, code, status) => { if (!condition) throw new FundingError(code, status); };
const phone = value => {
  requireThat(typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value), 'invalid_phone');
  return value;
};
export function policyYear(date, timeZone) {
  return Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(date));
}
export function fundingTokens(secret, normalizedPhone, year, eventId = null) {
  const mac = (...parts) => createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex');
  return {
    annual: mac('voice-protest:funding:annual:v1', year, normalizedPhone),
    // UUID text case must not create a second financial identity for one event.
    event: eventId ? mac('voice-protest:funding:event:v1', eventId.toLowerCase(), normalizedPhone) : null,
  };
}

// Explicitly test-only composition. No Supabase, Twilio, Ko-fi or production imports.
export function createIsolatedFundingService({ database, simulator, secret, participationSecret,
  timeZone, mode, now = () => new Date() }) {
  requireThat(mode === 'isolated' && process.env.NODE_ENV !== 'production', 'isolated_only', 503);
  requireThat(typeof secret === 'string' && Buffer.byteLength(secret) >= 32 && secret !== participationSecret,
    'independent_funding_secret_required', 503);
  requireThat(typeof timeZone === 'string', 'policy_timezone_required', 503);
  policyYear(now(), timeZone); // Validate configuration, never silently pick the year timezone.
  requireThat(simulator?.kind === 'simulator', 'simulator_required', 503);
  const auth=createSharedFundingAuthStore(database);
  const hash = value => createHmac('sha256', secret).update(`rate:${value}`).digest('hex');
  const sessionDigest = value => createHmac('sha256',secret).update(JSON.stringify(['voice-protest:funding:session:v1',value])).digest('hex');
  async function authCall(operation) {
    let result;
    try {result=await operation();} catch {throw new FundingError('financial_auth_unavailable',503);}
    if(result?.error)throw new FundingError(result.error,result.error==='otp_rate_limit'?429:result.error==='otp_verification_unavailable'?503:401);
    return result;
  }
  async function bounded(operation,milliseconds) {
    let timer;
    try {return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('adapter_timeout')),Number(milliseconds));})]);}
    finally {clearTimeout(timer);}
  }
  async function session(id) {
    requireThat(typeof id==='string' && /^[0-9a-f-]{36}$/.test(id),'financial_session_required',401);
    const s=await authCall(()=>auth.session(sessionDigest(id)));
    requireThat(s,'financial_session_required',401);
    requireThat(s.year===policyYear(now(),timeZone),'reverify_for_policy_year',401);
    return s;
  }
  async function sql(text, values) {
    try { return await database.query(text, values); }
    catch (err) {
      const known = ['annual_limit','event_limit','event_not_open','event_not_enabled','idempotency_conflict',
        'provider_may_still_charge','unknown_intent','pending_items','insufficient_event_funds','not_ready'];
      const code = known.find(code => err.message?.includes(code));
      throw new FundingError(code || 'funding_operation_failed', code ? 409 : 503);
    }
  }
  return {
    async start({ phone: value, eventId = null }) {
      const normalized = phone(value);
      requireThat(eventId === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId), 'invalid_event');
      eventId = eventId === null ? null : eventId.toLowerCase();
      const rateKey=hash(normalized),year=policyYear(now(),timeZone),tokens=fundingTokens(secret,normalized,year,eventId);
      const id=randomUUID();
      const created=await authCall(()=>auth.start(id,rateKey,{tokens,year,eventId}));
      try {await bounded(()=>simulator.startOtp(id,normalized),created.sendTimeoutMilliseconds);} catch {
        await authCall(()=>auth.sent(id,false));
        throw new FundingError('otp_send_unavailable',503);
      }
      await authCall(()=>auth.sent(id,true));
      return {challengeId:id,expiresInSeconds:Number(created.expiresInSeconds)};
    },
    async verify({ challengeId, code }) {
      requireThat(typeof challengeId==='string' && /^[0-9a-f-]{36}$/.test(challengeId),'challenge_expired',401);
      const operation=randomUUID();
      const claimed=await authCall(()=>auth.claim(challengeId,operation));
      let ok;
      try {ok=await bounded(()=>simulator.verifyOtp(challengeId,code),claimed.leaseMilliseconds);} catch {
        await authCall(()=>auth.finish(challengeId,operation,'uncertain',null));
        throw new FundingError('otp_verification_unavailable',503);
      }
      const id=randomUUID();
      const result=await authCall(()=>auth.finish(challengeId,operation,ok?'valid':'invalid',sessionDigest(id)));
      return {session:id,expiresInSeconds:Number(result.expiresInSeconds),year:result.year};
    },
    async limits(sessionId) {
      const s = await session(sessionId);
      const r = await sql(`SELECT
        (SELECT committed+reserved FROM funding_private.annual_limits WHERE policy_year=$1 AND token=$2) AS annual_used,
        (SELECT committed+reserved FROM funding_private.event_limits WHERE event_id=$3 AND token=$4) AS event_used`,
        [s.year,s.tokens.annual,s.eventId,s.tokens.event]);
      return { year: s.year, annualRemainingCents: 100000-Number(r.rows[0].annual_used || 0),
        eventRemainingCents: s.eventId ? 10000-Number(r.rows[0].event_used || 0) : null };
    },
    async intent(sessionId, { kind, amountCents, currency = 'EUR' }) {
      const s = await session(sessionId);
      requireThat(currency === 'EUR' && Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 100000,
        'invalid_amount_or_currency');
      requireThat(kind === (s.eventId ? 'event' : 'general'), 'session_purpose_mismatch');
      const expiry = new Date(now().getTime()+600000);
      const r = await sql('SELECT funding_private.reserve($1,$2,$3,$4,$5,$6) AS id',
        [s.year,s.tokens.annual,s.tokens.event,s.eventId,amountCents,expiry]);
      const id = r.rows[0].id;
      // External work happens after the atomic reservation. Failure retains capacity safely.
      await simulator.checkout({ intentId: id, amountCents, currency });
      return { intentId: id, amountCents, currency, expiresAt: expiry.toISOString(), simulated: true };
    },
    async webhook(event, auth) {
      requireThat(simulator.authenticate(auth), 'invalid_provider_auth', 401);
      requireThat(typeof event.eventRef === 'string' && event.eventRef.length > 0 && event.eventRef.length <= 128,
        'invalid_provider_reference');
      requireThat(Number.isSafeInteger(event.amountCents) && event.amountCents>0, 'invalid_provider_amount');
      const r = await sql('SELECT funding_private.confirm($1,$2,$3,$4) AS result',
        [event.eventRef,event.intentId,event.amountCents,event.currency]);
      return { result: r.rows[0].result };
    },
    async summary() {
      const r = await sql(`SELECT kind,COALESCE(sum(balance),0) AS balance FROM funding_private.accounts
        WHERE kind IN ('general','event','restricted_grant') GROUP BY kind ORDER BY kind`, []);
      return { simulated: true, accounts: r.rows.map(row=>({kind:row.kind,balanceCents:Number(row.balance)})) };
    },
  };
}

export function createPaymentSimulator({ otpCode, webhookSecret }) {
  requireThat(/^\d{6}$/.test(otpCode || '') && typeof webhookSecret === 'string' && webhookSecret.length>=32,
    'simulator_configuration_required', 503);
  const challenges = new Set(), checkouts = new Map();
  return {
    kind: 'simulator',
    async startOtp(id) { challenges.add(id); }, // Deliberately no phone argument retained.
    async verifyOtp(id, code) {
      const a=Buffer.from(String(code)),b=Buffer.from(otpCode);
      const ok=challenges.has(id)&&a.length===b.length&&timingSafeEqual(a,b);
      if(ok) challenges.delete(id); return ok;
    },
    async checkout(intent) { checkouts.set(intent.intentId, {...intent}); },
    authenticate(value) {
      const a=Buffer.from(String(value || '')),b=Buffer.from(webhookSecret);
      return a.length===b.length&&timingSafeEqual(a,b);
    },
  };
}
