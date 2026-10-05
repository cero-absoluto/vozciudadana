import {createSmsFixtureProvider,createSmsCostRehearsal} from '../apps/api/src/funding/smsCostRehearsal.js';
import * as sms from './helpers/funding-sms-closure-fixture.mjs';
import {createLegacyReceiptFixtureAdapter,createLegacyReceiptService} from '../apps/api/src/funding/legacyReceipt.js';
import {legacyReceiptMigration,legacyReceiptSecret,legacyReceiptInput,legacyReceiptAdapterOptions} from './helpers/funding-legacy-receipt-fixture.mjs';
// Run only against a fresh loopback PostgreSQL database explicitly named i4_isolated.
// This harness never uses Supabase credentials or a production connection.
import {createOwnerAuthorityService} from '../apps/api/src/funding/ownerAuthority.js';
import {authorityMigration,ownerIdentityFixture} from './helpers/funding-owner-authority-fixture.mjs';
import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createFundingKeyContinuity,createIsolatedCleanupService} from '../apps/api/src/funding/keyContinuity.js';
import {legacyFundingVersion,splitFundingVersion,registerFundingVersion,fixtureRetentionPolicySQL} from './helpers/funding-continuity-fixture.mjs';
import {createOfflineFixtureTransport,createOfflineProviderAdapter} from '../apps/api/src/funding/offlineProvider.js';
import {createQualificationFixture,createQualificationObserver,rehearseCutover} from '../apps/api/src/funding/providerQualification.js';
import {createLifecycleFixture,createDurableLifecycleService} from '../apps/api/src/funding/providerLifecycle.js';
import {transitionSQL,cohort,transition,write,snapshot as transitionSnapshot} from './helpers/funding-transition-fixture.mjs';
import {fundingLifecycleReplayMigration,fundingLifecycleMigration,fundingLifecycleEnrollmentSQL} from './helpers/funding-fixture.mjs';
import {createIsolatedReviewAuthenticator,createIsolatedReviewService} from '../apps/api/src/funding/isolatedReview.js';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
import {fundingParentFixtureSQL,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration} from './helpers/funding-fixture.mjs';
const connection=process.env.I4_ISOLATED_PG_URL;
if(!connection) {
 if(process.env.I4_REQUIRE_MULTISESSION==='1')throw new Error('Concurrency verification blocked: set I4_ISOLATED_PG_URL to a fresh loopback PostgreSQL 17 i4_isolated database');
 test('multi-session funding concurrency', {skip:'I4_ISOLATED_PG_URL absent: requires native PostgreSQL, not PGlite'},()=>{});
} else {
 const u=new URL(connection);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.pathname==='/i4_isolated','fresh loopback i4_isolated database required');
 assert.notEqual(process.env.NODE_ENV,'production');
 let pool=new pg.Pool({connectionString:connection,max:24,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c lock_timeout=8000'});const admin=pool;after(()=>Promise.all([admin.end(),pool.end()]));
 const version=Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
 assert.ok(version>=170000&&version<180000,'PostgreSQL 17 required for production-version concurrency validation');
 console.log('I4_NATIVE_POSTGRES_VERSION_NUM='+version);
 console.log('I4_NATIVE_POSTGRES_VERSION='+(await pool.query('SHOW server_version')).rows[0].server_version);
 await admin.query(fundingParentFixtureSQL);
 await pool.query(await readFile(new URL('../supabase/migrations/20261003200832_funding_private_core.sql',import.meta.url),'utf8'));
 await admin.query(await readFile(fundingRlsMigration,'utf8'));
 await admin.query(await readFile(fundingAuthMigration,'utf8'));
 await admin.query(await readFile(fundingTemporalMigration,'utf8'));
 await admin.query(await readFile(fundingCostsMigration,'utf8'));
 await admin.query(await readFile(fundingReviewMigration,'utf8'));
 await admin.query(await readFile(fundingProviderMigration,'utf8'));
 await admin.query(await readFile(fundingContinuityMigration,'utf8'));
  await admin.query(await readFile(fundingRetentionMigration,'utf8'));
 await admin.query(await readFile(fundingLifecycleMigration,'utf8'));
 await admin.query(await readFile(fundingLifecycleReplayMigration,'utf8'));
 await admin.query("CREATE ROLE funding_ci_login LOGIN INHERIT PASSWORD 'i4_synthetic_funding_only' IN ROLE funding_runtime");
 const runtimeURL=new URL(connection);runtimeURL.username='funding_ci_login';runtimeURL.password='i4_synthetic_funding_only';
 pool=new pg.Pool({connectionString:runtimeURL.toString(),max:24,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
 const actor=(await pool.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'service_role','MEMBER') AS service_member FROM pg_roles WHERE rolname=current_user")).rows[0];
 assert.deepEqual(actor,{actor:'funding_ci_login',rolsuper:false,rolbypassrls:false,service_member:false});
 console.log('I4_NATIVE_FINANCIAL_ACTOR='+JSON.stringify(actor));
 const event='20000000-0000-0000-0000-000000000001',token='b'.repeat(64);
 await admin.query(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',0,'untouched')`,[event]);
 await pool.query(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+event,event]);
 let smsExecutor,smsIngest,smsService,smsProvider;after(()=>Promise.all([smsExecutor?.end(),smsIngest?.end()]));
 test('native SMS: restricted executor and evidence roles cannot access identities, finance membership or Owner',async()=>{
  await admin.query(await readFile(sms.smsClosureMigration,'utf8'));await admin.query(sms.smsParticipationFixtureSQL);
  for(const [role,parent] of [['funding_sms_executor_ci','funding_sms_executor'],['funding_sms_ingest_ci','funding_sms_evidence_ingest']])await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic_sms_ci_only' IN ROLE ${parent}`);
  const make=name=>{const u=new URL(connection);u.username=name;u.password='synthetic_sms_ci_only';return new pg.Pool({connectionString:u.toString(),max:24});};smsExecutor=make('funding_sms_executor_ci');smsIngest=make('funding_sms_ingest_ci');
  smsProvider=createSmsFixtureProvider(sms.smsProviderOptions);smsService=createSmsCostRehearsal({executorDatabase:smsExecutor,evidenceDatabase:smsIngest,provider:smsProvider,mode:'isolated'});
  for(const p of [smsExecutor,smsIngest]){const actor=(await p.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'funding_runtime','MEMBER') AS finance,pg_has_role(current_user,'funding_review','MEMBER') AS review,pg_has_role(current_user,'service_role','MEMBER') AS service FROM pg_roles WHERE rolname=current_user")).rows[0];assert.equal(actor.rolsuper,false);assert.equal(actor.rolbypassrls,false);assert.equal(actor.finance,false);assert.equal(actor.review,false);assert.equal(actor.service,false);console.log('I4_NATIVE_SMS_ACTOR='+JSON.stringify(actor));
   for(const sql of ['SET ROLE funding_runtime','SET ROLE funding_review','SELECT * FROM funding_private.annual_limits','SELECT annual_token FROM funding_private.intents','SELECT * FROM sms_participation_fixture.adhesions','UPDATE public.protests SET hash_integridad=NULL'])await assert.rejects(p.query(sql),e=>e.code==='42501');}
  await assert.rejects(smsIngest.query('SELECT * FROM funding_private.accounts'),e=>e.code==='42501');
 });
 test('native SMS: twenty connections preserve one operation/hold/dispatch and one actual-price allocation',async()=>{
  const e=await sms.seedSmsEvent(admin),input=sms.smsPrepareInput(e,'native_dispatch');const results=await Promise.all(Array.from({length:20},()=>smsService.prepare(input))),op=results[0].operationId;assert.equal(new Set(results.map(x=>x.operationId)).size,1);
  const quota=JSON.stringify((await admin.query('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows);
  await Promise.all(Array.from({length:20},()=>smsService.dispatch(op)));assert.equal(smsProvider.calls(op),1);
  await Promise.all(Array.from({length:20},()=>smsService.ingestEvidence(sms.smsFixtureSecret,sms.smsFact(op,'native_price'))));assert.ok((await Promise.all(Array.from({length:20},()=>smsService.project(op)))).every(x=>x==='charged'));
  assert.equal(Number((await admin.query('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e])).rows[0].balance),95);assert.equal(JSON.stringify((await admin.query('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows),quota);
  assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_sms_fixture_private.execution WHERE operation_id=$1 AND allocation_id IS NOT NULL',[op])).rows[0].n),1);
 });
 test('native SMS: concurrent conflicting evidence preserves original and one conflict without allocation',async()=>{
  const e=await sms.seedSmsEvent(admin),op=(await smsService.prepare(sms.smsPrepareInput(e,'native_conflict'))).operationId;await smsService.dispatch(op);await smsService.ingestEvidence(sms.smsFixtureSecret,sms.smsFact(op,'native_clash'));
  const original=(await admin.query('SELECT * FROM funding_sms_fixture_private.facts WHERE operation_id=$1 ORDER BY id',[op])).rows;
  await Promise.all(Array.from({length:20},()=>smsService.ingestEvidence(sms.smsFixtureSecret,sms.smsFact(op,'native_clash',{amountCents:6}))));assert.equal(await smsService.project(op),'review');assert.deepEqual((await admin.query('SELECT * FROM funding_sms_fixture_private.facts WHERE operation_id=$1 ORDER BY id',[op])).rows,original);
  assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_sms_fixture_private.conflicts WHERE operation_id=$1',[op])).rows[0].n),1);
 });
 test('native SMS: closure commits ahead of waiting dispatch; no external send and held cost prevents settlement',async()=>{
  const e=await sms.seedSmsEvent(admin),op=(await smsService.prepare(sms.smsPrepareInput(e,'native_close_first'))).operationId,a=await admin.connect(),b=await smsExecutor.connect();let committed=false;
  try{await a.query('BEGIN');await a.query("SELECT pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0))");await a.query("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]);
   const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,wait=b.query('SELECT funding_sms_fixture_private.claim($1)',[op]);const checked=assert.rejects(wait,/sms_dispatch_closed/);await observeWaiting(pid);await a.query('COMMIT');committed=true;await checked;assert.equal(smsProvider.calls(op),0);await assert.rejects(smsService.close(e,true),/sms_pending_items/);
  }finally{if(!committed)await a.query('ROLLBACK');a.release();b.release();}
 });
 test('native SMS: cost projection commits before waiting settlement, balanced once and final unchanged',async()=>{
  const e=await sms.seedSmsEvent(admin),op=(await smsService.prepare(sms.smsPrepareInput(e,'native_project_first'))).operationId;await smsService.dispatch(op);await smsService.ingestEvidence(sms.smsFixtureSecret,sms.smsFact(op,'native_settle_price'));await admin.query("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]);
  const a=await smsExecutor.connect(),b=await smsExecutor.connect();let committed=false;
  try{await a.query('BEGIN');assert.equal((await a.query('SELECT funding_sms_fixture_private.project($1) AS r',[op])).rows[0].r,'charged');const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,pending=b.query('SELECT funding_sms_fixture_private.close($1,true) AS r',[e]);await observeWaiting(pid);await a.query('COMMIT');committed=true;assert.equal(Number((await pending).rows[0].r.surplusCents),95);
   assert.equal((await admin.query('SELECT hash_integridad FROM public.protests WHERE id=$1',[e])).rows[0].hash_integridad,'synthetic_final_v2');assert.equal(Number((await smsService.close(e,true)).surplusCents),95);
  }finally{if(!committed)await a.query('ROLLBACK');a.release();b.release();}
 });
 test('native SMS: deferred commit fault has no ACK; lost committed claim never sends on retry',async()=>{
  const e=await sms.seedSmsEvent(admin),op=(await smsService.prepare(sms.smsPrepareInput(e,'native_fault'))).operationId;await smsService.dispatch(op);
  await admin.query("CREATE FUNCTION public.native_sms_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_sms_commit_fault';END $$;CREATE CONSTRAINT TRIGGER native_sms_fault AFTER INSERT ON funding_sms_fixture_private.facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.native_sms_fault()");
  try{await assert.rejects(smsService.ingestEvidence(sms.smsFixtureSecret,sms.smsFact(op,'native_commit_fault')),e=>e.code==='sms_rehearsal_unavailable');assert.equal((await admin.query("SELECT id FROM funding_sms_fixture_private.facts WHERE reference='synthetic_sms_fact_native_commit_fault'")).rows.length,0);}finally{await admin.query('DROP TRIGGER native_sms_fault ON funding_sms_fixture_private.facts');}
  const id=(await smsService.prepare(sms.smsPrepareInput(e,'native_lost_claim'))).operationId;let lose=true;const database={async connect(){const c=await smsExecutor.connect();return {async query(sql,args){const r=await c.query(sql,args);if(sql==='COMMIT'&&lose){lose=false;throw Error('synthetic_response_loss');}return r;},release(){c.release();}};}};
  const provider=createSmsFixtureProvider(sms.smsProviderOptions),service=createSmsCostRehearsal({executorDatabase:database,evidenceDatabase:smsIngest,provider,mode:'isolated'});await assert.rejects(service.dispatch(id),e=>e.code==='sms_rehearsal_unavailable');assert.equal((await service.dispatch(id)).claimed,false);assert.equal(provider.calls(id),0);assert.equal(await service.project(id),'unknown');
 });
 test('20 concurrent reservations cannot exceed cumulative event capacity',async()=>{
  const clients=await Promise.all(Array.from({length:20},()=>pool.connect()));
  try {
   await Promise.all(clients.map(c=>c.query('BEGIN')));
   const results=await Promise.allSettled(clients.map(async c=>{
    try {const r=await c.query(`SELECT funding_private.reserve(2026,$1,$1,$2,6000,clock_timestamp()+interval '10 minutes') AS id`,[token,event]);await c.query('COMMIT');return r.rows[0].id;}
    catch(e){await c.query('ROLLBACK');throw e;}
   }));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/event_limit/);
   const sum=await pool.query(`SELECT reserved+committed AS used FROM funding_private.event_limits WHERE event_id=$1`,[event]);assert.equal(Number(sum.rows[0].used),6000);
  } finally {clients.forEach(c=>c.release());}
 });
 test('20 concurrent deliveries of the same payment write one payment and ledger transaction',async()=>{
  const id=(await pool.query('SELECT id FROM funding_private.intents WHERE event_id=$1',[event])).rows[0].id;
  const results=await Promise.all(Array.from({length:20},()=>pool.query(`SELECT funding_private.confirm('concurrent-payment',$1,6000,'EUR') AS result`,[id])));
  for(const r of results)assert.equal(r.rows[0].result,'confirmed');
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[id])).rows[0].count),1);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM funding_private.ledger_transactions WHERE operation_key=$1`,['intent:'+id])).rows[0].count),1);
 });
 test('general and event reservations race against shared annual capacity without excess',async()=>{
  const t='c'.repeat(64);await pool.query(`SELECT funding_private.reserve(2026,$1,NULL,NULL,95000,clock_timestamp()+interval '10 minutes')`,[t]);
  const results=await Promise.allSettled([
   pool.query(`SELECT funding_private.reserve(2026,$1,$1,$2,4000,clock_timestamp()+interval '10 minutes')`,[t,event]),
   pool.query(`SELECT funding_private.reserve(2026,$1,NULL,NULL,4000,clock_timestamp()+interval '10 minutes')`,[t])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/annual_limit/);
 });
 async function freshEvent(n,amount=1000){
  const e=`30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  await admin.query(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',0,'untouched')`,[e]);
  await pool.query(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+e,e]);
  const id=(await pool.query(`SELECT funding_private.reserve(2026,$1,$1,$2,$3,clock_timestamp()+interval '10 minutes') AS id`,[String(n).padStart(64,'d'),e,amount])).rows[0].id;
  return {e,id};
 }
 test('20 concurrent cost reservations cannot exceed available event funds',async()=>{
  const {e,id}=await freshEvent(1);await pool.query(`SELECT funding_private.confirm('cost-seed',$1,1000,'EUR')`,[id]);
  const results=await Promise.allSettled(Array.from({length:20},(_,n)=>pool.query(`SELECT funding_private.reserve_cost($1,600,$2)`,[e,'racing-cost:'+n])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/insufficient_event_funds/);
  assert.equal(Number((await pool.query(`SELECT sum(amount) AS held FROM funding_private.cost_reservations WHERE event_id=$1 AND state='reserved'`,[e])).rows[0].held),600);
 });
 test('reservation and new cost wait for parent lock then reject ended event while closure proceeds',async()=>{
  const {e,id}=await freshEvent(2);await pool.query(`SELECT funding_private.confirm('closing-seed',$1,1000,'EUR')`,[id]);
  const owner=await admin.connect(),workers=await Promise.all(Array.from({length:3},()=>pool.connect()));
  let committed=false,resultsPromise;
  try{
   await owner.query('BEGIN');await owner.query('SELECT id FROM public.protests WHERE id=$1 FOR UPDATE',[e]);
   const pids=await Promise.all(workers.map(async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
   // Attach rejection handlers immediately; release the parent only after all workers block.
   resultsPromise=Promise.allSettled([
    workers[0].query(`SELECT funding_private.reserve(2026,$1,$1,$2,100,clock_timestamp()+interval '10 minutes')`,['e'.repeat(64),e]),
    workers[1].query(`SELECT funding_private.reserve_cost($1,100,'end-race-cost')`,[e]),
    workers[2].query(`SELECT funding_private.close_event($1)`,[e])]);
   const deadline=Date.now()+5000;let blocked=0;
   while(Date.now()<deadline){
    // Statistics snapshots can otherwise remain cached inside the owning transaction.
    await owner.query('SELECT pg_stat_clear_snapshot()');
    blocked=Number((await owner.query(`SELECT count(*) AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'`,[pids])).rows[0].n);
    if(blocked===3)break;await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(blocked,3,'all workers must block on parent before end transition');
   await owner.query(`UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[e]);
   await owner.query('COMMIT');committed=true;
   const results=await resultsPromise;
   for(const r of results.slice(0,2)){assert.equal(r.status,'rejected');assert.match(r.reason.message,/event_not_open/);}
   assert.equal(results[2].status,'fulfilled');
   assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.cost_reservations WHERE event_id=$1',[e])).rows[0].count),0);
   assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.intents WHERE event_id=$1',[e])).rows[0].count),1);
  }finally{if(!committed)await owner.query('ROLLBACK');if(resultsPromise)await resultsPromise;owner.release();workers.forEach(c=>c.release());}
 });
 test('confirmation racing settlement yields one final surplus without losing contribution',async()=>{
  const {e,id}=await freshEvent(3,700);
  await admin.query(`UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[e]);
  await pool.query('SELECT funding_private.close_event($1)',[e]);
  const results=await Promise.allSettled([
   pool.query(`SELECT funding_private.confirm('settlement-race',$1,700,'EUR') AS result`,[id]),
   pool.query('SELECT funding_private.settle($1) AS surplus',[e])]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[0].value.rows[0].result,'confirmed');
  if(results[1].status==='rejected')assert.match(results[1].reason.message,/pending_items/);
  assert.equal(Number((await pool.query('SELECT funding_private.settle($1) AS surplus',[e])).rows[0].surplus),700);
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.settlements WHERE event_id=$1',[e])).rows[0].count),1);
  assert.equal(Number((await pool.query('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e])).rows[0].balance),0);
 });

 const authSimulator=createPaymentSimulator({otpCode:'123456',webhookSecret:'z'.repeat(32)});
 const authService=(sim=authSimulator)=>createIsolatedFundingService({database:pool,simulator:sim,secret:'s'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 test('native auth: 20 starts across instances share one three-start quota',async()=>{
  const a=authService(),b=authService();
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>(i%2?a:b).start({phone:'+34980000001',eventId:i%3?event:null})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
  for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'otp_rate_limit');
 });
 test('native auth: 20 valid verifications create exactly one shared session',async()=>{
  const a=authService(),b=authService(),c=await a.start({phone:'+34980000002'});
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>(i%2?a:b).verify({challengeId:c.challengeId,code:'123456'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'challenge_expired');
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])).rows[0].count),1);
  const session=results.find(r=>r.status==='fulfilled').value.session;
  assert.equal((await authService().limits(session)).annualRemainingCents,100000);
 });
 test('native auth: invalid verification race cannot exceed five shared attempts',async()=>{
  const a=authService(),b=authService(),c=await a.start({phone:'+34980000003'});
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>(i%2?a:b).verify({challengeId:c.challengeId,code:'000000'})));
  assert.ok(results.every(r=>r.status==='rejected'));
  for(const r of results)assert.ok(['invalid_otp','challenge_expired'].includes(r.reason.code));
  let attempts=Number((await pool.query('SELECT attempts FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId])).rows[0].attempts);
  assert.ok(attempts>0&&attempts<=5);
  for(;attempts<5;attempts++)await assert.rejects(a.verify({challengeId:c.challengeId,code:'000000'}),e=>e.code==='invalid_otp');
  await assert.rejects(b.verify({challengeId:c.challengeId,code:'123456'}),e=>e.code==='challenge_expired');
 });
 test('native auth: abandoned lease rejects concurrent recovery and late approval',async()=>{
  const a=authService(),c=await a.start({phone:'+34980000004'}),op='80000000-0000-0000-0000-000000000001';
  await pool.query('SELECT funding_auth_private.claim_challenge($1,$2)',[c.challengeId,op]);
  await admin.query("UPDATE funding_auth_private.otp_challenges SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[c.challengeId]);
  const results=await Promise.allSettled(Array.from({length:10},()=>authService().verify({challengeId:c.challengeId,code:'123456'})));
  assert.ok(results.every(r=>r.status==='rejected'&&r.reason.code==='challenge_expired'));
  const result=(await pool.query("SELECT funding_auth_private.finish_verification($1,$2,'valid',$3) AS result",[c.challengeId,op,'f'.repeat(64)])).rows[0].result;
  assert.equal(result.error,'challenge_expired');
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])).rows[0].count),0);
 });
 test('native auth: session insert fault rolls back consumption as restricted actor',async()=>{
  const a=authService(),c=await a.start({phone:'+34980000005'});
  await admin.query("CREATE FUNCTION public.native_auth_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_insert_fault';END $$;CREATE TRIGGER native_auth_fault BEFORE INSERT ON funding_auth_private.verified_sessions FOR EACH ROW EXECUTE FUNCTION public.native_auth_fault()");
  try{
   await assert.rejects(a.verify({challengeId:c.challengeId,code:'123456'}),e=>e.code==='financial_auth_unavailable');
   assert.equal((await pool.query('SELECT state FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId])).rows[0].state,'verifying');
   assert.equal(Number((await pool.query('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])).rows[0].count),0);
  }finally{await admin.query('DROP TRIGGER native_auth_fault ON funding_auth_private.verified_sessions');}
 });
 test('native auth: client roles denied and expiry uses DB rather than replica clock',async()=>{
  const a=authService(),c=await a.start({phone:'+34980000006'}),s=await a.verify({challengeId:c.challengeId,code:'123456'});
  await admin.query("UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1",[c.challengeId]);
  await assert.rejects(authService().limits(s.session),e=>e.code==='financial_session_required');
  const client=await admin.connect();try{
   for(const role of ['anon','authenticated']){await client.query('SET ROLE '+role);await assert.rejects(client.query('SELECT * FROM funding_auth_private.verified_sessions'),/permission denied/);await client.query('RESET ROLE');}
  }finally{client.release();}
 });

 test('native temporal: delayed December payment delivered twenty times in January credits once in old year',async()=>{
  await admin.query("CREATE TABLE funding_private.fixture_temporal_clock(t timestamptz NOT NULL);INSERT INTO funding_private.fixture_temporal_clock VALUES('2030-12-31T22:58:00Z');GRANT SELECT ON funding_private.fixture_temporal_clock TO funding_runtime;CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$ SELECT t FROM funding_private.fixture_temporal_clock $$");
  const id=(await pool.query("SELECT funding_private.reserve_v2(2030,$1,NULL,NULL,800,1) AS id",['1'.repeat(64)])).rows[0].id;
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T23:20:00Z'");
  const results=await Promise.all(Array.from({length:20},()=>pool.query("SELECT funding_private.confirm_v2('native-late','native-payment',$1,800,'EUR','2030-12-31T22:59:50Z','simulator_successful_payment:v2') AS result",[id])));
  assert.ok(results.every(r=>r.rows[0].result==='confirmed'));
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[id])).rows[0].count),1);
  assert.equal(Number((await pool.query('SELECT committed FROM funding_private.annual_limits WHERE policy_year=2030 AND token=$1',['1'.repeat(64)])).rows[0].committed),800);
 });
 test('native temporal: cancellation and confirmation races never both credit and release quota',async()=>{
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T22:58:00Z'");
  for(let n=0;n<5;n++){
   const token=String(n+2).repeat(64),id=(await pool.query('SELECT funding_private.reserve_v2(2030,$1,NULL,NULL,800,1) AS id',[token])).rows[0].id;
   const results=await Promise.allSettled([
    pool.query("SELECT funding_private.confirm_v2($1,$1,$2,800,'EUR','2030-12-31T22:58:00Z','simulator_successful_payment:v2') AS result",['cancel-race-v2:'+n,id]),
    pool.query('SELECT funding_private.cancel($1,true) AS result',[id])]);
   assert.equal(results[0].status,'fulfilled');
   const state=(await pool.query('SELECT state FROM funding_private.intents WHERE id=$1',[id])).rows[0].state;
   const quota=(await pool.query('SELECT committed,reserved FROM funding_private.annual_limits WHERE policy_year=2030 AND token=$1',[token])).rows[0];
   assert.equal(Number(quota.reserved),0);
   if(state==='confirmed'){assert.equal(Number(quota.committed),800);assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/cannot_cancel/);}
   else{assert.equal(state,'cancelled');assert.equal(Number(quota.committed),0);assert.equal(results[0].value.rows[0].result,'review');}
  }
 });
 test('native temporal: parent-locked requests crossing midnight cannot reserve old-year capacity',async()=>{
  const e='90000000-0000-0000-0000-000000000001';
  await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,'2030-01-01','2032-01-01',0,'untouched')",[e]);
  await pool.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T22:59:59Z'");
  const owner=await admin.connect(),workers=await Promise.all(Array.from({length:10},()=>pool.connect()));let result,committed=false;
  try{
   await owner.query('BEGIN');await owner.query('SELECT id FROM public.protests WHERE id=$1 FOR UPDATE',[e]);
   const pids=await Promise.all(workers.map(async c=>(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
   result=Promise.allSettled(workers.map((c,n)=>c.query('SELECT funding_private.reserve_v2(2030,$1,$1,$2,100,1)',[(n+10).toString(16).padStart(64,'b'),e])));
   let blocked=0;const deadline=Date.now()+5000;
   while(Date.now()<deadline){await owner.query('SELECT pg_stat_clear_snapshot()');blocked=Number((await owner.query("SELECT count(*) AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[pids])).rows[0].n);if(blocked===10)break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(blocked,10);
   await owner.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T23:00:00Z'");await owner.query('COMMIT');committed=true;
   const settled=await result;for(const r of settled){assert.equal(r.status,'rejected');assert.match(r.reason.message,/reverify_for_policy_year|funding_window_closed/);}
   assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.intents WHERE event_id=$1',[e])).rows[0].count),0);
  }finally{if(!committed)await owner.query('ROLLBACK');if(result)await result;owner.release();workers.forEach(c=>c.release());}
  await assert.rejects(pool.query('SELECT funding_private.reserve_v2(2031,$1,NULL,NULL,100,1800)',['9'.repeat(64)]),/funding_window_closed/);
 });
 test('native temporal: delayed confirmation racing settlement preserves final surplus and parent values',async()=>{
  const real=(await admin.query('SELECT clock_timestamp() AS t')).rows[0].t,paid=new Date(real.getTime()-5000);
  await admin.query('UPDATE funding_private.fixture_temporal_clock SET t=$1',[paid]);
  const e='90000000-0000-0000-0000-000000000002';
  await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '10 minutes',0,'untouched')",[e]);
  await pool.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);
  const year=(await pool.query('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;
  const id=(await pool.query('SELECT funding_private.reserve_v2($1,$2,$2,$3,800,1) AS id',[year,'a'.repeat(64),e])).rows[0].id;
  await admin.query("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]);await pool.query('SELECT funding_private.close_event($1)',[e]);
  const parent=JSON.stringify((await pool.query('SELECT * FROM public.protests WHERE id=$1',[e])).rows);
  await admin.query('UPDATE funding_private.fixture_temporal_clock SET t=$1',[new Date(real.getTime()+1000)]);
  const results=await Promise.allSettled([pool.query("SELECT funding_private.confirm_v2('settle-v2','settle-payment-v2',$1,800,'EUR',$2,'simulator_successful_payment:v2') AS result",[id,paid]),pool.query('SELECT funding_private.settle($1) AS surplus',[e])]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[0].value.rows[0].result,'confirmed');
  if(results[1].status==='rejected')assert.match(results[1].reason.message,/pending_items/);
  assert.equal(Number((await pool.query('SELECT funding_private.settle($1) AS surplus',[e])).rows[0].surplus),800);
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM public.protests WHERE id=$1',[e])).rows),parent);
 });

 // Fees/refunds use the same real restricted login; synthetic Owner decisions use admin only.
 async function costsClock(){await admin.query('UPDATE funding_private.fixture_temporal_clock SET t=clock_timestamp()');}
 async function costsPaid(n,amount=1000,bound=0){
  await costsClock();const e=`a0000000-0000-0000-0000-${String(n).padStart(12,'0')}`,token=String(n).padStart(64,'9');
  await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0,'untouched')",[e]);
  await pool.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);
  const year=(await pool.query('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;
  const id=(await pool.query('SELECT funding_private.reserve_with_fee_v3($1,$2,$2,$3,$4,1,$5,true) AS id',[year,token,e,amount,bound])).rows[0].id;
  await pool.query("SELECT funding_private.confirm_v2($1,$1,$2,$3,'EUR',funding_private.temporal_now(),'simulator_successful_payment:v2')",['costs-payment:'+n,id,amount]);return {e,id,token};
 }
 test('native costs: twenty fee reservations share one operational budget without overdraft',async()=>{
  await costsClock();const free=Number((await pool.query("SELECT funding_private.available_operational('general') AS n")).rows[0].n);assert.ok(free>1);const bound=Math.floor(free/2)+1;
  const year=(await pool.query('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;
  const results=await Promise.allSettled(Array.from({length:20},(_,n)=>pool.query('SELECT funding_private.reserve_with_fee_v3($1,$2,NULL,NULL,100,1,$3,true) AS id',[year,String(n).padStart(64,'8'),bound])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/operational_budget_insufficient/);
  const id=results.find(r=>r.status==='fulfilled').value.rows[0].id;await pool.query('SELECT funding_private.cancel($1,true)',[id]);
  assert.equal(Number((await pool.query("SELECT funding_private.available_operational('general') AS n")).rows[0].n),free);
 });
 test('native costs: twenty duplicate fee debits create one ledger transaction preserving event gross',async()=>{
  const {e,id}=await costsPaid(1,1000,20),paid=(await pool.query('SELECT funding_private.temporal_now() AS t')).rows[0].t;
  const results=await Promise.all(Array.from({length:20},()=>pool.query("SELECT funding_private.record_provider_movement('native-fee',$1,'processing_fee',-20,'EUR',NULL,NULL,$2) AS result",[id,paid])));
  assert.ok(results.every(r=>r.rows[0].result==='allocated'));assert.equal(Number((await pool.query("SELECT count(*) FROM funding_private.ledger_transactions WHERE operation_key='psp-movement:native-fee'")).rows[0].count),1);
  assert.equal(Number((await pool.query('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e])).rows[0].balance),1000);
 });
 test('native costs: two Owner refund holds race without consuming the same funds; cash replay keeps gross quota',async()=>{
  const {e,id,token}=await costsPaid(2);
  for(const op of ['native-refund-a','native-refund-b'])await admin.query("INSERT INTO funding_private.financial_review_decisions(operation_ref,action,intent_id,amount,source_account,expires_at) VALUES($1,'refund_authorize',$2,600,$3,clock_timestamp()+interval '1 day')",[op,id,'event:'+e]);
  const results=await Promise.allSettled(['native-refund-a','native-refund-b'].map(op=>pool.query('SELECT funding_private.reserve_refund($1) AS result',[op])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/refund_exceeds_gross|refund_source_insufficient/);
  const op=results[0].status==='fulfilled'?'native-refund-a':'native-refund-b',paid=(await pool.query('SELECT funding_private.temporal_now() AS t')).rows[0].t;
  const callbacks=await Promise.all(Array.from({length:20},()=>pool.query("SELECT funding_private.record_provider_movement('native-refund',$1,'refund',-600,'EUR',$2,NULL,$3) AS result",[id,op,paid])));
  assert.ok(callbacks.every(r=>r.rows[0].result==='allocated'));assert.equal(Number((await pool.query('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e])).rows[0].balance),400);
  assert.equal(Number((await pool.query('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[token])).rows[0].committed),1000);
 });
 test('native costs: final settlement and forced dispute never reopen final history',async()=>{
  const {e,id}=await costsPaid(3);await admin.query("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]);await pool.query('SELECT funding_private.close_event($1)',[e]);await pool.query('SELECT funding_private.settle($1)',[e]);
  const final=JSON.stringify((await pool.query('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows);
  const callbacks=await Promise.all(Array.from({length:20},()=>pool.query("SELECT funding_private.record_provider_movement('native-final-dispute',$1,'dispute_debit',-1000,'EUR',NULL,NULL,funding_private.temporal_now()) AS result",[id])));
  assert.ok(callbacks.every(r=>r.rows[0].result==='review'));await assert.rejects(pool.query('SELECT funding_private.reserve_with_fee_v3(2026,$1,NULL,NULL,100,1,0,true)',['7'.repeat(64)]),/financial_exposure_pending/);
  await admin.query("INSERT INTO funding_private.financial_review_decisions(operation_ref,action,intent_id,amount,source_account,expires_at) VALUES('native-cover','cover_exposure',$1,1000,'general',clock_timestamp()+interval '1 day')",[id]);
  assert.equal((await pool.query("SELECT funding_private.cover_provider_exposure('native-final-dispute','native-cover') AS result")).rows[0].result,'allocated');
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows),final);
 });

 let reviewPool,reviewService,reviewPaid,reviewInput,reviewDecision;
 after(()=>reviewPool?.end());
 const reviewCredential='r'.repeat(32);
 test('native review: separate inherited login is nonprivileged and cannot move money or impersonate the finance role',async()=>{
  await admin.query("CREATE ROLE funding_review_ci_login LOGIN INHERIT PASSWORD 'i4_synthetic_review_only' IN ROLE funding_review;GRANT SELECT ON funding_private.fixture_temporal_clock TO funding_review");
  const url=new URL(connection);url.username='funding_review_ci_login';url.password='i4_synthetic_review_only';
  reviewPool=new pg.Pool({connectionString:url.toString(),max:24,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
  const actor=(await reviewPool.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'funding_runtime','MEMBER') AS financial_member,pg_has_role(current_user,'service_role','MEMBER') AS service_member FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(actor,{actor:'funding_review_ci_login',rolsuper:false,rolbypassrls:false,financial_member:false,service_member:false});console.log('I4_NATIVE_REVIEW_ACTOR='+JSON.stringify(actor));
  for(const command of ["UPDATE funding_private.accounts SET balance=0","SELECT annual_token FROM funding_private.intents","SET ROLE funding_runtime","SELECT funding_private.cover_provider_exposure('x','x')"]){await assert.rejects(reviewPool.query(command),e=>e.code==='42501');}
  await assert.rejects(pool.query('SET ROLE funding_review'),e=>e.code==='42501');
  reviewService=createIsolatedReviewService({database:reviewPool,authenticator:createIsolatedReviewAuthenticator({reviewSecret:reviewCredential,fundingSecret:'f'.repeat(32),providerSecret:'w'.repeat(32),participationSecret:'p'.repeat(32),mode:'isolated'}),mode:'isolated'});
  await assert.rejects(reviewService.cases('w'.repeat(32)),e=>e.code==='review_authority_required');reviewPaid=await costsPaid(4);
 });
 test('native review: twenty Owner replays create one approval/provenance with zero financial effects',async()=>{
  reviewInput={requestId:'b0000000-0000-0000-0000-000000000001',action:'refund_authorize',intentId:reviewPaid.id,amountCents:100,sourceAccount:'event:'+reviewPaid.e,expiresAt:new Date(Date.now()+600000).toISOString(),evidenceRef:'b0000000-0000-0000-0000-000000000002'};
  const before=(await pool.query('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[reviewPaid.e])).rows[0].balance;
  const results=await Promise.all(Array.from({length:20},()=>reviewService.decide(reviewCredential,reviewInput)));assert.equal(new Set(results.map(r=>r.decisionId)).size,1);assert.ok(results.every(r=>r.fundsMoved===false));reviewDecision=results[0];
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.review_authorizations WHERE request_id=$1',[reviewInput.requestId])).rows[0].count),1);
  assert.equal((await pool.query('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[reviewPaid.e])).rows[0].balance,before);
  await assert.rejects(reviewService.decide(reviewCredential,{...reviewInput,amountCents:101}),e=>e.code==='idempotency_conflict');
 });
 test('native review: twenty revocations remain one audit fact; review/coverage never silently settles a case',async()=>{
  const revoke={requestId:'b0000000-0000-0000-0000-000000000003',evidenceRef:'b0000000-0000-0000-0000-000000000004'};
  await Promise.all(Array.from({length:20},()=>reviewService.revoke(reviewCredential,reviewDecision.decisionId,revoke)));
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.financial_decision_revocations WHERE decision_id=$1',[reviewDecision.decisionId])).rows[0].count),1);
  await assert.rejects(pool.query('SELECT funding_private.reserve_refund($1)',[reviewDecision.operationRef]),/owner_decision_required/);
  await pool.query("SELECT funding_private.record_provider_movement('native-review-fee',$1,'fee',-10,'EUR',NULL,NULL,funding_private.temporal_now())",[reviewPaid.id]);
  const d=await reviewService.decide(reviewCredential,{...reviewInput,requestId:'b0000000-0000-0000-0000-000000000005',evidenceRef:'b0000000-0000-0000-0000-000000000006',action:'cover_exposure',amountCents:10,sourceAccount:'general',movementRef:'native-review-fee'});
  const detail=await reviewService.case(reviewCredential,'native-review-fee');assert.equal(detail.case.allocated,false);assert.equal(detail.cashReconciliation,'not_certified');assert.ok(detail.decisions.some(x=>x.decisionId===d.decisionId));
  assert.equal((await pool.query("SELECT funding_private.cover_provider_exposure('native-review-fee',$1) AS result",[d.operationRef])).rows[0].result,'allocated');
  assert.equal((await reviewService.case(reviewCredential,'native-review-fee')).case.allocated,true);
 });

 // Closed offline provider contracts, exercised by the same restricted financial login.
 const providerSecret='z'.repeat(32),providerNow=async()=>(await pool.query('SELECT funding_private.temporal_now() AS t')).rows[0].t;
 const providerTransport=createOfflineFixtureTransport({mode:'isolated',otpCode:'123456',signingSecret:providerSecret,now:providerNow});
 const providerAdapter=()=>createOfflineProviderAdapter({mode:'isolated',database:pool,transport:providerTransport,signingSecret:providerSecret,now:providerNow,minimumCheckoutSeconds:60});
 const providerService=()=>createIsolatedFundingService({database:pool,simulator:providerAdapter(),secret:'j'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 let providerSession;
 test('native provider: twenty independent adapter compositions share one OTP claim and one session',async()=>{
  await costsClock();const c=await providerService().start({phone:'+349790000001'});
  const results=await Promise.allSettled(Array.from({length:20},()=>providerService().verify({challengeId:c.challengeId,code:'123456'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);providerSession=results.find(r=>r.status==='fulfilled').value.session;
  assert.equal(providerTransport.stats().otpChecks,1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.fixture_otp_bindings WHERE challenge_id=$1',[c.challengeId])).rows[0].count),1);
  console.log('I4_NATIVE_OFFLINE_PROVIDER_SOURCE=offline_fixture; actor=funding_ci_login; synthetic_minimum_seconds=60');
 });
 test('native provider: twenty signed replays create one ingress and one financial confirmation',async()=>{
  const i=await providerService().intent(providerSession,{kind:'general',amountCents:1000});
  // Native timestamps have microseconds; model payment after checkout, not a truncated creation instant.
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t=t+interval '1 second'");const proof=await providerTransport.pay(i.intentId),w=await providerTransport.webhook(proof.paymentRef);
  const results=await Promise.all(Array.from({length:20},()=>providerAdapter().ingest(w.raw,w.signature)));
  assert.ok(results.every(r=>r.result==='confirmed'));
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.fixture_ingress_events WHERE payment_ref=$1',[proof.paymentRef])).rows[0].count),1);
  assert.equal((await pool.query('SELECT state FROM funding_private.intents WHERE id=$1',[i.intentId])).rows[0].state,'confirmed');
  assert.equal(Number((await pool.query('SELECT committed FROM funding_private.annual_limits WHERE token=(SELECT annual_token FROM funding_private.intents WHERE id=$1)',[i.intentId])).rows[0].committed),1000);
 });
 test('native provider: late January signed replay preserves evidenced December payment year',async()=>{
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T22:58:00Z'");
  const s=providerService(),c=await s.start({phone:'+349790000002'}),v=await s.verify({challengeId:c.challengeId,code:'123456'}),i=await s.intent(v.session,{kind:'general',amountCents:1000});
  const proof=await providerTransport.pay(i.intentId,{effectivePaidAt:'2030-12-31T22:59:50Z'});
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T23:20:00Z'");
  const w=await providerTransport.webhook(proof.paymentRef,{created:1});const results=await Promise.all(Array.from({length:20},()=>providerAdapter().ingest(w.raw,w.signature)));
  assert.ok(results.every(r=>r.result==='confirmed'));
  const row=(await pool.query('SELECT policy_year,committed FROM funding_private.annual_limits WHERE token=(SELECT annual_token FROM funding_private.intents WHERE id=$1)',[i.intentId])).rows[0];assert.equal(row.policy_year,2030);assert.equal(Number(row.committed),1000);
  await costsClock();
 });

 // Owner-approved isolated key continuity and a separately inherited cleanup operator.
 const continuityClock=async()=>(await pool.query('SELECT funding_private.temporal_now() AS t')).rows[0].t;
 const continuitySimulator=createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32),now:continuityClock});
 const continuityRing=[legacyFundingVersion,splitFundingVersion];
 const continuityService=(currentVersion='v1')=>createIsolatedFundingService({database:pool,simulator:continuitySimulator,secret:'f'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated',continuity:createFundingKeyContinuity({database:pool,mode:'isolated',versions:continuityRing,currentVersion,participationSecret:'p'.repeat(32)})});
 let continuityEvent,continuitySessions,continuityIntent,cleanupPool,cleanupService;
 after(()=>cleanupPool?.end());
 test('native continuity: twenty old/new-version reservations share one canonical quota',async()=>{
  await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-06-01T12:00:00Z'");await registerFundingVersion(admin,legacyFundingVersion);await registerFundingVersion(admin,splitFundingVersion);
  continuityEvent='c0000000-0000-0000-0000-000000000001';await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,'2030-01-01','2032-01-01',0.9,'untouched')",[continuityEvent]);await pool.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+continuityEvent,continuityEvent]);
  continuitySessions=[];for(const current of ['v1','v2']){const a=continuityService(current),c=await a.start({phone:'+349890000001',eventId:continuityEvent});continuitySessions.push(await a.verify({challengeId:c.challengeId,code:'123456'}));}
  const results=await Promise.allSettled(Array.from({length:20},(_,n)=>continuityService(n%2?'v1':'v2').intent(continuitySessions[n%2].session,{kind:'event',amountCents:6000})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'event_limit');continuityIntent=results.find(r=>r.status==='fulfilled').value;
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.event_limits WHERE event_id=$1',[continuityEvent])).rows[0].count),1);
  assert.equal(Number((await pool.query("SELECT count(*) FROM funding_private.quota_scopes WHERE purpose='event' AND scope_ref=$1",[continuityEvent])).rows[0].count),1);
 });
 test('native continuity: twenty versioned OTP completions issue one session and one financial scope',async()=>{
  const c=await continuityService().start({phone:'+349890000002'});
  const results=await Promise.allSettled(Array.from({length:20},(_,n)=>continuityService(n%2?'v1':'v2').verify({challengeId:c.challengeId,code:'123456'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const digest=(await pool.query('SELECT digest FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])).rows;assert.equal(digest.length,1);
  const v=results.find(r=>r.status==='fulfilled').value;await continuityService('v2').revokeSession(v.session);await assert.rejects(continuityService().limits(v.session),e=>e.code==='financial_session_required');
 });
 test('native cleanup: separate inherited login has no financial/review/service authority and no payload access',async()=>{
  await admin.query("CREATE ROLE funding_cleanup_ci_login LOGIN INHERIT PASSWORD 'i4_synthetic_cleanup_only' IN ROLE funding_cleanup");const url=new URL(connection);url.username='funding_cleanup_ci_login';url.password='i4_synthetic_cleanup_only';
  cleanupPool=new pg.Pool({connectionString:url.toString(),max:24,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
  const actor=(await cleanupPool.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'funding_runtime','MEMBER') AS financial_member,pg_has_role(current_user,'funding_review','MEMBER') AS review_member,pg_has_role(current_user,'service_role','MEMBER') AS service_member FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(actor,{actor:'funding_cleanup_ci_login',rolsuper:false,rolbypassrls:false,financial_member:false,review_member:false,service_member:false});console.log('I4_NATIVE_CLEANUP_ACTOR='+JSON.stringify(actor));
  for(const sql of ['SELECT * FROM funding_private.annual_limits','SELECT payload FROM funding_auth_private.verified_sessions','SELECT candidates FROM funding_auth_private.continuity_challenges','SET ROLE funding_runtime','SET ROLE funding_review','UPDATE funding_private.accounts SET balance=0'])await assert.rejects(cleanupPool.query(sql),e=>e.code==='42501');
  cleanupService=createIsolatedCleanupService({database:cleanupPool,mode:'isolated'});await assert.rejects(cleanupService.run('c0000000-0000-0000-0000-000000000002'),e=>e.code==='cleanup_policy_required');await admin.query(fixtureRetentionPolicySQL);
 });
 test('native cleanup: twenty batch replays preserve pending quota and live auth; finance cannot clean',async()=>{
  const quota=JSON.stringify((await pool.query('SELECT * FROM funding_private.event_limits WHERE event_id=$1',[continuityEvent])).rows),ledger=Number((await pool.query('SELECT count(*) FROM funding_private.ledger_transactions')).rows[0].count);
  const request='c0000000-0000-0000-0000-000000000003',results=await Promise.all(Array.from({length:20},()=>cleanupService.run(request)));assert.ok(results.every(r=>r.request_id===request));
  assert.equal(Number((await cleanupPool.query('SELECT count(*) FROM funding_auth_private.cleanup_batches WHERE request_id=$1',[request])).rows[0].count),1);
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM funding_private.event_limits WHERE event_id=$1',[continuityEvent])).rows),quota);assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.ledger_transactions')).rows[0].count),ledger);
  await assert.rejects(pool.query('SELECT funding_auth_private.run_cleanup($1)',[request]),e=>e.code==='42501');
  assert.equal((await continuityService('v2').limits(continuitySessions[0].session)).eventRemainingCents,4000);
 });

 test('native cleanup: twenty expired-auth replays delete once while preserving pending financial quota',async()=>{
  const before=JSON.stringify((await pool.query('SELECT * FROM funding_private.event_limits WHERE event_id=$1',[continuityEvent])).rows);
  const ch=(await pool.query("SELECT id,rate_token FROM funding_auth_private.otp_challenges WHERE payload->>'eventId'=$1",[continuityEvent])).rows;assert.equal(ch.length,2);
  await admin.query("UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=ANY($1::uuid[])",[ch.map(r=>r.id)]);
  await admin.query("UPDATE funding_auth_private.otp_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",[ch.map(r=>r.id)]);
  await admin.query("UPDATE funding_auth_private.otp_rate_windows SET expires_at=clock_timestamp()-interval '1 second' WHERE rate_token=$1",[ch[0].rate_token]);
  const request='c0000000-0000-0000-0000-000000000004',results=await Promise.all(Array.from({length:20},()=>cleanupService.run(request)));
  assert.ok(results.every(r=>r.session_count===2&&r.challenge_count===2&&r.rate_count===1&&r.scope_count===1));
  assert.equal(JSON.stringify((await pool.query('SELECT * FROM funding_private.event_limits WHERE event_id=$1',[continuityEvent])).rows),before);
  assert.equal((await pool.query('SELECT state FROM funding_private.intents WHERE id=$1',[continuityIntent.intentId])).rows[0].state,'reserved');
  await assert.rejects(continuityService('v2').limits(continuitySessions[0].session),e=>e.code==='financial_session_required');
 });

 // Read-only composition of the qualification harness under the real restricted login.
 // It does not attach a remote lifecycle to existing expiry SQL or release funds.
 const qualificationBinding={reference:'qual_native',provider:'mollie',method:'ideal',amountCents:1000,currency:'EUR',createdAt:'2030-06-01T12:00:00Z',localDeadline:'2030-06-01T12:10:00Z',eventDeadline:'2030-07-01T00:00:00Z',yearDeadline:'2031-01-01T00:00:00Z'};
 const qualificationTransport=createQualificationFixture({mode:'isolated',records:[{...qualificationBinding,status:'open',mode:'synthetic',observedAt:'2030-06-01T12:20:00Z',revision:1}]});
 const qualificationObserver=createQualificationObserver({mode:'isolated',transport:qualificationTransport,bindings:[qualificationBinding],now:()=> '2030-06-01T12:20:00Z'});
 async function qualificationFinancialSnapshot(){
  return JSON.stringify((await pool.query('SELECT i.state,i.amount,l.committed,l.reserved,(SELECT count(*) FROM funding_private.ledger_transactions) AS ledger_count FROM funding_private.intents i JOIN funding_private.event_limits l ON l.event_id=i.event_id AND l.token=i.event_token WHERE i.id=$1',[continuityIntent.intentId])).rows);
 }
 test('native qualification: twenty expired-local observations preserve actual pending quota and ledger',async()=>{
  const before=await qualificationFinancialSnapshot();assert.notEqual(before,'[]');
  const results=await Promise.all(Array.from({length:20},async()=>{assert.equal((await pool.query('SELECT current_user AS actor')).rows[0].actor,'funding_ci_login');return qualificationObserver.observe('qual_native');}));
  assert.ok(results.every(r=>r.action==='HOLD'&&!r.releaseReservation));assert.equal(await qualificationFinancialSnapshot(),before);
 });
 test('native qualification: terminal fixture evidence remains an assessment and does not release SQL quota',async()=>{
  const before=await qualificationFinancialSnapshot();qualificationTransport.set('qual_native',{revision:2,status:'canceled'});
  const results=await Promise.all(Array.from({length:20},()=>qualificationObserver.observe('qual_native')));assert.ok(results.every(r=>r.releaseReservation));assert.equal(await qualificationFinancialSnapshot(),before);
 });
 test('native cutover: unresolved references block rehearsal and preserve final records',async()=>{
  const before=JSON.stringify((await pool.query('SELECT id,hash_integridad,saldo_euros FROM public.protests ORDER BY id')).rows);
  const verdict=rehearseCutover({syntheticOnly:true,writerFreezeObserved:true,inventoryComplete:true,referencesReconciled:false,quotaContinuityKnown:false,finalsPreserved:true,rollbackRehearsed:true,qualificationAccepted:false,pendingReferences:1,unknownReferences:1,activeWriters:['legacy','synthetic_candidate']});
  assert.equal(verdict.verdict,'BLOCKED');assert.equal(verdict.productionActivation,false);assert.equal(JSON.stringify((await pool.query('SELECT id,hash_integridad,saldo_euros FROM public.protests ORDER BY id')).rows),before);
 });
 let lifecyclePool,lifecycleService,lifecycleApi,lifecycleSession,lifecycleIntent;
 const lifecycleTransport=createLifecycleFixture({mode:'isolated'});after(()=>lifecyclePool?.end());
 test('native lifecycle: ingest is a separate restricted login, with no financial or identity access',async()=>{
  await admin.query(fundingLifecycleEnrollmentSQL);await admin.query("CREATE ROLE funding_ingest_ci_login LOGIN INHERIT PASSWORD 'i4_synthetic_ingest_only' IN ROLE funding_provider_ingest;GRANT SELECT ON funding_private.fixture_temporal_clock TO funding_provider_ingest");
  const url=new URL(connection);url.username='funding_ingest_ci_login';url.password='i4_synthetic_ingest_only';lifecyclePool=new pg.Pool({connectionString:url.toString(),max:24,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
  const actor=(await lifecyclePool.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'funding_runtime','MEMBER') AS financial_member,pg_has_role(current_user,'service_role','MEMBER') AS service_member FROM pg_roles WHERE rolname=current_user")).rows[0];assert.deepEqual(actor,{actor:'funding_ingest_ci_login',rolsuper:false,rolbypassrls:false,financial_member:false,service_member:false});console.log('I4_NATIVE_INGEST_ACTOR='+JSON.stringify(actor));
  await assert.rejects(lifecyclePool.query('SELECT annual_token FROM funding_private.intents'),e=>e.code==='42501');await assert.rejects(lifecyclePool.query('SELECT * FROM funding_private.annual_limits'),e=>e.code==='42501');
  await costsClock();lifecycleService=createDurableLifecycleService({mode:'isolated',finance:pool,ingest:lifecyclePool,transport:lifecycleTransport});
  lifecycleApi=createIsolatedFundingService({database:pool,simulator:continuitySimulator,durableProvider:lifecycleService,secret:'f'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated',continuity:createFundingKeyContinuity({database:pool,mode:'isolated',versions:continuityRing,currentVersion:'v2',participationSecret:'p'.repeat(32)})});
  const c=await lifecycleApi.start({phone:'+349890000100'});lifecycleSession=(await lifecycleApi.verify({challengeId:c.challengeId,code:'123456'})).session;
 });
 test('native lifecycle: twenty identical begins reserve once; boolean/raw cancellation cannot bypass proof',async()=>{
  const operationRef=randomUUID(),results=await Promise.all(Array.from({length:20},()=>lifecycleApi.lifecycleIntent(lifecycleSession,{kind:'general',amountCents:1000,operationRef})));assert.ok(results.every(r=>r.intentId===results[0].intentId));lifecycleIntent=results[0];
  await assert.rejects(pool.query('SELECT funding_private.cancel($1,true)',[lifecycleIntent.intentId]),/lifecycle_transition_evidence_required/);await assert.rejects(pool.query("UPDATE funding_private.intents SET state='cancelled' WHERE id=$1",[lifecycleIntent.intentId]),/lifecycle_transition_evidence_required/);
  assert.equal(Number((await pool.query('SELECT reserved FROM funding_private.annual_limits WHERE token=(SELECT annual_token FROM funding_private.intents WHERE id=$1)',[lifecycleIntent.intentId])).rows[0].reserved),1000);
 });
 test('native lifecycle: twenty workers recover lost creation response with exactly one checkout',async()=>{
  lifecycleTransport.fault('response_lost');assert.equal((await lifecycleService.run(lifecycleIntent.commandId)).uncertain,true);lifecycleTransport.fault(null);
  const results=await Promise.allSettled(Array.from({length:20},()=>createDurableLifecycleService({mode:'isolated',finance:pool,ingest:lifecyclePool,transport:lifecycleTransport}).run(lifecycleIntent.commandId)));const successes=results.filter(r=>r.status==='fulfilled');assert.ok(successes.length>=1);for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/lifecycle_command_busy/);
  const observations=new Set(successes.map(r=>r.value.observationId));assert.equal(observations.size,1);assert.equal(lifecycleTransport.stats().creates,1);const evidence=successes[0].value;assert.equal(await lifecycleService.apply(evidence.intentId,evidence.observationId),'bound');
 });
 test('native lifecycle: twenty payment applications commit once, preserve year and balance ledger',async()=>{
  await new Promise(resolve=>setTimeout(resolve,10));await costsClock();lifecycleTransport.set(lifecycleIntent.commandId,{status:'paid',successfulAt:new Date(Date.now()-1).toISOString(),revision:2});
  const cmd=await lifecycleService.request(lifecycleIntent.intentId,randomUUID(),'retrieve'),e=await lifecycleService.run(cmd);await costsClock();const results=await Promise.all(Array.from({length:20},()=>lifecycleService.apply(e.intentId,e.observationId)));assert.ok(results.every(r=>r==='confirmed'));
  assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[e.intentId])).rows[0].count),1);assert.equal(Number((await pool.query('SELECT committed FROM funding_private.annual_limits WHERE token=(SELECT annual_token FROM funding_private.intents WHERE id=$1)',[e.intentId])).rows[0].committed),1000);
 });
 test('native lifecycle: twenty cancellation applications release once; later paid fact remains exception',async()=>{
  await costsClock();const i=await lifecycleApi.lifecycleIntent(lifecycleSession,{kind:'general',amountCents:500,operationRef:randomUUID()}),open=await lifecycleService.run(i.commandId);await lifecycleService.apply(i.intentId,open.observationId);
  const cmd=await lifecycleService.request(i.intentId,randomUUID(),'cancel'),e=await lifecycleService.run(cmd),results=await Promise.all(Array.from({length:20},()=>lifecycleService.apply(e.intentId,e.observationId)));assert.ok(results.every(r=>r==='cancelled'));
  assert.equal(Number((await pool.query('SELECT reserved FROM funding_private.annual_limits WHERE token=(SELECT annual_token FROM funding_private.intents WHERE id=$1)',[i.intentId])).rows[0].reserved),0);
  lifecycleTransport.set(i.commandId,{status:'paid',successfulAt:new Date().toISOString(),revision:3});const checkCmd=await lifecycleService.request(i.intentId,randomUUID(),'retrieve'),paid=await lifecycleService.run(checkCmd);assert.equal(await lifecycleService.apply(i.intentId,paid.observationId),'exception');assert.equal((await pool.query('SELECT state FROM funding_private.intents WHERE id=$1',[i.intentId])).rows[0].state,'cancelled');
 });
 test('native lifecycle: concurrent existing replays survive exception; new begins and conflicting replays remain blocked',async()=>{
  await costsClock();
  const existing=(await pool.query("SELECT l.operation_ref,i.id,i.amount FROM funding_private.provider_lifecycles l JOIN funding_private.intents i ON i.id=l.intent_id JOIN funding_private.provider_applications a ON a.intent_id=i.id WHERE a.result='exception' ORDER BY l.created_at DESC LIMIT 1")).rows[0];
  assert.ok(existing);
  const snapshot=async()=>JSON.stringify((await pool.query("SELECT (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM funding_private.intents i) AS intents,(SELECT jsonb_agg(to_jsonb(a) ORDER BY token,policy_year) FROM funding_private.annual_limits a) AS quotas,(SELECT count(*) FROM funding_private.provider_commands) AS commands,(SELECT count(*) FROM funding_private.payments) AS payments,(SELECT count(*) FROM funding_private.provider_applications WHERE result='exception') AS exceptions")).rows);
  const before=await snapshot();
  const args={kind:'general',amountCents:Number(existing.amount),operationRef:existing.operation_ref};
  const results=await Promise.allSettled(Array.from({length:20},(_,n)=>lifecycleApi.lifecycleIntent(lifecycleSession,n%2?{...args,operationRef:randomUUID()}:args)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
  for(const r of results)if(r.status==='fulfilled')assert.equal(r.value.intentId,existing.id);else assert.match(r.reason.message,/lifecycle_unresolved_exception/);
  await assert.rejects(lifecycleApi.lifecycleIntent(lifecycleSession,{...args,amountCents:args.amountCents+1}),/idempotency_conflict/);
  assert.equal(await snapshot(),before);
 });
 test('native lifecycle: payment/cancellation race has one financial outcome and records conflicting evidence',async()=>{
  const challenge=await lifecycleApi.start({phone:'+349890000101'});lifecycleSession=(await lifecycleApi.verify({challengeId:challenge.challengeId,code:'123456'})).session;
  await costsClock();const i=await lifecycleApi.lifecycleIntent(lifecycleSession,{kind:'general',amountCents:500,operationRef:randomUUID()}),open=await lifecycleService.run(i.commandId);await lifecycleService.apply(i.intentId,open.observationId);
  const cancelCmd=await lifecycleService.request(i.intentId,randomUUID(),'cancel'),cancel=await lifecycleService.run(cancelCmd);
  await new Promise(resolve=>setTimeout(resolve,10));lifecycleTransport.set(i.commandId,{status:'paid',successfulAt:new Date(Date.now()-1).toISOString(),revision:3});const paidCmd=await lifecycleService.request(i.intentId,randomUUID(),'retrieve'),paid=await lifecycleService.run(paidCmd);await costsClock();
  const results=await Promise.all(Array.from({length:20},(_,n)=>lifecycleService.apply(i.intentId,n%2?paid.observationId:cancel.observationId)));assert.ok(results.includes('exception'));const row=(await pool.query('SELECT state FROM funding_private.intents WHERE id=$1',[i.intentId])).rows[0];assert.ok(['confirmed','cancelled'].includes(row.state));assert.equal(Number((await pool.query('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[i.intentId])).rows[0].count),row.state==='confirmed'?1:0);
 });
 test('native lifecycle: twenty different operations cannot exceed cumulative event cap',async()=>{
  await costsClock();const id=randomUUID();await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0.9,'lifecycle_cap')",[id]);await pool.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+id,id]);const c=await lifecycleApi.start({phone:'+349890000102',eventId:id}),session=(await lifecycleApi.verify({challengeId:c.challengeId,code:'123456'})).session;
  const results=await Promise.allSettled(Array.from({length:20},()=>lifecycleApi.lifecycleIntent(session,{kind:'event',amountCents:6000,operationRef:randomUUID()})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/event_limit/);assert.equal((await lifecycleApi.limits(session)).eventRemainingCents,4000);
 });

 let transitionLegacyPool;
 after(()=>transitionLegacyPool?.end());
 async function transitionActive(id){await cohort(admin,id);const c=await pool.connect();try{await transition(c,id,'FROZEN');await transition(c,id,'ENROLLED');await transition(c,id,'REHEARSAL_ACTIVE');}finally{c.release();}}
 async function transitionIntent(){await costsClock();const year=(await pool.query('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;const versions=(await pool.query("SELECT version FROM funding_private.key_versions WHERE purpose='annual' ORDER BY version")).rows;const aliases=versions.map(v=>({version:v.version,token:randomUUID().replaceAll('-','').repeat(2)}));const token=(await pool.query("SELECT funding_private.resolve_quota_scope('annual',$1,$2::jsonb) AS token",[String(year),JSON.stringify(aliases)])).rows[0].token;return (await pool.query('SELECT funding_private.reserve_v2($1,$2,NULL,NULL,800) AS id',[year,token])).rows[0].id;}
 async function transitionPaid(client,id,ref){return {result:(await client.query("SELECT funding_private.confirm_v2($1,$1,$2,800,'EUR',(SELECT created_at FROM funding_private.temporal_intents WHERE intent_id=$2),'simulator_successful_payment:v2') AS r",[ref,id])).rows[0].r};}
 const transitionArgs=(id,ref,extra={})=>({cohort:id,ref:'synthetic_'+ref,writer:'candidate',...extra});
 async function observeWaiting(pid){const end=Date.now()+5000;while(Date.now()<end){await admin.query('SELECT pg_stat_clear_snapshot()');const r=(await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(r?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('transition_lock_not_observed');}
 test('native transition: restricted writer roles and journal/final immutability',async()=>{
  await admin.query(transitionSQL);await admin.query("CREATE ROLE synthetic_transition_legacy_login LOGIN INHERIT PASSWORD 'synthetic_transition_only' IN ROLE synthetic_transition_legacy");
  const url=new URL(connection);url.username='synthetic_transition_legacy_login';url.password='synthetic_transition_only';transitionLegacyPool=new pg.Pool({connectionString:url.toString(),max:4,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
  for(const [db,expected,financial] of [[pool,'funding_ci_login',true],[transitionLegacyPool,'synthetic_transition_legacy_login',false]]){
   const role=(await db.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'service_role','MEMBER') AS service_member,pg_has_role(current_user,'funding_runtime','MEMBER') AS financial_member FROM pg_roles WHERE rolname=current_user")).rows[0];
   assert.deepEqual(role,{actor:expected,rolsuper:false,rolbypassrls:false,service_member:false,financial_member:financial});console.log('I4_NATIVE_TRANSITION_ACTOR='+JSON.stringify(role));
   await assert.rejects(db.query('DELETE FROM synthetic_transition.journal'),e=>e.code==='42501');
  }
  await assert.rejects(transitionLegacyPool.query('SELECT * FROM funding_private.annual_limits'),e=>e.code==='42501');
 });
 test('native transition: freeze wins race and displaced legacy action never executes',async()=>{
  await cohort(admin,'native_freeze');const owner=await pool.connect(),legacy=await transitionLegacyPool.connect();let committed=false;
  try{
   await owner.query('BEGIN');await owner.query("SELECT * FROM synthetic_transition.manifest WHERE cohort='native_freeze' FOR UPDATE");
   const pid=(await legacy.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;let called=false;
   const attempt=write(legacy,transitionArgs('native_freeze','freeze_race',{writer:'legacy'}),async()=>{called=true;return {};});
   await observeWaiting(pid);await owner.query("UPDATE synthetic_transition.manifest SET state='FROZEN' WHERE cohort='native_freeze'");await owner.query('COMMIT');committed=true;
   assert.equal((await attempt).outcome,'REJECTED_WRITER');assert.equal(called,false);
  }finally{if(!committed)await owner.query('ROLLBACK');owner.release();legacy.release();}
 });
 test('native transition: legacy wins race before freeze; journal survives reconnect and late callback goes to legacy review',async()=>{
  await cohort(admin,'native_before');const legacy=await transitionLegacyPool.connect(),freezer=await pool.connect();let committed=false;
  try{
   await legacy.query('BEGIN');await legacy.query("SELECT * FROM synthetic_transition.manifest WHERE cohort='native_before' FOR UPDATE");
   await legacy.query("INSERT INTO synthetic_transition.operations VALUES('synthetic_before','native_before',1,'invented_legacy_digest','{\"synthetic\":true}')");
   await legacy.query("INSERT INTO synthetic_transition.journal(cohort,ref,outcome) VALUES('native_before','synthetic_before','ACCEPTED')");
   const pid=(await freezer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;const freeze=transition(freezer,'native_before','FROZEN');await observeWaiting(pid);await legacy.query('COMMIT');committed=true;await freeze;
  }finally{if(!committed)await legacy.query('ROLLBACK');legacy.release();freezer.release();}
  const fresh=await transitionLegacyPool.connect();try{const before=await transitionSnapshot(pool);assert.equal((await write(fresh,transitionArgs('native_before','late_callback',{writer:'legacy',kind:'callback'}),()=>{throw Error('legacy_no_credit');})).outcome,'LEGACY_REVIEW');assert.equal(await transitionSnapshot(pool),before);assert.equal(Number((await fresh.query("SELECT count(*) AS n FROM synthetic_transition.operations WHERE ref='synthetic_before'")).rows[0].n),1);}finally{fresh.release();}
 });
 test('native transition: twenty duplicate confirmations write one payment and replay after pause',async()=>{
  await transitionActive('native_replay');const id=await transitionIntent(),a=transitionArgs('native_replay','replay',{binding:{intent:id,amount:800}});
  const calls=()=>Promise.all(Array.from({length:20},async()=>{const c=await pool.connect();try{return await write(c,a,()=>transitionPaid(c,id,a.ref));}finally{c.release();}}));
  const r=await calls();assert.equal(r.filter(x=>x.outcome==='ACCEPTED').length,1);assert.equal(r.filter(x=>x.outcome==='REPLAY').length,19);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM funding_private.payments WHERE intent_id=$1',[id])).rows[0].n),1);
  const c=await pool.connect();try{await transition(c,'native_replay','PAUSED');}finally{c.release();}
  const before=await transitionSnapshot(pool);assert.ok((await calls()).every(x=>x.outcome==='REPLAY'));assert.equal(await transitionSnapshot(pool),before);
 });
 test('native transition: post-confirmation fault rolls back all writes, reconnect retry succeeds once',async()=>{
  await transitionActive('native_fault');const id=await transitionIntent(),a=transitionArgs('native_fault','fault_native',{binding:{intent:id,amount:800}}),before=await transitionSnapshot(pool);
  const c=await pool.connect();try{await assert.rejects(write(c,a,async()=>{await transitionPaid(c,id,a.ref);throw Error('injected_native_transition');}),/injected_native_transition/);}finally{c.release();}
  assert.equal(await transitionSnapshot(pool),before);
  const fresh=await pool.connect();try{assert.equal((await write(fresh,a,()=>transitionPaid(fresh,id,a.ref))).result.result,'confirmed');}finally{fresh.release();}
 });
 test('native transition: competing claimed writers and concurrent pause cannot create new receipts after pause',async()=>{
  await transitionActive('native_compete');const candidate=await pool.connect(),legacy=await transitionLegacyPool.connect();
  try{const r=await Promise.all([write(candidate,transitionArgs('native_compete','same')),write(legacy,transitionArgs('native_compete','same',{writer:'legacy'}))]);assert.equal(r[0].outcome,'ACCEPTED');assert.ok(['REJECTED_WRITER','CONTRADICTION'].includes(r[1].outcome));await transition(candidate,'native_compete','PAUSED');}finally{candidate.release();legacy.release();}
  const before=await transitionSnapshot(pool);const r=await Promise.all(Array.from({length:20},async(_,n)=>{const c=await pool.connect();try{return await write(c,transitionArgs('native_compete','paused_'+n),()=>{throw Error('new_operation_after_pause');});}finally{c.release();}}));assert.ok(r.every(x=>x.outcome==='REJECTED_WRITER'));assert.equal(await transitionSnapshot(pool),before);
 });


 test('native transition: observed pause lock orders competing new entry, outstanding completion remains allowed',async()=>{
  await transitionActive('native_pause_race');const id=await transitionIntent(),owner=await pool.connect(),worker=await pool.connect();let committed=false;
  try{
   await owner.query('BEGIN');await owner.query("SELECT * FROM synthetic_transition.manifest WHERE cohort='native_pause_race' FOR UPDATE");
   const pid=(await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const attempt=write(worker,transitionArgs('native_pause_race','pause_race_new'),()=>{throw Error('new_entry_must_not_execute');});await observeWaiting(pid);
   await owner.query("UPDATE synthetic_transition.manifest SET state='PAUSED' WHERE cohort='native_pause_race'");await owner.query('COMMIT');committed=true;
   assert.equal((await attempt).outcome,'REJECTED_WRITER');
   assert.equal((await write(worker,transitionArgs('native_pause_race','pause_race_completion',{kind:'completion',binding:{intent:id,amount:800}}),()=>transitionPaid(worker,id,'synthetic_pause_race_completion'))).result.result,'confirmed');
  }finally{if(!committed)await owner.query('ROLLBACK');owner.release();worker.release();}
 });
 let ownerIdentity,ownerService,ownerCredential,ownerEnrollment,ownerInput,ownerChallenge,ownerProof,ownerDecision;
 after(()=>ownerEnrollment?.end());
 test('native Owner: restricted issuer/enrollment roles and no legacy authority fallback',async()=>{
  await admin.query(await readFile(authorityMigration,'utf8'));
  await admin.query("CREATE ROLE funding_owner_enrollment_ci LOGIN INHERIT PASSWORD 'synthetic_owner_enrollment' IN ROLE funding_owner_enrollment");
  const u=new URL(connection);u.username='funding_owner_enrollment_ci';u.password='synthetic_owner_enrollment';ownerEnrollment=new pg.Pool({connectionString:u.toString(),max:4});
  const actor=(await ownerEnrollment.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'funding_runtime','MEMBER') AS finance,pg_has_role(current_user,'funding_review','MEMBER') AS review,pg_has_role(current_user,'service_role','MEMBER') AS service FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(actor,{actor:'funding_owner_enrollment_ci',rolsuper:false,rolbypassrls:false,finance:false,review:false,service:false});console.log('I4_NATIVE_OWNER_ENROLLMENT_ACTOR='+JSON.stringify(actor));
  ownerIdentity=ownerIdentityFixture();await ownerEnrollment.query("INSERT INTO funding_owner_private.principals VALUES($1,'synthetic_owner_issuer','fixture-owner',1,true,true,$2)",[ownerIdentity.principal,randomUUID()]);
  ownerService=createOwnerAuthorityService({database:reviewPool,identity:ownerIdentity.adapter,mode:'isolated'});ownerCredential=ownerIdentity.credential();
  for(const cmd of ["SET ROLE funding_review","SET ROLE funding_runtime","UPDATE funding_private.accounts SET balance=0"])await assert.rejects(ownerEnrollment.query(cmd),e=>e.code==='42501');
  for(const p of [pool,reviewPool])await assert.rejects(p.query("UPDATE funding_owner_private.principals SET active=false"),e=>e.code==='42501');
  ownerInput={requestId:randomUUID(),action:'refund_authorize',intentId:reviewPaid.id,amountCents:100,sourceAccount:'event:'+reviewPaid.e,expiresAt:'2035-01-01T00:00:00Z',evidenceRef:randomUUID()};
  await assert.rejects(reviewService.decide(reviewCredential,ownerInput),/owner_binding_required|review_unavailable/);
 });
 test('native Owner: twenty operation-bound confirmations commit one approval and challenge consumption',async()=>{
  ownerChallenge=await ownerService.challenge(ownerCredential,'issue',ownerInput);ownerProof=ownerIdentity.confirm('issue',ownerInput,ownerChallenge.challengeId);
  const result=await Promise.all(Array.from({length:20},()=>ownerService.decide(ownerCredential,ownerInput,ownerChallenge.challengeId,ownerProof)));ownerDecision=result[0];assert.equal(new Set(result.map(x=>x.decisionId)).size,1);
  assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_owner_private.bindings WHERE request_id=$1',[ownerInput.requestId])).rows[0].n),1);
  await assert.rejects(ownerService.decide(ownerCredential,{...ownerInput,amountCents:101},ownerChallenge.challengeId,ownerProof),/owner_confirmation_required/);
 });
 test('native Owner: suspension commits ahead of waiting financial use and invalidates stale approval',async()=>{
  const a=await ownerEnrollment.connect(),f=await pool.connect();let committed=false;
  try{await a.query('BEGIN');await a.query("SELECT funding_owner_private.recover($1,$2,'suspend',$3)",[randomUUID(),ownerIdentity.principal,randomUUID()]);
   const pid=(await f.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const use=f.query('SELECT funding_private.reserve_refund($1)',[ownerInput.requestId]);const checked=assert.rejects(use,/owner_authority_revoked/);await observeWaiting(pid);
   await a.query('COMMIT');committed=true;await checked;
   assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_private.refund_reservations WHERE decision_id=$1',[ownerDecision.decisionId])).rows[0].n),0);
  }finally{if(!committed)await a.query('ROLLBACK');a.release();f.release();}
 });
 test('native Owner: recovery replay is idempotent, reenrollment does not revive old decisions',async()=>{
  const r=randomUUID(),ev=randomUUID(),args=[r,ownerIdentity.principal,ev];const results=await Promise.all(Array.from({length:20},()=>ownerEnrollment.query("SELECT funding_owner_private.recover($1,$2,'reenroll',$3) AS epoch",args)));assert.ok(results.every(x=>x.rows[0].epoch===3));
  await assert.rejects(ownerService.cases(ownerCredential),/owner_authority_revoked/);
  await assert.rejects(pool.query('SELECT funding_private.reserve_refund($1)',[ownerInput.requestId]),/owner_authority_revoked/);
  assert.ok(await ownerService.cases(ownerIdentity.credential({epoch:3})));
 });
 test('native Owner: financial-use lock commits before suspension, which prevents later allocation',async()=>{
  const cred=ownerIdentity.credential({epoch:3}),input={...ownerInput,requestId:randomUUID(),evidenceRef:randomUUID()},c=await ownerService.challenge(cred,'issue',input),proof=ownerIdentity.confirm('issue',input,c.challengeId,3);const d=await ownerService.decide(cred,input,c.challengeId,proof);
  const f=await pool.connect(),a=await ownerEnrollment.connect();let committed=false;
  try{await f.query('BEGIN');assert.equal((await f.query('SELECT funding_private.reserve_refund($1) AS result',[input.requestId])).rows[0].result,'reserved');
   const pid=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,rev=a.query("SELECT funding_owner_private.recover($1,$2,'suspend',$3)",[randomUUID(),ownerIdentity.principal,randomUUID()]);await observeWaiting(pid);await f.query('COMMIT');committed=true;await rev;
   assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_private.refund_reservations WHERE decision_id=$1',[d.decisionId])).rows[0].n),1);
   await pool.query("SELECT funding_private.record_provider_movement('owner-stale-refund',$1,'refund',-100,'EUR',$2,NULL,funding_private.temporal_now())",[reviewPaid.id,input.requestId]);
   assert.equal((await pool.query("SELECT funding_private.apply_movement('owner-stale-refund',$1,$2) AS result",['event:'+reviewPaid.e,d.decisionId])).rows[0].result,'review');
   assert.equal(Number((await admin.query("SELECT count(*) AS n FROM funding_private.provider_movements WHERE movement_ref='owner-stale-refund'")).rows[0].n),1);
   assert.equal(Number((await admin.query("SELECT count(*) AS n FROM funding_private.movement_allocations WHERE movement_ref='owner-stale-refund'")).rows[0].n),0);
  }finally{if(!committed)await f.query('ROLLBACK');f.release();a.release();}
 });


 let receiptPool,receiptService;after(()=>receiptPool?.end());
 test('native legacy receipt: independent ingest actor cannot assume financial or review authority',async()=>{
  await admin.query(await readFile(legacyReceiptMigration,'utf8'));
  await admin.query("CREATE ROLE funding_legacy_receipt_ci_login LOGIN INHERIT PASSWORD 'synthetic_receipt_ci' IN ROLE funding_legacy_receipt_ingest");
  const u=new URL(connection);u.username='funding_legacy_receipt_ci_login';u.password='synthetic_receipt_ci';receiptPool=new pg.Pool({connectionString:u.toString(),max:24});
  receiptService=createLegacyReceiptService({database:receiptPool,adapter:createLegacyReceiptFixtureAdapter(legacyReceiptAdapterOptions),mode:'isolated'});
  const actor=(await receiptPool.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'funding_runtime','MEMBER') AS finance,pg_has_role(current_user,'funding_review','MEMBER') AS review,pg_has_role(current_user,'service_role','MEMBER') AS service FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(actor,{actor:'funding_legacy_receipt_ci_login',rolsuper:false,rolbypassrls:false,finance:false,review:false,service:false});console.log('I4_NATIVE_RECEIPT_ACTOR='+JSON.stringify(actor));
  for(const command of ['SET ROLE funding_runtime','SET ROLE funding_review','SELECT * FROM funding_private.accounts','DELETE FROM funding_legacy_receipt_private.operations'])await assert.rejects(receiptPool.query(command),e=>e.code==='42501');
  await assert.rejects(pool.query('SELECT * FROM funding_legacy_receipt_private.operations'),e=>e.code==='42501');
 });
 test('native legacy receipt: twenty independent connections and adapters preserve one committed operation',async()=>{
  const input=legacyReceiptInput('native_duplicates');const result=await Promise.all(Array.from({length:20},()=>createLegacyReceiptService({database:receiptPool,adapter:createLegacyReceiptFixtureAdapter(legacyReceiptAdapterOptions),mode:'isolated'}).receive(legacyReceiptSecret,input)));
  assert.equal(new Set(result.map(x=>x.receiptId)).size,1);assert.equal(result.filter(x=>x.outcome==='received').length,1);assert.ok(result.every(x=>x.received&&x.allocation==='review'&&!x.fundsMoved&&!x.paymentVerified));
  assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_legacy_receipt_private.operations WHERE operation_ref=$1',[input.reference])).rows[0].n),1);
 });
 test('native legacy receipt: concurrent conflicts preserve original and one immutable conflict',async()=>{
  const input=legacyReceiptInput('native_conflicts'),original=await receiptService.receive(legacyReceiptSecret,input),before=(await admin.query('SELECT * FROM funding_legacy_receipt_private.operations WHERE id=$1',[original.receiptId])).rows;
  const result=await Promise.all(Array.from({length:20},()=>receiptService.receive(legacyReceiptSecret,{...input,amountCents:101})));
  assert.equal(new Set(result.map(x=>x.conflictId)).size,1);assert.deepEqual((await admin.query('SELECT * FROM funding_legacy_receipt_private.operations WHERE id=$1',[original.receiptId])).rows,before);
  assert.equal(Number((await admin.query('SELECT count(*) AS n FROM funding_legacy_receipt_private.conflicts WHERE operation_id=$1',[original.receiptId])).rows[0].n),1);
 });
 test('native legacy receipt: waiting receipt observes prior commit rather than acknowledging an uncommitted row',async()=>{
  const input=legacyReceiptInput('native_wait'),n=createLegacyReceiptFixtureAdapter(legacyReceiptAdapterOptions).normalize(legacyReceiptSecret,input),a=await receiptPool.connect(),b=await receiptPool.connect();let committed=false;
  const sql='SELECT funding_legacy_receipt_private.receive($1,$2,$3,$4,$5,$6,$7) AS result',args=[n.reference,n.amountCents,n.currency,n.effectiveAt,n.eventRef,n.digest,n.evidenceRef];
  try{await a.query('BEGIN');const first=(await a.query(sql,args)).rows[0].result;const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;const pending=b.query(sql,args);await observeWaiting(pid);
   await a.query('COMMIT');committed=true;const second=(await pending).rows[0].result;assert.equal(second.outcome,'duplicate');assert.equal(second.receiptId,first.receiptId);
  }finally{if(!committed)await a.query('ROLLBACK');a.release();b.release();}
 });
 test('native legacy receipt: deferred commit failure has no ACK or durable insert; lost committed response retries safely without finance changes',async()=>{
  const state=async()=>JSON.stringify({accounts:(await admin.query('SELECT * FROM funding_private.accounts ORDER BY id')).rows,ledger:(await admin.query('SELECT * FROM funding_private.ledger_entries ORDER BY transaction_id,account_id')).rows,quotas:(await admin.query('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows});const before=await state(),input=legacyReceiptInput('native_commit_failure');
  await admin.query("CREATE FUNCTION public.native_receipt_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_commit_fault';END $$;CREATE CONSTRAINT TRIGGER native_receipt_commit_fault AFTER INSERT ON funding_legacy_receipt_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.native_receipt_commit_fault()");
  try{await assert.rejects(receiptService.receive(legacyReceiptSecret,input),e=>e.code==='legacy_receipt_unavailable');assert.equal((await admin.query('SELECT id FROM funding_legacy_receipt_private.operations WHERE operation_ref=$1',[input.reference])).rows.length,0);}finally{await admin.query('DROP TRIGGER native_receipt_commit_fault ON funding_legacy_receipt_private.operations');}
  let lose=true;const database={async connect(){const c=await receiptPool.connect();return {async query(s,a){const r=await c.query(s,a);if(s==='COMMIT'&&lose){lose=false;throw Error('synthetic_response_loss');}return r;},release(){c.release();}};}};
  const service=createLegacyReceiptService({database,adapter:createLegacyReceiptFixtureAdapter(legacyReceiptAdapterOptions),mode:'isolated'});await assert.rejects(service.receive(legacyReceiptSecret,input),e=>e.code==='legacy_receipt_unavailable');assert.equal((await receiptService.receive(legacyReceiptSecret,input)).outcome,'duplicate');assert.equal(await state(),before);
 });
}
