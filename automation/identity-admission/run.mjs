import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import pg from '../security-database/native/node_modules/pg/lib/index.js';
const {Client}=pg;
const c=new Client({host:'127.0.0.1',port:55451,user:'rehearsal',password:process.env.CENSUS_NATIVE_PASSWORD,database:'postgres'});
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const meta=JSON.parse(file('../security-database/metadata.json'));
const owners=JSON.parse(file('../security-database/owners-and-triggers.json'));
const original=owners.trigger_functions.find(x=>x.signature==='enforce_census_admission()').definition;
const proposal=file('../../docs/proposals/idv-01-02-admission.sql');
const rollback=file('../../docs/proposals/idv-01-02-admission-rollback.sql');
const ids={low:'11111111-1111-4111-8111-111111111111',high:'22222222-2222-4222-8222-222222222222',institution:'33333333-3333-4333-8333-333333333333',census:'44444444-4444-4444-8444-444444444444'};
const checks=[];
await c.connect();
const deny=async(sql,params,code)=>assert.rejects(()=>c.query(sql,params),e=>e.message===code);
try{
 assert.equal((await c.query('SHOW cluster_name')).rows[0].cluster_name,'voiceprotest-database-rehearsal');
 for(const table of ['protests','adhesions','groups','group_members']){
  const cols=meta.columns.filter(x=>x.table===table).map(x=>'"'+x.name+'" '+x.type);
  await c.query('CREATE TABLE public.'+table+'('+cols.join(',')+')');
 }
 await c.query('ALTER TABLE public.groups ADD COLUMN id uuid, ADD COLUMN protest_id uuid');
 await c.query('ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS group_id uuid, ADD COLUMN IF NOT EXISTS email_hash text, ADD COLUMN IF NOT EXISTS accredited_at timestamptz');
 await c.query('CREATE SCHEMA voiceprotest_private;CREATE TABLE voiceprotest_private.census_creator_proofs(protest_id uuid,key_hash text,founder_hash text,used_at timestamptz)');
 await c.query(original);
 await c.query(owners.triggers.find(x=>x.definition.includes('enforce_census_admission()')).definition);
 await c.query('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;REVOKE ALL ON FUNCTION public.enforce_census_admission() FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.enforce_census_admission() TO service_role;GRANT USAGE ON SCHEMA public,voiceprotest_private TO service_role;GRANT ALL ON ALL TABLES IN SCHEMA public,voiceprotest_private TO service_role;');
 const acl=()=>c.query("SELECT proacl::text,proowner FROM pg_proc WHERE oid='public.enforce_census_admission()'::regprocedure");const before=(await acl()).rows;
 for(const [name,id] of Object.entries(ids))await c.query('INSERT INTO protests(id,scope,risk_level,dominio_email,requiere_censo) VALUES($1,\'local\',$2,$3,$4)',[id,name==='high'?'high':'low',['institution','census'].includes(name)?'synthetic.invalid':null,name==='census']);
 // A legacy high-risk GPS row exists before the candidate, and is not rewritten.
 await c.query("INSERT INTO adhesions(id,protest_id,verification_method,identity_subject_hash,gps_confirmed,adhesion_osm_id,senales,ciudad) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,'phone_otp','legacy',true,9,'sim,gps','Legacy')",[ids.high]);
 await c.query(proposal);assert.deepEqual((await acl()).rows,before);checks.push('owner and execution ACL preserved; existing row untouched');
 await c.query('SET ROLE service_role');
 const insert=(id,method='phone_otp',gps=false)=>c.query('INSERT INTO adhesions(protest_id,verification_method,identity_subject_hash,gps_confirmed,senales) VALUES($1,$2,\'synthetic\',$3,$4)',[id,method,gps,gps?'sim,gps':'sim']);
 await deny('INSERT INTO adhesions(protest_id,verification_method) VALUES($1,\'phone_otp\')',[ids.institution],'VP_INSTITUTIONAL_VERIFICATION_REQUIRED');
 await insert(ids.institution,'institutional_email_otp');checks.push('non-census institutional rejects SMS; accepts institutional method');
 for(const method of ['qr','eid'])await assert.rejects(()=>insert(ids.institution,method),/VP_INSTITUTIONAL_VERIFICATION_REQUIRED/);
 await assert.rejects(()=>insert(ids.high,'phone_otp',true),/VP_GPS_NOT_ALLOWED/);await insert(ids.high);await insert(ids.low,'phone_otp',true);checks.push('high risk rejects GPS; low risk accepts GPS; high risk accepts no-GPS');
 await deny('UPDATE adhesions SET gps_confirmed=true WHERE protest_id=$1 AND gps_confirmed=false',[ids.high],'VP_GPS_NOT_ALLOWED');
 await deny('UPDATE adhesions SET senales=\'sim,gps\' WHERE protest_id=$1 AND gps_confirmed=false',[ids.high],'VP_GPS_NOT_ALLOWED');
 await c.query("UPDATE adhesions SET ciudad=NULL,identity_subject_hash=NULL,anonymized_at=now() WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");await deny('UPDATE adhesions SET gps_lat=43 WHERE protest_id=$1 AND gps_confirmed=false',[ids.high],'VP_GPS_NOT_ALLOWED');
 await deny('INSERT INTO adhesions(protest_id,verification_method,gps_lat) VALUES($1,\'phone_otp\',43)',[ids.high],'VP_GPS_NOT_ALLOWED');
 checks.push('GPS, raw coordinates and signal-only bypass rejected; legacy anonymisation still allowed');
 await assert.rejects(()=>insert(ids.census,'institutional_email_otp'),/CENSUS_MEMBERSHIP_REQUIRED/);
 await c.query("INSERT INTO groups(id,protest_id) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1);",[ids.census]);
 await c.query("INSERT INTO group_members(group_id,email_hash,accredited_at) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic',now())");
 await insert(ids.census,'institutional_email_otp');checks.push('census still rejects unaccredited addresses and accepts accredited members');
 await c.query('RESET ROLE');
 // Preserve the owner-approved founder proof bootstrap without creating groups.
 const founder='55555555-5555-4555-8555-555555555555';
 await c.query("INSERT INTO protests(id,scope,risk_level,dominio_email,requiere_censo) VALUES($1,'local','low','synthetic.invalid',true)",[founder]);
 await c.query("INSERT INTO voiceprotest_private.census_creator_proofs(protest_id,key_hash,founder_hash) VALUES($1,'synthetic-proof','synthetic')",[founder]);
 await c.query('BEGIN');await c.query("SELECT set_config('voiceprotest.creator_proof','synthetic-proof',true)");
 await insert(founder,'institutional_email_otp');await c.query('COMMIT');checks.push('authorised founder proof bootstrap remains accepted');
 await assert.rejects(()=>insert(ids.institution,'institutional_email_otp',true),/VP_GPS_NOT_ALLOWED/);
 await c.query("UPDATE protests SET risk_level='critical' WHERE id=$1",[ids.high]);await assert.rejects(()=>insert(ids.high,'phone_otp',true),/VP_GPS_NOT_ALLOWED/);checks.push('critical and institutional GPS rejected in SQL');
 // Two reinforcement transactions already holding SHARE on the same protest.
 const other=new Client(c.connectionParameters);await other.connect();
 try{
  const a='66666666-6666-4666-8666-666666666666',b='77777777-7777-4777-8777-777777777777';
  await c.query("INSERT INTO adhesions(id,protest_id,verification_method,gps_confirmed) VALUES($1,$3,'phone_otp',false),($2,$3,'phone_otp',false)",[a,b,ids.low]);
  for(const client of [c,other]){await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='300ms'");await client.query('SELECT id FROM protests WHERE id=$1 FOR SHARE',[ids.low]);}
  await c.query('UPDATE adhesions SET gps_confirmed=true WHERE id=$1',[a]);
  await other.query('UPDATE adhesions SET gps_confirmed=true WHERE id=$1',[b]);
  await c.query('COMMIT');await other.query('COMMIT');checks.push('parallel GPS transactions retain compatible SHARE locks without upgrade deadlock');
 }finally{await other.query('ROLLBACK');await other.end();}
 await c.query(rollback);assert.deepEqual((await acl()).rows,before);await c.query(proposal);checks.push('rollback and reapply preserve ACL and trigger contract');
 console.log(JSON.stringify({status:'PASS',server:(await c.query('SHOW server_version')).rows[0].server_version,checks},null,2));
}finally{await c.end();}
