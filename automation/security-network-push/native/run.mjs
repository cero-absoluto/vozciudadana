import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const pg=await import(process.env.CENSUS_NATIVE_PG_MODULE||'pg');const {Client}=pg.default||pg;
const config={host:'127.0.0.1',port:55449,user:'rehearsal',password:process.env.CENSUS_NATIVE_PASSWORD,database:'postgres'};
assert.ok(config.password?.length>=32,'Use the isolated launcher');
const clients=[];async function connect(){const c=new Client(config);await c.connect();clients.push(c);await c.query("SET statement_timeout='8s'");return c;}
const checks=[];const admin=await connect();
try{
  assert.equal((await admin.query('SHOW cluster_name')).rows[0].cluster_name,'voiceprotest-push-rehearsal');
  assert.match((await admin.query('SHOW server_version')).rows[0].server_version,/^17\.6/);
  await admin.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE public.devices(id text PRIMARY KEY,verified_at timestamptz);
    CREATE TABLE public.protests(id uuid PRIMARY KEY,ends_at timestamptz);
    CREATE TABLE public.push_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id text NOT NULL,endpoint text NOT NULL UNIQUE,p256dh text NOT NULL,auth text NOT NULL,protest_id uuid REFERENCES public.protests(id),ends_at timestamptz,locale text,timezone text,updated_at timestamptz);
    GRANT SELECT ON public.devices,public.protests TO service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.push_subscriptions TO service_role;
    INSERT INTO public.devices VALUES ('device-a',now()),('device-b',now()),('unverified',NULL);
    INSERT INTO public.protests VALUES ('11111111-1111-1111-1111-111111111111','2099-01-01');`);
  const proposal=readFileSync(new URL('../../../docs/proposals/push-security.sql',import.meta.url),'utf8');
  await admin.query('ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_key');
  await assert.rejects(()=>admin.query(proposal),/VP_PUSH_ENDPOINT_UNIQUE_REQUIRED/);
  await admin.query('ROLLBACK');
  assert.equal((await admin.query("SELECT to_regprocedure('public.save_owned_push_subscription(text,text,text,text,uuid,text,text)') IS NULL AS absent")).rows[0].absent,true);
  await admin.query('ALTER TABLE public.push_subscriptions ADD UNIQUE(endpoint)');checks.push('missing endpoint uniqueness aborts before RPC installation');
  await admin.query('ALTER TABLE public.push_subscriptions DROP COLUMN timezone');
  await assert.rejects(()=>admin.query(proposal),/VP_PUSH_COLUMNS_REQUIRED/);await admin.query('ROLLBACK');
  await admin.query('ALTER TABLE public.push_subscriptions ADD COLUMN timezone text');checks.push('missing required column aborts before RPC installation');
  const badCatalogs=[
    ['deferrable endpoint uniqueness','ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_key; ALTER TABLE public.push_subscriptions ADD UNIQUE(endpoint) DEFERRABLE INITIALLY IMMEDIATE','VP_PUSH_ENDPOINT_UNIQUE_REQUIRED'],
    ['wrong device id type',"ALTER TABLE public.devices ALTER COLUMN id TYPE uuid USING CASE id WHEN 'device-a' THEN '11111111-1111-1111-1111-111111111111'::uuid WHEN 'device-b' THEN '22222222-2222-2222-2222-222222222222'::uuid ELSE '33333333-3333-3333-3333-333333333333'::uuid END",'VP_PUSH_CATALOG_TYPES_REQUIRED'],
    ['wrong subscription id type','ALTER TABLE public.push_subscriptions ALTER COLUMN id DROP DEFAULT; ALTER TABLE public.push_subscriptions ALTER COLUMN id TYPE bigint USING NULL::bigint','VP_PUSH_CATALOG_TYPES_REQUIRED'],
    ['missing protest expiry','ALTER TABLE public.protests DROP COLUMN ends_at','VP_PUSH_CATALOG_TYPES_REQUIRED'],
  ];
  for(const [name,ddl,expected] of badCatalogs){
    await admin.query('BEGIN');await admin.query(ddl);await assert.rejects(()=>admin.query(proposal),new RegExp(expected));await admin.query('ROLLBACK');
    assert.equal((await admin.query("SELECT to_regprocedure('public.save_owned_push_subscription(text,text,text,text,uuid,text,text)') IS NULL AS absent")).rows[0].absent,true);
    checks.push(name+' rejected before RPC installation');
  }
  await admin.query(proposal);
  const a=await connect(),b=await connect();await a.query('SET ROLE service_role');await b.query('SET ROLE service_role');
  const sql="SELECT public.save_owned_push_subscription($1,$2,'synthetic-p256dh','synthetic-auth',$3,'en','UTC') AS saved";
  const call=(c,device,endpoint,protest=null)=>c.query(sql,[device,endpoint,protest]).then(r=>r.rows[0].saved);
  assert.equal(await call(a,'device-a','synthetic:endpoint','11111111-1111-1111-1111-111111111111'),true);
  assert.equal((await admin.query("SELECT ends_at='2099-01-01'::timestamptz AS correct FROM public.push_subscriptions")).rows[0].correct,true);checks.push('expiry derived from authoritative protest');
  assert.equal(await call(b,'device-b','synthetic:endpoint'),false);
  assert.equal((await admin.query('SELECT device_id FROM public.push_subscriptions')).rows[0].device_id,'device-a');checks.push('other owner cannot replace endpoint');
  assert.equal(await call(a,'device-a','synthetic:endpoint'),true);checks.push('same owner can update endpoint');
  await assert.rejects(()=>call(a,'unverified','synthetic:unverified'),/VP_PUSH_DEVICE_UNVERIFIED/);checks.push('unverified device denied distinctly');
  await assert.rejects(()=>call(a,'device-a','synthetic:unknown','99999999-9999-9999-9999-999999999999'),/VP_PUSH_PROTEST_NOT_FOUND/);checks.push('unknown protest denied distinctly');
  const c=await connect();await c.query('SET ROLE anon');
  await assert.rejects(()=>call(c,'device-a','synthetic:anon'),/permission denied/);checks.push('browser role cannot invoke RPC');
  await a.query('BEGIN');assert.equal(await call(a,'device-a','synthetic:race'),true);
  const pending=call(b,'device-b','synthetic:race');
  let wait;
  for(let i=0;i<100;i++){
    wait=(await admin.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1',[b.processID])).rows[0];
    if(wait?.wait_event_type==='Lock')break;await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(wait.wait_event_type,'Lock');await a.query('COMMIT');assert.equal(await pending,false);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.push_subscriptions WHERE endpoint='synthetic:race' AND device_id='device-a'")).rows[0].n,1);checks.push('overlapping endpoint claim waits and cannot change owner');
  console.log(JSON.stringify({status:'PASS',checks:checks.length,details:checks,lockEvidence:wait,limitations:['synthetic minimal schema matching relevant column types','HTTP layer separately validates device secret and provider URL','no production contacts or push deliveries']}));
}finally{for(const c of clients.reverse())await c.end();}
