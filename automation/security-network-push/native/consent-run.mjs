import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const pg=await import(process.env.CENSUS_NATIVE_PG_MODULE||'pg');const {Client}=pg.default||pg;
const config={host:'127.0.0.1',port:55449,user:'rehearsal',password:process.env.CENSUS_NATIVE_PASSWORD,database:'postgres'};
assert.ok(config.password?.length>=32,'Use the isolated launcher');
const clients=[],checks=[];
async function connect(role){const c=new Client(config);await c.connect();clients.push(c);await c.query("SET statement_timeout='8s'");if(role)await c.query('SET ROLE '+role);return c;}
const admin=await connect();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const migrationFiles=readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('_scoped_push_consent.sql'));
assert.equal(migrationFiles.length,1);
try{
 assert.equal((await admin.query('SHOW cluster_name')).rows[0].cluster_name,'voiceprotest-push-rehearsal');
 await admin.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.devices(id text PRIMARY KEY,verified_at timestamptz);
 CREATE TABLE public.protests(id uuid PRIMARY KEY,ends_at timestamptz);
 CREATE TABLE public.adhesions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id text,protest_id uuid,deleted_at timestamptz,anonymized_at timestamptz);
 CREATE TABLE public.push_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id text NOT NULL,endpoint text NOT NULL UNIQUE,p256dh text NOT NULL,auth text NOT NULL,protest_id uuid REFERENCES public.protests(id),ends_at timestamptz,locale text,timezone text,updated_at timestamptz);
 ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
 CREATE POLICY push_service_only ON public.push_subscriptions FOR ALL TO service_role USING(true) WITH CHECK(true);
 GRANT SELECT ON public.devices,public.protests,public.adhesions TO service_role;
 GRANT SELECT,INSERT,UPDATE,DELETE ON public.push_subscriptions TO service_role;
 INSERT INTO public.devices VALUES('device-a',now()),('device-b',now()),('unverified',NULL);
 INSERT INTO public.protests VALUES('${A}','2099-01-01'),('${B}','2099-01-01'),('${C}',now()-interval '3 days');
 INSERT INTO public.adhesions(device_id,protest_id) VALUES('device-a','${A}'),('device-a','${B}'),('device-a','${C}'),('device-b','${A}');`);
 await admin.query(readFileSync(new URL('../../../docs/proposals/push-security.sql',import.meta.url),'utf8'));
 await admin.query(readFileSync(new URL('../../../supabase/migrations/'+migrationFiles[0],import.meta.url),'utf8'));
 const a=await connect('service_role'),b=await connect('service_role');
 const status=(c,d,p,sub)=>c.query(sub?'SELECT public.get_push_notification_preferences($1,$2,$3,$4,$5) AS data':'SELECT public.get_push_notification_preferences($1,$2) AS data',sub?[d,p,sub.endpoint,sub.p256dh,sub.auth]:[d,p]).then(r=>r.rows[0].data);
 const revoke=(c,d,p)=>c.query('SELECT public.revoke_push_notification_preferences($1,$2) AS data',[d,p]).then(r=>r.rows[0].data);
 const save=(c,d,p,revision,endpoint='synthetic:device-a')=>c.query("SELECT public.save_scoped_push_subscription($1,$2,'p256dh','auth',$3,'en','UTC',$4) AS data",[d,endpoint,p,revision]).then(r=>r.rows[0].data);
 const legacy=(c,d,p,endpoint='synthetic:device-a')=>c.query("SELECT public.save_owned_push_subscription($1,$2,'p256dh','auth',$3,'en','UTC') AS data",[d,endpoint,p]).then(r=>r.rows[0].data);
 const allowed=(c,d,p,endpoint='synthetic:device-a')=>c.query('SELECT public.push_subscription_can_deliver($1,$2,$3) AS data',[d,p,endpoint]).then(r=>r.rows[0].data);
 assert.deepEqual(await status(a,'device-a',A),{ok:true,enabled:false,revision:0,registration:'missing'});checks.push('new identity/event status does not invent consent or transport');
 assert.deepEqual(await save(a,'device-a',A,0),{ok:true,enabled:true,revision:1});assert.equal(await allowed(a,'device-a',A),true);assert.equal(await allowed(a,'device-a',B),false);checks.push('explicit scoped consent enables only its event');
 assert.deepEqual(await status(a,'device-a',A),{ok:true,enabled:true,revision:1,registration:'missing'});checks.push('read without browser snapshot never certifies transport even with saved consent');
 const knownTransport={endpoint:'synthetic:device-a',p256dh:'p256dh',auth:'auth'};
 assert.equal((await status(a,'device-a',A,knownTransport)).registration,'present');checks.push('exact owner endpoint and key pair proves known browser transport');
 for(const mismatch of [{endpoint:'synthetic:device-new'},{p256dh:'wrong-key'},{auth:'wrong-auth'},{auth:null}]){
   const state=await status(a,'device-a',A,{...knownTransport,...mismatch});assert.equal(state.registration,'missing');assert.equal(state.enabled,true);assert.equal(state.revision,1);
 }checks.push('another endpoint and either changed or absent key never borrows an old transport registration');
 assert.deepEqual(await status(b,'device-b',A,knownTransport),{ok:true,enabled:false,revision:0,registration:'missing'});checks.push('another identity cannot claim a matching foreign endpoint/key snapshot');
 assert.deepEqual(await save(a,'device-a',B,0),{ok:true,enabled:true,revision:1});assert.equal(await allowed(a,'device-a',A),true);assert.equal(await allowed(a,'device-a',B),true);checks.push('one shared transport preserves both opted-in events despite legacy pointer update');
 assert.deepEqual(await revoke(a,'device-a',A),{ok:true,enabled:false,revision:2});assert.equal(await allowed(a,'device-a',A),false);assert.equal(await allowed(a,'device-a',B),true);assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.push_subscriptions')).rows[0].n,1);checks.push('event revoke preserves the endpoint and other event');
 await assert.rejects(()=>save(a,'device-a',A,1),/VP_PUSH_CONSENT_STALE/);assert.equal(await allowed(a,'device-a',A),false);checks.push('delayed pre-revocation activation cannot restore consent');
 assert.equal(await legacy(a,'device-a',A),true);assert.equal(await allowed(a,'device-a',A),false);checks.push('legacy registration cannot erase a persisted revocation');
 assert.deepEqual(await save(a,'device-a',A,2),{ok:true,enabled:true,revision:3});checks.push('fresh explicit consent can re-enable using the current revision');
 const before=await status(b,'device-b',A);assert.deepEqual(await save(b,'device-b',A,0),{ok:false,error:'PUSH_ENDPOINT_OWNED'});assert.deepEqual(await status(b,'device-b',A),before);checks.push('foreign endpoint cannot be transferred or create a false preference');
 await assert.rejects(()=>save(a,'unverified',A,0,'synthetic:unverified'),/VP_PUSH_DEVICE_UNVERIFIED/);await assert.rejects(()=>save(a,'device-b',B,0,'synthetic:unjoined'),/VP_PUSH_PARTICIPATION_REQUIRED/);checks.push('unverified and unrelated participation denied before transport creation');
 await admin.query("DELETE FROM public.push_subscriptions WHERE device_id='device-a'");assert.deepEqual(await status(a,'device-a',A),{ok:true,enabled:true,revision:3,registration:'missing'});await save(a,'device-a',A,3);checks.push('missing transport is reported and repaired only by current explicit consent');
 await admin.query("UPDATE public.adhesions SET deleted_at=now() WHERE device_id='device-a' AND protest_id=$1",[A]);assert.equal(await allowed(a,'device-a',A),false);await revoke(a,'device-a',A);checks.push('removed participation blocks delivery but does not prevent its owner revoking');
 await admin.query("UPDATE public.adhesions SET deleted_at=NULL WHERE device_id='device-a' AND protest_id=$1",[A]);
 const rev=(await status(a,'device-a',A)).revision;
 await a.query('BEGIN');await revoke(a,'device-a',A);const late=save(b,'device-a',A,rev);let wait;
 for(let i=0;i<100;i++){wait=(await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[b.processID])).rows[0];if(wait?.wait_event_type==='Lock')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(wait?.wait_event_type,'Lock');await a.query('COMMIT');await assert.rejects(()=>late,/VP_PUSH_CONSENT_STALE/);assert.equal(await allowed(a,'device-a',A),false);checks.push('concurrent revoke locks stale activation and wins without resurrection');
 await a.query('BEGIN');const fresh=(await status(a,'device-a',A)).revision;await save(a,'device-a',A,fresh);const cancel=revoke(b,'device-a',A);for(let i=0;i<100;i++){wait=(await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[b.processID])).rows[0];if(wait?.wait_event_type==='Lock')break;await new Promise(r=>setTimeout(r,10));}assert.equal(wait?.wait_event_type,'Lock');await a.query('COMMIT');await cancel;assert.equal(await allowed(a,'device-a',A),false);checks.push('concurrent activation then revoke ends disabled');
 await legacy(a,'device-b',A,'synthetic:legacy');assert.equal(await allowed(a,'device-b',A,'synthetic:legacy'),true);assert.equal(await allowed(a,'device-b',B,'synthetic:legacy'),false);await revoke(a,'device-b',A);assert.equal(await allowed(a,'device-b',A,'synthetic:legacy'),false);checks.push('legacy provenance is limited to its explicit event and overridden by revocation');
 const anon=await connect('anon'),authenticated=await connect('authenticated');for(const c of [anon,authenticated]){
  await assert.rejects(()=>status(c,'device-a',A),/permission denied/);await assert.rejects(()=>revoke(c,'device-a',A),/permission denied/);await assert.rejects(()=>c.query('SELECT * FROM public.push_notification_preferences'),/permission denied/);
 }checks.push('browser roles cannot read preferences or execute consent RPCs');
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_proc WHERE oid IN ('public.get_push_notification_preferences(text,uuid,text,text,text)'::regprocedure,'public.revoke_push_notification_preferences(text,uuid)'::regprocedure,'public.save_scoped_push_subscription(text,text,text,text,uuid,text,text,integer)'::regprocedure) AND prosecdef")).rows[0].n,0);checks.push('consent functions remain security invoker');
 await admin.query("UPDATE public.push_subscriptions SET updated_at=now()-interval '3 days',protest_id=$1 WHERE device_id='device-a'",[C]);assert.equal((await a.query('SELECT public.prune_scoped_push_orphans() AS n')).rows[0].n,0);checks.push('cleanup preserves transport referenced by another active consent');
 await revoke(a,'device-a',B);assert.equal((await a.query('SELECT public.prune_scoped_push_orphans() AS n')).rows[0].n,1);checks.push('cleanup removes provably stale transport after its remaining consents stop');
 await admin.query("UPDATE public.push_subscriptions SET updated_at=now()-interval '3 days',protest_id=NULL WHERE device_id='device-b'");assert.equal((await a.query('SELECT public.prune_scoped_push_orphans() AS n')).rows[0].n,0);checks.push('unknown legacy provenance is retained, not guessed orphaned');
 await admin.query("UPDATE public.push_subscriptions SET updated_at=now()-interval '3 days',protest_id=$1 WHERE device_id='device-b'",[C]);await a.query('BEGIN');await status(a,'device-b',A);assert.equal((await b.query('SELECT public.prune_scoped_push_orphans() AS n')).rows[0].n,0);await a.query('ROLLBACK');checks.push('cleanup skips an identity locked by concurrent preference activity');
 console.log(JSON.stringify({status:'PASS',checks:checks.length,details:checks,migration:migrationFiles[0],limits:['isolated native PostgreSQL 17','synthetic relevant schema','device possession checked by separate HTTP tests','a provider send already authorized/in flight cannot be recalled']}));
}finally{for(const c of clients.reverse())await c.end();}
