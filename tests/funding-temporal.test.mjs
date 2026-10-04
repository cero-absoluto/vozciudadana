import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {fundingParentFixtureSQL,fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration} from './helpers/funding-fixture.mjs';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
const db=new PGlite();after(()=>db.close());await db.exec(fundingParentFixtureSQL);
for(const m of [fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration])await db.exec(await readFile(m,'utf8'));
// Owner-controlled ephemeral DB clock only. No caller-supplied application clock can set it.
await db.exec(`CREATE TABLE funding_private.fixture_temporal_clock(t timestamptz NOT NULL);INSERT INTO funding_private.fixture_temporal_clock VALUES('2030-12-31T22:58:00Z');GRANT SELECT ON funding_private.fixture_temporal_clock TO funding_runtime;
CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$ SELECT t FROM funding_private.fixture_temporal_clock $$;`);
await db.exec('SET ROLE funding_runtime');
const q=(sql,args=[])=>db.query(sql,args),scalar=async(sql,args)=>Object.values((await q(sql,args)).rows[0])[0];
async function admin(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE funding_runtime');}}
const setClock=t=>admin(()=>q('UPDATE funding_private.fixture_temporal_clock SET t=$1',[t]));
const at=async()=>await scalar('SELECT funding_private.temporal_now()');
let seq=0;const token=()=>String(++seq).padStart(64,'a');
async function reserve(amount=800,event=null,annual=token(),eventToken=annual,min=1){const year=(await q('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;return scalar('SELECT funding_private.reserve_v2($1,$2,$3,$4,$5,$6)',[year,annual,event?eventToken:null,event,amount,min]);}
const confirm=(id,paid,ref=randomUUID(),payment=ref,semantic='simulator_successful_payment:v2',amount=800)=>scalar('SELECT funding_private.confirm_v2($1,$2,$3,$4,$5,$6,$7)',[ref,payment,id,amount,'EUR',paid,semantic]);
async function event(){const e=randomUUID();await admin(()=>q(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,'2030-01-01','2032-01-01',0,'legacy-untouched')`,[e]));await q("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);return e;}

test('DB year and UTC cutoff handle immediately before, exactly at and after Amsterdam midnight',async()=>{
 for(const [time,year] of [['2030-12-31T22:59:59Z',2030],['2030-12-31T23:00:00Z',2031],['2030-12-31T23:00:01Z',2031]]){await setClock(time);assert.equal((await q('SELECT funding_private.temporal_context() AS c')).rows[0].c.year,year);}
 await setClock('2030-12-31T22:59:30Z');const id=await reserve();assert.equal(new Date(await scalar('SELECT valid_until FROM funding_private.temporal_intents WHERE intent_id=$1',[id])).toISOString(),'2030-12-31T23:00:00.000Z');
});
test('insufficient checkout window rejects before quota mutation; minimum 30 minutes cannot fit mock ten minutes',async()=>{
 await setClock('2030-12-31T22:59:59.500Z');const t=token();await assert.rejects(reserve(800,null,t,t,1),/funding_window_closed/);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.annual_limits WHERE token=$1',[t])),0);
 await setClock('2030-12-31T22:58:00Z');await assert.rejects(reserve(800,null,t,t,1800),/funding_window_closed/);
});
test('valid pre-deadline payment delivered in January credits old year exactly once, including different delivery ID',async()=>{
 await setClock('2030-12-31T22:58:00Z');const t=token(),id=await reserve(800,null,t),ref=randomUUID(),paid='2030-12-31T22:59:50Z';
 await setClock('2030-12-31T23:20:00Z');assert.equal(await confirm(id,paid,ref),'confirmed');assert.equal(await confirm(id,paid,ref),'confirmed');assert.equal(await confirm(id,paid,randomUUID(),ref),'confirmed');
 assert.equal(await scalar('SELECT committed FROM funding_private.annual_limits WHERE policy_year=2030 AND token=$1',[t]),800);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.annual_limits WHERE policy_year=2031 AND token=$1',[t])),0);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[id])),1);
 await assert.rejects(confirm(id,'2030-12-31T22:59:51Z',ref),/idempotency_conflict/);
});
test('payment at deadline, next year, before creation, future, missing timestamp or unknown semantic is review without quota release',async()=>{
 for(const [paid,semantic] of [['2030-12-31T23:00:00Z','simulator_successful_payment:v2'],['2030-12-31T23:00:01Z','simulator_successful_payment:v2'],['2030-12-31T22:57:59Z','simulator_successful_payment:v2'],['2031-01-01T00:00:00Z','simulator_successful_payment:v2'],[null,'simulator_successful_payment:v2'],['2030-12-31T22:58:00Z','unknown']]){
  await setClock('2030-12-31T22:58:00Z');const t=token(),id=await reserve(800,null,t);await setClock('2030-12-31T23:20:00Z');assert.equal(await confirm(id,paid,randomUUID(),randomUUID(),semantic),'review');
  assert.equal(await scalar('SELECT reserved FROM funding_private.annual_limits WHERE token=$1',[t]),800);assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[id])),0);
 }
});
test('v1 remains usable for legacy and cannot bypass temporal evidence for new v2 intents',async()=>{
 await setClock('2030-12-31T22:58:00Z');const id=await reserve();await assert.rejects(q("SELECT funding_private.confirm('bypass',$1,800,'EUR')",[id]),/temporal_evidence_required/);
 await assert.rejects(q("SELECT funding_private.confirm_legacy_v1('bypass',$1,800,'EUR')",[id]),/temporal_evidence_required/);
 const legacy=await scalar("SELECT funding_private.reserve(2026,$1,NULL,NULL,800,clock_timestamp()+interval '10 minutes')",[token()]);
 const before=JSON.stringify((await q('SELECT * FROM funding_private.intents WHERE id=$1',[legacy])).rows);
 assert.equal(await confirm(legacy,'2030-12-31T22:58:00Z'),'review');assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.intents WHERE id=$1',[legacy])).rows),before);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.temporal_intents WHERE intent_id=$1',[legacy])),0);
 assert.equal(await scalar("SELECT funding_private.confirm('legacy-payment',$1,800,'EUR')",[legacy]),'confirmed');
});
test('new annual OTP is required and event quota persists across years with independent annual tokens',async()=>{
 const e=await event();await setClock('2030-12-31T22:58:00Z');const sim=createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32),now:at});
 const service=createIsolatedFundingService({database:db,simulator:sim,secret:'h'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated',now:()=>new Date('1990-01-01')});
 const verified=async()=>{const c=await service.start({phone:'+34950000001',eventId:e});return (await service.verify({challengeId:c.challengeId,code:'123456'})).session;};
 const old=await verified(),i=await service.intent(old,{kind:'event',amountCents:6000});assert.equal((await service.webhook({eventRef:'old-year-api',intentId:i.intentId,amountCents:6000,currency:'EUR'},'w'.repeat(32))).result,'confirmed');
 await setClock('2030-12-31T23:00:00Z');await assert.rejects(service.limits(old),e=>e.code==='reverify_for_policy_year');
 const fresh=await verified(),j=await service.intent(fresh,{kind:'event',amountCents:4000});assert.equal((await service.webhook({eventRef:'new-year-api',intentId:j.intentId,amountCents:4000,currency:'EUR'},'w'.repeat(32))).result,'confirmed');
 assert.equal((await service.limits(fresh)).eventRemainingCents,0);await assert.rejects(service.intent(fresh,{kind:'event',amountCents:1}),e=>e.code==='event_limit');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.event_limits WHERE event_id=$1',[e])),1);
 assert.equal(Number(await scalar('SELECT count(DISTINCT policy_year) FROM funding_private.annual_limits WHERE token IN(SELECT annual_token FROM funding_private.intents WHERE event_id=$1)',[e])),2);
});
test('API ignores caller paidAt and trusts only adapter-bound payment evidence',async()=>{
 await setClock('2030-12-31T22:58:00Z');const sim=createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32),now:at});
 const service=createIsolatedFundingService({database:db,simulator:sim,secret:'j'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 const c=await service.start({phone:'+34950000002'}),s=await service.verify({challengeId:c.challengeId,code:'123456'}),i=await service.intent(s.session,{kind:'general',amountCents:800});
 const event={eventRef:'adapter-proof',intentId:i.intentId,amountCents:800,currency:'EUR'};await sim.recordPayment(event,'2030-12-31T22:59:50Z');
 await setClock('2030-12-31T23:20:00Z');assert.equal((await service.webhook({...event,paidAt:'2031-01-01T00:00:00Z'},'w'.repeat(32))).result,'confirmed');
 assert.equal(new Date(await scalar('SELECT effective_paid_at FROM funding_private.temporal_receipts WHERE event_ref=$1',[event.eventRef])).toISOString(),'2030-12-31T22:59:50.000Z');
 await assert.rejects(service.webhook({...event,amountCents:801},'w'.repeat(32)),e=>e.code==='provider_evidence_mismatch');
});
test('temporal metadata/receipts are immutable and runtime cannot change timezone or DB-clock function',async()=>{
 await assert.rejects(q("UPDATE funding_private.temporal_policy SET timezone='UTC'"),/permission denied/);
 await assert.rejects(db.exec("CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$"),e=>e.code==='42501');
 await assert.rejects(q('UPDATE funding_private.temporal_intents SET valid_until=valid_until'),/append_only/);
 await assert.rejects(q('DELETE FROM funding_private.temporal_receipts'),/append_only/);
});
test('settlement waits for pending temporal evidence; late valid payment can finish closing account without rewriting parent',async()=>{
 const real=await scalar('SELECT clock_timestamp()');await setClock(new Date(new Date(real).getTime()-5000).toISOString());const e=await event();
 await admin(()=>q(`UPDATE public.protests SET starts_at=clock_timestamp()-interval '1 day',ends_at=clock_timestamp()+interval '10 minutes' WHERE id=$1`,[e]));
 const id=await reserve(800,e),paid=await at();await admin(()=>q(`UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[e]));
 const parent=JSON.stringify((await q('SELECT * FROM public.protests WHERE id=$1',[e])).rows);
 await q('SELECT funding_private.close_event($1)',[e]);await assert.rejects(q('SELECT funding_private.settle($1)',[e]),/pending_items/);
 await setClock(new Date(new Date(real).getTime()+1000).toISOString());assert.equal(await confirm(id,paid),'confirmed');assert.equal(await scalar('SELECT funding_private.settle($1)',[e]),800);
 assert.equal(JSON.stringify((await q('SELECT * FROM public.protests WHERE id=$1',[e])).rows),parent);
});
test('an incompatible final account quarantines payment and never reopens final settlement',async()=>{
 await setClock('2030-12-31T22:58:00Z');const e=await event(),id=await reserve(800,e),paid=await at();
 await admin(async()=>{await q("UPDATE funding_private.accounts SET state='settled' WHERE event_id=$1",[e]);await q('INSERT INTO funding_private.settlements(event_id,surplus) VALUES($1,0)',[e]);});
 const final=JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows);
 assert.equal(await confirm(id,paid),'review');assert.equal(await scalar('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e]),0);
 assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows),final);
});
