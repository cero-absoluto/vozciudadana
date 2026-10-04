import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/funding-fixture.mjs';
import {transitionSQL,cohort,transition,write,snapshot} from './helpers/funding-transition-fixture.mjs';
const db=new PGlite();after(()=>db.close());await db.exec(f.fundingParentFixtureSQL);
for(const k of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration','fundingProviderMigration','fundingContinuityMigration','fundingRetentionMigration','fundingLifecycleMigration','fundingLifecycleReplayMigration'])await db.exec(await readFile(f[k],'utf8'));
await db.exec(transitionSQL);
await db.exec("CREATE TABLE funding_private.fixture_temporal_clock(t timestamptz NOT NULL);INSERT INTO funding_private.fixture_temporal_clock VALUES('2030-06-01T12:00:00Z');GRANT SELECT ON funding_private.fixture_temporal_clock TO funding_runtime;CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$ SELECT t FROM funding_private.fixture_temporal_clock $$");
const admin={query:async(sql,args=[])=>{await db.exec('RESET ROLE');try{return await db.query(sql,args);}finally{await db.exec('SET ROLE funding_runtime');}}};
await db.exec('SET ROLE funding_runtime');
async function active(id,options){await cohort(admin,id,options);await transition(db,id,'FROZEN');await transition(db,id,'ENROLLED');await transition(db,id,'REHEARSAL_ACTIVE');}
const args=(id,ref,extra={})=>({cohort:id,ref:'synthetic_'+ref,writer:'candidate',...extra});
let seq=0;async function intent(amount=800){const token=String(++seq).padStart(64,'e');return (await db.query('SELECT funding_private.reserve_v2(2030,$1,NULL,NULL,$2) AS id',[token,amount])).rows[0].id;}
async function paid(id,ref,amount=800,time='2030-06-01T12:00:00Z'){return {result:(await db.query("SELECT funding_private.confirm_v2($1,$1,$2,$3,'EUR',$4,'simulator_successful_payment:v2') AS r",[ref,id,amount,time])).rows[0].r};}

test('transition: freeze/enrolment/pause preserve invented final balance/hash',async()=>{
 const before=(await db.query('SELECT * FROM synthetic_transition.finals')).rows;await active('final');await transition(db,'final','PAUSED');assert.deepEqual((await db.query('SELECT * FROM synthetic_transition.finals')).rows,before);
});
test('transition: pending, unknown, missing inventory and annual usage UNKNOWN block enrolment',async()=>{
 for(const [id,options,status] of [['unknown_quota',{known:false},null],['incomplete',{complete:false},null],['pending',{},'pending'],['unknown',{},'unknown']]) {
  await cohort(admin,id,options);if(status)await admin.query('INSERT INTO synthetic_transition.inventory VALUES($1,\'synthetic_pending\',$2)',[id,status]);await transition(db,id,'FROZEN');
  await assert.rejects(transition(db,id,'ENROLLED'),/transition_evidence_missing/);assert.equal((await db.query('SELECT state FROM synthetic_transition.manifest WHERE cohort=$1',[id])).rows[0].state,'FROZEN');
 }
});
test('transition: displaced writer and stale epoch cannot invoke the financial action',async()=>{
 await active('writers');let invoked=0;const action=async()=>{invoked++;return {};};
 assert.equal((await write(db,args('writers','wrong_role',{writer:'legacy'}),action)).outcome,'REJECTED_ROLE');
 assert.equal((await write(db,args('writers','old_epoch',{epoch:0}),action)).outcome,'REJECTED_WRITER');assert.equal(invoked,0);
});
test('transition: confirmed payment response replay survives pause; contradictory evidence is journaled',async()=>{
 await active('payment');const id=await intent();const a=args('payment','payment',{binding:{intent:id,amount:800}});
 assert.equal((await write(db,a,()=>paid(id,a.ref))).result.result,'confirmed');const before=await snapshot(db);await transition(db,'payment','PAUSED');
 assert.equal((await write(db,a,()=>{throw Error('must_not_run');})).outcome,'REPLAY');
 assert.equal((await write(db,{...a,binding:{intent:id,amount:801}})).outcome,'CONTRADICTION');assert.equal(await snapshot(db),before);
});
test('transition: pause blocks new reservations but accepts completion of a prior reserved intent',async()=>{
 await active('pause');const id=await intent();await transition(db,'pause','PAUSED');
 const before=await snapshot(db);assert.equal((await write(db,args('pause','new'),()=>intent())).outcome,'REJECTED_WRITER');assert.equal(await snapshot(db),before);
 assert.equal((await write(db,args('pause','complete',{kind:'completion',binding:{intent:id,amount:800}}),()=>paid(id,'synthetic_complete'))).result.result,'confirmed');
});
test('transition: injected failure after confirmation rolls back ledger, quota, operation and success journal',async()=>{
 await active('fault');const id=await intent();const before=await snapshot(db);const n=(await db.query('SELECT count(*) AS n FROM synthetic_transition.journal')).rows[0].n;
 await assert.rejects(write(db,args('fault','fault',{binding:{intent:id,amount:800}}),async()=>{await paid(id,'synthetic_fault');throw Error('injected_transition_fault');}),/injected_transition_fault/);
 assert.equal(await snapshot(db),before);assert.equal((await db.query('SELECT count(*) AS n FROM synthetic_transition.journal')).rows[0].n,n);
 assert.equal((await write(db,args('fault','fault',{binding:{intent:id,amount:800}}),()=>paid(id,'synthetic_fault'))).result.result,'confirmed');
});
test('transition: absent outcome retains actual SQL reservation over Amsterdam year boundary',async()=>{
 await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T22:59:30Z'");await active('year');const id=await intent();const before=await snapshot(db);
 await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-12-31T23:20:00Z'");await transition(db,'year','PAUSED');assert.equal(await snapshot(db),before);
 assert.equal((await db.query('SELECT state FROM funding_private.intents WHERE id=$1',[id])).rows[0].state,'reserved');
 assert.equal((await write(db,args('year','late',{kind:'completion',binding:{intent:id,amount:800,paidAt:'2030-12-31T23:10:00Z'}}),()=>paid(id,'synthetic_late',800,'2030-12-31T23:10:00Z'))).result.result,'review');
 await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-06-01T12:00:00Z'");
});
test('transition: same-year previously evidenced usage retains actual cumulative cap',async()=>{
 await active('quota');const token='d'.repeat(64);await admin.query("INSERT INTO funding_private.annual_limits(policy_year,token,reserved,committed) VALUES(2030,$1,0,99500)",[token]);
 await assert.rejects(write(db,args('quota','over_cap'),()=>db.query('SELECT funding_private.reserve_v2(2030,$1,NULL,NULL,501)',[token])),/annual_limit/);
 assert.equal(Number((await db.query('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[token])).rows[0].committed),99500);
});
test('transition: rejected operation payload cannot persist donor/profile/participation data',async()=>{
 await active('privacy');await transition(db,'privacy','PAUSED');await write(db,{...args('privacy','pii'),phone:'FORBIDDEN_PHONE',binding:{name:'FORBIDDEN_NAME',participation:'FORBIDDEN_TOKEN'}});
 const result=JSON.stringify((await db.query('SELECT * FROM synthetic_transition.journal')).rows)+JSON.stringify((await db.query('SELECT * FROM synthetic_transition.operations')).rows);assert.doesNotMatch(result,/FORBIDDEN_/);
});
test('transition: rollback cannot mutate confirmed operations, journal or immutable final records',async()=>{
 for(const table of ['operations','journal','finals'])await assert.rejects(db.query(`DELETE FROM synthetic_transition.${table}`),/permission denied|immutable/);
});
test('transition: event cutoff keeps late completion in review without rewriting the event final',async()=>{
 await active('event_end');const e='e0000000-0000-0000-0000-000000000001',token='f'.repeat(64);
 await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,'2030-06-01T11:00:00Z','2030-06-01T12:01:00Z',0.73,'invented_event_final')",[e]);
 await db.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);
 const id=(await db.query('SELECT funding_private.reserve_v2(2030,$1,$1,$2,800) AS id',[token,e])).rows[0].id;
 const before=(await db.query('SELECT * FROM public.protests WHERE id=$1',[e])).rows;
 await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-06-01T12:02:00Z'");
 await assert.rejects(write(db,args('event_end','event_new'),()=>db.query('SELECT funding_private.reserve_v2(2030,$1,$1,$2,800)',[token,e])),/event_not_open/);
 assert.equal((await write(db,args('event_end','event_late',{kind:'completion',binding:{intent:id,amount:800,paidAt:'2030-06-01T12:01:00Z'}}),()=>paid(id,'synthetic_event_late',800,'2030-06-01T12:01:00Z'))).result.result,'review');
 assert.deepEqual((await db.query('SELECT * FROM public.protests WHERE id=$1',[e])).rows,before);
 await admin.query("UPDATE funding_private.fixture_temporal_clock SET t='2030-06-01T12:00:00Z'");
});
test('transition: event SMS cannot consume positive general or restricted grant balances',async()=>{
 await active('sources');const e='e0000000-0000-0000-0000-000000000002';
 await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0,'invented_sources')",[e]);
 await db.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);
 await db.query("INSERT INTO funding_private.accounts(id,kind) VALUES('synthetic_restricted','restricted_grant')");
 const grant=(await db.query("INSERT INTO funding_private.grant_awards(account_id,purpose,restricted,anti_capture_accepted) VALUES('synthetic_restricted','invented infrastructure',true,true) RETURNING id")).rows[0].id;
 await db.query("SELECT funding_private.record_simulated_grant($1,5000,'synthetic_restricted_funding')",[grant]);
 assert.ok(Number((await db.query("SELECT balance FROM funding_private.accounts WHERE id='general'")).rows[0].balance)>0);
 const before=await snapshot(db);await assert.rejects(write(db,args('sources','sms'),()=>db.query("SELECT funding_private.reserve_cost($1,1,'synthetic_sms')",[e])),/insufficient_event_funds/);assert.equal(await snapshot(db),before);
});
