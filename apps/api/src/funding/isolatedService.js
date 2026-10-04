import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

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
  const challenges = new Map(), sessions = new Map(), attempts = new Map();
  const hash = value => createHmac('sha256', secret).update(`rate:${value}`).digest('hex');
  const clean = () => {
    for (const map of [challenges, sessions]) for (const [id, item] of map) if (item.expires <= now().getTime()) map.delete(id);
    for (const [id, item] of attempts) if (item.until <= now().getTime()) attempts.delete(id);
  };
  function session(id) {
    clean(); const s = sessions.get(id);
    requireThat(s, 'financial_session_required', 401);
    requireThat(s.year === policyYear(now(), timeZone), 'reverify_for_policy_year', 401);
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
      clean(); const normalized = phone(value);
      requireThat(eventId === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId), 'invalid_event');
      eventId = eventId === null ? null : eventId.toLowerCase();
      const rateKey = hash(normalized), rate = attempts.get(rateKey) || { count: 0, until: now().getTime()+600000 };
      requireThat(rate.count++ < 3, 'otp_rate_limit', 429); attempts.set(rateKey, rate);
      const year = policyYear(now(), timeZone), tokens = fundingTokens(secret, normalized, year, eventId);
      const id = randomUUID();
      await simulator.startOtp(id, normalized); // Simulator discards phone; no phone is stored below.
      challenges.set(id, { tokens, year, eventId, rateKey, tries: 0, expires: now().getTime()+300000 });
      return { challengeId: id, expiresInSeconds: 300 };
    },
    async verify({ challengeId, code }) {
      clean(); const c = challenges.get(challengeId);
      requireThat(c && ++c.tries <= 5, 'challenge_expired', 401);
      requireThat(await simulator.verifyOtp(challengeId, code), 'invalid_otp', 401);
      challenges.delete(challengeId);
      const id = randomUUID(); sessions.set(id, { ...c, expires: now().getTime()+600000 });
      return { session: id, expiresInSeconds: 600, year: c.year };
    },
    async limits(sessionId) {
      const s = session(sessionId);
      const r = await sql(`SELECT
        (SELECT committed+reserved FROM funding_private.annual_limits WHERE policy_year=$1 AND token=$2) AS annual_used,
        (SELECT committed+reserved FROM funding_private.event_limits WHERE event_id=$3 AND token=$4) AS event_used`,
        [s.year,s.tokens.annual,s.eventId,s.tokens.event]);
      return { year: s.year, annualRemainingCents: 100000-Number(r.rows[0].annual_used || 0),
        eventRemainingCents: s.eventId ? 10000-Number(r.rows[0].event_used || 0) : null };
    },
    async intent(sessionId, { kind, amountCents, currency = 'EUR' }) {
      const s = session(sessionId);
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
