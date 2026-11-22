import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {createHash} from 'node:crypto';

// VP-FIN-001 — see supabase/migrations/20261122120000_atomic_kofi_credit.sql.
// routes/webhooks.js used to credit a donation across several independent
// Supabase round trips with no transaction, and the final financial_movements
// insert put two rows with the SAME tx_ref in one statement — self-conflicting
// against financial_movements_tx_ref_idx on every donation that had a
// resolved Ko-fi transaction id, not only on retries. By the time that insert
// failed, protests.saldo_euros/donaciones_total had already been credited,
// so every Ko-fi retry re-credited the balance while the audit trail
// (financial_movements) recorded nothing. Confirmed directly against a real
// Postgres 16 instance before writing this fix — not only unit-tested here.
//
// These tests exercise the real route against a fake Supabase client whose
// .rpc() stands in for the new atomic credit_kofi_donation() function, so
// they check what the ROUTE sends to the database (correct split, correct
// idempotency handling of the RPC's response) rather than Postgres itself.

process.env.KOFI_VERIFICATION_TOKEN = 'synthetic-kofi-token';
process.env.PLATFORM_FEE_PERCENT = '10';
process.env.MAX_DONATION_EUR = '100';

let rpcCalls = [];
let rpcResult = {data: {ok: true, duplicate: false, donation_id: 'synthetic-donation-id', protest_found: true}, error: null};
let fromCalls = [];
let mappingRow = null;

const database = {
  rpc(name, args) {
    rpcCalls.push({name, args});
    return Promise.resolve(rpcResult);
  },
  from(table) {
    fromCalls.push(table);
    const q = {
      select() { return q; },
      eq() { return q; },
      maybeSingle() { return Promise.resolve({data: mappingRow, error: null}); },
    };
    return q;
  },
};
mock.module('../apps/api/src/services/supabase.js', {namedExports: {supabase: database}});
const {default: kofiWebhookRoutes} = await import('../apps/api/src/routes/webhooks.js');

function reset(overrides = {}) {
  rpcCalls = [];
  fromCalls = [];
  mappingRow = null;
  rpcResult = {data: {ok: true, duplicate: false, donation_id: 'synthetic-donation-id', protest_found: true}, error: null};
  Object.assign({rpcResult}, overrides);
}

async function fixture() {
  const app = Fastify();
  await app.register(sensible);
  await app.register(kofiWebhookRoutes);
  await app.ready();
  return app;
}

function kofiPayload(fields) {
  const data = JSON.stringify({
    verification_token: 'synthetic-kofi-token',
    amount: '5.00',
    currency: 'EUR',
    kofi_transaction_id: 'synthetic-tx-1',
    ...fields,
  });
  return new URLSearchParams({data}).toString();
}

async function post(app, body) {
  return app.inject({
    method: 'POST',
    url: '/kofi',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    payload: body,
  });
}

test('valid Ko-fi webhook calls credit_kofi_donation once with the correct 90/10 split, never writes other tables directly', async () => {
  reset();
  process.env.KOFI_DEFAULT_PROTEST_ID = '11111111-1111-1111-1111-111111111111';
  const app = await fixture();
  try {
    const r = await post(app, kofiPayload({}));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), {ok: true, over_limit: false, importe_computable: 5, importe_excedente: 0});
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'credit_kofi_donation');
    const a = rpcCalls[0].args;
    assert.equal(a.p_protest_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(a.p_importe_computable, 5);
    assert.equal(a.p_importe_plataforma, 0.5);
    assert.equal(a.p_importe_convocatoria, 4.5);
    assert.equal(a.p_fee_percent, 10);
    assert.equal(a.p_over_limit, false);
    assert.equal(a.p_tx_ref, createHash('sha256').update('synthetic-tx-1').digest('hex').slice(0, 16));
    // No direct-link code in this payload, so the kofi_protest_map lookup is
    // skipped and the env-var fallback resolves protestId — meaning the ONLY
    // database access for this request is the RPC itself. The route must
    // never touch donaciones/protests/financial_movements/platform_fund
    // directly any more.
    assert.deepEqual(fromCalls, []);
  } finally {
    await app.close();
    delete process.env.KOFI_DEFAULT_PROTEST_ID;
  }
});

test('a Ko-fi retry (RPC reports duplicate) is surfaced as duplicate:true and nothing is treated as a new credit', async () => {
  reset();
  rpcResult = {data: {ok: true, duplicate: true}, error: null};
  const app = await fixture();
  try {
    const r = await post(app, kofiPayload({}));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), {ok: true, duplicate: true});
  } finally {
    await app.close();
  }
});

test('amounts over the policy limit are capped, the excess is sent to the RPC separately, and over_limit is reported', async () => {
  reset();
  const app = await fixture();
  try {
    const r = await post(app, kofiPayload({amount: '150.00'}));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), {ok: true, over_limit: true, importe_computable: 100, importe_excedente: 50});
    const a = rpcCalls[0].args;
    assert.equal(a.p_over_limit, true);
    assert.equal(a.p_importe_computable, 100);
    assert.equal(a.p_importe_excedente, 50);
    assert.equal(a.p_importe_original, 150);
  } finally {
    await app.close();
  }
});

test('credit_kofi_donation failing returns a generic 500 and never leaks database error detail', async () => {
  reset();
  rpcResult = {data: null, error: {message: 'relation "protests" does not exist — internal detail'}};
  const app = await fixture();
  try {
    const r = await post(app, kofiPayload({}));
    assert.equal(r.statusCode, 500);
    assert.ok(!r.body.includes('relation'));
    assert.deepEqual(r.json(), {error: 'Failed to record donation'});
  } finally {
    await app.close();
  }
});

test('an invalid verification token is rejected before the RPC is ever called', async () => {
  reset();
  const app = await fixture();
  try {
    const data = JSON.stringify({verification_token: 'wrong', amount: '5.00', kofi_transaction_id: 'x'});
    const r = await post(app, new URLSearchParams({data}).toString());
    assert.equal(r.statusCode, 401);
    assert.equal(rpcCalls.length, 0);
  } finally {
    await app.close();
  }
});

test('resolving protest_id through kofi_protest_map takes priority over the env-var fallback', async () => {
  reset();
  mappingRow = {protest_id: '22222222-2222-2222-2222-222222222222'};
  process.env.KOFI_DEFAULT_PROTEST_ID = '11111111-1111-1111-1111-111111111111';
  const app = await fixture();
  try {
    const r = await post(app, kofiPayload({shop_items: [{direct_link_code: 'abc'}]}));
    assert.equal(r.statusCode, 200);
    assert.equal(rpcCalls[0].args.p_protest_id, '22222222-2222-2222-2222-222222222222');
  } finally {
    await app.close();
    delete process.env.KOFI_DEFAULT_PROTEST_ID;
  }
});
