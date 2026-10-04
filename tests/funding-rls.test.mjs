import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fundingParentFixtureSQL,fundingCoreMigration,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration,fundingCostsMigration,fundingReviewMigration,fundingProviderMigration,fundingContinuityMigration,fundingRetentionMigration} from './helpers/funding-fixture.mjs';
const db=new PGlite();after(()=>db.close());
await db.exec(fundingParentFixtureSQL);
await db.exec(await readFile(fundingCoreMigration,'utf8'));
const e='50000000-0000-0000-0000-000000000001',token='f'.repeat(64);
await db.query(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',9,'historic-fixture')`,[e]);
await db.query(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+e,e]);
const q=(sql,args=[])=>db.query(sql,args);
const scalar=async(sql,args)=>Object.values((await q(sql,args)).rows[0])[0];
async function asRole(role,fn){await db.exec('SET ROLE '+role);try{return await fn();}finally{await db.exec('RESET ROLE');}}
const reserve=()=>scalar(`SELECT funding_private.reserve(2026,$1,$1,$2,1000,clock_timestamp()+interval '10 minutes')`,[token,e]);

test('original funding role cannot lock enabled parent with observed production RLS',async()=>{
 await asRole('funding_runtime',async()=>{await assert.rejects(reserve(),/event_not_open/);});
 assert.equal(await scalar('SELECT count(*) FROM funding_private.intents'),0);
});
test('compatibility permits financial lifecycle while parent values and legacy trigger counters remain unchanged',async()=>{
 await db.exec(await readFile(fundingRlsMigration,'utf8'));
 await db.exec(await readFile(fundingAuthMigration,'utf8'));
 await db.exec(await readFile(fundingTemporalMigration,'utf8'));
 await db.exec(await readFile(fundingCostsMigration,'utf8'));
 await db.exec(await readFile(fundingReviewMigration,'utf8'));
 await db.exec(await readFile(fundingProviderMigration,'utf8'));
 await db.exec(await readFile(fundingContinuityMigration,'utf8'));
 await db.exec(await readFile(fundingRetentionMigration,'utf8'));
 const cost=await asRole('funding_runtime',async()=>{
  const id=await reserve();assert.equal(await scalar(`SELECT funding_private.confirm('rls-payment',$1,1000,'EUR')`,[id]),'confirmed');
  return scalar(`SELECT funding_private.reserve_cost($1,300,'rls-cost')`,[e]);
 });
 await q(`UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[e]);
 const before=(await q('SELECT * FROM public.protests WHERE id=$1',[e])).rows[0];
 const calls=(await q('SELECT * FROM public.fixture_parent_trigger_calls')).rows[0];
 await asRole('funding_runtime',async()=>{
  await q('SELECT funding_private.finish_cost($1,true)',[cost]);await q('SELECT funding_private.close_event($1)',[e]);
  assert.equal(await scalar('SELECT funding_private.settle($1)',[e]),700);
  assert.equal(await scalar('SELECT funding_private.settle($1)',[e]),700);
 });
 assert.deepEqual((await q('SELECT * FROM public.protests WHERE id=$1',[e])).rows[0],before);
 assert.deepEqual((await q('SELECT * FROM public.fixture_parent_trigger_calls')).rows[0],calls);
});
test('financial role cannot mutate parent fields or remove guard even with lock privilege',async()=>{
 const before=(await q('SELECT * FROM public.protests WHERE id=$1',[e])).rows[0];
 await asRole('funding_runtime',async()=>{
  for(const set of ['id=id','starts_at=starts_at','ends_at=ends_at','count=count+1',"title='changed'","hash_integridad='changed'",'saldo_euros=0','ultima_donacion=clock_timestamp()'])
   await assert.rejects(q('UPDATE public.protests SET '+set+' WHERE id=$1',[e]),/permission denied|funding_parent_readonly/);
  await assert.rejects(q('UPDATE public.protests SET ultima_donacion=NULL WHERE false'),/funding_parent_readonly/);
  await assert.rejects(q('DELETE FROM public.protests WHERE id=$1',[e]),/permission denied/);
  await assert.rejects(q(`INSERT INTO public.protests(id,starts_at,ends_at) VALUES(gen_random_uuid(),now(),now())`),/permission denied/);
  await assert.rejects(q('ALTER TABLE public.protests DISABLE TRIGGER funding_parent_readonly'),/must be owner|permission denied/);
 });
 assert.deepEqual((await q('SELECT * FROM public.protests WHERE id=$1',[e])).rows[0],before);
});
test('inherited financial actors are guarded and have no bypass or service role membership',async()=>{
 await db.exec('CREATE ROLE funding_inherited_actor NOLOGIN INHERIT IN ROLE funding_runtime');
 await asRole('funding_inherited_actor',async()=>{
  assert.equal((await q('SELECT id FROM public.protests WHERE id=$1 FOR UPDATE',[e])).rows[0].id,e);
  await assert.rejects(q('UPDATE public.protests SET ultima_donacion=NULL WHERE id=$1',[e]),/funding_parent_readonly/);
  assert.equal(await scalar(`SELECT pg_has_role(current_user,'service_role','MEMBER')`),false);
  assert.equal(await scalar(`SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user`),false);
 });
});
test('client roles remain denied private finance after compatibility policy',async()=>{
 for(const role of ['anon','authenticated'])await asRole(role,async()=>{
  await assert.rejects(q('SELECT * FROM funding_private.intents'),/permission denied/);
  assert.equal(await scalar(`SELECT has_column_privilege(current_user,'public.protests','ultima_donacion','UPDATE')`),true);
  // Existing broad public grants do not imply an RLS-authorized write.
  const r=await q('UPDATE public.protests SET ultima_donacion=NULL WHERE id=$1 RETURNING id',[e]);assert.equal(r.rows.length,0);
 });
});

