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
  async function temporalContext() {
    let context;
    try {context=(await database.query('SELECT funding_private.temporal_context() AS context',[])).rows[0].context;}
    catch {throw new FundingError('financial_auth_unavailable',503);}
    requireThat(context?.timeZone===timeZone,'policy_timezone_mismatch',503);
    return context;
  }
  async function session(id) {
    requireThat(typeof id==='string' && /^[0-9a-f-]{36}$/.test(id),'financial_session_required',401);
    const s=await authCall(()=>auth.session(sessionDigest(id)));
    requireThat(s,'financial_session_required',401);
    requireThat(s.year===(await temporalContext()).year,'reverify_for_policy_year',401);
    return s;
  }
  async function sql(text, values) {
    try { return await database.query(text, values); }
    catch (err) {
      const known = ['annual_limit','event_limit','event_not_open','event_not_enabled','idempotency_conflict',
        'provider_may_still_charge','unknown_intent','pending_items','insufficient_event_funds','not_ready','funding_window_closed','reverify_for_policy_year','temporal_evidence_required','fee_bound_required','operational_budget_insufficient','financial_exposure_pending','owner_decision_required','refund_source_insufficient','refund_exceeds_gross','dispute_review_required'];
      const code = known.find(code => err.message?.includes(code));
      throw new FundingError(code || 'funding_operation_failed', code ? 409 : 503);
    }
  }
  return {
    async start({ phone: value, eventId = null }) {
      const normalized = phone(value);
      requireThat(eventId === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId), 'invalid_event');
      eventId = eventId === null ? null : eventId.toLowerCase();
      const year=(await temporalContext()).year,rateKey=hash(normalized),tokens=fundingTokens(secret,normalized,year,eventId);
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
      const r = await sql('SELECT funding_private.reserve_with_fee_v3($1,$2,$3,$4,$5,$6,$7,$8) AS id',
        [s.year,s.tokens.annual,s.tokens.event,s.eventId,amountCents,simulator.minimumCheckoutSeconds || 1,simulator.feeBoundCents,simulator.feeBoundKnown]);
      const id=r.rows[0].id;
      const row=(await sql('SELECT created_at,valid_until FROM funding_private.temporal_intents WHERE intent_id=$1',[id])).rows[0];
      const expiry=new Date(row.valid_until).toISOString();
      const checkout=await simulator.checkout({intentId:id,amountCents,currency,expiresAt:expiry});
      requireThat(checkout?.expiresAt===expiry,'checkout_deadline_mismatch',503);
      return {intentId:id,amountCents,currency,expiresAt:expiry,simulated:true,policyVersion:2,financialModelVersion:3};
    },
    async webhook(event, auth) {
      requireThat(simulator.authenticate(auth),'invalid_provider_auth',401);
      requireThat(typeof event.eventRef==='string' && event.eventRef.length>0 && event.eventRef.length<=128,'invalid_provider_reference');
      requireThat(Number.isSafeInteger(event.amountCents) && event.amountCents>0,'invalid_provider_amount');
      // Adapter-owned evidence; caller-provided paidAt is never used as proof.
      const proof=await simulator.paymentEvidence({eventRef:event.eventRef,intentId:event.intentId,amountCents:event.amountCents,currency:event.currency});
      requireThat(proof.intentId===event.intentId && proof.amountCents===event.amountCents && proof.currency===event.currency,'provider_evidence_mismatch',409);
      const r=await sql('SELECT funding_private.confirm_v2($1,$2,$3,$4,$5,$6,$7) AS result',
        [event.eventRef,proof.paymentRef,event.intentId,event.amountCents,event.currency,proof.effectivePaidAt,proof.semantic]);
      return {result:r.rows[0].result};
    },
    async movement(event, authorization) {
      requireThat(simulator.authenticate(authorization),'invalid_provider_auth',401);
      requireThat(typeof event.movementRef==='string' && event.movementRef.length>0 && event.movementRef.length<=128,'invalid_provider_reference');
      requireThat(typeof event.kind==='string' && event.kind.length>0 && event.kind.length<=64 && Number.isSafeInteger(event.amountCents),'invalid_provider_amount');
      const proof=await simulator.movementEvidence({movementRef:event.movementRef,intentId:event.intentId,kind:event.kind,amountCents:event.amountCents,currency:event.currency,operationRef:event.operationRef??null,relatedRef:event.relatedRef??null});
      for(const key of ['intentId','kind','amountCents','currency','operationRef','relatedRef'])requireThat(proof[key]===(event[key]??null),'provider_evidence_mismatch',409);
      const r=await sql('SELECT funding_private.record_provider_movement($1,$2,$3,$4,$5,$6,$7,$8) AS result',[event.movementRef,proof.intentId,proof.kind,proof.amountCents,proof.currency,proof.operationRef,proof.relatedRef,proof.effectiveAt]);
      return {result:r.rows[0].result,simulated:true};
    },
    async movementStatus(authorization) {
      requireThat(simulator.authenticate(authorization),'invalid_provider_auth',401);
      const r=await sql(`SELECT m.currency,count(*) FILTER(WHERE a.movement_ref IS NULL) AS unallocated,
        COALESCE(sum(m.amount) FILTER(WHERE a.movement_ref IS NULL),0) AS unallocated_amount,
        COALESCE(-sum(m.amount) FILTER(WHERE a.movement_ref IS NULL AND m.amount<0),0) AS unallocated_debits,
        COALESCE(sum(m.amount) FILTER(WHERE a.movement_ref IS NULL AND m.amount>0),0) AS unallocated_credits
        FROM funding_private.provider_movements m LEFT JOIN funding_private.movement_allocations a USING(movement_ref) GROUP BY m.currency ORDER BY m.currency`,[]);
      const blocked=(await sql('SELECT funding_private.has_pending_exposure() AS blocked',[])).rows[0].blocked;
      return {simulated:true,cashReconciliation:'not_certified',newCommitmentsPaused:blocked,
        movements:r.rows.map(row=>({currency:row.currency,unallocatedCount:Number(row.unallocated),unallocatedAmountCents:Number(row.unallocated_amount),unallocatedDebitsCents:Number(row.unallocated_debits),unallocatedCreditsCents:Number(row.unallocated_credits)}))};
    },
    async summary() {
      const r = await sql(`SELECT kind,COALESCE(sum(balance),0) AS balance FROM funding_private.accounts
        WHERE kind IN ('general','event','restricted_grant') GROUP BY kind ORDER BY kind`, []);
      return { simulated: true, balanceBasis:'fund_allocations', cashReconciliation:'not_certified', accounts: r.rows.map(row=>({kind:row.kind,balanceCents:Number(row.balance)})) };
    },
  };
}

export function createPaymentSimulator({ otpCode, webhookSecret, minimumCheckoutSeconds=1, feeBoundCents=0, feeBoundKnown=true, now=()=>new Date() }) {
  requireThat(/^\d{6}$/.test(otpCode || '') && typeof webhookSecret === 'string' && webhookSecret.length>=32,
    'simulator_configuration_required', 503);
  requireThat(Number.isSafeInteger(minimumCheckoutSeconds) && minimumCheckoutSeconds>=1,'simulator_window_required',503);
  const challenges = new Set(), checkouts = new Map(), paidEvents=new Map(),movements=new Map();
  return {
    kind: 'simulator',minimumCheckoutSeconds,feeBoundCents,feeBoundKnown,
    async startOtp(id) { challenges.add(id); }, // Deliberately no phone argument retained.
    async verifyOtp(id, code) {
      const a=Buffer.from(String(code)),b=Buffer.from(otpCode);
      const ok=challenges.has(id)&&a.length===b.length&&timingSafeEqual(a,b);
      if(ok) challenges.delete(id); return ok;
    },
    async checkout(intent) {
      const t=new Date(await now());
      requireThat(new Date(intent.expiresAt).getTime()-t.getTime()>=minimumCheckoutSeconds*1000,'funding_window_closed',409);
      checkouts.set(intent.intentId,{...intent});return {expiresAt:intent.expiresAt};
    },
    async recordPayment(event,effectivePaidAt=null) {
      const proof={intentId:event.intentId,amountCents:event.amountCents,currency:event.currency,paymentRef:event.paymentRef || event.eventRef,effectivePaidAt:new Date(effectivePaidAt ?? await now()).toISOString(),semantic:'simulator_successful_payment:v2'};
      paidEvents.set(event.eventRef,proof);return proof;
    },
    async paymentEvidence(event) {
      if(paidEvents.has(event.eventRef))return paidEvents.get(event.eventRef);
      // Authenticated mock callback represents immediate simulated payment only.
      // Delayed cases explicitly record the payment before delivering its notification.
      return this.recordPayment(event);
    },
    async recordMovement(event,effectiveAt=null) {
      const proof={...event,effectiveAt:new Date(effectiveAt??await now()).toISOString()};
      movements.set(event.movementRef,proof);return proof;
    },
    async movementEvidence(event) {
      if(movements.has(event.movementRef))return movements.get(event.movementRef);
      return this.recordMovement(event);
    },
    authenticate(value) {
      const a=Buffer.from(String(value || '')),b=Buffer.from(webhookSecret);
      return a.length===b.length&&timingSafeEqual(a,b);
    },
  };
}
