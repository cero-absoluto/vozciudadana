import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as migrations from './helpers/funding-fixture.mjs';
import {legacyFundingVersion,splitFundingVersion,registerFundingVersion,fixtureRetentionPolicySQL} from './helpers/funding-continuity-fixture.mjs';
import {createFundingKeyContinuity,createIsolatedCleanupService} from '../apps/api/src/funding/keyContinuity.js';
import {createIsolatedFundingService,createPaymentSimulator,fundingTokens} from '../apps/api/src/funding/isolatedService.js';
const db=new PGlite();after(()=>db.close());await db.exec(migrations.fundingParentFixtureSQL);
for(const name of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration','fundingProviderMigration','fundingContinuityMigration','fundingRetentionMigration'])await db.exec(await readFile(migrations[name],'utf8'));
await db.exec("CREATE TABLE funding_private.fixture_continuity_clock(t timestamptz);INSERT INTO funding_private.fixture_continuity_clock VALUES('2030-06-01T12:00:00Z');GRANT SELECT ON funding_private.fixture_continuity_clock TO funding_runtime;CREATE OR REPLACE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$ SELECT t FROM funding_private.fixture_continuity_clock $$;");
await db.exec('SET ROLE funding_runtime');
const q=(s,a=[])=>db.query(s,a),scalar=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
async function owner(f){await db.exec('RESET ROLE');try{return await f();}finally{await db.exec('SET ROLE funding_runtime');}}
const now=()=>scalar('SELECT funding_private.temporal_now()');
const simulator=createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32),now});
function service(versions=null,current='v1'){
 const continuity=versions?createFundingKeyContinuity({mode:'isolated',database:db,versions,currentVersion:current,participationSecret:'p'.repeat(32)}):null;
 return createIsolatedFundingService({database:db,simulator,secret:'f'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated',continuity});
}
async function verified(s,phone,eventId=null){const c=await s.start({phone,eventId}),v=await s.verify({challengeId:c.challengeId,code:'123456'});return {...v,challengeId:c.challengeId};}
async function paid(s,v,amount,eventId=null){const i=await s.intent(v.session,{kind:eventId?'event':'general',amountCents:amount});await s.webhook({eventRef:randomUUID(),intentId:i.intentId,amountCents:amount,currency:'EUR'},'w'.repeat(32));return i;}
async function event(){const id=randomUUID();await owner(()=>q("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,'2030-01-01','2032-01-01',0.9,'preserved')",[id]));await q("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+id,id]);return id;}
let oldSession,oldLedger,eventId,oldEventSession,allRing;
test('known v1 quota is adopted after OTP without rewriting ledger/history',async()=>{
 const s=service(),v=await verified(s,'+349810000001');await paid(s,v,1000);oldSession=v;oldLedger=JSON.stringify((await q('SELECT * FROM funding_private.ledger_transactions')).rows);
 await owner(()=>registerFundingVersion(db,legacyFundingVersion));const upgraded=service([legacyFundingVersion]),v2=await verified(upgraded,'+349810000001');assert.equal((await upgraded.limits(v2.session)).annualRemainingCents,99000);
 assert.equal(await scalar("SELECT canonical_token FROM funding_private.quota_scopes WHERE purpose='annual'"),fundingTokens('f'.repeat(32),'+349810000001',2030).annual);assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.ledger_transactions')).rows),oldLedger);
});
test('purpose secrets, provenance, production mode and caller mutation are rejected',()=>{
 assert.throws(()=>createFundingKeyContinuity({mode:'production',database:db,versions:[legacyFundingVersion],currentVersion:'v1'}),/isolated_only/);
 const bad={...splitFundingVersion,secrets:{...splitFundingVersion.secrets,annual:'p'.repeat(32)}};
 assert.throws(()=>createFundingKeyContinuity({mode:'isolated',database:db,versions:[bad],currentVersion:'v2',participationSecret:'p'.repeat(32)}),/independent_funding_secret_required/);
 assert.throws(()=>createFundingKeyContinuity({mode:'isolated',database:db,versions:[{...bad,secrets:{...splitFundingVersion.secrets,event:splitFundingVersion.secrets.annual}}],currentVersion:'v2'}),/purpose_key_reuse/);
});
test('adding split keys blocks incomplete keyrings and legacy service; old session survives complete keyring',async()=>{
 await owner(()=>registerFundingVersion(db,splitFundingVersion));allRing=[legacyFundingVersion,splitFundingVersion];
 await assert.rejects(service([legacyFundingVersion]).start({phone:'+349810000002'}),e=>e.code==='key_provenance_required');
 await assert.rejects(service().start({phone:'+349810000002'}),e=>e.code==='key_provenance_required');
 assert.equal((await service(allRing,'v2').limits(oldSession.session)).annualRemainingCents,99000);
});
test('old/new version €60 plus €40 share cumulative event quota; next cent rejected',async()=>{
 eventId=await event();const a=service(allRing),b=service(allRing,'v2');oldEventSession=await verified(a,'+349810000003',eventId);await paid(a,oldEventSession,6000,eventId);
 const next=await verified(b,'+349810000003',eventId);await paid(b,next,4000,eventId);assert.equal((await b.limits(next.session)).eventRemainingCents,0);
 await assert.rejects(b.intent(next.session,{kind:'event',amountCents:1}),e=>e.code==='event_limit');assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.event_limits WHERE event_id=$1',[eventId])),1);
});
test('general and event gross share €1000 annual cap across versions',async()=>{
 const a=service(allRing),b=service(allRing,'v2'),p='+349810000004',e=await event();await paid(a,await verified(a,p),99000);const v=await verified(b,p,e);await paid(b,v,1000,e);await assert.rejects(b.intent(v.session,{kind:'event',amountCents:1}),x=>x.code==='annual_limit');
});
test('failed OTP does not resolve financial identity; rate starts remain shared across versions',async()=>{
 const a=service(allRing),b=service(allRing,'v2'),p='+349810000005',before=await scalar("SELECT count(*) FROM funding_private.quota_scopes WHERE purpose='annual'");
 const c=await a.start({phone:p});await assert.rejects(b.verify({challengeId:c.challengeId,code:'654321'}),x=>x.code==='invalid_otp');assert.equal(await scalar("SELECT count(*) FROM funding_private.quota_scopes WHERE purpose='annual'"),before);
 await b.start({phone:p});await a.start({phone:p});await assert.rejects(b.start({phone:p}),x=>x.code==='otp_rate_limit');
});
test('attempt limit and consumed challenge survive version recomposition',async()=>{
 const a=service(allRing),b=service(allRing,'v2'),c=await a.start({phone:'+349810000006'});
 for(let n=0;n<5;n++)await assert.rejects((n%2?a:b).verify({challengeId:c.challengeId,code:'654321'}),x=>x.code==='invalid_otp');
 await assert.rejects(b.verify({challengeId:c.challengeId,code:'123456'}),x=>x.code==='challenge_expired');
});
test('missing version and unknown provenance block without quota mutation or zero-use assumption',async()=>{
 const before=JSON.stringify((await q('SELECT * FROM funding_private.annual_limits')).rows);
 await assert.rejects(service([splitFundingVersion],'v2').limits(oldEventSession.session),x=>x.code==='key_provenance_required');
 const bad={...legacyFundingVersion,provenance:'unknown'};assert.throws(()=>service([bad]),/key_provenance_required/);assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.annual_limits')).rows),before);
});
test('conflicting alias groups fail closed and cannot merge committed quota',async()=>{
 const p='+349810000007',a=service(allRing),v=await verified(a,p),oldToken=fundingTokens('f'.repeat(32),p,2030).annual;
 const before=await scalar('SELECT count(*) FROM funding_private.quota_aliases');
 // Explicit synthetic owner anomaly: an independently charged token already exists.
 const newToken=fundingTokens(splitFundingVersion.secrets.annual,p,2030).annual;await owner(()=>q('INSERT INTO funding_private.annual_limits(policy_year,token,committed) VALUES(2030,$1,100)',[newToken]));
 const c=await a.start({phone:p});await assert.rejects(a.verify({challengeId:c.challengeId,code:'123456'}),x=>x.code==='financial_auth_unavailable');assert.equal(await scalar('SELECT count(*) FROM funding_private.quota_aliases'),before);assert.equal(Number(await scalar('SELECT committed FROM funding_private.annual_limits WHERE token=$1',[newToken])),100);
 assert.notEqual(oldToken,newToken);assert.ok(v.session);
});
test('scope aliases are immutable, purpose-bound and private; raw new intent cannot bypass canonical quota',async()=>{
 await assert.rejects(q("UPDATE funding_private.quota_aliases SET scope_ref='2031'"),/permission denied/);
 await assert.rejects(q("SELECT funding_private.reserve_with_fee_v3(2030,$1,NULL,NULL,100,1,0,true)",['e'.repeat(64)]),/key_provenance_required/);
 for(const role of ['anon','authenticated','funding_review'])await owner(async()=>{await db.exec('SET ROLE '+role);await assert.rejects(q('SELECT * FROM funding_private.quota_aliases'),/permission denied/);await db.exec('RESET ROLE');});
 const state=JSON.stringify((await q('SELECT * FROM funding_private.quota_aliases')).rows);assert.ok(!state.includes('+3498'));assert.ok(!state.includes('fixture-v2'));assert.ok(!state.includes('123456'));
});
test('absent cleanup policy fails closed; finance/mixed roles cannot clean or delete auth',async()=>{
 const cleanup=createIsolatedCleanupService({mode:'isolated',database:db});await assert.rejects(cleanup.run(randomUUID()),x=>x.code==='cleanup_role_required');await assert.rejects(q('DELETE FROM funding_auth_private.verified_sessions'),/permission denied/);
 await owner(async()=>{await db.exec('SET ROLE funding_cleanup');await assert.rejects(cleanup.run(randomUUID()),x=>x.code==='cleanup_policy_required');await db.exec('RESET ROLE');});await owner(()=>db.exec(fixtureRetentionPolicySQL));
});
test('audited cleanup removes expired auth and rate aliases, retaining live session and all quotas/history',async()=>{
 const a=service(allRing,'v2'),p='+349810000008',v=await verified(a,p);await paid(a,v,300);
 const before=JSON.stringify((await q('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows),ledger=JSON.stringify((await q('SELECT * FROM funding_private.ledger_transactions ORDER BY id')).rows);
 await owner(()=>q("UPDATE funding_auth_private.otp_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[v.challengeId]));
 const cleanup=createIsolatedCleanupService({mode:'isolated',database:db}),request=randomUUID();let first;
 await owner(async()=>{await db.exec('SET ROLE funding_cleanup');first=await cleanup.run(request);assert.equal(first.challenge_count,0);assert.deepEqual(await cleanup.run(request),first);await db.exec('RESET ROLE');});assert.equal((await a.limits(v.session)).annualRemainingCents,99700);
 await owner(async()=>{await q("UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1",[v.challengeId]);await q("UPDATE funding_auth_private.otp_rate_windows SET expires_at=clock_timestamp()-interval '1 second' WHERE rate_token=(SELECT rate_token FROM funding_auth_private.otp_challenges WHERE id=$1)",[v.challengeId]);await db.exec('SET ROLE funding_cleanup');const r=await cleanup.run(randomUUID());assert.equal(r.session_count,1);assert.equal(r.challenge_count,1);assert.equal(r.rate_count,1);assert.equal(r.scope_count,1);await db.exec('RESET ROLE');});
 assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.annual_limits ORDER BY token')).rows),before);assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.ledger_transactions ORDER BY id')).rows),ledger);
});
test('cleanup operator cannot change financial data, key catalog or immutable audit; policy is test-only',async()=>{
 await owner(async()=>{await db.exec('SET ROLE funding_cleanup');for(const sql of ['SELECT * FROM funding_private.annual_limits','DELETE FROM funding_private.quota_scopes WHERE purpose=\'annual\'','UPDATE funding_auth_private.cleanup_batches SET session_count=0','SELECT * FROM funding_private.key_versions']){
 if(sql.startsWith('DELETE')){assert.equal((await q(sql)).affectedRows,0);}else await assert.rejects(q(sql),/permission denied/);}
 assert.equal(await scalar("SELECT pg_has_role(current_user,'funding_runtime','MEMBER')"),false);await assert.rejects(q('SELECT payload FROM funding_auth_private.verified_sessions'),/permission denied/);await db.exec('RESET ROLE');});
 await owner(()=>assert.rejects(q("UPDATE funding_auth_private.retention_policy SET test_only=false"),/check constraint/));
});
test('year change retains pluriyear event quota and separates yearly identity; old sessions need reverify',async()=>{
 await owner(()=>q("UPDATE funding_private.fixture_continuity_clock SET t='2031-06-01T12:00:00Z'"));const a=service(allRing,'v2');await assert.rejects(a.limits(oldEventSession.session),x=>x.code==='reverify_for_policy_year');
 const v=await verified(a,'+349810000003',eventId);assert.equal((await a.limits(v.session)).eventRemainingCents,0);assert.equal((await a.limits(v.session)).annualRemainingCents,100000);
 await assert.rejects(a.intent(v.session,{kind:'event',amountCents:1}),x=>x.code==='event_limit');
});
test('year/event scopes cannot become a cross-year or participation identity',async()=>{
 const scopes=(await q("SELECT purpose,scope_ref,canonical_token FROM funding_private.quota_scopes WHERE purpose IN('annual','event')")).rows;
 assert.ok(scopes.some(s=>s.scope_ref==='2031'));const aliases=(await q("SELECT a.*,s.canonical_token FROM funding_private.quota_aliases a JOIN funding_private.quota_scopes s ON s.id=a.scope_id WHERE a.version='v1' AND a.purpose='annual' AND a.token IN($1,$2)",[fundingTokens('f'.repeat(32),'+349810000003',2030).annual,fundingTokens('f'.repeat(32),'+349810000003',2031).annual])).rows;
 assert.equal(aliases.length,2);assert.notEqual(aliases[0].canonical_token,aliases[1].canonical_token);
});
test('session revocation checks all key versions immediately without resetting limits',async()=>{
 const a=service(allRing),b=service(allRing,'v2'),v=await verified(a,'+349810000009');await paid(a,v,500);
 await b.revokeSession(v.session);await assert.rejects(a.limits(v.session),x=>x.code==='financial_session_required');await assert.rejects(b.limits(v.session),x=>x.code==='financial_session_required');
 const fresh=await verified(b,'+349810000009');assert.equal((await b.limits(fresh.session)).annualRemainingCents,99500);
});
test('injected alias commit fault rolls back financial scopes and session consumption atomically',async()=>{
 const a=service(allRing,'v2'),c=await a.start({phone:'+349810000010'}),before=await scalar("SELECT count(*) FROM funding_private.quota_scopes WHERE purpose='annual'"),sessions=await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions');
 await owner(()=>db.exec("CREATE FUNCTION funding_private.fixture_alias_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.purpose='annual' THEN RAISE EXCEPTION 'fixture_alias_commit_fault';END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_alias_fault AFTER INSERT ON funding_private.quota_aliases FOR EACH ROW EXECUTE FUNCTION funding_private.fixture_alias_fault();"));
 await assert.rejects(a.verify({challengeId:c.challengeId,code:'123456'}),x=>x.code==='financial_auth_unavailable');
 assert.equal(await scalar("SELECT count(*) FROM funding_private.quota_scopes WHERE purpose='annual'"),before);assert.equal(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions'),sessions);assert.equal(await scalar('SELECT state FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId]),'verifying');
 await owner(()=>db.exec('DROP TRIGGER fixture_alias_fault ON funding_private.quota_aliases;DROP FUNCTION funding_private.fixture_alias_fault();'));
});
test('cleanup grace/dependencies and audit failure prevent silent or partial deletion',async()=>{
 const a=service(allRing,'v2'),v=await verified(a,'+349810000011');await owner(async()=>{await q("UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1",[v.challengeId]);await db.exec("UPDATE funding_auth_private.retention_policy SET grace_seconds=60 WHERE purpose='session'");});
 const cleanup=createIsolatedCleanupService({mode:'isolated',database:db});await owner(async()=>{await db.exec('SET ROLE funding_cleanup');await cleanup.run(randomUUID());await db.exec('RESET ROLE');});assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[v.challengeId])),1);
 await owner(()=>db.exec("UPDATE funding_auth_private.retention_policy SET grace_seconds=0;CREATE FUNCTION funding_auth_private.fixture_cleanup_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_cleanup_audit_fault';END $$;CREATE TRIGGER fixture_cleanup_fault BEFORE INSERT ON funding_auth_private.cleanup_batches FOR EACH ROW EXECUTE FUNCTION funding_auth_private.fixture_cleanup_fault();"));
 await owner(async()=>{await db.exec('SET ROLE funding_cleanup');await assert.rejects(cleanup.run(randomUUID()),x=>x.code==='cleanup_unavailable');await db.exec('RESET ROLE');});assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[v.challengeId])),1);
 await owner(()=>db.exec('DROP TRIGGER fixture_cleanup_fault ON funding_auth_private.cleanup_batches;DROP FUNCTION funding_auth_private.fixture_cleanup_fault();'));
});
test('direct cleanup deletion without same-transaction provenance cannot commit',async()=>{
 const a=service(allRing,'v2'),v=await verified(a,'+349810000012');await owner(()=>q("UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1",[v.challengeId]));
 await owner(async()=>{await db.exec('SET ROLE funding_cleanup');await assert.rejects(q('DELETE FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[v.challengeId]),/cleanup_provenance_required/);await db.exec('RESET ROLE');});
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[v.challengeId])),1);
});
test('wrong material under an existing key version cannot invent a fresh zero-use identity',async()=>{
 const wrong={...legacyFundingVersion,secrets:Object.fromEntries(Object.keys(legacyFundingVersion.secrets).map(p=>[p,'g'.repeat(32)]))},before=await scalar('SELECT count(*) FROM funding_private.quota_scopes');
 await assert.rejects(service([wrong,splitFundingVersion],'v2').start({phone:'+349810000003',eventId}),x=>x.code==='key_provenance_required');assert.equal(await scalar('SELECT count(*) FROM funding_private.quota_scopes'),before);
});
test('unknown legacy enrollment cannot be treated as zero used quota',async()=>{
 const before=await scalar('SELECT count(*) FROM funding_private.quota_scopes');await owner(()=>db.exec('DELETE FROM funding_private.continuity_enrollment'));
 await assert.rejects(service(allRing,'v2').start({phone:'+349810000003',eventId}),x=>x.code==='key_provenance_required');assert.equal(await scalar('SELECT count(*) FROM funding_private.quota_scopes'),before);
 await owner(()=>q("INSERT INTO funding_private.continuity_enrollment VALUES(true,true,'synthetic_closed_fixture',$1)",[randomUUID()]));
});
