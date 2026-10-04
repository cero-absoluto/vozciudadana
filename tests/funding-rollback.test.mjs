import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fundingParentFixtureSQL,fundingRlsMigration,fundingAuthMigration,fundingTemporalMigration} from './helpers/funding-fixture.mjs';
test('fault at payment insertion rolls back quota, ledger, accounts and provider acknowledgement',async()=>{
 const db=new PGlite();try{
 await db.exec(fundingParentFixtureSQL);
 await db.exec(await readFile(new URL('../supabase/migrations/20261003200832_funding_private_core.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(fundingRlsMigration,'utf8'));
 await db.exec(await readFile(fundingAuthMigration,'utf8'));
 await db.exec(await readFile(fundingTemporalMigration,'utf8'));
 const token='d'.repeat(64),id=(await db.query(`SELECT funding_private.reserve(2026,$1,NULL,NULL,800,clock_timestamp()+interval '10 minutes') AS id`,[token])).rows[0].id;
 await db.exec(`CREATE FUNCTION public.fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_failure';END $$;
 CREATE TRIGGER fail_payment BEFORE INSERT ON funding_private.payments FOR EACH ROW EXECUTE FUNCTION public.fail_payment();`);
 await assert.rejects(db.query(`SELECT funding_private.confirm('fault',$1,800,'EUR')`,[id]),/injected_failure/);
 assert.equal((await db.query('SELECT reserved,committed FROM funding_private.annual_limits')).rows[0].reserved,800);
 assert.equal((await db.query('SELECT committed FROM funding_private.annual_limits')).rows[0].committed,0);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM funding_private.ledger_transactions')).rows[0].n),0);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM funding_private.provider_events')).rows[0].n),0);
 assert.equal((await db.query(`SELECT balance FROM funding_private.accounts WHERE id='general'`)).rows[0].balance,0);
 await db.exec('DROP TRIGGER fail_payment ON funding_private.payments');
 assert.equal((await db.query(`SELECT funding_private.confirm('fault',$1,800,'EUR') AS result`,[id])).rows[0].result,'confirmed');
 }finally{await db.close();}
});
test('injected faults at every financial write stage leave the confirmation unapplied',async()=>{
 const db=new PGlite();try{
 await db.exec(fundingParentFixtureSQL);
 await db.exec(await readFile(new URL('../supabase/migrations/20261003200832_funding_private_core.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(fundingRlsMigration,'utf8'));
 await db.exec(await readFile(fundingAuthMigration,'utf8'));
 await db.exec(await readFile(fundingTemporalMigration,'utf8'));
 const ev='30000000-0000-0000-0000-000000000001',token='e'.repeat(64);
 await db.query(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,now()-interval '1 day',now()+interval '1 day',0,'fixture')`,[ev]);
 await db.query(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)`,['event:'+ev,ev]);
 await db.exec(`CREATE FUNCTION public.fail_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_stage';END $$;`);
 for(const [table,operation] of [['annual_limits','UPDATE'],['event_limits','UPDATE'],['ledger_transactions','INSERT'],['ledger_entries','INSERT'],['accounts','UPDATE'],['payments','INSERT'],['intents','UPDATE'],['provider_events','INSERT']]){
  const id=(await db.query(`SELECT funding_private.reserve(2026,$1,$1,$2,800,clock_timestamp()+interval '10 minutes') AS id`,[token,ev])).rows[0].id;
  const before=(await db.query('SELECT reserved,committed FROM funding_private.annual_limits')).rows[0];
  await db.exec(`CREATE TRIGGER fail_stage BEFORE ${operation} ON funding_private.${table} FOR EACH ROW EXECUTE FUNCTION public.fail_stage()`);
  await assert.rejects(db.query(`SELECT funding_private.confirm($1,$2,800,'EUR')`,[table,id]),/injected_stage/);
  assert.deepEqual((await db.query('SELECT reserved,committed FROM funding_private.annual_limits')).rows[0],before);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM funding_private.ledger_transactions')).rows[0].n),0);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM funding_private.provider_events')).rows[0].n),0);
  assert.equal((await db.query('SELECT state FROM funding_private.intents WHERE id=$1',[id])).rows[0].state,'reserved');
  await db.exec(`DROP TRIGGER fail_stage ON funding_private.${table}`);
 }
 }finally{await db.close();}
});
