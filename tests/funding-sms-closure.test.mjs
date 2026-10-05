import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/funding-fixture.mjs';
import * as s from './helpers/funding-sms-closure-fixture.mjs';
import {createSmsFixtureProvider,createSmsCostRehearsal} from '../apps/api/src/funding/smsCostRehearsal.js';
const db=new PGlite();after(()=>db.close());await db.exec(f.fundingParentFixtureSQL);
for(const m of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration'])await db.exec(await readFile(f[m],'utf8'));
await db.exec(await readFile(s.smsClosureMigration,'utf8'));await db.exec(s.smsParticipationFixtureSQL);
const q=(x,a=[])=>db.query(x,a),admin={query:q};let tail=Promise.resolve(),failBefore=false,failAfter=false;
function database(role){return {async connect(){let release;const previous=tail;tail=new Promise(r=>release=r);await previous;await db.exec('SET ROLE '+role);return {async query(sql,args){if(sql==='COMMIT'&&failBefore){failBefore=false;throw Error('synthetic_before_commit');}const r=await q(sql,args);if(sql==='COMMIT'&&failAfter){failAfter=false;throw Error('synthetic_response_loss');}return r;},release(){db.exec('RESET ROLE').then(release);}};}};}
const executorDatabase=database('funding_sms_executor'),evidenceDatabase=database('funding_sms_evidence_ingest');
const build=(provider=createSmsFixtureProvider(s.smsProviderOptions))=>({provider,service:createSmsCostRehearsal({executorDatabase,evidenceDatabase,provider,mode:'isolated'})});
const event=async(balance=100)=>{await tail;return s.seedSmsEvent(admin,balance);};
const row=async(op)=>{await tail;return (await q('SELECT * FROM funding_sms_fixture_private.execution WHERE operation_id=$1',[op])).rows[0];};
const balance=async(id)=>{await tail;return Number((await q('SELECT balance FROM funding_private.accounts WHERE id=$1',['event:'+id])).rows[0].balance);};
async function fixture(op,key,delta={},service){return service.ingestEvidence(s.smsFixtureSecret,s.smsFact(op,key,delta));}
test('twenty prepares/dispatch retries use one hold and one transport claim; accepted is not priced',async()=>{
 const e=await event(),{service,provider}=build(),input=s.smsPrepareInput(e,'local_one');const r=await Promise.all(Array.from({length:20},()=>service.prepare(input)));const op=r[0].operationId;assert.equal(new Set(r.map(x=>x.operationId)).size,1);await Promise.all(Array.from({length:20},()=>service.dispatch(op)));assert.equal(provider.calls(op),1);assert.equal((await row(op)).state,'accepted');assert.equal(await balance(e),100);
});
test('pricing facts/project retries consume actual cost once, release bound difference and preserve quotas/finals',async()=>{
 const e=await event(),{service}=build(),op=(await service.prepare(s.smsPrepareInput(e,'local_price'))).operationId;await tail;const quotas=JSON.stringify((await q('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows);await service.dispatch(op);await Promise.all(Array.from({length:20},()=>fixture(op,'price',{},service)));await Promise.all(Array.from({length:20},()=>service.project(op)));assert.equal(await balance(e),95);assert.equal((await row(op)).state,'charged');await tail;
 assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows),quotas);assert.equal((await q('SELECT hash_integridad,saldo_euros FROM public.protests WHERE id=$1',[e])).rows[0].hash_integridad,'synthetic_final_v2');
 assert.equal(Number((await q('SELECT sum(amount) n FROM funding_private.ledger_entries WHERE transaction_id=$1',[(await row(op)).allocation_id])).rows[0].n),0);
});
test('same reference conflicts are immutable and deduplicated; changed currency and overbound stay review',async()=>{
 const {service}=build(),e=await event(),op=(await service.prepare(s.smsPrepareInput(e,'local_conflict'))).operationId;await service.dispatch(op);await fixture(op,'conflict',{},service);await Promise.all(Array.from({length:20},()=>fixture(op,'conflict',{amountCents:6},service)));assert.equal(await service.project(op),'review');assert.equal(await balance(e),100);await tail;assert.equal(Number((await q('SELECT count(*) n FROM funding_sms_fixture_private.conflicts WHERE operation_id=$1',[op])).rows[0].n),1);
 for(const [key,delta] of [['fx',{currency:'USD'}],['bound',{amountCents:11}]]){const id=(await service.prepare(s.smsPrepareInput(e,key))).operationId;await service.dispatch(id);await fixture(id,key,delta,service);assert.equal(await service.project(id),'review');}
});
test('lost send response retains hold and never redispatches after service/provider recomposition',async()=>{
 const e=await event(),{service,provider}=build(createSmsFixtureProvider({...s.smsProviderOptions,scenario:'response_lost'})),op=(await service.prepare(s.smsPrepareInput(e,'local_unknown'))).operationId;assert.equal((await service.dispatch(op)).state,'unknown');assert.equal(provider.calls(op),1);const next=build();assert.equal((await next.service.dispatch(op)).claimed,false);assert.equal(next.provider.calls(op),0);assert.equal(await balance(e),100);await fixture(op,'resolved',{},next.service);assert.equal(await next.service.project(op),'charged');
});
test('failed send status is not no-charge evidence; explicit no-charge cancels without ledger cost',async()=>{
 const e=await event(),{service}=build(),op=(await service.prepare(s.smsPrepareInput(e,'local_failed'))).operationId;await service.dispatch(op);await fixture(op,'failed',{kind:'failed',amountCents:null,currency:null},service);assert.equal(await service.project(op),'unknown');await fixture(op,'nocharge',{kind:'no_charge',amountCents:null,currency:null},service);assert.equal(await service.project(op),'cancelled');assert.equal(await balance(e),100);
});
test('commit failures never ACK; committed lost preparation response retries without new reservation',async()=>{
 const e=await event(),{service}=build(),input=s.smsPrepareInput(e,'local_commit');failBefore=true;await assert.rejects(service.prepare(input),e=>e.code==='sms_rehearsal_unavailable');await tail;assert.equal((await q('SELECT id FROM funding_sms_fixture_private.operations WHERE operation_key=$1',[input.operationKey])).rows.length,0);
 failAfter=true;await assert.rejects(service.prepare(input),e=>e.code==='sms_rehearsal_unavailable');assert.equal((await service.prepare(input)).duplicate,true);
 const op=(await service.prepare(input)).operationId;await service.dispatch(op);await tail;await db.exec("CREATE FUNCTION public.sms_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_commit_fault';END $$;CREATE CONSTRAINT TRIGGER sms_commit_fault AFTER INSERT ON funding_sms_fixture_private.facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sms_commit_fault()");
 try{await assert.rejects(fixture(op,'commitfail',{},service),e=>e.code==='sms_rehearsal_unavailable');await tail;assert.equal((await q("SELECT id FROM funding_sms_fixture_private.facts WHERE reference='synthetic_sms_fact_commitfail'")).rows.length,0);}finally{await db.exec('DROP TRIGGER sms_commit_fault ON funding_sms_fixture_private.facts');}
});
test('closure blocks holds and further dispatch, settlement waits for evidence; historical final stays unchanged',async()=>{
 const e=await event(),{service}=build(),op=(await service.prepare(s.smsPrepareInput(e,'local_close'))).operationId;await tail;await q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[e]);assert.equal((await service.close(e)).settled,false);await assert.rejects(service.dispatch(op),/sms_dispatch_closed/);await assert.rejects(service.close(e,true),/sms_pending_items/);await tail;
 assert.equal((await q('SELECT hash_integridad,saldo_euros FROM public.protests WHERE id=$1',[e])).rows[0].hash_integridad,'synthetic_final_v2');
 const f=await event(),id=(await service.prepare(s.smsPrepareInput(f,'local_settle'))).operationId;await service.dispatch(id);await fixture(id,'settle',{},service);await service.project(id);await tail;await q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[f]);assert.equal(Number((await service.close(f,true)).surplusCents),95);assert.equal(Number((await service.close(f,true)).surplusCents),95);
});
test('participation mirror preserves duplicate/closed/OTP atomic guards; email requires no SMS budget',async()=>{
 const e=await event(0),otp=randomUUID();await tail;await q('INSERT INTO sms_participation_fixture.otp(id) VALUES($1)',[otp]);const args=[e,'synthetic_nullifier','institutional_email_otp',otp];await q('SELECT sms_participation_fixture.join($1,$2,$3,$4)',args);await assert.rejects(q('SELECT sms_participation_fixture.join($1,$2,$3,$4)',args),/otp_used/);
 const otp2=randomUUID();await q('INSERT INTO sms_participation_fixture.otp(id) VALUES($1)',[otp2]);await assert.rejects(q('SELECT sms_participation_fixture.join($1,$2,$3,$4)',[e,args[1],args[2],otp2]),/unique/);assert.equal((await q('SELECT consumed FROM sms_participation_fixture.otp WHERE id=$1',[otp2])).rows[0].consumed,false);
 const {service}=build();await assert.rejects(service.prepare(s.smsPrepareInput(e,'email_no_budget')),/insufficient_event_funds/);
});
test('privacy allowlists, credentials and isolation; facts immutable and roles cannot see donor/participant identifiers',async()=>{
 const e=await event(),{service}=build(),op=(await service.prepare(s.smsPrepareInput(e,'local_privacy'))).operationId;
 for(const key of ['phone','phone_hash','device_id','nullifier','donorHMAC','adhesion_id','email','rawPayload','sms_sent'])await assert.rejects(fixture(op,'privacy',{[key]:'private'},service),/invalid_sms_fact/);
 await assert.rejects(service.ingestEvidence(s.smsProviderOptions.ownerSecret,s.smsFact(op)),/sms_evidence_auth_required/);assert.throws(()=>createSmsFixtureProvider({...s.smsProviderOptions,mode:'production'}));assert.throws(()=>createSmsFixtureProvider({...s.smsProviderOptions,secret:s.smsProviderOptions.participationSecret}));
 await fixture(op,'immutable',{},service);await tail;await assert.rejects(q('UPDATE funding_sms_fixture_private.facts SET amount_cents=amount_cents'),/append_only/);
 for(const role of ['funding_sms_executor','funding_sms_evidence_ingest']){await db.exec('SET ROLE '+role);for(const statement of ['SELECT * FROM funding_private.annual_limits','SELECT * FROM sms_participation_fixture.adhesions','UPDATE public.protests SET hash_integridad=NULL'])await assert.rejects(q(statement),e=>e.code==='42501');await db.exec('RESET ROLE');}
 assert.equal(Number((await q("SELECT count(*) n FROM pg_proc WHERE pronamespace='funding_sms_fixture_private'::regnamespace AND (prosecdef OR has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'))")).rows[0].n),0);
});

test('unexposed prepared cost can release only with explicit no-charge evidence; priced-without-dispatch stays review',async()=>{
 const e=await event(),{service}=build(),id=(await service.prepare(s.smsPrepareInput(e,'local_unexposed'))).operationId;await fixture(id,'unexposed',{kind:'no_charge',amountCents:null,currency:null},service);assert.equal(await service.project(id),'cancelled');assert.equal((await service.dispatch(id)).claimed,false);assert.equal(await balance(e),100);
 const id2=(await service.prepare(s.smsPrepareInput(e,'local_unclaimed_price'))).operationId;await fixture(id2,'unclaimed',{},service);assert.equal(await service.project(id2),'review');assert.equal(await balance(e),100);
});
