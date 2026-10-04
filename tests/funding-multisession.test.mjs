// Run only against a fresh loopback PostgreSQL database explicitly named i4_isolated.
// This harness never uses Supabase credentials or a production connection.
import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
import {fundingParentFixtureSQL,fundingRlsMigration,fundingAuthMigration} from './helpers/funding-fixture.mjs';
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

}
