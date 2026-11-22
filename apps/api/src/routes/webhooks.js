import {credentialMatches} from '../lib/credentialMatches.js';
import { supabase } from '../services/supabase.js';
import { createHash } from 'crypto';

// ── Configurable costs and fees (shared with protests.js — set via Railway env vars) ──
const PLATFORM_FEE_PCT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '10') / 100;
const MAX_DONATION_EUR = parseFloat(process.env.MAX_DONATION_EUR || '100');

/**
 * Ko-fi webhook handler.
 *
 * DESIGN PRINCIPLE — strict minimization at the donation boundary:
 * Ko-fi/PayPal act as third-party payment processors and may know the donor's
 * identity (name, email, message). Voice Protest does not. This handler reads
 * only the fields needed to update aggregate financial state and immediately
 * discards everything else. No donor name, email, message, or PayPal account
 * is ever written to the database — this mirrors the same minimization
 * principle already applied to phone numbers in the adhesion flow.
 *
 * Ko-fi sends the payload as a single 'data' form field containing a JSON string.
 * See: https://ko-fi.com/manage/webhooks
 *
 * @param {import('fastify').FastifyInstance} app
 */
export default async function kofiWebhookRoutes(app) {
  // Ko-fi sends webhooks as application/x-www-form-urlencoded with a single
  // 'data' field containing a JSON string. Fastify needs an explicit parser
  // for this content type — without it, the server returns 415.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const parsed = Object.fromEntries(new URLSearchParams(body));
        done(null, parsed);
      } catch (err) {
        done(err);
      }
    }
  );

  app.post('/kofi', {
    schema: {
      body: {
        type: 'object',
        required: ['data'],
        properties: {
          data: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    let payload;
    try {
      payload = JSON.parse(req.body.data);
    } catch {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    // ── Verify the request is genuinely from Ko-fi ──────────────────────
    const expectedToken = process.env.KOFI_VERIFICATION_TOKEN;
    if (!expectedToken) {
      app.log.error({code:'kofi_unconfigured'});
      return reply.status(500).send({ error: 'Webhook not configured' });
    }
    if (!payload || typeof payload!=='object' || Array.isArray(payload) || !credentialMatches(payload.verification_token,expectedToken)) {
      return reply.status(401).send({ error: 'Invalid verification token' });
    }

    // ── Extract ONLY the non-identifying fields we need ─────────────────
    // Everything else in `payload` (from_name, email, message, paypal info,
    // etc.) is intentionally never read past this point and is discarded
    // when this function returns.
    const importe = parseFloat(payload.amount);
    const moneda  = (payload.currency || 'EUR').toUpperCase();
    const txId    = payload.kofi_transaction_id || payload.message_id || '';

    if (!importe || importe <= 0) {
      return reply.status(400).send({ error: 'Invalid amount' });
    }

    // ── Policy limit: €100 per contribution (Funding Policy) ─────────────
    // The payment has already been processed by Ko-fi/PayPal before this
    // webhook fires. Returning 400 would leave the donor in an absurd
    // situation: they paid but Voice Protest didn't register it.
    //
    // Instead: accept the webhook (always return 200 for authentic payments),
    // but cap the computable amount at MAX_DONATION_EUR. Any excess is recorded
    // as 'over_limit_pending_review' and does NOT flow automatically to either
    // the protest balance or the platform fund. A human reviews it.
    const over_limit = importe > MAX_DONATION_EUR;
    const importe_computable = over_limit ? MAX_DONATION_EUR : importe;
    const importe_excedente  = over_limit ? parseFloat((importe - MAX_DONATION_EUR).toFixed(2)) : 0;

    if (over_limit) {
      app.log.warn({code:'kofi_over_limit'});
    }

    // protest_id resolution — three-step lookup in priority order:
    //
    // 1. Ko-fi "Direct Link" code embedded in the shop item (set per-protest
    //    in the Ko-fi dashboard when creating a dedicated donation button).
    // 2. A mapping table in Supabase (kofi_protest_map) keyed on the same
    //    direct_link_code — allows managing mappings without redeploying.
    // 3. Environment variable fallback for single-protest beta deployments.
    //
    // This three-step approach lets the platform scale to multiple concurrent
    // fundraising protests without code changes: add a row to kofi_protest_map
    // and configure the Ko-fi button to match.
    const directLinkCode = payload.shop_items?.[0]?.direct_link_code || null;
    let protestId = null;

    if (directLinkCode) {
      const { data: mapping } = await supabase
        .from('kofi_protest_map')
        .select('protest_id')
        .eq('kofi_code', directLinkCode)
        .eq('active', true)
        .maybeSingle();
      if (mapping) protestId = mapping.protest_id;
    }

    // Fallback to env default (beta: only one protest accepts donations at a time)
    if (!protestId) protestId = process.env.KOFI_DEFAULT_PROTEST_ID || null;

    if (!protestId) {
      app.log.warn({code:'kofi_target_unresolved'});
    }

    // Non-identifying technical reference: hash the Ko-fi transaction id so
    // we can de-duplicate retried webhooks without storing anything that
    // could be correlated back to the donor by a third party.
    const txRef = txId
      ? createHash('sha256').update(txId).digest('hex').slice(0, 16)
      : null;

    const importe_plataforma   = parseFloat((importe_computable * PLATFORM_FEE_PCT).toFixed(2));
    const importe_convocatoria = parseFloat((importe_computable - importe_plataforma).toFixed(2));

    // All of this — the tx_ref idempotency gate, the protest balance
    // increment, and the donaciones/platform_fund/financial_movements rows —
    // happens in one Postgres transaction (credit_kofi_donation, VP-FIN-001
    // fix, 22 Nov 2026). Previously this was several independent Supabase
    // round trips with no transaction, and the final financial_movements
    // insert self-conflicted on tx_ref for every donation (two rows, same
    // tx_ref, one statement) — by the time that insert failed, the protest
    // balance had already been credited, so every Ko-fi retry re-credited
    // it again with nothing recorded in the audit trail. See the migration
    // for the full history.
    const { data: result, error: creditError } = await supabase.rpc('credit_kofi_donation', {
      p_tx_ref:               txRef,
      p_protest_id:           protestId,
      p_moneda:               moneda,
      p_importe_original:     importe,
      p_importe_computable:   importe_computable,
      p_importe_convocatoria: importe_convocatoria,
      p_importe_plataforma:   importe_plataforma,
      p_importe_excedente:    importe_excedente,
      p_fee_percent:          Math.round(PLATFORM_FEE_PCT * 100),
      p_over_limit:           over_limit,
    });

    if (creditError) {
      app.log.error({code: 'kofi_credit_failed'});
      return reply.status(500).send({ error: 'Failed to record donation' });
    }

    if (result?.duplicate) {
      return { ok: true, duplicate: true };
    }

    if (protestId && !result?.protest_found) {
      app.log.warn({code:'kofi_target_missing'});
    }

    return { ok: true, over_limit, importe_computable, importe_excedente };
  });
}
