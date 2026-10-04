import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import Fastify from 'fastify';
import {fundingParentFixtureSQL,fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration} from './helpers/funding-fixture.mjs';
import {createIsolatedReviewAuthenticator,createIsolatedReviewService,isolatedReviewRoutes} from '../apps/api/src/funding/isolatedReview.js';
const db=new PGlite();after(()=>db.close());await db.exec(fundingParentFixtureSQL);
for(const m of [fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration])await db.exec(await readFile(m,'utf8'));
const q=(s,a=[])=>db.query(s,a),scalar=async(s,a)=>Object.values((await q(s,a)).rows[0])[0];
async function as(role,fn){await db.exec('SET ROLE '+role);try{return await fn();}finally{await db.exec('RESET ROLE');}}
const financial=(s,a)=>as('funding_runtime',()=>q(s,a));
const reviewDatabase={query:(s,a)=>as('funding_review',()=>q(s,a))};
const auth=createIsolatedReviewAuthenticator({reviewSecret:'r'.repeat(32),fundingSecret:'f'.repeat(32),providerSecret:'w'.repeat(32),participationSecret:'p'.repeat(32),mode:'isolated'});
const service=createIsolatedReviewService({database:reviewDatabase,authenticator:auth,mode:'isolated'}),credential='r'.repeat(32);
async function paid(e=null,amount=1000){const token=randomUUID().replaceAll('-','').repeat(2),year=(await q('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;
 const id=(await financial('SELECT funding_private.reserve_with_fee_v3($1,$2,$3,$4,$5,1,0,true) AS id',[year,token,e?token:null,e,amount])).rows[0].id;
 await financial("SELECT funding_private.confirm_v2($1,$1,$2,$3,'EUR',funding_private.temporal_now(),'simulator_successful_payment:v2')",[randomUUID(),id,amount]);return {id,token,e};}
async function event(){const e=randomUUID();await q("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0.9,'legacy')",[e]);await financial("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);return e;}
function request(i,extra={}){return {requestId:randomUUID(),action:'refund_authorize',intentId:i.id,amountCents:100,sourceAccount:i.e?'event:'+i.e:'general',expiresAt:new Date(Date.now()+600000).toISOString(),evidenceRef:randomUUID(),...extra};}
async function cash(i,ref,kind,amount,currency='EUR',effective=true){return (await financial('SELECT funding_private.record_provider_movement($1,$2,$3,$4,$5,NULL,NULL,$6) AS result',[ref,i.id,kind,amount,currency,effective?new Date():null])).rows[0].result;}
async function snapshot(){return JSON.stringify({accounts:(await q('SELECT * FROM funding_private.accounts ORDER BY id')).rows,quota:(await q('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows,ledger:(await q('SELECT * FROM funding_private.ledger_entries ORDER BY transaction_id,account_id')).rows,settlements:(await q('SELECT * FROM funding_private.settlements ORDER BY event_id')).rows});}
const seed=await paid(null,10000);

test('review role cannot move money, read identity tokens, change policy or inherit financial/service authority',async()=>{
 await as('funding_review',async()=>{
  for(const statement of ["UPDATE funding_private.accounts SET balance=0","SELECT annual_token FROM funding_private.intents","SELECT * FROM funding_private.annual_limits","SELECT * FROM funding_auth_private.verified_sessions","SELECT * FROM funding_private.ledger_entries","SELECT funding_private.cover_provider_exposure('x','x')","CREATE TABLE funding_private.unapproved(x int)"]){await assert.rejects(q(statement),e=>e.code==='42501');}
  assert.equal(await scalar("SELECT pg_has_role(current_user,'funding_runtime','MEMBER')"),false);
  assert.equal(await scalar("SELECT pg_has_role(current_user,'service_role','MEMBER')"),false);
 });
 await as('funding_runtime',async()=>{assert.equal(await scalar("SELECT pg_has_role(current_user,'funding_review','MEMBER')"),false);await assert.rejects(q('SELECT funding_private.issue_review_decision($1,$2,$3,$4,$5,$6,$7,NULL)',[randomUUID(),'refund_authorize',seed.id,100,'general',new Date(Date.now()+10000),randomUUID()]),e=>e.code==='42501');});
});
test('Owner simulator credential is distinct from PSP/donor; service rejects privileged or mixed-role DB',async()=>{
 for(const value of ['w'.repeat(32),'f'.repeat(32),randomUUID(),null])await assert.rejects(service.cases(value),e=>e.code==='review_authority_required');
 const adminService=createIsolatedReviewService({database:db,authenticator:auth,mode:'isolated'});await assert.rejects(adminService.cases(credential),e=>e.code==='review_connection_required');
 assert.throws(()=>createIsolatedReviewAuthenticator({reviewSecret:'w'.repeat(32),fundingSecret:'f'.repeat(32),providerSecret:'w'.repeat(32),participationSecret:'p'.repeat(32),mode:'isolated'}),/independent_review_secret_required/);
 assert.throws(()=>createIsolatedReviewService({database:db,authenticator:auth,mode:'production'}),/isolated_review_required/);
});
test('approval records only authority/provenance; exact replay after response loss returns same decision without funds or quota changes',async()=>{
 const input=request(seed),before=await snapshot(),first=await service.decide(credential,input),retry=await service.decide(credential,input);
 assert.equal(first.decisionId,retry.decisionId);assert.equal(first.fundsMoved,false);assert.equal(first.requiresFinancialRecheck,true);assert.equal(await snapshot(),before);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.review_authorizations WHERE request_id=$1',[input.requestId])),1);
 const provenance=(await q('SELECT authority,database_actor FROM funding_private.review_authorizations WHERE request_id=$1',[input.requestId])).rows[0];assert.deepEqual(provenance,{authority:'simulated_owner',database_actor:'funding_review'});
 for(const change of [{amountCents:101},{sourceAccount:'verification_cost'},{evidenceRef:randomUUID()}])await assert.rejects(service.decide(credential,{...input,...change}),e=>e.code==='idempotency_conflict');
});
test('missing evidence, unknown/non-confirmed payment, invalid source, expired approval and over-gross requests denied',async()=>{
 for(const change of [{evidenceRef:null},{intentId:randomUUID()},{sourceAccount:'clearing'},{expiresAt:'2000-01-01T00:00:00Z'},{amountCents:10001}])await assert.rejects(service.decide(credential,request(seed,change)),e=>['invalid_review_decision','payment_not_eligible','source_not_eligible','refund_exceeds_gross'].includes(e.code));
 await financial("INSERT INTO funding_private.accounts(id,kind) VALUES('restricted:review','restricted_grant')");await assert.rejects(service.decide(credential,request(seed,{sourceAccount:'restricted:review'})),e=>e.code==='source_not_eligible');
 const e=await event(),i=await paid(e);await assert.rejects(service.decide(credential,request(i,{sourceAccount:'event:'+randomUUID()})),e=>e.code==='source_not_eligible');
 const cost=(await financial("SELECT funding_private.reserve_cost($1,1000,'review-cost') AS id",[e])).rows[0].id;
 await assert.rejects(service.decide(credential,request(i)),e=>e.code==='review_source_insufficient');await financial('SELECT funding_private.finish_cost($1,false)',[cost]);
});
test('decision insertion and provenance are atomic, including injected failure; direct unprovenanced insertion cannot commit',async()=>{
 const input=request(seed),before=Number(await scalar('SELECT count(*) FROM funding_private.financial_review_decisions'));
 await as('funding_review',()=>assert.rejects(q("INSERT INTO funding_private.financial_review_decisions(operation_ref,action,intent_id,amount,source_account,expires_at) VALUES($1,'refund_authorize',$2,100,'general',clock_timestamp()+interval '1 day')",[randomUUID(),seed.id]),/review_provenance_required/));
 await db.exec("CREATE FUNCTION public.review_fixture_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'review_fixture_fault';END $$;CREATE TRIGGER review_fixture_fault BEFORE INSERT ON funding_private.review_authorizations FOR EACH ROW EXECUTE FUNCTION public.review_fixture_fault()");
 try{await assert.rejects(service.decide(credential,input),e=>e.code==='review_unavailable');assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.financial_review_decisions')),before);}
 finally{await q('DROP TRIGGER review_fixture_fault ON funding_private.review_authorizations');}
 const result=await service.decide(credential,input);assert.ok(result.decisionId);
});
test('revocation is append-only, idempotent and prevents reservation without moving funds',async()=>{
 const input=request(seed),d=await service.decide(credential,input),r={requestId:randomUUID(),evidenceRef:randomUUID()},before=await snapshot();
 await service.revoke(credential,d.decisionId,r);await service.revoke(credential,d.decisionId,r);assert.equal(await snapshot(),before);
 await assert.rejects(service.revoke(credential,d.decisionId,{...r,evidenceRef:randomUUID()}),e=>e.code==='idempotency_conflict');
 await assert.rejects(financial('SELECT funding_private.reserve_refund($1)',[d.operationRef]),/owner_decision_required/);
 await as('funding_review',()=>assert.rejects(q('UPDATE funding_private.review_authorizations SET evidence_ref=$1',[randomUUID()]),e=>e.code==='42501'));
 await assert.rejects(q('UPDATE funding_private.review_authorizations SET evidence_ref=evidence_ref'),/append_only/);
});
test('approval does not promise financial coverage: later cost changes require financial recheck',async()=>{
 const e=await event(),i=await paid(e),d=await service.decide(credential,request(i,{amountCents:600}));
 const cost=(await financial("SELECT funding_private.reserve_cost($1,1000,'review-later-cost') AS id",[e])).rows[0].id;
 await assert.rejects(financial('SELECT funding_private.reserve_refund($1)',[d.operationRef]),/refund_source_insufficient/);await financial('SELECT funding_private.finish_cost($1,false)',[cost]);
 assert.equal((await financial('SELECT funding_private.reserve_refund($1) AS result',[d.operationRef])).rows[0].result,'reserved');
 assert.equal(Number(await scalar('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[i.token])),1000);
});
test('case list paginates unallocated facts, detail shows decisions, inspection cannot change funds',async()=>{
 await cash(seed,'review-a','fee',-1,'USD');await cash(seed,'review-b','fee',-1,'USD');const before=await snapshot();
 const a=await service.cases(credential,{limit:1}),b=await service.cases(credential,{limit:1,after:a.nextCursor});assert.equal(a.items.length,1);assert.equal(b.items.length,1);assert.notEqual(a.items[0].movementRef,b.items[0].movementRef);
 const detail=await service.case(credential,'review-a');assert.ok(detail.case.reviewFlags.includes('foreign_currency'));assert.equal(detail.cashReconciliation,'not_certified');assert.ok(detail.decisions.length>0);assert.equal(await snapshot(),before);
 const text=JSON.stringify(detail);for(const secret of ['annual_token','event_token','+316','phone','bearer','reviewSecret'])assert.ok(!text.includes(secret));
 await assert.rejects(service.case(credential,'missing'),e=>e.code==='review_case_not_found');
});
test('API requires authority and bounded schemas; provider credentials and ownerApproved cannot issue a decision',async()=>{
 const app=Fastify({logger:false});await app.register(isolatedReviewRoutes,{service});const input=request(seed);
 try{
  assert.equal((await app.inject({url:'/review/cases'})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/review/decisions',headers:{'x-review-auth':'w'.repeat(32)},payload:{...input,ownerApproved:true}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/review/decisions',headers:{'x-review-auth':credential},payload:{...input,evidenceRef:undefined}})).statusCode,400);
  const r=await app.inject({method:'POST',url:'/review/decisions',headers:{'x-review-auth':credential},payload:input});assert.equal(r.statusCode,200);assert.equal(r.json().fundsMoved,false);
  assert.equal((await app.inject({url:'/review/cases?limit=101',headers:{'x-review-auth':credential}})).statusCode,400);
  const list=await app.inject({url:'/review/cases?limit=1',headers:{'x-review-auth':credential}});assert.equal(list.statusCode,200);assert.equal(list.json().items.length,1);
 }finally{await app.close();}
});
test('FX, unknown evidence and extraordinary principal stay pending; authorization cannot clear exposure by itself',async()=>{
 await assert.rejects(service.decide(credential,request(seed,{action:'cover_exposure',amountCents:1,movementRef:'review-a'})),e=>e.code==='movement_not_eligible');
 await cash(seed,'review-no-evidence','fee',-1,'EUR',false);await assert.rejects(service.decide(credential,request(seed,{action:'cover_exposure',amountCents:1,movementRef:'review-no-evidence'})),e=>e.code==='movement_not_eligible');
 await cash(seed,'review-excess','dispute_debit',-10001);await assert.rejects(service.decide(credential,request(seed,{action:'cover_exposure',amountCents:10001,movementRef:'review-excess'})),e=>e.code==='refund_exceeds_gross');
 assert.equal((await financial('SELECT funding_private.has_pending_exposure() AS result')).rows[0].result,true);
});
test('new general coverage adjusts only after separate financial apply; final event snapshot never changes',async()=>{
 // Earlier synthetic exceptions deliberately pause new checkout. Seed this case with an already-paid event fixture via DB owner.
 const e=await event();const token='a'.repeat(64),id=await scalar("SELECT funding_private.reserve_v2(2026,$1,$1,$2,1000,1)",[token,e]);await q("SELECT funding_private.confirm_v2('review-final-payment','review-final-payment',$1,1000,'EUR',funding_private.temporal_now(),'simulator_successful_payment:v2')",[id]);
 await q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]);await financial('SELECT funding_private.close_event($1)',[e]);await financial('SELECT funding_private.settle($1)',[e]);
 assert.equal(await cash({id},'review-final-debit','dispute_debit',-1000),'review');const before=await snapshot(),final=JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows);
 const d=await service.decide(credential,request({id},{action:'cover_exposure',amountCents:1000,sourceAccount:'general',movementRef:'review-final-debit'}));assert.equal(await snapshot(),before);
 assert.equal((await financial("SELECT funding_private.cover_provider_exposure('review-final-debit',$1) AS result",[d.operationRef])).rows[0].result,'allocated');
 assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows),final);assert.equal(Number(await scalar('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[token])),1000);
 const detail=await service.case(credential,'review-final-debit');assert.equal(detail.case.allocated,true);assert.ok(detail.case.reviewFlags.includes('event_final'));
});
test('client and financial roles cannot forge provenance, while all functions remain SECURITY INVOKER',async()=>{
 for(const role of ['anon','authenticated','funding_runtime'])await as(role,()=>assert.rejects(q("INSERT INTO funding_private.review_authorizations(request_id,decision_id,kind,evidence_ref) SELECT $1,id,'issue',$2 FROM funding_private.financial_review_decisions LIMIT 1",[randomUUID(),randomUUID()]),e=>e.code==='42501'));
 assert.equal(Number(await scalar("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='funding_private' AND p.prosecdef")),0);
});
