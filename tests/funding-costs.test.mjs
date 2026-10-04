import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import Fastify from 'fastify';
import {fundingParentFixtureSQL,fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration} from './helpers/funding-fixture.mjs';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
import {isolatedFundingRoutes} from '../apps/api/src/funding/routes.js';
const db=new PGlite();after(()=>db.close());await db.exec(fundingParentFixtureSQL);
for(const m of [fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration])await db.exec(await readFile(m,'utf8'));
await db.exec('SET ROLE funding_runtime');
const q=(s,a=[])=>db.query(s,a),scalar=async(s,a)=>Object.values((await q(s,a)).rows[0])[0];
async function admin(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE funding_runtime');}}
const balance=id=>scalar('SELECT balance FROM funding_private.accounts WHERE id=$1',[id]);
const now=()=>scalar('SELECT funding_private.temporal_now()');
const year=async()=>Number((await q('SELECT funding_private.temporal_context() AS c')).rows[0].c.year);
async function event(){const e=randomUUID();await admin(()=>q("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0.9,'historical')",[e]));await q("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+e,e]);return e;}
async function reserve(amount=10000,e=null,bound=0,known=true){const token=randomUUID().replaceAll('-','').repeat(2);const id=await scalar('SELECT funding_private.reserve_with_fee_v3($1,$2,$3,$4,$5,1,$6,$7)',[await year(),token,e?token:null,e,amount,bound,known]);return {id,token,e,amount};}
async function confirm(i){const ref=randomUUID();assert.equal(await scalar("SELECT funding_private.confirm_v2($1,$1,$2,$3,'EUR',$4,'simulator_successful_payment:v2')",[ref,i.id,i.amount,await now()]),'confirmed');}
async function paid(amount=10000,e=null,bound=0){const i=await reserve(amount,e,bound);await confirm(i);return i;}
async function movement(i,kind,amount,{ref=randomUUID(),operation=null,related=null,currency='EUR',effective=null}={}){return {ref,result:await scalar('SELECT funding_private.record_provider_movement($1,$2,$3,$4,$5,$6,$7,$8)',[ref,i.id,kind,amount,currency,operation,related,effective??await now()])};}
async function decision(i,amount,source,action='refund_authorize',expires=null){const op=randomUUID();await admin(()=>q('INSERT INTO funding_private.financial_review_decisions(operation_ref,action,intent_id,amount,source_account,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[op,action,i.id,amount,source,expires??new Date(Date.now()+600000).toISOString()]));return op;}
const reserveRefund=op=>scalar('SELECT funding_private.reserve_refund($1)',[op]);
const quota=i=>scalar('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[i.token]);

test('known bounded fee requires general coverage before checkout and failed reserve leaves no quota',async()=>{
 await assert.rejects(reserve(10000,null,300),/operational_budget_insufficient/);
 await assert.rejects(reserve(10000,null,0,false),/fee_bound_required/);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.intents')),0);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.annual_limits')),0);
 await paid(10000); // Synthetic general budget only, zero mock fee.
});
test('gross EUR100 credits event intact; EUR3 processing fee debits general with balanced append-only ledger',async()=>{
 const e=await event(),before=Number(await balance('general')),i=await paid(10000,e,300);
 const m=await movement(i,'processing_fee',-300);assert.equal(m.result,'allocated');
 assert.equal(Number(await balance('event:'+e)),10000);assert.equal(Number(await balance('general')),before-300);
 assert.equal(Number(await quota(i)),10000);assert.equal(await scalar('SELECT state FROM funding_private.fee_reservations WHERE intent_id=$1',[i.id]),'final');
 assert.equal(Number(await scalar('SELECT count(*) FROM (SELECT transaction_id FROM funding_private.ledger_entries GROUP BY transaction_id HAVING sum(amount)<>0) x')),0);
 await assert.rejects(q('UPDATE funding_private.provider_movements SET amount=0 WHERE movement_ref=$1',[m.ref]),/append_only/);
});
test('pre-charge cancellation releases fee hold and reserved quota once; paid cancellation cannot release quota',async()=>{
 const i=await reserve(1000,null,400);const before=Number(await scalar("SELECT funding_private.available_operational('general')"));
 assert.equal(await scalar('SELECT funding_private.cancel($1,true)',[i.id]),'cancelled');assert.equal(await scalar('SELECT funding_private.cancel($1,true)',[i.id]),'cancelled');
 assert.equal(Number(await scalar("SELECT funding_private.available_operational('general')")),before+400);
 const j=await paid(1000);await assert.rejects(q('SELECT funding_private.cancel($1,true)',[j.id]),/cannot_cancel/);assert.equal(Number(await quota(j)),1000);
});
test('Owner decision is required and cannot be inserted by runtime; revoked, expired and restricted sources denied',async()=>{
 const i=await paid(1000);await assert.rejects(reserveRefund('not-approved'),/owner_decision_required/);
 await assert.rejects(q("INSERT INTO funding_private.financial_review_decisions(operation_ref,action,intent_id,amount,source_account,expires_at) VALUES('forged','refund_authorize',$1,100,'general',clock_timestamp()+interval '1 day')",[i.id]),/permission denied/);
 const expired=await decision(i,100,'general','refund_authorize','2000-01-01');await assert.rejects(reserveRefund(expired),/owner_decision_required/);
 const revoked=await decision(i,100,'general');await admin(()=>q('INSERT INTO funding_private.financial_decision_revocations(decision_id) SELECT id FROM funding_private.financial_review_decisions WHERE operation_ref=$1',[revoked]));await assert.rejects(reserveRefund(revoked),/owner_decision_required/);
 await q("INSERT INTO funding_private.accounts(id,kind) VALUES('restricted:costs','restricted_grant')");const restricted=await decision(i,100,'restricted:costs');await assert.rejects(reserveRefund(restricted),/source_not_eligible/);
});
test('partial and full refund add ledger movements; annual and event cumulative quota never restore',async()=>{
 const e=await event(),i=await paid(10000,e),op=await decision(i,2000,'event:'+e);assert.equal(await reserveRefund(op),'reserved');assert.equal(await reserveRefund(op),'already_reserved');
 const m=await movement(i,'refund',-2000,{operation:op});assert.equal(m.result,'allocated');assert.equal(Number(await balance('event:'+e)),8000);assert.equal(Number(await quota(i)),10000);
 assert.equal(Number(await scalar('SELECT committed FROM funding_private.event_limits WHERE event_id=$1',[e])),10000);
 assert.equal((await movement(i,'refund',-2000,{operation:op})).result,'review'); // A second cash debit is retained, never applied twice.
 const cover=await decision(i,2000,'general','cover_exposure'); // Explicit coverage of the extra observed debit, within gross.
 const extra=await scalar("SELECT movement_ref FROM funding_private.provider_movements WHERE claimed_intent=$1 AND kind='refund' AND movement_ref<>$2",[i.id,m.ref]);
 assert.equal(await scalar('SELECT funding_private.cover_provider_exposure($1,$2)',[extra,cover]),'allocated');
 const op2=await decision(i,6000,'event:'+e);await reserveRefund(op2);assert.equal((await movement(i,'refund',-6000,{operation:op2})).result,'allocated');
 assert.equal(Number(await quota(i)),10000);const excess=await decision(i,1,'general');await assert.rejects(reserveRefund(excess),/refund_exceeds_gross/);
});
test('refund holds compete with SMS cost; pending and failed status carry no cash and settlement waits for a held refund',async()=>{
 const e=await event(),i=await paid(1000,e),op=await decision(i,600,'event:'+e);await reserveRefund(op);
 await assert.rejects(q("SELECT funding_private.reserve_cost($1,500,'over-refund')",[e]),/insufficient_event_funds/);
 const before=await balance('event:'+e);assert.equal((await movement(i,'refund_pending',0,{operation:op})).result,'allocated');assert.equal(await balance('event:'+e),before);
 await admin(()=>q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]));await q('SELECT funding_private.close_event($1)',[e]);await assert.rejects(q('SELECT funding_private.settle($1)',[e]),/pending_items/);
 assert.equal((await movement(i,'refund_failed',0,{operation:op})).result,'allocated');assert.equal(await balance('event:'+e),before);assert.equal(Number(await scalar('SELECT funding_private.settle($1)',[e])),1000);
 assert.equal(Number(await quota(i)),1000);
});
test('forced dispute after final settlement journals exposure, pauses commitments and requires general Owner coverage',async()=>{
 const e=await event(),i=await paid(1000,e);await admin(()=>q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]));await q('SELECT funding_private.close_event($1)',[e]);await q('SELECT funding_private.settle($1)',[e]);
 const final=JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows);
 const m=await movement(i,'dispute_debit',-1000);assert.equal(m.result,'review');assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.provider_movements WHERE movement_ref=$1',[m.ref])),1);
 await assert.rejects(reserve(100),/financial_exposure_pending/);await assert.rejects(q('SELECT funding_private.cover_provider_exposure($1,$2)',[m.ref,'fake']),/owner_decision_required/);
 assert.equal(await scalar('SELECT funding_private.apply_movement($1,$2)',[m.ref,'general']),'review');
 const op=await decision(i,1000,'general','cover_exposure');assert.equal(await scalar('SELECT funding_private.cover_provider_exposure($1,$2)',[m.ref,op]),'allocated');
 assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.settlements WHERE event_id=$1',[e])).rows),final);assert.equal(Number(await balance('event:'+e)),0);assert.equal(Number(await quota(i)),1000);
 assert.equal((await movement(i,'dispute_recovery',1000,{related:m.ref})).result,'allocated');assert.equal(Number(await quota(i)),1000);
});
test('processing fee beyond bound remains evidence; explicit coverage releases its hold without using event money',async()=>{
 const e=await event(),i=await paid(1000,e,10),m=await movement(i,'processing_fee',-20);assert.equal(m.result,'review');
 assert.equal(await scalar('SELECT state FROM funding_private.fee_reservations WHERE intent_id=$1',[i.id]),'held');
 const op=await decision(i,20,'general','cover_exposure');assert.equal(await scalar('SELECT funding_private.cover_provider_exposure($1,$2)',[m.ref,op]),'allocated');
 assert.equal(await scalar('SELECT state FROM funding_private.fee_reservations WHERE intent_id=$1',[i.id]),'final');assert.equal(Number(await balance('event:'+e)),1000);
});
test('spent event principal cannot turn negative; specific Owner general refund and status-only dispute preserve quota',async()=>{
 const e=await event(),i=await paid(1000,e),cost=await scalar("SELECT funding_private.reserve_cost($1,1000,'spent-for-refund')",[e]);await q('SELECT funding_private.finish_cost($1,true)',[cost]);
 const bad=await decision(i,1000,'event:'+e);await assert.rejects(reserveRefund(bad),/refund_source_insufficient/);
 const op=await decision(i,1000,'general');await reserveRefund(op);assert.equal((await movement(i,'refund',-1000,{operation:op})).result,'allocated');assert.equal(Number(await balance('event:'+e)),0);
 const before=await balance('general');assert.equal((await movement(i,'dispute_opened',0)).result,'allocated');assert.equal((await movement(i,'dispute_resolved',0)).result,'allocated');assert.equal(await balance('general'),before);assert.equal(Number(await quota(i)),1000);
});
test('forced debit cannot spend SMS commitments or masquerade as reconciled settlement',async()=>{
 const e=await event(),i=await paid(1000,e),cost=await scalar("SELECT funding_private.reserve_cost($1,1000,'dispute-cost-hold')",[e]);
 const m=await movement(i,'dispute_debit',-1000);assert.equal(m.result,'review');assert.equal(Number(await balance('event:'+e)),1000);
 await admin(()=>q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]));await q('SELECT funding_private.close_event($1)',[e]);await q('SELECT funding_private.finish_cost($1,true)',[cost]);await assert.rejects(q('SELECT funding_private.settle($1)',[e]),/pending_items/);
 const op=await decision(i,1000,'general','cover_exposure');assert.equal(await scalar('SELECT funding_private.cover_provider_exposure($1,$2)',[m.ref,op]),'allocated');assert.equal(Number(await scalar('SELECT funding_private.settle($1)',[e])),0);assert.equal(Number(await quota(i)),1000);
});
test('refund followed by dispute cannot double-allocate principal; recovery must reference an allocated cash debit',async()=>{
 const e=await event(),i=await paid(1000,e),op=await decision(i,1000,'event:'+e);await reserveRefund(op);const r=await movement(i,'refund',-1000,{operation:op});
 const d=await movement(i,'dispute_debit',-1000);assert.equal(d.result,'review');assert.equal(Number(await balance('event:'+e)),0);
 const cover=await decision(i,1000,'general','cover_exposure');assert.equal(await scalar('SELECT funding_private.cover_provider_exposure($1,$2)',[d.ref,cover]),'review');
 assert.equal((await movement(i,'dispute_recovery',1000,{related:d.ref})).result,'review');
 assert.equal((await movement(i,'refund_recovery',1000,{related:r.ref})).result,'allocated');assert.equal(Number(await balance('event:'+e)),1000);
 assert.equal((await movement(i,'refund_recovery',1,{related:r.ref})).result,'review');assert.equal(Number(await quota(i)),1000);
});
test('excess/FX/unknown cash evidence stays immutable for review; exact replay is idempotent and changed payload conflicts',async()=>{
 // Prior unallocated double-debit is deliberately still visible and conservatively stops new checkout.
 const i=(await q('SELECT id,amount FROM funding_private.intents WHERE state=\'confirmed\' LIMIT 1')).rows[0];
 const effective=await now(),ref=randomUUID();const a=await movement(i,'fee',-9,{ref,effective,currency:'USD'});assert.equal(a.result,'review');
 assert.equal((await movement(i,'fee',-9,{ref,effective,currency:'USD'})).result,'review');await assert.rejects(movement(i,'fee',-10,{ref,effective,currency:'USD'}),/idempotency_conflict/);
 assert.equal((await movement({id:randomUUID()},'unknown_debit',-9)).result,'review');
 await assert.rejects(q('DELETE FROM funding_private.movement_allocations'),/permission denied/);
 assert.equal(Number(await scalar("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='funding_private' AND p.prosecdef")),0);
 assert.equal(await scalar("SELECT has_schema_privilege('anon','funding_private','USAGE')"),false);
});
test('isolated movement API requires provider auth, binds evidence and never accepts caller timestamp as proof',async()=>{
 const sim=createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32),now});const service=createIsolatedFundingService({database:db,simulator:sim,secret:'s'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated'});
 const i=(await q("SELECT id FROM funding_private.intents WHERE state='confirmed' LIMIT 1")).rows[0];const payload={movementRef:randomUUID(),intentId:i.id,kind:'refund_pending',amountCents:0,currency:'EUR',operationRef:null,relatedRef:null};
 const app=Fastify({logger:false});await app.register(isolatedFundingRoutes,{service});try{
 assert.equal((await app.inject({method:'POST',url:'/simulator/movements',payload})).statusCode,401);
 await sim.recordMovement(payload,'2000-01-01');const r=await app.inject({method:'POST',url:'/simulator/movements',headers:{'x-simulator-auth':'w'.repeat(32)},payload});assert.equal(r.statusCode,200);assert.equal(r.json().result,'review');
 assert.equal((await app.inject({url:'/simulator/movement-status'})).statusCode,401);
 const status=(await app.inject({url:'/simulator/movement-status',headers:{'x-simulator-auth':'w'.repeat(32)}})).json();assert.equal(status.newCommitmentsPaused,true);assert.equal(status.cashReconciliation,'not_certified');assert.ok(status.movements.some(m=>m.unallocatedCount>0));
 assert.equal(new Date(await scalar('SELECT effective_at FROM funding_private.provider_movements WHERE movement_ref=$1',[payload.movementRef])).toISOString(),'2000-01-01T00:00:00.000Z');
 await assert.rejects(service.movement({...payload,amountCents:1,effectiveAt:'2099-01-01'},'w'.repeat(32)),e=>e.code==='provider_evidence_mismatch');
 }finally{await app.close();}
});
