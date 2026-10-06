import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
const url=process.env.I4_INSTALLATION_PG_URL;
async function database(){
 if(!url)return new PGlite();
 const u=new URL(url);assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.pathname==='/i4_installation');assert.notEqual(process.env.NODE_ENV,'production');
 const c=new pg.Client({connectionString:url});await c.connect();const v=Number((await c.query('SHOW server_version_num')).rows[0].server_version_num);assert.ok(v>=170000&&v<180000);console.log('I4_INSTALLATION_NATIVE_PG='+v);
 return {exec:sql=>c.query(sql),query:sql=>c.query(sql),close:()=>c.end()};
}
const install=await readFile(new URL('../apps/api/src/funding/installation/inert-foundation.sql',import.meta.url),'utf8');
const rollback=await readFile(new URL('../apps/api/src/funding/installation/rollback-empty-foundation.sql',import.meta.url),'utf8');
test('inert installation preserves parent and denies all existing application actors',async()=>{
 const db=await database();try{
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE public.protests(id uuid PRIMARY KEY,saldo_euros numeric,hash_integridad text);INSERT INTO public.protests VALUES('00000000-0000-0000-0000-000000000001',0.90,'final');");
 const before=(await db.query('SELECT * FROM public.protests')).rows;
 await db.exec(install);
 assert.deepEqual((await db.query('SELECT * FROM public.protests')).rows,before);
 assert.equal((await db.query('SELECT activation_allowed FROM funding_installation_private.manifest')).rows[0].activation_allowed,false);
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT * FROM funding_lookup_private.references'),/permission denied/);await db.exec('RESET ROLE');}
 await assert.rejects(db.exec(install),/installation_namespace_collision/);await db.exec('ROLLBACK');
 await db.exec(rollback);
 assert.deepEqual((await db.query('SELECT * FROM public.protests')).rows,before);
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname LIKE 'funding%'")).rows[0].n,0);
 }finally{if(url)await db.exec('DROP TABLE public.protests; DROP ROLE anon; DROP ROLE authenticated; DROP ROLE service_role;');await db.close();}
});
test('rollback refuses retained technical evidence',async()=>{const db=await database();try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE public.protests(id uuid PRIMARY KEY);');await db.exec(install);
 await db.exec("INSERT INTO funding_lookup_private.references(operation_id,iv,tag,ciphertext) VALUES('00000000-0000-0000-0000-000000000001',repeat('a',24),repeat('a',32),repeat('a',68))");
 await assert.rejects(db.exec(rollback),/nonempty_or_unknown_installation_stop/);await db.exec('ROLLBACK');assert.equal((await db.query('SELECT count(*)::int n FROM funding_lookup_private.references')).rows[0].n,1);
 }finally{if(url){await db.exec('TRUNCATE funding_lookup_private.references');await db.exec(rollback);await db.exec('DROP TABLE public.protests;DROP ROLE anon;DROP ROLE authenticated;DROP ROLE service_role;');}await db.close();}});
