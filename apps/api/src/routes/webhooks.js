import {credentialMatches} from '../lib/credentialMatches.js';
import {supabase} from '../services/supabase.js';
import {withRequestDeadline} from '../lib/requestDeadline.js';
import {createHash} from 'node:crypto';

// Integer cents/basis points throughout; reject partial parses, infinities and
// sub-cent amounts instead of silently changing a payment's financial meaning.
const decimalHundredths = value => {
  if (!['string','number'].includes(typeof value)) return null;
  const text = String(value);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
};
const utcTimestamp = (value, precision = 7) => {
  if (typeof value !== 'string' || !new RegExp('^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,' + precision + '})?Z$').test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19) !== value.slice(0,19)) return null;
  return date;
};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function kofiWebhookRoutes(app) {
  app.addContentTypeParser('application/x-www-form-urlencoded', {parseAs:'string'}, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body))); }
    catch (error) { done(error); }
  });
  app.post('/kofi', {schema:{body:{type:'object',required:['data'],properties:{data:{type:'string'}},additionalProperties:true}}}, async (req, reply) => {
    let payload;
    try { payload = JSON.parse(req.body.data); }
    catch { return reply.status(400).send({error:'Invalid payload'}); }
    const expectedToken = process.env.KOFI_VERIFICATION_TOKEN;
    if (!expectedToken) return reply.status(503).send({error:'KOFI_UNAVAILABLE'});
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !credentialMatches(payload.verification_token, expectedToken)) return reply.status(401).send({error:'Invalid verification token'});

    // Read no donor name/email/message/processor identity; hash the technical
    // transaction reference before crossing the persistence boundary.
    const amount = decimalHundredths(payload.amount);
    if (amount === null || amount <= 0 || amount > 9999999999) return reply.status(400).send({error:'Invalid amount'});
    // Proposed cutover contract: keep disabled until the Owner approves a
    // provider timestamp sample and an explicit UTC activation boundary.
    const cutover = utcTimestamp(process.env.KOFI_ATOMIC_CUTOVER_UTC, 3);
    if (!cutover || cutover.getTime() > Date.now()) return reply.status(503).send({error:'KOFI_CUTOVER_REQUIRED'});
    const paidAt = utcTimestamp(payload.timestamp);
    if (!paidAt || paidAt < cutover || paidAt.getTime() > Date.now()) return reply.status(422).send({error:'KOFI_TIMESTAMP_REVIEW_REQUIRED'});
    const cap = decimalHundredths(process.env.MAX_DONATION_EUR ?? '100');
    const feeBps = decimalHundredths(process.env.PLATFORM_FEE_PERCENT ?? '10');
    if (cap === null || cap <= 0 || cap > 9999999999 || feeBps === null || feeBps < 0 || feeBps > 10000) return reply.status(503).send({error:'KOFI_CONFIGURATION_INVALID'});
    if (typeof payload.currency !== 'string' || payload.currency.toUpperCase() !== 'EUR') return reply.status(422).send({error:'KOFI_CURRENCY_REVIEW_REQUIRED'});
    // A delivery/message ID is not assumed to identify a stable payment.
    const txId = payload.kofi_transaction_id;
    if (typeof txId !== 'string' || !txId.trim() || txId.length > 512) return reply.status(422).send({error:'KOFI_TRANSACTION_ID_REQUIRED'});
    if (payload.shop_items != null && !Array.isArray(payload.shop_items)) return reply.status(400).send({error:'KOFI_TARGET_INVALID'});
    const directLink = payload.shop_items?.[0]?.direct_link_code;
    if (directLink != null && (typeof directLink !== 'string' || !directLink || directLink.length > 512)) return reply.status(400).send({error:'KOFI_TARGET_INVALID'});

    try {
      let protestId = process.env.KOFI_DEFAULT_PROTEST_ID || null;
      if (directLink != null) {
        const {data, error} = await withRequestDeadline(8000, signal => supabase.from('kofi_protest_map').select('protest_id').eq('kofi_code', directLink).eq('active', true).maybeSingle().abortSignal(signal));
        if (error) throw new Error('KOFI_STORAGE_FAILED');
        // A supplied but unmapped code must not silently credit the default.
        protestId = data?.protest_id ?? null;
      }
      if (!uuid(protestId)) return reply.status(422).send({error:'KOFI_TARGET_REVIEW_REQUIRED'});
      const txHash = createHash('sha256').update(txId).digest('hex');
      const {data, error} = await withRequestDeadline(8000, signal => supabase.rpc('record_kofi_donation_atomic', {
        p_tx_hash:txHash, p_amount_cents:amount, p_currency:'EUR', p_protest_id:protestId,
        p_cap_cents:cap, p_fee_bps:feeBps, p_paid_at:paidAt.toISOString(), p_cutover_at:cutover.toISOString(),
      }).abortSignal(signal));
      if (error) {
        const code = ['KOFI_LEGACY_REVIEW_REQUIRED','KOFI_TRANSACTION_CONFLICT','KOFI_TARGET_REVIEW_REQUIRED','KOFI_FUND_REVIEW_REQUIRED'].find(code => typeof error.message === 'string' && error.message.includes(code));
        if (code) return reply.status(409).send({error:code});
        throw new Error('KOFI_STORAGE_FAILED');
      }
      const computable = Math.min(amount, cap), excess = amount - computable;
      if (data?.ok !== true || typeof data.duplicate !== 'boolean' || data.over_limit !== (excess > 0) || data.importe_computable !== computable / 100 || data.importe_excedente !== excess / 100) throw new Error('KOFI_RESPONSE_INVALID');
      return {ok:true,duplicate:data.duplicate,over_limit:data.over_limit,importe_computable:data.importe_computable,importe_excedente:data.importe_excedente};
    } catch {
      // A lost response can follow a committed transaction. Never claim success
      // or retry here: the provider's next delivery reconciles by the receipt.
      return reply.status(503).send({error:'KOFI_UNAVAILABLE'});
    }
  });
}
