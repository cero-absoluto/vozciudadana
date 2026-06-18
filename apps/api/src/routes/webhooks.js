import { supabase } from '../services/supabase.js';
import { createHash } from 'crypto';

// ── Configurable costs and fees (shared with protests.js — set via Railway env vars) ──
const PLATFORM_FEE_PCT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '10') / 100;

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
  app.post('/kofi', {
    schema: {
      body: {
        type: 'object',
        required: ['data'],
        properties: {
          data: { type: 'string' },
        },
        additionalProperties: true, // Ko-fi may send extra fields we don't declare or use
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
      app.log.error('KOFI_VERIFICATION_TOKEN not configured — rejecting webhook');
      return reply.status(500).send({ error: 'Webhook not configured' });
    }
    if (payload.verification_token !== expectedToken) {
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

    // protest_id is matched via the Ko-fi "Direct Link" / shop-item identifier
    // or a custom field set up per-protest in Ko-fi. Falls back to a single
    // configured default protest if no mapping is found (useful while only
    // one protest accepts donations at a time, e.g. during the beta).
    const protestId = payload.shop_items?.[0]?.direct_link_code
      || process.env.KOFI_DEFAULT_PROTEST_ID
      || null;

    if (!protestId) {
      app.log.warn('Ko-fi webhook received with no matching protest_id — recording to platform fund only');
    }

    // Non-identifying technical reference: hash the Ko-fi transaction id so
    // we can de-duplicate retried webhooks without storing anything that
    // could be correlated back to the donor by a third party.
    const txRef = txId
      ? createHash('sha256').update(txId).digest('hex').slice(0, 16)
      : null;

    // ── De-duplication: Ko-fi may retry the same webhook ─────────────────
    if (txRef) {
      const { data: existing } = await supabase
        .from('financial_movements')
        .select('id')
        .eq('tx_ref', txRef)
        .maybeSingle();
      if (existing) {
        return { ok: true, duplicate: true };
      }
    }

    const importe_plataforma   = parseFloat((importe * PLATFORM_FEE_PCT).toFixed(2));
    const importe_convocatoria = parseFloat((importe - importe_plataforma).toFixed(2));

    if (protestId) {
      const { data: protest } = await supabase
        .from('protests')
        .select('saldo_euros, donaciones_count, donaciones_total')
        .eq('id', protestId)
        .maybeSingle();

      if (protest) {
        await supabase.from('protests').update({
          saldo_euros:      (protest.saldo_euros || 0) + importe_convocatoria,
          donaciones_count: (protest.donaciones_count || 0) + 1,
          donaciones_total: (protest.donaciones_total || 0) + importe,
          ultima_donacion:  new Date().toISOString(),
        }).eq('id', protestId);

        // Aggregate-only donation record — no donor fields stored.
        await supabase.from('donaciones').insert({
          protest_id:            protestId,
          importe,
          importe_convocatoria,
          importe_plataforma,
          fee_percent:           Math.round(PLATFORM_FEE_PCT * 100),
          proveedor:              'kofi',
          moneda,
        });
      } else {
        app.log.warn(`Ko-fi webhook: protest_id ${protestId} not found — crediting platform fund only`);
      }
    }

    await supabase.from('platform_fund').insert({
      type:        'income',
      amount:      importe_plataforma,
      source:      'donation_fee',
      protest_id:  protestId,
      description: `${Math.round(PLATFORM_FEE_PCT * 100)}% platform fee from Ko-fi donation of ${moneda} ${importe}`,
    });

    await supabase.from('financial_movements').insert([
      {
        type:        'donation_protest',
        protest_id:  protestId,
        amount:      importe_convocatoria,
        destination: 'protest_balance',
        description: `Ko-fi donation credited to protest (${100 - Math.round(PLATFORM_FEE_PCT * 100)}%)`,
        tx_ref:      txRef,
      },
      {
        type:        'donation_platform',
        protest_id:  protestId,
        amount:      importe_plataforma,
        destination: 'platform_fund',
        description: `Platform fee from Ko-fi donation (${Math.round(PLATFORM_FEE_PCT * 100)}%)`,
        tx_ref:      txRef,
      },
    ]);

    return { ok: true };
  });
}
