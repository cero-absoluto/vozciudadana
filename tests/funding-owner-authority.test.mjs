import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as fixture from './helpers/funding-fixture.mjs';
import {authorityMigration,ownerIdentityFixture} from './helpers/funding-owner-authority-fixture.mjs';
import {createOwnerAuthorityService} from '../apps/api/src/funding/ownerAuthority.js';
const db=new PGlite();after(()=>db.close());await db.exec(fixture.fundingParentFixtureSQL);
for(const m of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration','fundingProviderMigration','fundingContinuityMigration','fundingRetentionMigration'])await db.exec(await readFile(fixture[m],'utf8'));
await db.exec(await readFile(authorityMigration,'utf8'));
const q=(s,a=[])=>db.query(s,a);
const identity=ownerIdentityFixture();
await q("INSERT INTO funding_owner_private.principals VALUES($1,'synthetic_owner_issuer','fixture-owner',1,true,true,$2)",[identity.principal,randomUUID()]);
// PGlite is single session; transaction adapter serializes complete transactions, including role switching.
let tail=Promise.resolve();
const database={async connect(){let release;const previous=tail;tail=new Promise(r=>release=r);await previous;await db.exec('SET ROLE funding_review');return {query:q,release:()=>{db.exec('RESET ROLE').then(release);}};}};
const service=createOwnerAuthorityService({database,identity:identity.adapter,mode:'isolated'}),credential=identity.credential();
const year=(await q('SELECT funding_private.temporal_context() AS c')).rows[0].c.year;
const paid=(await q('SELECT funding_private.reserve_with_fee_v3($1,$2,NULL,NULL,10000,1,0,true) AS id',[year,'c'.repeat(64)])).rows[0].id;
await q("SELECT funding_private.confirm_v2('owner-seed','owner-seed',$1,10000,'EUR',funding_private.temporal_now(),'simulator_successful_payment:v2')",[paid]);
const input=()=>({requestId:randomUUID(),action:'refund_authorize',intentId:paid,amountCents:100,sourceAccount:'general',expiresAt:new Date(Date.now()+600000).toISOString(),evidenceRef:randomUUID()});
async function issue(i=input(),cred=credential,epoch=1){const c=await service.challenge(cred,'issue',i);const proof=identity.confirm('issue',i,c.challengeId,epoch);return {i,c,proof,d:await service.decide(cred,i,c.challengeId,proof)};}
async function role(name,fn){await tail;await db.exec('SET ROLE '+name);try{return await fn();}finally{await db.exec('RESET ROLE');}}
test('unknown credentials, editable metadata, wrong issuer/audience and weak authentication rejected',async()=>{
 for(const c of [null,{ownerApproved:true},'psp-bearer',identity.credential({issuer:'other'}),identity.credential({audience:'donor'}),identity.credential({subject:'unknown'}),identity.credential({expiresAt:0})])await assert.rejects(service.cases(c));
 await assert.rejects(service.challenge(identity.credential({stepUp:false}),'issue',input()),/owner_confirmation_required/);
 assert.throws(()=>createOwnerAuthorityService({database,identity:identity.adapter,mode:'production'}));
});
test('operation confirmation binds every field and principal epoch; no general credential confirms an action',async()=>{
 const i=input(),c=await service.challenge(credential,'issue',i),proof=identity.confirm('issue',i,c.challengeId);
 await assert.rejects(service.decide(credential,i,c.challengeId,credential),/owner_confirmation_required/);
 for(const change of [{requestId:randomUUID()},{amountCents:101},{sourceAccount:'event:x'},{evidenceRef:randomUUID()},{action:'cover_exposure'},{expiresAt:new Date(Date.now()+900000).toISOString()},{intentId:randomUUID()},{movementRef:'changed'}])await assert.rejects(service.decide(credential,{...i,...change},c.challengeId,proof));
 await assert.rejects(service.decide(credential,{...i,ownerApproved:true},c.challengeId,proof),/invalid_owner_binding/);
 assert.equal((await service.decide(credential,i,c.challengeId,proof)).fundsMoved,false);
});
test('twenty exact replays return one binding/decision without extending expiry; changed request conflicts',async()=>{
 const {i,c,proof,d}=await issue();const results=await Promise.all(Array.from({length:20},()=>service.decide(credential,i,c.challengeId,proof)));assert.ok(results.every(r=>r.decisionId===d.decisionId));await tail;
 assert.equal(Number((await q('SELECT count(*) AS n FROM funding_owner_private.bindings WHERE request_id=$1',[i.requestId])).rows[0].n),1);
 const changed={...i,amountCents:101};await assert.rejects(service.decide(credential,changed,c.challengeId,identity.confirm('issue',changed,c.challengeId)),/idempotency_conflict/);
});
test('expired and consumed challenge cannot create a fresh authorization',async()=>{
 const i=input(),c=await service.challenge(credential,'issue',i);await tail;await q("UPDATE funding_owner_private.challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.challengeId]);
 await assert.rejects(service.decide(credential,i,c.challengeId,identity.confirm('issue',i,c.challengeId)),/owner_confirmation_required/);
 const x=await issue(),other=input();await assert.rejects(service.decide(credential,other,x.c.challengeId,identity.confirm('issue',other,x.c.challengeId)),/owner_confirmation_required/);
});
test('injected binding failure rolls back decision and challenge consumption together',async()=>{
 const i=input(),c=await service.challenge(credential,'issue',i),proof=identity.confirm('issue',i,c.challengeId);await tail;
 await db.exec("CREATE FUNCTION public.owner_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_failure';END $$;CREATE TRIGGER owner_fault BEFORE INSERT ON funding_owner_private.bindings FOR EACH ROW EXECUTE FUNCTION public.owner_fault()");
 try{await assert.rejects(service.decide(credential,i,c.challengeId,proof));await tail;assert.equal((await q('SELECT consumed FROM funding_owner_private.challenges WHERE id=$1',[c.challengeId])).rows[0].consumed,false);assert.equal((await q('SELECT id FROM funding_private.financial_review_decisions WHERE operation_ref=$1',[i.requestId])).rows.length,0);}finally{await db.exec('DROP TRIGGER owner_fault ON funding_owner_private.bindings');}
 assert.ok((await service.decide(credential,i,c.challengeId,proof)).decisionId);
});
test('bound revocation blocks financial use; roles cannot enroll or forge bindings',async()=>{
 const {d}=await issue(),r={requestId:randomUUID(),decisionId:d.decisionId,evidenceRef:randomUUID()},c=await service.challenge(credential,'revoke',r),proof=identity.confirm('revoke',r,c.challengeId);await service.revoke(credential,r,c.challengeId,proof);await tail;
 await role('funding_runtime',()=>assert.rejects(q('SELECT funding_private.reserve_refund($1)',[d.operationRef]),/owner_decision_required/));
 for(const name of ['funding_review','funding_runtime','anon','authenticated'])await role(name,()=>assert.rejects(q("INSERT INTO funding_owner_private.principals VALUES($1,'synthetic_owner_issuer','forged',1,true,true,$2)",[randomUUID(),randomUUID()]),e=>e.code==='42501'));
 await role('funding_runtime',()=>assert.rejects(q('INSERT INTO funding_owner_private.bindings SELECT * FROM funding_owner_private.bindings'),e=>e.code==='42501'));
});
test('individual session revocation denies its credential while another current session remains usable',async()=>{
 const sessionId=randomUUID(),one=identity.credential({sessionId}),two=identity.credential();assert.ok(await service.cases(one));await tail;
 await role('funding_owner_enrollment',()=>q('INSERT INTO funding_owner_private.session_revocations(session_id,principal,evidence) VALUES($1,$2,$3)',[sessionId,identity.principal,randomUUID()]));
 await assert.rejects(service.cases(one),/owner_session_revoked/);assert.ok(await service.cases(two));
});
test('recovery suspension invalidates old credentials and decisions; reenrollment cannot restore them',async()=>{
 const {d}=await issue();await tail;const before=(await q("SELECT balance FROM funding_private.accounts WHERE id='general'")).rows[0].balance;
 const recovery=randomUUID(),evidence=randomUUID();await role('funding_owner_enrollment',()=>q("SELECT funding_owner_private.recover($1,$2,'suspend',$3)",[recovery,identity.principal,evidence]));
 await assert.rejects(service.cases(credential),/owner_authority_revoked/);await tail;
 await role('funding_runtime',()=>assert.rejects(q('SELECT funding_private.reserve_refund($1)',[d.operationRef]),/owner_authority_revoked/));
 await role('funding_owner_enrollment',()=>q("SELECT funding_owner_private.recover($1,$2,'reenroll',$3)",[randomUUID(),identity.principal,randomUUID()]));
 const fresh=identity.credential({epoch:3});assert.ok(await service.cases(fresh));await tail;
 await role('funding_runtime',()=>assert.rejects(q('SELECT funding_private.reserve_refund($1)',[d.operationRef]),/owner_authority_revoked/));
 assert.equal((await q("SELECT balance FROM funding_private.accounts WHERE id='general'")).rows[0].balance,before);
 const next=await issue(input(),fresh,3);assert.ok(next.d.decisionId);
});
