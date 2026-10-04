import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as fixture from './helpers/funding-fixture.mjs';
import {createLifecycleFixture,createDurableLifecycleService} from '../apps/api/src/funding/providerLifecycle.js';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
const db=new PGlite();after(()=>db.close());await db.exec(fixture.fundingParentFixtureSQL);
for(const key of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration','fundingProviderMigration','fundingContinuityMigration','fundingRetentionMigration'])await db.exec(await readFile(fixture[key],'utf8'));
let sequence=0;
const admin=async(s,a=[])=>{await db.exec('RESET ROLE');return a.length?db.query(s,a):db.exec(s);};
const query=(role)=>({async query(s,a=[]){await db.exec('SET ROLE '+role);return db.query(s,a);}});
const finance=query('funding_runtime'),ingest=query('funding_provider_ingest');
const scalar=async(s,a=[])=>Object.values((await finance.query(s,a)).rows[0])[0];
const year=()=>scalar("SELECT extract(year FROM funding_private.temporal_now() AT TIME ZONE 'Europe/Amsterdam')::int");
// Reproduce the old boolean contract on synthetic data before loading the guard.
const oldToken='1'.repeat(64),oldId=await scalar("SELECT funding_private.reserve($1,$2,NULL,NULL,100,clock_timestamp()+interval '10 minutes')",[await year(),oldToken]);
const oldResult=await scalar('SELECT funding_private.cancel($1,true)',[oldId]);
await admin(await readFile(fixture.fundingLifecycleMigration,'utf8'));
const transport=createLifecycleFixture({mode:'isolated'}),compose=()=>createDurableLifecycleService({mode:'isolated',finance,ingest,transport});
let service=compose();
async function begin({amountCents=1000,eventId=null,operationRef=randomUUID()}={}){const token=String(++sequence).padStart(64,'a');return {...await service.begin({operationRef,year:await year(),annualToken:token,eventToken:eventId?token:null,eventId,amountCents}),token,operationRef};}
async function run(i,commandId=i.commandId){const e=await service.run(commandId);return e.uncertain?'uncertain':service.apply(i.intentId,e.observationId);}
const state=i=>scalar('SELECT state FROM funding_private.intents WHERE id=$1',[i.intentId]);
const hold=i=>scalar('SELECT reserved FROM funding_private.annual_limits WHERE token=$1',[i.token]);
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
test('old boolean cancellation is reproduced; fixture enrollment initially absent blocks begin',async()=>{
 assert.equal(oldResult,'cancelled');await assert.rejects(begin(),/lifecycle_fixture_enrollment_required/);await admin(fixture.fundingLifecycleEnrollmentSQL);
});
test('begin is atomic and idempotent; conflicting operation creates no second hold',async()=>{
 const i=await begin();const args={operationRef:i.operationRef,year:await year(),annualToken:i.token,amountCents:1000};assert.equal((await service.begin(args)).intentId,i.intentId);assert.equal(Number(await hold(i)),1000);await assert.rejects(service.begin({...args,amountCents:1001}),/idempotency_conflict/);
});
test('begin command failure rolls back newly reserved quota/intent',async()=>{
 await admin("CREATE FUNCTION public.lifecycle_fail_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_command_failure';END $$;CREATE TRIGGER fail_command BEFORE INSERT ON funding_private.provider_commands FOR EACH ROW EXECUTE FUNCTION public.lifecycle_fail_command()");
 const before=Number(await scalar('SELECT count(*) FROM funding_private.intents'));await assert.rejects(begin(),/injected_command_failure/);assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.intents')),before);await admin('DROP TRIGGER fail_command ON funding_private.provider_commands');
});
test('boolean cancel and raw state mutation lack durable proof and cannot release hold',async()=>{
 const i=await begin();await assert.rejects(finance.query('SELECT funding_private.cancel($1,true)',[i.intentId]),/lifecycle_transition_evidence_required/);await assert.rejects(finance.query("UPDATE funding_private.intents SET state='cancelled' WHERE id=$1",[i.intentId]),/lifecycle_transition_evidence_required/);assert.equal(Number(await hold(i)),1000);
});
test('creation binds only after hold; response lost remains uncertain through recomposition',async()=>{
 const i=await begin();transport.fault('response_lost');assert.equal(await run(i),'uncertain');assert.equal(Number(await hold(i)),1000);transport.fault(null);service=compose();assert.equal(await run(i),'bound');const n=transport.stats().creates;assert.equal(await run(i),'bound');assert.equal(transport.stats().creates,n);
});
test('definitive precreation failure cancels once with audit and no checkout',async()=>{
 const i=await begin(),before=transport.stats().creates;transport.fault('precreation_failure');try{assert.equal(await run(i),'cancelled');assert.equal(await run(i),'cancelled');}finally{transport.fault(null);}assert.equal(transport.stats().creates,before);assert.equal(Number(await hold(i)),0);
});
test('cancel422 and transport timeout retain holds; confirmed cancellation releases exactly once',async()=>{
 const i=await begin();await run(i);const c=await service.request(i.intentId,randomUUID(),'cancel');transport.fault('cancel422');assert.equal(await run(i,c),'bound');transport.fault('query_timeout');const c2=await service.request(i.intentId,randomUUID(),'retrieve');assert.equal(await run(i,c2),'uncertain');assert.equal(Number(await hold(i)),1000);transport.fault(null);const c3=await service.request(i.intentId,randomUUID(),'cancel');assert.equal(await run(i,c3),'cancelled');assert.equal(await run(i,c3),'cancelled');assert.equal(Number(await hold(i)),0);
});
test('expired local window requests retrieval while remote remains open; no release',async()=>{
 const i=await begin();await run(i);await admin("CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp()+interval '1 hour' $$");try{const c=await service.expireLocal(i.intentId,randomUUID());assert.equal(await run(i,c),'bound');assert.equal(Number(await hold(i)),1000);}finally{await admin("CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$");}
});
test('valid paid evidence commits ledger/quota once and survives adapter recomposition',async()=>{
 const i=await begin();await run(i);await tick();transport.set(i.operationRef,{status:'paid',successfulAt:new Date().toISOString(),revision:2});const c=await service.request(i.intentId,randomUUID(),'retrieve');assert.equal(await run(i,c),'confirmed');service=compose();assert.equal(await run(i,c),'confirmed');assert.equal(Number(await hold(i)),0);assert.equal(Number(await scalar('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[i.token])),1000);assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[i.intentId])),1);
});
test('cancel after successful payment observes paid instead of cancelling committed quota',async()=>{
 const i=await begin();await run(i);await tick();transport.set(i.operationRef,{status:'paid',successfulAt:new Date().toISOString(),revision:2});const c=await service.request(i.intentId,randomUUID(),'cancel');assert.equal(await run(i,c),'confirmed');assert.equal(await state(i),'confirmed');
});
test('terminal reversal is recorded as exception without restoring quota or rewriting final fact',async()=>{
 const i=await begin();await run(i);const c=await service.request(i.intentId,randomUUID(),'cancel');await run(i,c);transport.set(i.operationRef,{status:'paid',successfulAt:new Date().toISOString(),revision:3});const r=await service.request(i.intentId,randomUUID(),'retrieve');assert.equal(await run(i,r),'exception');assert.equal(await state(i),'cancelled');assert.equal(Number(await hold(i)),0);await assert.rejects(service.begin({operationRef:randomUUID(),year:await year(),annualToken:i.token,amountCents:100}),/lifecycle_unresolved_exception/);
});
test('wrong amount/currency, missing successful time and out-of-order evidence quarantine hold',async()=>{
 for(const patch of [{amountCents:999},{currency:'USD'},{status:'paid',successfulAt:null},{revision:0}]){
  const i=await begin();await run(i);transport.set(i.operationRef,{revision:2,...patch});const c=await service.request(i.intentId,randomUUID(),'retrieve');if(patch.revision===0)await assert.rejects(run(i,c),/check constraint/);else{assert.equal(await run(i,c),'review');assert.equal(await state(i),'review');}assert.equal(Number(await hold(i)),1000);
 }
});
test('late or future paid instant goes to review rather than automatic refund or new year',async()=>{
 const i=await begin();await run(i);transport.set(i.operationRef,{status:'paid',successfulAt:new Date(Date.now()+3600000).toISOString(),revision:2});const c=await service.request(i.intentId,randomUUID(),'retrieve');assert.equal(await run(i,c),'review');assert.equal(Number(await hold(i)),1000);
});
test('expired lease cannot record evidence; command can be reclaimed',async()=>{
 const i=await begin(),worker=randomUUID();await ingest.query('SELECT funding_private.claim_lifecycle_command($1,$2)',[i.commandId,worker]);await admin("UPDATE funding_private.provider_commands SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[i.commandId]);await assert.rejects(ingest.query('SELECT funding_private.record_lifecycle_observation($1,$2,$3,NULL,1,$4,1000,$5,NULL,NULL,clock_timestamp(),$6)',[randomUUID(),i.commandId,worker,'precreation_failed','EUR','a'.repeat(64)]),/lifecycle_lease_lost/);assert.equal(await run(i),'bound');
});
test('unknown references/legacy cannot acquire lifecycle by request',async()=>{
 await assert.rejects(service.request(oldId,randomUUID(),'retrieve'),/unknown_lifecycle/);await assert.rejects(service.run(randomUUID()),/no rows/);
});
test('ingest cannot read identity/quota or assume finance and finance cannot forge observations',async()=>{
 await assert.rejects(ingest.query('SELECT annual_token FROM funding_private.intents'),/permission denied/);await assert.rejects(ingest.query('SELECT * FROM funding_private.annual_limits'),/permission denied/);await assert.rejects(ingest.query("SELECT funding_private.cancel($1,true)",[oldId]),/permission denied/);await assert.rejects(finance.query("INSERT INTO funding_private.provider_observations(id) VALUES($1)",[randomUUID()]),/permission denied/);
});
test('bindings, observations and applications are immutable; no public authority',async()=>{
 const i=await begin();await run(i);await assert.rejects(finance.query('UPDATE funding_private.provider_lifecycles SET operation_ref=$1 WHERE intent_id=$2',[randomUUID(),i.intentId]),/lifecycle_binding_immutable/);await assert.rejects(ingest.query('UPDATE funding_private.provider_commands SET intent_id=$1 WHERE id=$2',[oldId,i.commandId]),/lifecycle_command_immutable/);await assert.rejects(finance.query('DELETE FROM funding_private.provider_lifecycles WHERE intent_id=$1',[i.intentId]),/permission denied/);for(const role of ['anon','authenticated','funding_review','funding_cleanup'])await assert.rejects(query(role).query('SELECT * FROM funding_private.provider_observations'),/permission denied/);
});
test('deferred application proof without financial transition cannot commit',async()=>{
 const i=await begin();const e=await service.run(i.commandId);await assert.rejects(finance.query("INSERT INTO funding_private.provider_applications(observation_id,intent_id,result) VALUES($1,$2,'review')",[e.observationId,i.intentId]),/lifecycle_application_not_committed/);assert.equal(await state(i),'reserved');
});
test('payment insertion failure rolls back application and financial state; observation survives',async()=>{
 const i=await begin();await run(i);await tick();transport.set(i.operationRef,{status:'paid',successfulAt:new Date().toISOString(),revision:2});const c=await service.request(i.intentId,randomUUID(),'retrieve'),e=await service.run(c);await admin("CREATE FUNCTION public.lifecycle_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'lifecycle_payment_fault';END $$;CREATE TRIGGER lifecycle_fail_payment BEFORE INSERT ON funding_private.payments FOR EACH ROW EXECUTE FUNCTION public.lifecycle_fail_payment()");await assert.rejects(service.apply(i.intentId,e.observationId),/lifecycle_payment_fault/);assert.equal(await state(i),'reserved');assert.equal(Number(await hold(i)),1000);assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.provider_applications WHERE observation_id=$1',[e.observationId])),0);await admin('DROP TRIGGER lifecycle_fail_payment ON funding_private.payments');assert.equal(await service.apply(i.intentId,e.observationId),'confirmed');
});
test('verified session API issues durable intent and refuses unauthenticated/forged lifecycle adapter',async()=>{
 const simulator=createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32)}),s=createIsolatedFundingService({database:finance,simulator,durableProvider:service,secret:'l'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 const c=await s.start({phone:'+349700001234'}),v=await s.verify({challengeId:c.challengeId,code:'123456'});const i=await s.lifecycleIntent(v.session,{kind:'general',amountCents:1000,operationRef:randomUUID()});assert.equal(await state(i),'reserved');await assert.rejects(s.lifecycleIntent('invalid',{kind:'general',amountCents:1000,operationRef:randomUUID()}));assert.throws(()=>createDurableLifecycleService({mode:'isolated',finance,ingest,transport:{execute:()=>{}}}),/closed_lifecycle_fixture_required/);
});
test('expired creation window cannot create a new checkout or release an uncertain hold',async()=>{
 const i=await begin(),before=transport.stats().creates;await admin("CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp()+interval '1 hour' $$");try{assert.equal(await run(i),'uncertain');assert.equal(transport.stats().creates,before);assert.equal(Number(await hold(i)),1000);assert.equal((await service.status(i.intentId)).binding_state,'creation_uncertain');}finally{await admin("CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$");}
});
test('ended/final synthetic event quarantines success and never rewrites parent hash or balance',async()=>{
 const eventId=randomUUID();await admin("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0.9,'final_fixture')",[eventId]);await finance.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+eventId,eventId]);const i=await begin({eventId});await run(i);
 await admin("UPDATE public.protests SET ends_at=clock_timestamp() WHERE id=$1",[eventId]);await admin("UPDATE funding_private.accounts SET state='settled' WHERE event_id=$1",[eventId]);const before=JSON.stringify((await finance.query('SELECT saldo_euros,hash_integridad,updated_at FROM public.protests WHERE id=$1',[eventId])).rows);
 await tick();transport.set(i.operationRef,{status:'paid',successfulAt:new Date().toISOString(),revision:2});const c=await service.request(i.intentId,randomUUID(),'retrieve');assert.equal(await run(i,c),'review');assert.equal(Number(await hold(i)),1000);assert.equal(JSON.stringify((await finance.query('SELECT saldo_euros,hash_integridad,updated_at FROM public.protests WHERE id=$1',[eventId])).rows),before);
});
