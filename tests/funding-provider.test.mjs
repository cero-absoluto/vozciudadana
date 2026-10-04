import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import Fastify from 'fastify';
import {fundingParentFixtureSQL,fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration} from './helpers/funding-fixture.mjs';
import {createIsolatedFundingService} from '../apps/api/src/funding/isolatedService.js';
import {checkoutCapability,createOfflineFixtureTransport,createOfflineProviderAdapter,offlineProviderRoutes} from '../apps/api/src/funding/offlineProvider.js';
const db=new PGlite();after(()=>db.close());await db.exec(fundingParentFixtureSQL);
for(const m of [fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration])await db.exec(await readFile(m,'utf8'));
await db.exec("CREATE TABLE funding_private.fixture_provider_clock(t timestamptz NOT NULL);INSERT INTO funding_private.fixture_provider_clock VALUES('2030-06-01T12:00:00Z');GRANT SELECT ON funding_private.fixture_provider_clock TO funding_runtime;CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$ SELECT t FROM funding_private.fixture_provider_clock $$;");
await db.exec('SET ROLE funding_runtime');
const q=(s,a=[])=>db.query(s,a),scalar=async(s,a)=>Object.values((await q(s,a)).rows[0])[0];
const now=()=>scalar('SELECT funding_private.temporal_now()');
async function admin(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE funding_runtime');}}
const clock=t=>admin(()=>q('UPDATE funding_private.fixture_provider_clock SET t=$1',[t]));
const secret='w'.repeat(32),transport=createOfflineFixtureTransport({mode:'isolated',otpCode:'123456',signingSecret:secret,now});
const adapter=createOfflineProviderAdapter({mode:'isolated',database:db,transport,signingSecret:secret,now,minimumCheckoutSeconds:60}); // Synthetic capability only; Stripe minimum remains1800.
const service=createIsolatedFundingService({database:db,simulator:adapter,secret:'f'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
let n=0;
async function verified(s=service,e=null){const phone='+34970000'+String(++n).padStart(4,'0'),c=await s.start({phone,eventId:e}),v=await s.verify({challengeId:c.challengeId,code:'123456'});return {...v,challengeId:c.challengeId,phone};}
async function intent(e=null){const v=await verified(service,e),i=await service.intent(v.session,{kind:e?'event':'general',amountCents:1000});return {...i,session:v.session};}
const sign=async(raw,t=null)=>{t??=Math.floor(new Date(await now()).getTime()/1000);return `t=${t},v1=${createHmac('sha256',secret).update(String(t)+'.').update(raw).digest('hex')}`;};
async function mutate(w,fn){const payload=JSON.parse(w.raw.toString());fn(payload);const raw=Buffer.from(JSON.stringify(payload));return {raw,signature:await sign(raw)};}
async function event(){const e=randomUUID();await admin(()=>q("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,'2030-01-01','2031-01-01',0.9,'historic')",[e]));await q("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);return e;}
const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('offline_network_forbidden');};after(()=>{globalThis.fetch=oldFetch;});

test('transport is closed/offline; spoofed transport and production composition are refused',()=>{
 assert.throws(()=>createOfflineProviderAdapter({mode:'isolated',database:db,transport:{kind:'offline_fixture',baseURL:'https://example.com'},signingSecret:secret}),/closed_offline_transport_required/);
 assert.throws(()=>createOfflineFixtureTransport({mode:'production',otpCode:'123456',signingSecret:secret}),/isolated_only/);
});
test('documented 30-minute checkout cannot fit ten-minute policy: no transport or quota mutation',async()=>{
 const a=createOfflineProviderAdapter({mode:'isolated',database:db,transport,signingSecret:secret,now});
 const s=createIsolatedFundingService({database:db,simulator:a,secret:'g'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'}),v=await verified(s),before=transport.stats();
 await assert.rejects(s.intent(v.session,{kind:'general',amountCents:1000}),e=>e.code==='funding_window_closed');assert.equal(transport.stats().checkoutCreates,before.checkoutCreates);assert.equal((await s.limits(v.session)).annualRemainingCents,100000);
});
test('provider creation clock and integer-second expiry are checked independently of local reservation',()=>{
 assert.throws(()=>checkoutCapability({createdAt:'2030-01-01T00:00:00.500Z',expiresAt:'2030-01-01T00:30:00.500Z',minimumSeconds:1800}),/funding_window_closed/);
 const c=checkoutCapability({createdAt:'2030-01-01T00:00:00Z',expiresAt:'2030-01-01T00:31:00.999Z',minimumSeconds:1800});assert.equal(c.expiresAt,'2030-01-01T00:31:00.000Z');
});
test('OTP reference survives adapter recomposition; provider response PII and phone are not persisted',async()=>{
 const phone='+349710000001',c=await service.start({phone});
 const a=createOfflineProviderAdapter({mode:'isolated',database:db,transport,signingSecret:secret,now,minimumCheckoutSeconds:60}),s=createIsolatedFundingService({database:db,simulator:a,secret:'f'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 const v=await s.verify({challengeId:c.challengeId,code:'123456'});assert.equal((await s.limits(v.session)).annualRemainingCents,100000);
 const state=JSON.stringify((await q('SELECT * FROM funding_private.fixture_otp_bindings')).rows);assert.ok(!state.includes(phone));assert.ok(!state.includes('discard@example.invalid'));assert.ok(!state.includes('123456'));assert.match(state,/VE[0-9a-f]{32}/);
 await assert.rejects(q("SELECT funding_private.bind_fixture_otp($1,$2,'participation')",[c.challengeId,'VE'+'1'.repeat(32)]),/fixture_otp_binding_invalid/);
});
test('OTP check without active shared claim, with expired lease or missing binding fails closed',async()=>{
 const c=await service.start({phone:'+349710000002'});await assert.rejects(adapter.verifyOtp(c.challengeId,'123456'),e=>e.code==='fixture_otp_binding_invalid');
 await q('SELECT funding_auth_private.claim_challenge($1,$2)',[c.challengeId,randomUUID()]);await admin(()=>q("UPDATE funding_auth_private.otp_challenges SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[c.challengeId]));await assert.rejects(adapter.verifyOtp(c.challengeId,'123456'),e=>e.code==='fixture_otp_binding_invalid');
});
test('provider OTP fault cannot create a session or trigger a process fallback',async()=>{
 const c=await service.start({phone:'+349710000003'});transport.setFault('otp_check');try{await assert.rejects(service.verify({challengeId:c.challengeId,code:'123456'}),e=>e.code==='otp_verification_unavailable');}finally{transport.setFault(null);}
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])),0);
});
test('valid signed fixture correlates to pre-bound payment once; event.created is never paid time',async()=>{
 const i=await intent(),p=await transport.pay(i.intentId),w=await transport.webhook(p.paymentRef,{created:1});
 assert.equal((await adapter.ingest(w.raw,w.signature)).result,'confirmed');assert.equal((await adapter.ingest(w.raw,w.signature)).result,'confirmed');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[i.intentId])),1);
 assert.equal(new Date(await scalar('SELECT effective_paid_at FROM funding_private.temporal_receipts WHERE event_ref=$1',[w.eventRef])).toISOString(),p.effectivePaidAt);
 assert.equal(await scalar('SELECT source FROM funding_private.fixture_ingress_events WHERE event_ref=$1',[w.eventRef]),'offline_fixture');
});
test('altered bytes, wrong signature, ambiguous header and stale delivery timestamp cannot reach DB',async()=>{
 const i=await intent(),p=await transport.pay(i.intentId),w=await transport.webhook(p.paymentRef),before=Number(await scalar('SELECT count(*) FROM funding_private.fixture_ingress_events'));
 for(const [raw,signature] of [[Buffer.concat([w.raw,Buffer.from(' ')]),w.signature],[w.raw,'t=1,v1='+'0'.repeat(64)],[w.raw,w.signature+',t=1']])await assert.rejects(adapter.ingest(raw,signature),e=>e.code==='invalid_provider_auth');
 await assert.rejects(adapter.ingest(w.raw,await sign(w.raw,Math.floor(new Date(await now()).getTime()/1000)-301)),e=>e.code==='invalid_provider_auth');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.fixture_ingress_events')),before);
});
test('signed mismatched amount/currency/intent becomes minimal quarantine without credit or quota release',async()=>{
 for(const change of [o=>o.amount_received=1001,o=>o.currency='usd',o=>o.metadata.funding_intent=randomUUID()]){
  const i=await intent(),p=await transport.pay(i.intentId),w=await transport.webhook(p.paymentRef),changed=await mutate(w,x=>change(x.data.object));
  assert.equal((await adapter.ingest(changed.raw,changed.signature)).result,'review');assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[i.intentId])),0);assert.equal((await service.limits(i.session)).annualRemainingCents,99000);
 }
});
test('same event ID with different normalized financial evidence conflicts; irrelevant PII is discarded',async()=>{
 const i=await intent(),p=await transport.pay(i.intentId),w=await transport.webhook(p.paymentRef);await adapter.ingest(w.raw,w.signature);
 const changed=await mutate(w,x=>x.data.object.amount_received=999);await assert.rejects(adapter.ingest(changed.raw,changed.signature),e=>e.code==='idempotency_conflict');
 const pii=await mutate(w,x=>x.data.object.customer.email='new-discard@example.invalid');assert.equal((await adapter.ingest(pii.raw,pii.signature)).result,'confirmed');
 const state=JSON.stringify((await q('SELECT * FROM funding_private.fixture_ingress_events')).rows);assert.ok(!state.includes('discard'));assert.ok(!state.includes('+316'));assert.ok(!state.includes('customer'));
});
test('signed unknown payment, missing proof and asynchronous status retain review without inferential credit',async()=>{
 const i=await intent(),p=await transport.pay(i.intentId),w=await transport.webhook(p.paymentRef,{type:'payment_intent.processing'});assert.equal((await adapter.ingest(w.raw,w.signature)).result,'review');
 const next=await transport.webhook(p.paymentRef),unknown=await mutate(next,x=>x.data.object.id='pi_fixture_'+'f'.repeat(32));assert.equal((await adapter.ingest(unknown.raw,unknown.signature)).result,'review');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[i.intentId])),0);
});
test('transport response loss leaves held capacity; callback without stored binding cannot invent checkout provenance',async()=>{
 const v=await verified(),before=transport.stats();transport.setFault('checkout_response_lost');try{await assert.rejects(service.intent(v.session,{kind:'general',amountCents:1000}),e=>e.code==='offline_transport_uncertain');}finally{transport.setFault(null);}
 assert.equal((await service.limits(v.session)).annualRemainingCents,99000);assert.equal(transport.stats().checkoutCreates,before.checkoutCreates+1);
 const id=await scalar('SELECT id FROM funding_private.intents WHERE state=\'reserved\' AND id NOT IN(SELECT intent_id FROM funding_private.fixture_checkout_bindings) ORDER BY id LIMIT 1');
 const p=await transport.pay(id),w=await transport.webhook(p.paymentRef);assert.equal((await adapter.ingest(w.raw,w.signature)).result,'review');
});
test('late delivery keeps December payment year; payment exactly at expiry stays review without restoring quota',async()=>{
 await clock('2030-12-31T22:58:00Z');const i=await intent(),p=await transport.pay(i.intentId,{effectivePaidAt:'2030-12-31T22:59:50Z'});await clock('2030-12-31T23:20:00Z');const w=await transport.webhook(p.paymentRef);assert.equal((await adapter.ingest(w.raw,w.signature)).result,'confirmed');
 assert.equal(await scalar('SELECT policy_year FROM funding_private.intents WHERE id=$1',[i.intentId]),2030);await assert.rejects(service.limits(i.session),e=>e.code==='reverify_for_policy_year');
 await clock('2030-12-31T22:58:00Z');const j=await intent(),late=await transport.pay(j.intentId,{effectivePaidAt:j.expiresAt});await clock('2030-12-31T23:20:00Z');const lw=await transport.webhook(late.paymentRef);assert.equal((await adapter.ingest(lw.raw,lw.signature)).result,'review');
 await clock('2030-06-01T12:00:00Z');
});
test('final event remains final after valid signed callback and source is still simulator',async()=>{
 const e=await event(),i=await intent(e),p=await transport.pay(i.intentId);await admin(async()=>{await q("UPDATE funding_private.accounts SET state='settled' WHERE event_id=$1",[e]);await q('INSERT INTO funding_private.settlements(event_id,surplus) VALUES($1,0)',[e]);});
 const final=JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows),w=await transport.webhook(p.paymentRef);assert.equal((await adapter.ingest(w.raw,w.signature)).result,'review');assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows),final);
});
test('raw HTTP parser authenticates bytes, enforces body bound and refuses live mode; unsigned legacy route cannot bypass',async()=>{
 const app=Fastify({logger:false});await app.register(offlineProviderRoutes,{adapter});const i=await intent(),p=await transport.pay(i.intentId),w=await transport.webhook(p.paymentRef);
 try{
  let r=await app.inject({method:'POST',url:'/fixture/stripe-webhook',headers:{'content-type':'application/json','stripe-signature':w.signature},payload:w.raw});assert.equal(r.statusCode,200);assert.equal(r.json().source,'offline_fixture');
  r=await app.inject({method:'POST',url:'/fixture/stripe-webhook',headers:{'content-type':'application/json'},payload:w.raw});assert.equal(r.statusCode,401);
  const live=await mutate(w,x=>x.livemode=true);r=await app.inject({method:'POST',url:'/fixture/stripe-webhook',headers:{'content-type':'application/json','stripe-signature':live.signature},payload:live.raw});assert.equal(r.statusCode,400);
  r=await app.inject({method:'POST',url:'/fixture/stripe-webhook',headers:{'content-type':'application/json'},payload:Buffer.alloc(16385,'x')});assert.equal(r.statusCode,413);
  await assert.rejects(service.webhook({eventRef:'unsigned',intentId:i.intentId,amountCents:1000,currency:'EUR'},secret),e=>e.code==='invalid_provider_auth');
 }finally{await app.close();}
});
test('private bindings are immutable/minimal; clients/review role cannot access or execute ingress',async()=>{
 await assert.rejects(q('UPDATE funding_private.fixture_checkout_bindings SET expires_at=expires_at'),e=>e.code==='42501');
 await admin(()=>assert.rejects(q('UPDATE funding_private.fixture_ingress_events SET source=source'),/append_only/));
 for(const role of ['anon','authenticated','funding_review']){await db.exec('RESET ROLE');await db.exec('SET ROLE '+role);try{await assert.rejects(q('SELECT * FROM funding_private.fixture_otp_bindings'),e=>e.code==='42501');}finally{await db.exec('RESET ROLE');await db.exec('SET ROLE funding_runtime');}}
 assert.equal(Number(await scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='funding_private' AND table_name LIKE 'fixture_%' AND column_name IN('phone','code','name','email','raw_body','payload')")),0);
});
