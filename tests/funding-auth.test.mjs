import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {fundingParentFixtureSQL,fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration} from './helpers/funding-fixture.mjs';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
import {isolatedFundingRoutes} from '../apps/api/src/funding/routes.js';
const db=new PGlite();after(()=>db.close());await db.exec(fundingParentFixtureSQL);
for(const migration of [fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration])await db.exec(await readFile(migration,'utf8'));
await db.exec('SET ROLE funding_runtime');
const q=(sql,args=[])=>db.query(sql,args);
const scalar=async(sql,args)=>Object.values((await q(sql,args)).rows[0])[0];
async function admin(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE funding_runtime');}}
const simulator=()=>createPaymentSimulator({otpCode:'123456',webhookSecret:'w'.repeat(32)});
const compose=(sim=simulator(),database=db,now=()=>new Date())=>createIsolatedFundingService({database,simulator:sim,secret:'a'.repeat(32),participationSecret:'p'.repeat(32),timeZone:'Europe/Amsterdam',mode:'isolated',now});
let sequence=0;const nextPhone=()=>'+349'+String(++sequence).padStart(8,'0');
const verify=(s,id,code='123456')=>s.verify({challengeId:id,code});
const fails=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('two instances and recomposition share start quota across general and UUID case variants',async()=>{
 const sim=simulator(),a=compose(sim),b=compose(sim),phone=nextPhone(),event='abcdefab-cdef-abcd-efab-cdefabcdefab';
 await a.start({phone});await b.start({phone,eventId:event});await a.start({phone,eventId:event.toUpperCase()});
 await fails(b.start({phone}),'otp_rate_limit');await fails(compose(sim).start({phone}),'otp_rate_limit');
 await b.start({phone:nextPhone()});
});
test('shared database expiry resets a window even when application clocks differ',async()=>{
 const sim=simulator(),phone=nextPhone(),a=compose(sim),b=compose(sim,db,()=>new Date(Date.now()+3600000));
 const c=await a.start({phone});await b.start({phone});await a.start({phone});await fails(b.start({phone}),'otp_rate_limit');
 await admin(()=>q(`UPDATE funding_auth_private.otp_rate_windows SET expires_at=clock_timestamp()-interval '1 second' WHERE rate_token=(SELECT rate_token FROM funding_auth_private.otp_challenges WHERE id=$1)`,[c.challengeId]));
 await b.start({phone});
});
test('five invalid attempts are shared and a sixth never calls verifier',async()=>{
 const sim=simulator();let calls=0;const original=sim.verifyOtp;sim.verifyOtp=async(...args)=>{calls++;return original(...args);};
 const a=compose(sim),b=compose(sim),{challengeId}=await a.start({phone:nextPhone()});
 for(let i=0;i<5;i++)await fails(verify(i%2?a:b,challengeId,'000000'),'invalid_otp');
 await fails(verify(a,challengeId),'challenge_expired');assert.equal(calls,5);
});
test('one valid verification creates a shared persistent session; replay denied',async()=>{
 const sim=simulator(),a=compose(sim),b=compose(sim),{challengeId}=await a.start({phone:nextPhone()});
 const {session}=await verify(b,challengeId);assert.equal((await compose(sim).limits(session)).annualRemainingCents,100000);
 await fails(verify(a,challengeId),'challenge_expired');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[challengeId])),1);
 const dump=JSON.stringify((await q('SELECT * FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[challengeId])).rows);assert.ok(!dump.includes(session));
});
test('expired session and challenge deny access despite application clock lag',async()=>{
 const sim=simulator(),a=compose(sim,db,()=>new Date(Date.now()-3600000));
 const c=await a.start({phone:nextPhone()}),s=await verify(a,c.challengeId);
 await admin(()=>q(`UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1`,[c.challengeId]));
 await fails(a.limits(s.session),'financial_session_required');
 const other=await a.start({phone:nextPhone()});
 await admin(()=>q(`UPDATE funding_auth_private.otp_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[other.challengeId]));
 await fails(verify(a,other.challengeId),'challenge_expired');
});
test('uncertain send retains capacity and marks failed without leaking adapter error',async()=>{
 const sim=simulator();sim.startOtp=async()=>{throw new Error('private_phone_provider_detail');};const a=compose(sim),phone=nextPhone();
 for(let i=0;i<3;i++)await fails(a.start({phone}),'otp_send_unavailable');
 await fails(a.start({phone}),'otp_rate_limit');
});
test('uncertain verification fails closed and cannot be retried',async()=>{
 const sim=simulator();sim.verifyOtp=async()=>{throw new Error('private_provider_detail');};const a=compose(sim),c=await a.start({phone:nextPhone()});
 await fails(verify(a,c.challengeId),'otp_verification_unavailable');await fails(verify(compose(sim),c.challengeId),'challenge_expired');
 assert.equal(await scalar('SELECT state FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId]),'failed');
});
test('late approval after claim lease expires cannot issue a session',async()=>{
 const sim=simulator();sim.verifyOtp=async id=>{await admin(()=>q(`UPDATE funding_auth_private.otp_challenges SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,[id]));return true;};
 const a=compose(sim),c=await a.start({phone:nextPhone()});await fails(verify(a,c.challengeId),'challenge_expired');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])),0);
});
test('abandoned claim and stale fencing token cannot reopen or issue a session',async()=>{
 const a=compose(),c=await a.start({phone:nextPhone()}),op=randomUUID();
 await q('SELECT funding_auth_private.claim_challenge($1,$2)',[c.challengeId,op]);
 await fails(verify(compose(),c.challengeId),'challenge_expired');
 const result=(await q(`SELECT funding_auth_private.finish_verification($1,$2,'valid',$3) AS r`,[c.challengeId,randomUUID(),'d'.repeat(64)])).rows[0].r;
 assert.equal(result.error,'challenge_expired');
 await admin(()=>q(`UPDATE funding_auth_private.otp_challenges SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,[c.challengeId]));
 await fails(verify(compose(),c.challengeId),'challenge_expired');
 assert.equal(await scalar('SELECT state FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId]),'failed');
});
test('session insertion fault rolls back consumption; no ghost session and no duplicate verification',async()=>{
 const a=compose(),c=await a.start({phone:nextPhone()});
 await admin(()=>db.exec(`CREATE FUNCTION public.auth_insert_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_secret_detail'; END $$;CREATE TRIGGER auth_insert_fault BEFORE INSERT ON funding_auth_private.verified_sessions FOR EACH ROW EXECUTE FUNCTION public.auth_insert_fault();`));
 try{await fails(verify(a,c.challengeId),'financial_auth_unavailable');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])),0);
 assert.equal(await scalar('SELECT state FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId]),'verifying');
 await fails(verify(a,c.challengeId),'challenge_expired');
 }finally{await admin(()=>db.exec('DROP TRIGGER auth_insert_fault ON funding_auth_private.verified_sessions'));}
});
test('lost response after commit creates only one inaccessible bearer, never another session',async()=>{
 const sim=simulator(),database={async query(sql,args){const r=await db.query(sql,args);if(sql.includes('finish_verification('))throw new Error('lost_response');return r;}};
 const a=compose(sim,database),c=await a.start({phone:nextPhone()});await fails(verify(a,c.challengeId),'financial_auth_unavailable');
 await fails(verify(compose(sim),c.challengeId),'challenge_expired');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])),1);
});
test('DB failure denies start/session/intent without fallback or raw route errors',async()=>{
 const database={query(){throw new Error('secret_phone_or_db_detail');}},a=compose(simulator(),database);
 const app=Fastify({logger:false});await app.register(isolatedFundingRoutes,{prefix:'/api/funding',service:a});
 try{const r=await app.inject({method:'POST',url:'/api/funding/otp/start',payload:{phone:nextPhone()}});assert.equal(r.statusCode,503);assert.deepEqual(r.json(),{error:'financial_auth_unavailable'});
 await fails(a.limits(randomUUID()),'financial_auth_unavailable');await fails(a.intent(randomUUID(),{kind:'general',amountCents:1}),'financial_auth_unavailable');
 }finally{await app.close();}
});
test('private auth has no raw phone/OTP/bearer and client roles cannot access it or change policy',async()=>{
 const phone=nextPhone(),a=compose(),c=await a.start({phone}),s=await verify(a,c.challengeId);
 const dump=JSON.stringify((await q(`SELECT row_to_json(c) AS c,row_to_json(s) AS s FROM funding_auth_private.otp_challenges c JOIN funding_auth_private.verified_sessions s ON s.challenge_id=c.id WHERE c.id=$1`,[c.challengeId])).rows);
 for(const value of [phone,'123456',s.session])assert.ok(!dump.includes(value));
 await assert.rejects(q('UPDATE funding_auth_private.test_policy SET max_starts=100'),/permission denied/);
 for(const role of ['anon','authenticated'])await admin(async()=>{await db.exec('SET ROLE '+role);await assert.rejects(q('SELECT * FROM funding_auth_private.verified_sessions'),/permission denied/);await assert.rejects(q('SELECT funding_auth_private.cleanup_expired()'),/permission denied/);await db.exec('RESET ROLE');});
 assert.equal(Number(await scalar(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='funding_auth_private' AND p.prosecdef`)),0);
});
test('controlled expiry cleanup preserves live session and all financial quotas/ledger',async()=>{
 await admin(()=>db.exec("INSERT INTO funding_auth_private.retention_policy VALUES('session',1,true,0),('challenge',1,true,0),('rate',1,true,0)"));
 const cleanup=()=>admin(async()=>{await db.exec('SET ROLE funding_cleanup');await q('SELECT funding_auth_private.cleanup_expired()');await db.exec('RESET ROLE');});
 const a=compose(),c=await a.start({phone:nextPhone()}),s=await verify(a,c.challengeId);
 const intent=await a.intent(s.session,{kind:'general',amountCents:800});
 await a.webhook({eventRef:'cleanup-ledger-seed',intentId:intent.intentId,amountCents:800,currency:'EUR'},'w'.repeat(32));
 const before=JSON.stringify((await q('SELECT * FROM funding_private.annual_limits')).rows);
 const ledgerBefore=Number(await scalar('SELECT count(*) FROM funding_private.ledger_transactions'));
 const balanceBefore=await scalar("SELECT balance FROM funding_private.accounts WHERE id='general'");
 await admin(()=>q(`UPDATE funding_auth_private.otp_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[c.challengeId]));
 await cleanup();assert.equal((await a.limits(s.session)).annualRemainingCents,99200);
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_private.ledger_transactions')),ledgerBefore);
 assert.equal(await scalar("SELECT balance FROM funding_private.accounts WHERE id='general'"),balanceBefore);
 assert.equal(JSON.stringify((await q('SELECT * FROM funding_private.annual_limits')).rows),before);
 await admin(()=>q(`UPDATE funding_auth_private.verified_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE challenge_id=$1`,[c.challengeId]));
 await cleanup();assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.otp_challenges WHERE id=$1',[c.challengeId])),0);
});
test('bounded adapter timeout fails closed and late promise completion cannot issue a session',async()=>{
 let approve;const sim=simulator();sim.verifyOtp=()=>new Promise(resolve=>{approve=resolve;});
 const database={async query(sql,args){const r=await db.query(sql,args);if(sql.includes('claim_challenge(')&&r.rows[0].result?.claimed)r.rows[0].result.leaseMilliseconds=5;return r;}};
 const a=compose(sim,database),c=await a.start({phone:nextPhone()});
 await fails(verify(a,c.challengeId),'otp_verification_unavailable');approve(true);await new Promise(resolve=>setImmediate(resolve));
 await fails(verify(compose(sim),c.challengeId),'challenge_expired');
 assert.equal(Number(await scalar('SELECT count(*) FROM funding_auth_private.verified_sessions WHERE challenge_id=$1',[c.challengeId])),0);
});
test('bounded send timeout keeps capacity and leaves no usable challenge',async()=>{
 const sim=simulator();sim.startOtp=()=>new Promise(()=>{});
 let challengeId;const database={async query(sql,args){const r=await db.query(sql,args);if(sql.includes('start_challenge(')&&!r.rows[0].result?.error){r.rows[0].result.sendTimeoutMilliseconds=5;challengeId=args[0];}return r;}};
 const a=compose(sim,database),phone=nextPhone();await fails(a.start({phone}),'otp_send_unavailable');
 const latest=(await q('SELECT id,state FROM funding_auth_private.otp_challenges WHERE id=$1',[challengeId])).rows[0];
 assert.equal(latest.state,'failed');await fails(verify(a,latest.id),'challenge_expired');
});
