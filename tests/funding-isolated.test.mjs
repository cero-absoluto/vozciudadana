import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import Fastify from 'fastify';
import {fundingParentFixtureSQL,fundingRlsMigration} from './helpers/funding-fixture.mjs';
import { createIsolatedFundingService,createPaymentSimulator,fundingTokens,policyYear } from '../apps/api/src/funding/isolatedService.js';
import { isolatedFundingRoutes } from '../apps/api/src/funding/routes.js';

const db=new PGlite();
await db.exec(fundingParentFixtureSQL);
await db.exec(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES('00000000-0000-0000-0000-000000000090',now()-interval '2 days',now()-interval '1 day',0.90,'historic');`);
await db.exec(await readFile(new URL('../supabase/migrations/20261003200832_funding_private_core.sql',import.meta.url),'utf8'));
await db.exec(await readFile(fundingRlsMigration,'utf8'));
const q=(text,args=[])=>db.query(text,args),scalar=async(text,args)=>Object.values((await q(text,args)).rows[0])[0];
const token=n=>String(n).padStart(64,'a');
let sequence=1;
async function event({open=true,enabled=true}={}){
 const id=`10000000-0000-0000-0000-${String(sequence++).padStart(12,'0')}`;
 await q(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',0,'untouched')`,[id]);
 if(!open)await q(`UPDATE public.protests SET ends_at=now()-interval '1 second' WHERE id=$1`,[id]);
 if(enabled)await q(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+id,id]);return id;
}
const reserve=(annual,eventId,amount,year=2026,eventToken=annual)=>scalar('SELECT funding_private.reserve($1,$2,$3,$4,$5,clock_timestamp()+interval \'10 minutes\')',[year,annual,eventId?eventToken:null,eventId,amount]);
const confirm=(id,amount,ref=id,currency='EUR')=>scalar('SELECT funding_private.confirm($1,$2,$3,$4)',[ref,id,amount,currency]);
after(()=>db.close());

test('cumulative event 60+40 accepted and next cent denied; full allocation without 90/10',async()=>{
 const e=await event(),t=token(1);const a=await reserve(t,e,6000);await confirm(a,6000);
 const b=await reserve(t,e,4000);await confirm(b,4000);
 await assert.rejects(reserve(t,e,1),/event_limit/);
 assert.equal(await scalar('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e]),10000);
});
test('general and event share annual quota including unconfirmed reservations',async()=>{
 const t=token(2),e=await event();await reserve(t,null,95000);await reserve(t,e,5000);
 await assert.rejects(reserve(t,null,1),/annual_limit/);await assert.rejects(reserve(t,e,1),/annual_limit/);
});
test('one confirmation writes balanced entries; retries are idempotent',async()=>{
 const a=await reserve(token(3),null,500);assert.equal(await confirm(a,500),'confirmed');
 const before=await scalar('SELECT count(*) FROM funding_private.ledger_entries');
 assert.equal(await confirm(a,500),'confirmed');assert.equal(await scalar('SELECT count(*) FROM funding_private.ledger_entries'),before);
 assert.equal(await confirm(a,500,'second-payment'),'duplicate_payment');
 await assert.rejects(confirm(a,501,a),/idempotency_conflict/);
});
test('mismatched amount/currency retained for review without credit or released capacity',async()=>{
 const t=token(4),a=await reserve(t,null,800);
 assert.equal(await confirm(a,801,'mismatch','USD'),'review');
 assert.equal(await scalar('SELECT reserved FROM funding_private.annual_limits WHERE token=$1',[t]),800);
 assert.equal(await scalar('SELECT count(*) FROM funding_private.payments WHERE intent_id=$1',[a]),0);
});
test('expired reservation callback never credits automatically',async()=>{
 const a=await reserve(token(5),null,300);await q(`UPDATE funding_private.intents SET expires_at=now()-interval '1 second' WHERE id=$1`,[a]);
 assert.equal(await confirm(a,300),'review');assert.equal(await scalar('SELECT amount FROM funding_private.intents WHERE id=$1',[a]),300);
});
test('provider final cancellation releases quota once, unproven cancellation denied',async()=>{
 const t=token(6),a=await reserve(t,null,400);
 await assert.rejects(q('SELECT funding_private.cancel($1,false)',[a]),/provider_may_still_charge/);
 await q('SELECT funding_private.cancel($1,true)',[a]);await q('SELECT funding_private.cancel($1,true)',[a]);
 assert.equal(await scalar('SELECT reserved FROM funding_private.annual_limits WHERE token=$1',[t]),0);
 assert.equal(await confirm(a,400),'review');
});
test('unsupported/inactive/legacy events cannot receive future contributions',async()=>{
 await assert.rejects(reserve(token(7),await event({open:false}),100),/event_not_open/);
 await assert.rejects(reserve(token(7),await event({enabled:false}),100),/event_not_enabled/);
 await assert.rejects(reserve(token(7),'00000000-0000-0000-0000-000000000090',100),/event_not_open/);
});
test('negative amount and invalid token fail without limit mutation',async()=>{
 await assert.rejects(reserve(token(8),null,-1),/invalid_reservation/);
 await assert.rejects(reserve('bad',null,100),/check constraint/);
 assert.equal(await scalar('SELECT count(*) FROM funding_private.annual_limits WHERE token=$1',[token(8)]),0);
});
test('event quota persists across policy years, annual tokens are independent',async()=>{
 const e=await event(),et=token(9);await reserve(token(90),e,6000,2026,et);
 await assert.rejects(reserve(token(91),e,5000,2027,et),/event_limit/);
 await reserve(token(91),null,100000,2027);
});
test('cost reservations prevent overdraft and charge once; general cannot fund event SMS',async()=>{
 const e=await event(),a=await reserve(token(10),e,1000);await confirm(a,1000);
 const c=await scalar('SELECT funding_private.reserve_cost($1,800,$2)',[e,'cost-10']);
 await assert.rejects(q('SELECT funding_private.reserve_cost($1,300,$2)',[e,'cost-10b']),/insufficient_event_funds/);
 await q('SELECT funding_private.finish_cost($1,true)',[c]);await q('SELECT funding_private.finish_cost($1,true)',[c]);
 assert.equal(await scalar('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e]),200);
 const empty=await event();await assert.rejects(q('SELECT funding_private.reserve_cost($1,1,$2)',[empty,'empty']),/insufficient_event_funds/);
});
test('new costs after event end are rejected before close without changing balance or reservations',async()=>{
 const e=await event(),a=await reserve(token(101),e,1000);await confirm(a,1000);
 await q(`UPDATE public.protests SET ends_at=now()-interval '1 second' WHERE id=$1`,[e]);
 await assert.rejects(q('SELECT funding_private.reserve_cost($1,100,$2)',[e,'ended-cost']),/event_not_open/);
 assert.equal(await scalar('SELECT count(*) FROM funding_private.cost_reservations WHERE event_id=$1',[e]),0);
 assert.equal(await scalar('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e]),1000);
});
test('new costs before event start are rejected',async()=>{
 const e=await event(),a=await reserve(token(102),e,1000);await confirm(a,1000);
 await q(`UPDATE public.protests SET starts_at=now()+interval '1 hour' WHERE id=$1`,[e]);
 await assert.rejects(q('SELECT funding_private.reserve_cost($1,100,$2)',[e,'future-cost']),/event_not_open/);
});
test('cost committed while active can finish after end; repeated reservation adds nothing',async()=>{
 const e=await event(),a=await reserve(token(103),e,1000);await confirm(a,1000);
 const c=await scalar('SELECT funding_private.reserve_cost($1,300,$2)',[e,'prior-cost']);
 await q(`UPDATE public.protests SET ends_at=now()-interval '1 second' WHERE id=$1`,[e]);
 assert.equal(await scalar('SELECT funding_private.reserve_cost($1,300,$2)',[e,'prior-cost']),c);
 await q('SELECT funding_private.close_event($1)',[e]);
 await assert.rejects(q('SELECT funding_private.settle($1)',[e]),/pending_items/);
 await q('SELECT funding_private.finish_cost($1,true)',[c]);
 assert.equal(await scalar('SELECT funding_private.settle($1)',[e]),700);
});
test('settlement waits for pending items and surplus is moved once in isolation',async()=>{
 const e=await event(),a=await reserve(token(11),e,700);
 await q(`UPDATE public.protests SET ends_at=now()-interval '1 second' WHERE id=$1`,[e]);
 await q('SELECT funding_private.close_event($1)',[e]);await assert.rejects(q('SELECT funding_private.settle($1)',[e]),/pending_items/);
 await confirm(a,700);const before=Number(await scalar(`SELECT balance FROM funding_private.accounts WHERE id='general'`));
 assert.equal(await scalar('SELECT funding_private.settle($1)',[e]),700);
 assert.equal(await scalar('SELECT funding_private.settle($1)',[e]),700);
 assert.equal(Number(await scalar(`SELECT balance FROM funding_private.accounts WHERE id='general'`)),before+700);
 assert.equal(await scalar('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[e]),0);
});
test('append-only ledger rejects mutation and unbalanced transaction rolls back',async()=>{
 await assert.rejects(q('UPDATE funding_private.ledger_entries SET amount=amount+1'),/append_only/);
 const before=await scalar('SELECT count(*) FROM funding_private.ledger_transactions');
 await assert.rejects(q(`INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('bad-tx','grant')`),/unbalanced_ledger/);
 assert.equal(await scalar('SELECT count(*) FROM funding_private.ledger_transactions'),before);
 const id=await scalar('SELECT id FROM funding_private.ledger_transactions LIMIT 1');
 await assert.rejects(q(`INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES($1,'verification_cost',1)`,[id]),/transaction_already_final/);
});
test('private schema denies anonymous clients and functions are security invoker',async()=>{
 assert.equal(await scalar(`SELECT has_schema_privilege('anon','funding_private','USAGE')`),false);
 assert.equal(await scalar(`SELECT has_function_privilege('authenticated','funding_private.reserve(integer,text,text,uuid,bigint,timestamptz)','EXECUTE')`),false);
 assert.equal(await scalar(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='funding_private' AND p.prosecdef`),0);
 await db.exec('SET ROLE anon');await assert.rejects(q('SELECT * FROM funding_private.intents'),/permission denied/);await db.exec('RESET ROLE');
});
test('legacy balance and hash are untouched; no participant columns',async()=>{
 const r=(await q(`SELECT saldo_euros,hash_integridad FROM public.protests WHERE id='00000000-0000-0000-0000-000000000090'`)).rows[0];
 assert.equal(Number(r.saldo_euros),0.9);assert.equal(r.hash_integridad,'historic');
 assert.equal(await scalar(`SELECT count(*) FROM information_schema.columns WHERE table_schema='funding_private' AND column_name IN ('phone','phone_hash','adhesion_id','name','address','identity_subject_hash')`),0);
});
test('grant metadata is independent of individual caps and requires anti-capture agreement',async()=>{
 await q(`INSERT INTO funding_private.accounts(id,kind) VALUES('restricted:test','restricted_grant')`);
 await assert.rejects(q(`INSERT INTO funding_private.grant_awards(account_id,purpose,restricted,anti_capture_accepted) VALUES('restricted:test','R&D',true,false)`),/check constraint/);
 await q(`INSERT INTO funding_private.grant_awards(account_id,purpose,restricted,anti_capture_accepted) VALUES('restricted:test','R&D',true,true)`);
 assert.equal(await scalar(`SELECT balance FROM funding_private.accounts WHERE id='restricted:test'`),0);
 const id=await scalar(`SELECT id FROM funding_private.grant_awards WHERE account_id='restricted:test'`);
 const tid=await scalar('SELECT funding_private.record_simulated_grant($1,200000,$2)',[id,'restricted-grant']);
 assert.equal(await scalar('SELECT funding_private.record_simulated_grant($1,200000,$2)',[id,'restricted-grant']),tid);
 assert.equal(await scalar(`SELECT balance FROM funding_private.accounts WHERE id='restricted:test'`),200000);
});
test('unknown payment is durably quarantined and direct balance alteration fails',async()=>{
 assert.equal(await confirm('99999999-0000-0000-0000-000000000000',100,'unknown'),'review');
 assert.equal(await scalar(`SELECT count(*) FROM funding_private.unmatched_provider_events WHERE event_ref='unknown'`),1);
 await assert.rejects(q(`UPDATE funding_private.accounts SET balance=balance+1 WHERE id='general'`),/ledger_projection_mismatch/);
});

test('isolated API enforces financial verification and never contacts providers',async()=>{
 const service=createIsolatedFundingService({database:db,simulator:createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32)}),secret:'f'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 const app=Fastify({logger:false});await app.register(isolatedFundingRoutes,{prefix:'/api/funding',service});
 let r=await app.inject({method:'POST',url:'/api/funding/intents',payload:{kind:'general',amountCents:100,currency:'EUR'}});assert.equal(r.statusCode,401);
 r=await app.inject({method:'POST',url:'/api/funding/otp/start',payload:{phone:'+31612345678',eventId:null}});assert.equal(r.statusCode,200);
 const challengeId=r.json().challengeId;assert.ok(!r.body.includes('+316'));
 r=await app.inject({method:'POST',url:'/api/funding/otp/verify',payload:{challengeId,code:'123456'}});assert.equal(r.statusCode,200);const session=r.json().session;
 r=await app.inject({method:'POST',url:'/api/funding/intents',headers:{'x-funding-session':session},payload:{kind:'general',amountCents:100,currency:'EUR'}});assert.equal(r.statusCode,200);const intentId=r.json().intentId;
 r=await app.inject({method:'POST',url:'/api/funding/simulator/webhook',headers:{'x-simulator-auth':'wrong'},payload:{eventRef:'api-payment',intentId,amountCents:100,currency:'EUR'}});assert.equal(r.statusCode,401);
 r=await app.inject({method:'POST',url:'/api/funding/simulator/webhook',headers:{'x-simulator-auth':'w'.repeat(32)},payload:{eventRef:'api-payment',intentId,amountCents:100,currency:'EUR'}});assert.equal(r.statusCode,200);assert.equal(r.json().result,'confirmed');
 r=await app.inject({url:'/api/funding/limits',headers:{'x-funding-session':session}});assert.equal(r.statusCode,200);assert.equal(r.json().annualRemainingCents,99900);
 r=await app.inject({url:'/api/funding/public-summary'});assert.equal(r.statusCode,200);assert.ok(!r.body.includes('token'));
 await app.close();
});
test('UUID case variants share verified API sessions and one cumulative event limit',async()=>{
 const lower='abcdefab-cdef-abcd-efab-cdefabcdefab',upper=lower.toUpperCase();
 await q(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',0,'untouched')`,[lower]);
 await q(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+lower,lower]);
 const simulator=createPaymentSimulator({otpCode:'123456',webhookSecret:'v'.repeat(32)});
 const sessionEventIds=[];
 const database={query(text,values){if(text.startsWith('SELECT funding_private.reserve('))sessionEventIds.push(values[3]);return db.query(text,values);}};
 const service=createIsolatedFundingService({database,simulator,secret:'c'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 const app=Fastify({logger:false});await app.register(isolatedFundingRoutes,{prefix:'/api/funding',service});
 try{
  async function verifiedSession(eventId){
   let r=await app.inject({method:'POST',url:'/api/funding/otp/start',payload:{phone:'+31611111111',eventId}});assert.equal(r.statusCode,200);
   r=await app.inject({method:'POST',url:'/api/funding/otp/verify',payload:{challengeId:r.json().challengeId,code:'123456'}});assert.equal(r.statusCode,200);return r.json().session;
  }
  const lowSession=await verifiedSession(lower),upSession=await verifiedSession(upper);
  const contribute=(session,amountCents)=>app.inject({method:'POST',url:'/api/funding/intents',headers:{'x-funding-session':session},payload:{kind:'event',amountCents,currency:'EUR'}});
  let r=await contribute(lowSession,6000);assert.equal(r.statusCode,200);await confirm(r.json().intentId,6000);
  r=await contribute(upSession,5000);assert.equal(r.statusCode,409);assert.equal(r.json().error,'event_limit');
  r=await contribute(upSession,4000);assert.equal(r.statusCode,200);await confirm(r.json().intentId,4000);
  r=await contribute(lowSession,1);assert.equal(r.statusCode,409);
  r=await contribute(upSession,1);assert.equal(r.statusCode,409);
  for(const session of [lowSession,upSession]){
   r=await app.inject({url:'/api/funding/limits',headers:{'x-funding-session':session}});assert.equal(r.statusCode,200);assert.equal(r.json().eventRemainingCents,0);
  }
  assert.equal(await scalar('SELECT count(*) FROM funding_private.event_limits WHERE event_id=$1',[lower]),1);
  assert.equal(await scalar('SELECT balance FROM funding_private.accounts WHERE event_id=$1',[lower]),10000);
  assert.deepEqual(sessionEventIds,[lower,lower,lower,lower,lower]);
 }finally{await app.close();}
});
test('UUID canonicalization preserves existing lowercase v1 HMAC and purpose separation',()=>{
 const lower='abcdefab-cdef-abcd-efab-cdefabcdefab';
 const a=fundingTokens('c'.repeat(32),'+31611111111',2026,lower);
 const b=fundingTokens('c'.repeat(32),'+31611111111',2026,lower.toUpperCase());
 assert.equal(a.event,'60cf8956d43f237ef6a19c3d9c16dad62799c206129f136f53d8f6e836032d48');
 assert.deepEqual(a,b);assert.notEqual(a.annual,a.event);
 assert.notEqual(a.event,fundingTokens('c'.repeat(32),'+31611111111',2026,'abcdefab-cdef-abcd-efab-cdefabcdefac').event);
 assert.equal(fundingTokens('c'.repeat(32),'+31611111111',2026).event,null);
});
test('HMAC purpose separation, year boundary and production guard',()=>{
 const a=fundingTokens('x'.repeat(32),'+31612345678',2026,'e');const b=fundingTokens('x'.repeat(32),'+31612345678',2027,'e');
 assert.notEqual(a.annual,b.annual);assert.equal(a.event,b.event);assert.notEqual(a.annual,a.event);
 assert.equal(policyYear(new Date('2026-12-31T23:30:00Z'),'Europe/Amsterdam'),2027);
 assert.throws(()=>createIsolatedFundingService({mode:'production'}),/isolated_only/);
 assert.throws(()=>createIsolatedFundingService({mode:'isolated',secret:'x'.repeat(32),participationSecret:'x'.repeat(32)}),/independent_funding_secret_required/);
});
test('legacy double-UPDATE closure defect reproduced without altering historical fixture',async()=>{
 const e=await event();await q(`UPDATE public.protests SET saldo_euros=42,hash_integridad=NULL WHERE id=$1`,[e]);
 const result=(await q(`WITH hashed AS (UPDATE public.protests SET hash_integridad='synthetic-v2' WHERE id=$1 RETURNING id),
 reset AS (UPDATE public.protests SET saldo_euros=0 WHERE id IN (SELECT id FROM hashed) RETURNING id)
 SELECT (SELECT count(*) FROM hashed) AS hashed,(SELECT count(*) FROM reset) AS reset`,[e])).rows[0];
 assert.equal(Number(result.hashed),1);assert.equal(Number(result.reset),0);
 assert.equal(Number(await scalar('SELECT saldo_euros FROM public.protests WHERE id=$1',[e])),42);
});
test('funding role can execute reserve/confirm without exposing client access',async()=>{
 await db.exec('SET ROLE funding_runtime');
 try{const i=await reserve(token(75),null,100);assert.equal(await confirm(i,100),'confirmed');}
 finally{await db.exec('RESET ROLE');}
});
