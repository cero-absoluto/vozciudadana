// Run only against a fresh loopback PostgreSQL database explicitly named i4_isolated.
// This harness never uses Supabase credentials or a production connection.
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
import {fundingLifecycleMigration,fundingLifecycleEnrollmentSQL} from './helpers/funding-fixture.mjs';
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
 await admin.query("CREATE ROLE funding_ci_login LOGIN INHERIT PASSWORD 'i4_synthetic_funding_only' IN ROLE funding_runtime");
 const runtimeURL=new URL(connection);runtimeURL.username='funding_ci_login';runtimeURL.password='i4_synthetic_funding_only';
 pool=new pg.Pool({connectionString:runtimeURL.toString(),max:24,connectionTimeoutMillis:5000,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
 const actor=(await pool.query("SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,'service_role','MEMBER') AS service_member FROM pg_roles WHERE rolname=current_user")).rows[0];
 assert.deepEqual(actor,{actor:'funding_ci_login',rolsuper:false,rolbypassrls:false,service_member:false});
 console.log('I4_NATIVE_FINANCIAL_ACTOR='+JSON.stringify(actor));
 const event='20000000-0000-0000-0000-000000000001',token='b'.repeat(64);
 await admin.query(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',0,'untouched')`,[event]);
 await pool.query(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+event,event]);
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
  await admin.query(fundingLifecycleEnrollmentSQL);await admin.query("CREATE ROLE funding_ingest_ci_login LOGIN INHERIT PASSWORD 'i4_synthetic_ingest_only' IN ROLE funding_provider_ingest");
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
}
