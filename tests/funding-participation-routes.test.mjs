import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/funding-fixture.mjs';
import * as s from './helpers/funding-sms-closure-fixture.mjs';
import * as x from './helpers/funding-exact-cost-fixture.mjs';
import * as i from './helpers/funding-sms-integration-fixture.mjs';
import {createParticipationRouteRehearsal} from '../apps/api/src/funding/participationRouteRehearsal.js';
import {createPrivateLookupVault} from '../apps/api/src/funding/privateLookupVault.js';
import {createDurableRouteStore} from '../apps/api/src/funding/durableRouteStore.js';
process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-only';
process.env.PHONE_HASH_SECRET='synthetic-phone-only';process.env.NULLIFIER_SECRET='synthetic-nullifier-only';
process.env.PARTICIPATION_TOKEN_SECRET='synthetic-token-only';process.env.RECAPTCHA_SECRET='synthetic-captcha-only';
const {default:users}=await import('../apps/api/src/routes/users.js');
const {default:protests}=await import('../apps/api/src/routes/protests.js');
const {default:webhooks}=await import('../apps/api/src/routes/webhooks.js');
const {createVerifiedAdhesion}=await import('../apps/api/src/lib/adhesionService.js');
const savedFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 if(String(url).startsWith('https://www.google.com/recaptcha/api/siteverify?')){
  const bad=String(url).includes('response=bad');return {json:async()=>({success:!bad,action:new URL(url).searchParams.get('response')==='join'?'join_protest':'request_otp',hostname:'voiceprotest.org',score:0.9})};
 }
 if(String(url).startsWith('https://ipapi.co/'))return {json:async()=>({})};
 throw Error('external_network_blocked');
};
const db=new PGlite();after(async()=>{globalThis.fetch=savedFetch;await db.close();});
await db.exec(f.fundingParentFixtureSQL);
for(const m of ['fundingCoreMigration','fundingRlsMigration','fundingAuthMigration','fundingTemporalMigration','fundingCostsMigration','fundingReviewMigration','fundingProviderMigration','fundingContinuityMigration','fundingRetentionMigration','fundingLifecycleMigration','fundingLifecycleReplayMigration'])await db.exec(await readFile(f[m],'utf8'));
for(const path of ['20261004183459_funding_owner_authority_contract.sql','20261004201818_funding_legacy_receipt_journal.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+path,import.meta.url),'utf8'));
for(const path of [s.smsClosureMigration,x.exactCostMigration,i.integrationMigration])await db.exec(await readFile(path,'utf8'));
await db.exec(await readFile(new URL('../apps/api/src/funding/sql/durable-route-candidate.sql',import.meta.url),'utf8'));
await db.exec(`ALTER TABLE public.protests ADD status text DEFAULT 'active',ADD scope text DEFAULT 'global',ADD country text,ADD convocatoria_osm_id bigint,ADD convocatoria_ciudad_nombre text,ADD dominio_email text;
CREATE TABLE public.devices(id text PRIMARY KEY,last_seen timestamptz);
CREATE TABLE public.institutional_members(email_hash text,protest_id uuid,expires_at timestamptz,CONSTRAINT institutional_member_unique UNIQUE(email_hash,protest_id));
CREATE TABLE public.adhesions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),protest_id uuid,device_id text,phone_hash text,identity_subject_hash text,verification_method text,doc_hash text,ciudad text,region text,pais text,pais_code text,idioma text,nullifier text,created_at timestamptz,fiabilidad int,senales text,gps_confirmed boolean,adhesion_osm_id bigint,CONSTRAINT adhesions_active_nullifier_unique UNIQUE(nullifier),CONSTRAINT adhesions_active_device_unique UNIQUE(protest_id,device_id));
CREATE FUNCTION public.update_cities_count(uuid) RETURNS void LANGUAGE sql AS $$SELECT;$$;
CREATE TABLE public.financial_movements(id uuid DEFAULT gen_random_uuid(),protest_id uuid,amount numeric,type text);
CREATE TABLE public.donaciones(id uuid DEFAULT gen_random_uuid(),protest_id uuid,importe numeric);
GRANT SELECT,UPDATE ON public.fixture_parent_trigger_calls TO service_role;
GRANT ALL ON public.adhesions,public.devices,public.institutional_members,public.financial_movements,public.donaciones TO service_role;`);
const realSQL=await readFile(new URL('../supabase/migrations/20260723_adhesion_service_rpc.sql',import.meta.url),'utf8');
await db.exec(realSQL.slice(realSQL.indexOf('CREATE OR REPLACE FUNCTION create_verified_adhesion('),realSQL.indexOf('COMMENT ON FUNCTION create_verified_adhesion')));
await db.exec(await readFile(new URL('../supabase/migrations/20261005114925_funding_participation_scope_rehearsal.sql',import.meta.url),'utf8'));
let tail=Promise.resolve();
function database(role){return {async connect(){let release;const before=tail;tail=new Promise(r=>release=r);await before;await db.exec('SET ROLE '+role);return {query:(...a)=>db.query(...a),release(){db.exec('RESET ROLE').finally(release);}};}};}
const databases={bridgeDatabase:database('funding_sms_bridge'),executorDatabase:database('funding_sms_executor'),evidenceDatabase:database('funding_sms_evidence_ingest'),ingestDatabase:database('funding_exact_cost_ingest'),calculatorDatabase:database('funding_exact_cost_calculator')};
async function q(sql,args=[]){await tail;return db.query(sql,args);}
function client(){const records={devices:[],otp_requests:[]};let denied=false;return {records,setDenied:v=>denied=v,
 async rpc(name,args){if(name==='get_otp_cooldown')return {data:0};if(name==='check_otp_rate_limit')return {data:{allowed:!denied}};if(name==='create_verified_adhesion'){try{await tail;await db.exec('SET ROLE service_role');const values=Object.values(args),params=values.map((_,n)=>'$'+(n+1)).join(',');return {data:(await db.query('SELECT public.create_verified_adhesion('+params+') result',values)).rows[0].result};}catch(error){return {error};}finally{await db.exec('RESET ROLE');}}throw Error('unsupported_fixture_rpc');},
 from(table){let filters=[],op='select',payload;const b={select(){return b;},eq(k,v){filters.push([k,v]);return b;},is(){return b;},insert(v){op='insert';payload=v;return b;},upsert(v){op='upsert';payload=v;return b;},update(v){op='update';payload=v;return b;},maybeSingle(){return execute(true);},single(){return execute(true);},then(a,z){return execute(false).then(a,z);}};
 async function execute(single){if(table==='protests'){const rows=(await q('SELECT * FROM public.protests WHERE id=$1',[filters.find(x=>x[0]==='id')?.[1]])).rows;return {data:single?rows[0]??null:rows};}if(table==='adhesions')return {data:null};const rows=records[table]??(records[table]=[]);if(op==='insert'||op==='upsert'){rows.push(payload);return {data:single?payload:[payload]};}const found=rows.filter(row=>filters.every(([k,v])=>row[k]===v));if(op==='update')for(const row of found)Object.assign(row,payload);return {data:single?found[0]??null:found};}return b;}
 };}
async function setup(balance=100,legacyZero=false){const event=await s.seedSmsEvent({query:q},balance);if(legacyZero)await q("UPDATE public.protests SET saldo_euros=0 WHERE id=$1",[event]);await q('INSERT INTO funding_participation_private.scopes VALUES($1)',[event]);const lookupVault=createPrivateLookupVault({mode:'isolated',database:database('funding_lookup_runtime'),key:Buffer.alloc(32,7)});const built=i.buildIntegration(databases,{lookupVault}),c=client();const rehearsal=createParticipationRouteRehearsal({candidate:built.candidate,database:c,boundCents:20,secret:'route-only-secret-'.repeat(4),store:createDurableRouteStore({mode:'isolated',database:database('funding_route_runtime')}),scope:async id=>(await q('SELECT funding_participation_private.is_scoped($1) yes',[id])).rows[0].yes});const app=Fastify();await app.register(sensible);await app.register(users,{prefix:'/api/users',rehearsal});await app.register(protests,{prefix:'/api/protests',rehearsal});await app.register(webhooks,{prefix:'/api/webhooks',rehearsal});await app.ready();return {event,built,c,app,rehearsal,lookupVault,input:{phone:'+15005550006',device_id:'synthetic-device',protest_id:event,request_key:randomUUID(),recaptcha_token:'good'}};}
test('actual request route retains captcha and rate-limit gates before any exposure/send',async()=>{const h=await setup();try{let r=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:{...h.input,recaptcha_token:'bad'}});assert.equal(r.statusCode,400);h.c.setDenied(true);r=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:h.input});assert.equal(r.statusCode,429);assert.deepEqual(h.built.adapter.counts(),{});assert.equal((await q('SELECT count(*) n FROM funding_sms_bridge_private.bindings')).rows[0].n,0);}finally{await h.app.close();}});
test('actual request/verify/join routes bind operation, sign real token, check device, and never charge adhesion',async()=>{const h=await setup();try{const r=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:h.input});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().sent,true);const op=r.json().operation_id;const verify={phone:h.input.phone,otp:'000000',device_id:h.input.device_id,protest_id:h.event,operation_id:op,country_code:'ES'};const bad=await h.app.inject({method:'POST',url:'/api/users/verify-otp',payload:{...verify,operation_id:randomUUID()}});assert.equal(bad.statusCode,401);const v=await h.app.inject({method:'POST',url:'/api/users/verify-otp',payload:verify});assert.equal(v.statusCode,200,v.body);const before=(await q('SELECT saldo_euros,hash_integridad FROM public.protests WHERE id=$1',[h.event])).rows;let join=await h.app.inject({method:'POST',url:'/api/protests/'+h.event+'/join',payload:{participation_token:'forged',recaptcha_token:'join',sms_sent:true}});assert.equal(join.statusCode,401);join=await h.app.inject({method:'POST',url:'/api/protests/'+h.event+'/join',payload:{participation_token:v.json().participation_token,recaptcha_token:'join',sms_sent:true}});assert.equal(join.statusCode,201,join.body);assert.deepEqual((await q('SELECT saldo_euros,hash_integridad FROM public.protests WHERE id=$1',[h.event])).rows,before);assert.equal((await q('SELECT count(*) n FROM public.financial_movements')).rows[0].n,0);assert.equal((await q('SELECT count(*) n FROM public.adhesions')).rows[0].n,1);const duplicate=await h.app.inject({method:'POST',url:'/api/protests/'+h.event+'/join',payload:{participation_token:v.json().participation_token,recaptcha_token:'join',sms_sent:false}});assert.equal(duplicate.statusCode,409,duplicate.body);h.c.records.devices[0].verified_at=null;const revoked=await h.app.inject({method:'POST',url:'/api/protests/'+h.event+'/join',payload:{participation_token:v.json().participation_token,recaptcha_token:'join'}});assert.equal(revoked.statusCode,401);}finally{await h.app.close();}});
test('no budget or event purpose prevents simulated dispatch',async()=>{const h=await setup(0);try{const r=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:h.input});assert.equal(r.statusCode>=400,true,r.body);assert.deepEqual(h.built.adapter.counts(),{});const generic=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:{phone:h.input.phone,recaptcha_token:'good'}});assert.equal(generic.statusCode,400);}finally{await h.app.close();}});
test('real SQL admission preserves institutional channel, closure and uniqueness; fences legacy financial writes',async()=>{const h=await setup(0,true);try{await q('UPDATE public.protests SET saldo_euros=saldo_euros WHERE id=$1',[h.event]);await assert.rejects(q('UPDATE public.protests SET saldo_euros=1 WHERE id=$1',[h.event]),/legacy_financial_writer_fenced/);await assert.rejects(q("UPDATE public.protests SET status='closed' WHERE id=$1",[h.event]),/legacy_financial_writer_fenced/);await assert.rejects(q("INSERT INTO public.financial_movements(protest_id,amount) VALUES($1,1)",[h.event]),/legacy_financial_writer_fenced/);await assert.rejects(q('DELETE FROM funding_participation_private.scopes WHERE event_id=$1',[h.event]),/scope_append_only/);const input={protestId:h.event,identity:{subjectHash:'institutional-only',method:'institutional_email_otp',deviceId:null,institutionalDomain:'example.org'},location:{},institutionalMembership:{emailHash:'email-only',expiresAt:new Date(Date.now()+60000).toISOString()}};const r=await createVerifiedAdhesion(input,{mode:'isolated',database:h.c});assert.ok(r.id);await assert.rejects(createVerifiedAdhesion(input,{mode:'isolated',database:h.c}));await q("UPDATE public.protests SET ends_at=now()-interval '1 second' WHERE id=$1",[h.event]);await assert.rejects(createVerifiedAdhesion({...input,identity:{...input.identity,subjectHash:'other'},institutionalMembership:null},{mode:'isolated',database:h.c}),e=>e.code==='PROTEST_CLOSED'||/closed/i.test(e.message));}finally{await h.app.close();}});
test('isolated route hooks cannot be forged or enabled in production',async()=>{const app=Fastify();await assert.rejects(app.register(users,{rehearsal:{database:{}}}).ready(),/isolated_route_rehearsal_required/);await app.close();const old=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>createParticipationRouteRehearsal({}),/isolated_route_rehearsal_required/);}finally{process.env.NODE_ENV=old;}});

test('same request replay cannot resend and another unresolved attempt cannot reserve again',async()=>{const h=await setup();try{const first=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:h.input});assert.equal(first.json().sent,true);const replay=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:h.input});assert.equal(replay.json().sent,false);const count=(await q('SELECT count(*) n FROM funding_sms_bridge_private.bindings')).rows[0].n;const other=await h.app.inject({method:'POST',url:'/api/users/request-otp',payload:{...h.input,request_key:randomUUID()}});assert.equal(other.statusCode,503);assert.equal((await q('SELECT count(*) n FROM funding_sms_bridge_private.bindings')).rows[0].n,count);assert.equal(Object.values(h.built.adapter.counts()).reduce((a,b)=>a+b,0),1);}finally{await h.app.close();}});
test('actual manual donation and Ko-fi route reject migrated scope before financial writes',async()=>{const h=await setup();const saved=process.env.KOFI_DEFAULT_PROTEST_ID;process.env.KOFI_DEFAULT_PROTEST_ID=h.event;process.env.KOFI_VERIFICATION_TOKEN='synthetic-kofi-only';try{const manual=await h.app.inject({method:'POST',url:'/api/protests/'+h.event+'/donar',payload:{importe:1,admin_secret:'synthetic'}});assert.equal(manual.statusCode,409);const webhook=await h.app.inject({method:'POST',url:'/api/webhooks/kofi',payload:{data:JSON.stringify({verification_token:'synthetic-kofi-only',amount:'1',currency:'EUR',kofi_transaction_id:'synthetic-only'})}});assert.equal(webhook.statusCode,409,webhook.body);assert.equal((await q('SELECT count(*) n FROM public.financial_movements')).rows[0].n,0);}finally{process.env.KOFI_DEFAULT_PROTEST_ID=saved;await h.app.close();}});

test('existing service admission still checks national country and institutional domain',async()=>{const h=await setup();try{await q("UPDATE public.protests SET scope='national',country='ES',dominio_email='allowed.example' WHERE id=$1",[h.event]);const input={protestId:h.event,identity:{subjectHash:'denied',method:'phone_otp',countryCode:'FR'},location:{}};await assert.rejects(createVerifiedAdhesion(input,{mode:'isolated',database:h.c}),e=>e.code==='NATIONAL_ONLY');await assert.rejects(createVerifiedAdhesion({...input,identity:{subjectHash:'institution-denied',method:'institutional_email_otp',institutionalDomain:'other.example'}},{mode:'isolated',database:h.c}),e=>e.code==='INSTITUTIONAL_DOMAIN_MISMATCH');}finally{await h.app.close();}});


test('recomposed routes and provider retain binding and encrypted lookup without another send',async()=>{
 const h=await setup();try{
  const sent=await h.rehearsal.sendOtp(h.input.phone,h.input),id=sent.operation_id;
  const vault=createPrivateLookupVault({mode:'isolated',database:database('funding_lookup_runtime'),key:Buffer.alloc(32,7)});
  const next=i.buildIntegration(databases,{lookupVault:vault});
  const route=createParticipationRouteRehearsal({candidate:next.candidate,database:h.c,boundCents:20,secret:'route-only-secret-'.repeat(4),store:createDurableRouteStore({mode:'isolated',database:database('funding_route_runtime')}),scope:async e=>e===h.event});
  assert.equal(await route.verifyOtp(h.input.phone,'000000',{...h.input,operation_id:id}),true);
  assert.equal((await route.sendOtp(h.input.phone,h.input)).sent,false);
  assert.equal(Object.keys(next.adapter.counts()).some(k=>k.endsWith('/Verifications')),false);
  const rows=(await q('SELECT * FROM funding_lookup_private.references WHERE operation_id=$1',[id])).rows;
  assert.equal(JSON.stringify(rows).includes(i.providerSid('VE',id)),false);
  assert.equal(JSON.stringify((await q('SELECT * FROM funding_route_private.bindings')).rows).includes(h.input.phone),false);
  await next.candidate.collect(id);assert.equal((await next.candidate.inspect(id)).settlementBlocked,true);
 }finally{await h.app.close();}
});
test('lost preparation or lost binding ACK cannot cause another reservation or send',async()=>{
 const h=await setup();try{
  await db.exec("CREATE FUNCTION public.route_bind_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_bind_fault';END$$;CREATE TRIGGER route_bind_fault BEFORE UPDATE ON funding_route_private.bindings FOR EACH ROW EXECUTE FUNCTION public.route_bind_fault()");
  try{await assert.rejects(h.rehearsal.sendOtp(h.input.phone,h.input),/durable_route_store_unavailable/);}finally{await q('DROP TRIGGER route_bind_fault ON funding_route_private.bindings');}
  const before=(await q('SELECT count(*) n FROM funding_sms_fixture_private.operations')).rows[0].n;
  await assert.rejects(h.rehearsal.sendOtp(h.input.phone,h.input),/unresolved_attempt_requires_review/);
  assert.equal((await q('SELECT count(*) n FROM funding_sms_fixture_private.operations')).rows[0].n,before);
  assert.deepEqual(h.built.adapter.counts(),{});
 }finally{await h.app.close();}
});
test('expired lookup and wrong encryption key fail closed without extending retention',async()=>{
 const h=await setup();try{
  const id=(await h.rehearsal.sendOtp(h.input.phone,h.input)).operation_id;
  const wrong=createPrivateLookupVault({mode:'isolated',database:database('funding_lookup_runtime'),key:Buffer.alloc(32,8)});
  await assert.rejects(wrong.get(id),/private_lookup_unavailable/);
  await q("UPDATE funding_lookup_private.references SET created_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE operation_id=$1",[id]);
  await assert.rejects(h.lookupVault.get(id),/private_lookup_unavailable/);
  await q('SELECT funding_lookup_private.purge_expired()');
  assert.equal((await q('SELECT count(*) n FROM funding_lookup_private.references WHERE operation_id=$1',[id])).rows[0].n,0);
 }finally{await h.app.close();}
});
test('route and lookup actors cannot acquire each other, finance, parent mutation or raw identifiers',async()=>{
 const h=await setup();try{
  for(const [role,sql] of [['funding_route_runtime','UPDATE public.protests SET id=id'],['funding_route_runtime','SELECT * FROM funding_lookup_private.references'],['funding_lookup_runtime','SELECT * FROM funding_route_private.bindings'],['funding_lookup_runtime','SELECT * FROM funding_private.annual_limits'],['funding_lookup_runtime','SELECT funding_lookup_private.purge_expired()']]){
   await tail;await db.exec('SET ROLE '+role);try{await assert.rejects(db.exec(sql));}finally{await db.exec('RESET ROLE');}
  }
 }finally{await h.app.close();}
});


test('participation cutoff preserves legacy status, ledger and final hash; pending costs cannot settle',async()=>{
 const h=await setup();try{
  await h.rehearsal.sendOtp(h.input.phone,h.input);
  const before=(await q('SELECT status,saldo_euros,hash_integridad FROM public.protests WHERE id=$1',[h.event])).rows;
  await assert.rejects(h.rehearsal.closeParticipation(h.event));
  await q("UPDATE public.protests SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[h.event]);
  assert.deepEqual(await h.rehearsal.closeParticipation(h.event),{closed:true,settled:false,fundsMoved:false});
  assert.deepEqual((await q('SELECT status,saldo_euros,hash_integridad FROM public.protests WHERE id=$1',[h.event])).rows,before);
  await assert.rejects(h.rehearsal.sendOtp(h.input.phone,h.input));
  await assert.rejects(h.built.candidate.close(h.event,true),/integration_settlement_blocked/);
 }finally{await h.app.close();}
});
test('disposable backup restores committed route bindings, roles and encrypted references',async()=>{
 const h=await setup();let restored;try{
  const id=(await h.rehearsal.sendOtp(h.input.phone,h.input)).operation_id;await tail;
  const backup=await db.dumpDataDir();restored=new PGlite({loadDataDir:backup});
  assert.equal((await restored.query('SELECT operation_id FROM funding_route_private.bindings WHERE event_id=$1',[h.event])).rows[0].operation_id,id);
  assert.equal((await restored.query('SELECT count(*) n FROM funding_lookup_private.references WHERE operation_id=$1',[id])).rows[0].n,1);
  await restored.exec('SET ROLE funding_route_runtime');await assert.rejects(restored.exec('SELECT * FROM funding_lookup_private.references'));await restored.exec('RESET ROLE');
  assert.equal((await restored.query('SELECT hash_integridad FROM public.protests WHERE id=$1',[h.event])).rows[0].hash_integridad,'synthetic_final_v2');
 }finally{await restored?.close();await h.app.close();}
});


test('retention-only actor purges expired lookups but cannot read ciphertext or remove live references',async()=>{
 const h=await setup();try{
  const id=(await h.rehearsal.sendOtp(h.input.phone,h.input)).operation_id;
  await tail;await db.exec('SET ROLE funding_lookup_cleanup');
  try{assert.equal((await db.query('SELECT funding_lookup_private.purge_expired() n')).rows[0].n,0);await assert.rejects(db.query('SELECT ciphertext FROM funding_lookup_private.references'));await db.exec('DELETE FROM funding_lookup_private.references');}finally{await db.exec('RESET ROLE');}
  assert.equal((await q('SELECT count(*) n FROM funding_lookup_private.references WHERE operation_id=$1',[id])).rows[0].n,1);
  await q("UPDATE funding_lookup_private.references SET created_at=statement_timestamp()-interval '31 days',expires_at=statement_timestamp()-interval '1 day' WHERE operation_id=$1",[id]);
  await db.exec('SET ROLE funding_lookup_cleanup');try{assert.equal((await db.query('SELECT funding_lookup_private.purge_expired() n')).rows[0].n,1);}finally{await db.exec('RESET ROLE');}
 }finally{await h.app.close();}
});


test('installation preflight executes read-only metadata inventory without changing fixture finance',async()=>{
 const before=(await q('SELECT saldo_euros,hash_integridad FROM public.protests ORDER BY id')).rows;
 await tail;await db.exec(await readFile(new URL('../scripts/i4-installation-preflight.sql',import.meta.url),'utf8'));
 assert.deepEqual((await q('SELECT saldo_euros,hash_integridad FROM public.protests ORDER BY id')).rows,before);
});
