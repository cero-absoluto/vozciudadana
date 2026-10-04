import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import Fastify from 'fastify';
import * as f from './helpers/funding-fixture.mjs';
import {legacyReceiptMigration,legacyReceiptSecret,legacyReceiptInput,legacyReceiptAdapterOptions} from './helpers/funding-legacy-receipt-fixture.mjs';
import {createLegacyReceiptFixtureAdapter,createLegacyReceiptService,legacyReceiptFixtureRoutes} from '../apps/api/src/funding/legacyReceipt.js';
const db=new PGlite();after(()=>db.close());await db.exec(f.fundingParentFixtureSQL);
for(const name of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration'])await db.exec(await readFile(f[name],'utf8'));
await db.exec(await readFile(legacyReceiptMigration,'utf8'));
const q=(s,a=[])=>db.query(s,a),adapter=createLegacyReceiptFixtureAdapter(legacyReceiptAdapterOptions);
let tail=Promise.resolve(),failBeforeCommit=false,failAfterCommit=false;
const database={async connect(){let release;const previous=tail;tail=new Promise(r=>release=r);await previous;await db.exec('SET ROLE funding_legacy_receipt_ingest');return {async query(s,a){if(s==='COMMIT'&&failBeforeCommit){failBeforeCommit=false;throw Error('synthetic_before_commit');}const r=await q(s,a);if(s==='COMMIT'&&failAfterCommit){failAfterCommit=false;throw Error('synthetic_commit_response_lost');}return r;},release(){db.exec('RESET ROLE').then(release);}};}};
const service=createLegacyReceiptService({database,adapter,mode:'isolated'}),receive=i=>service.receive(legacyReceiptSecret,i);
const snapshot=async()=>{await tail;return JSON.stringify({accounts:(await q('SELECT * FROM funding_private.accounts ORDER BY id')).rows,ledger:(await q('SELECT * FROM funding_private.ledger_entries ORDER BY transaction_id,account_id')).rows,quotas:(await q('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows,settlements:(await q('SELECT * FROM funding_private.settlements ORDER BY event_id')).rows});};
async function role(name,fn){await tail;await db.exec('SET ROLE '+name);try{return await fn();}finally{await db.exec('RESET ROLE');}}
test('unknown legacy notice persists for review without intent, identity, cash allocation or financial changes',async()=>{
 const before=await snapshot(),r=await receive(legacyReceiptInput());assert.equal(r.received,true);assert.equal(r.allocation,'review');assert.equal(r.paymentVerified,false);assert.equal(r.fundsMoved,false);assert.equal(await snapshot(),before);
});
test('twenty exact retries and recomposed adapters preserve one receipt and original received time',async()=>{
 const i=legacyReceiptInput('duplicates'),r=await receive(i);await tail;const stamp=(await q('SELECT received_at FROM funding_legacy_receipt_private.operations WHERE id=$1',[r.receiptId])).rows[0].received_at;
 const result=await Promise.all(Array.from({length:20},()=>createLegacyReceiptService({database,adapter:createLegacyReceiptFixtureAdapter(legacyReceiptAdapterOptions),mode:'isolated'}).receive(legacyReceiptSecret,i)));assert.ok(result.every(x=>x.receiptId===r.receiptId&&x.outcome==='duplicate'));await tail;
 assert.equal(new Date((await q('SELECT received_at FROM funding_legacy_receipt_private.operations WHERE id=$1',[r.receiptId])).rows[0].received_at).getTime(),new Date(stamp).getTime());
});
test('twenty conflicting retries persist one conflict and preserve original; other bindings stay distinct',async()=>{
 const i=legacyReceiptInput('conflict'),r=await receive(i),changed={...i,amountCents:101};const result=await Promise.all(Array.from({length:20},()=>receive(changed)));assert.equal(new Set(result.map(x=>x.conflictId)).size,1);assert.ok(result.every(x=>x.outcome==='conflict'&&x.receiptId===r.receiptId));
 const foreign=await receive({...i,currency:'USD'});assert.notEqual(foreign.conflictId,result[0].conflictId);await tail;
 assert.equal(Number((await q('SELECT amount_cents FROM funding_legacy_receipt_private.operations WHERE id=$1',[r.receiptId])).rows[0].amount_cents),100);
 assert.equal((await receive(i)).outcome,'duplicate');
});
test('before-commit failure produces unavailable and no receipt; after-commit response loss retries safely',async()=>{
 const i=legacyReceiptInput('before');failBeforeCommit=true;await assert.rejects(receive(i),e=>e.code==='legacy_receipt_unavailable');await tail;assert.equal((await q('SELECT id FROM funding_legacy_receipt_private.operations WHERE operation_ref=$1',[i.reference])).rows.length,0);assert.equal((await receive(i)).outcome,'received');
 const j=legacyReceiptInput('after');failAfterCommit=true;await assert.rejects(receive(j),e=>e.code==='legacy_receipt_unavailable');assert.equal((await receive(j)).outcome,'duplicate');
});
test('deferred commit fault rolls back conflict and does not acknowledge receipt',async()=>{
 const i=legacyReceiptInput('deferred');await receive(i);await tail;
 await db.exec("CREATE FUNCTION public.receipt_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt_commit_fault';END $$;CREATE CONSTRAINT TRIGGER receipt_commit_fault AFTER INSERT ON funding_legacy_receipt_private.conflicts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.receipt_commit_fault()");
 try{await assert.rejects(receive({...i,amountCents:103}),e=>e.code==='legacy_receipt_unavailable');await tail;assert.equal((await q('SELECT id FROM funding_legacy_receipt_private.conflicts WHERE amount_cents=103')).rows.length,0);}finally{await db.exec('DROP TRIGGER receipt_commit_fault ON funding_legacy_receipt_private.conflicts');}
 assert.equal((await receive({...i,amountCents:103})).outcome,'conflict');
});
test('malformed fields, missing reference, raw payload and caller-selected provenance are rejected',async()=>{
 for(const delta of [{reference:null},{reference:'real_transaction'},{amountCents:0},{amountCents:1.1},{amountCents:Number.MAX_SAFE_INTEGER+1},{currency:'eur'},{effectiveAt:'2026-06-18 10:32'},{eventRef:'unknown'},{provider:'paypal'},{cohort:'real'},{rawPayload:{}},{phone:'+31000000000'},{email:'synthetic@example.invalid'},{message:'private'}])await assert.rejects(receive(legacyReceiptInput('invalid',delta)),e=>e.code==='invalid_legacy_receipt');
 for(const credential of [null,legacyReceiptAdapterOptions.fundingSecret,legacyReceiptAdapterOptions.ownerSecret,legacyReceiptAdapterOptions.participationSecret])await assert.rejects(service.receive(credential,legacyReceiptInput('auth')),e=>e.code==='legacy_receipt_auth_required');
 assert.throws(()=>createLegacyReceiptFixtureAdapter({...legacyReceiptAdapterOptions,secret:legacyReceiptAdapterOptions.ownerSecret}));assert.throws(()=>createLegacyReceiptFixtureAdapter({...legacyReceiptAdapterOptions,mode:'production'}));
});
test('foreign currency and declared event/time remain unverified facts, never converted or assigned',async()=>{
 const eventRef='10000000-0000-0000-0000-000000000001',i=legacyReceiptInput('foreign',{currency:'USD',effectiveAt:'2026-06-18T12:32:00+02:00',eventRef}),r=await receive(i);await tail;
 const row=(await q('SELECT currency,amount_cents,claimed_effective_at,claimed_event,allocation FROM funding_legacy_receipt_private.operations WHERE id=$1',[r.receiptId])).rows[0];assert.equal(row.currency,'USD');assert.equal(Number(row.amount_cents),100);assert.equal(new Date(row.claimed_effective_at).toISOString(),'2026-06-18T10:32:00.000Z');assert.equal(row.claimed_event,eventRef);assert.equal(row.allocation,'review');assert.equal(r.paymentVerified,false);
});
test('ingest/review/client/finance privilege boundaries, immutable records and invoker functions',async()=>{
 await role('funding_legacy_receipt_ingest',async()=>{for(const statement of ['SELECT * FROM funding_private.annual_limits','UPDATE funding_private.accounts SET balance=0',"SELECT funding_private.reserve_refund('x')","UPDATE funding_legacy_receipt_private.operations SET amount_cents=0",'DELETE FROM funding_legacy_receipt_private.conflicts'])await assert.rejects(q(statement),e=>e.code==='42501');});
 await role('funding_review',async()=>{assert.ok((await q('SELECT id,amount_cents,currency,allocation FROM funding_legacy_receipt_private.operations')).rows.length);await assert.rejects(q('SELECT operation_ref FROM funding_legacy_receipt_private.operations'),e=>e.code==='42501');await assert.rejects(q('DELETE FROM funding_legacy_receipt_private.operations'),e=>e.code==='42501');});
 for(const name of ['anon','authenticated','funding_runtime'])await role(name,()=>assert.rejects(q('SELECT * FROM funding_legacy_receipt_private.operations'),e=>e.code==='42501'));
 await assert.rejects(q('UPDATE funding_legacy_receipt_private.operations SET amount_cents=amount_cents'),/append_only/);
 assert.equal(Number((await q("SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='funding_legacy_receipt_private' AND (p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))")).rows[0].n),0);
});
test('HTTP fixture acknowledges only committed receipts; auth/schema/commit failures cannot return success',async()=>{
 const app=Fastify({logger:false});await app.register(legacyReceiptFixtureRoutes,{service});try{
  assert.equal((await app.inject({method:'POST',url:'/fixture/legacy-receipts',payload:legacyReceiptInput('http')})).statusCode,401);
  const headers={'x-fixture-receipt-auth':legacyReceiptSecret};assert.equal((await app.inject({method:'POST',url:'/fixture/legacy-receipts',headers,payload:{...legacyReceiptInput('http'),rawPayload:'private'}})).statusCode,400);
  failBeforeCommit=true;assert.equal((await app.inject({method:'POST',url:'/fixture/legacy-receipts',headers,payload:legacyReceiptInput('http')})).statusCode,503);
  const r=await app.inject({method:'POST',url:'/fixture/legacy-receipts',headers,payload:legacyReceiptInput('http')});assert.equal(r.statusCode,200);assert.equal(r.json().allocation,'review');assert.equal(r.json().paymentVerified,false);
 }finally{await app.close();}
});
