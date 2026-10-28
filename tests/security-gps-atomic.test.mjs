import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import {registerSafeErrorHandler} from '../apps/api/src/lib/safeErrors.js';
const pid='11111111-1111-4111-8111-111111111111',aid='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333';
mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:{}}});
const {default:routes}=await import('../apps/api/src/routes/protests.js');
function fixture(response={data:{ok:true,fiabilidad:95,adhesion_osm_id:123}}){const calls=[];const database={from(table){calls.push({table});const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:table==='gps_update_tokens'?{adhesion_id:aid,protest_id:pid,used:false,expires_at:'2999-01-01'}:{scope:'local',ends_at:'2999-01-01'}})};return q;},rpc(name,args){const call={name,args};calls.push(call);return {abortSignal(signal){call.signal=signal;return Promise.resolve(response);}};}};return {calls,database};}
async function appFor(f){const app=Fastify();await app.register(sensible);await app.register(rateLimit,{global:false});registerSafeErrorHandler(app);await app.register(routes,{dependencies:{database:f.database}});return app;}
const patch=app=>app.inject({method:'PATCH',url:`/${pid}/adhesion`,payload:{gps_update_token:token,gps_lat:40,gps_lng:-3,gps_accuracy:10}});
function geography(){return mock.method(globalThis,'fetch',async()=>({json:async()=>({osm_id:123,address:{city:'Synthetic City',country:'Synthetic Country',country_code:'es'}})}));}
test('GPS route uses one bounded atomic RPC, no separate token update or stale confidence read',async()=>{
 const geo=geography(),f=fixture(),app=await appFor(f);try{const r=await patch(app);assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json(),{ok:true,fiabilidad:95,adhesion_osm_id:123});assert.deepEqual(f.calls.filter(c=>c.table).map(c=>c.table),['gps_update_tokens','protests']);const rpc=f.calls.find(c=>c.name);assert.equal(rpc.name,'consume_gps_reinforcement');assert.equal(rpc.args.p_token,token);assert.equal(rpc.args.p_protest_id,pid);assert.equal(rpc.args.p_adhesion_id,undefined);assert.equal(rpc.args.p_fiabilidad,undefined);assert.ok(rpc.signal.aborted);}finally{geo.mock.restore();await app.close();}
});
for(const [code,status] of [['TOKEN_USED',409],['TOKEN_EXPIRED',410],['TOKEN_MISMATCH',403],['PROTEST_CLOSED',410],['TOKEN_NOT_FOUND',404],['ADHESION_UNAVAILABLE',404],['GPS_INPUT_INVALID',400],['__proto__',503]])test('database denial maps to controlled response '+code,async()=>{
 const geo=geography(),f=fixture({data:{ok:false,code}}),app=await appFor(f);try{const r=await patch(app);assert.equal(r.statusCode,status,r.body);assert.equal(r.headers['cache-control'],'no-store');assert.equal(f.calls.filter(c=>c.name).length,1);}finally{geo.mock.restore();await app.close();}
});
for(const result of [{error:{message:'PRIVATE_DATABASE_DETAIL'}},{data:null},{data:[]},{data:{ok:true,fiabilidad:'95',adhesion_osm_id:123}},{data:{ok:'true',fiabilidad:95,adhesion_osm_id:123}}])test('unknown or malformed RPC result fails closed without retry '+JSON.stringify(result),async()=>{
 const geo=geography(),f=fixture(result),app=await appFor(f);try{const r=await patch(app);assert.equal(r.statusCode,503);assert.ok(!r.body.includes('PRIVATE_'));assert.equal(f.calls.filter(c=>c.name).length,1);}finally{geo.mock.restore();await app.close();}
});
test('malformed GPS token is rejected before database or external geocode',async()=>{
 let fetched=0;const geo=mock.method(globalThis,'fetch',async()=>{fetched++;throw Error('prohibited');});const f=fixture(),app=await appFor(f);try{const r=await app.inject({method:'PATCH',url:`/${pid}/adhesion`,payload:{gps_update_token:'invalid',gps_lat:40,gps_lng:-3}});assert.equal(r.statusCode,400);assert.equal(f.calls.length,0);assert.equal(fetched,0);}finally{geo.mock.restore();await app.close();}
});

test('parallel PATCH requests with one token make only one per-process reverse-geocode call',async()=>{
 let fetches=0,release,announce;const started=new Promise(resolve=>announce=resolve),gate=new Promise(resolve=>release=resolve);const geo=mock.method(globalThis,'fetch',async()=>{fetches++;announce();await gate;return {json:async()=>({osm_id:123,address:{city:'Synthetic'}})};});const f=fixture(),app=await appFor(f);
 try{await app.ready();const leader=patch(app);await started;const followers=await Promise.all(Array.from({length:19},()=>patch(app)));assert.equal(fetches,1);assert.ok(followers.every(r=>r.statusCode===429));release();assert.equal((await leader).statusCode,200);assert.equal(f.calls.filter(c=>c.name).length,1);}finally{release();geo.mock.restore();await app.close();}
});
test('failed RPC releases the per-process in-flight slot for a later request',async()=>{
 const geo=geography(),f=fixture({error:{message:'PRIVATE'}}),app=await appFor(f);try{for(let i=0;i<2;i++)assert.equal((await patch(app)).statusCode,503);assert.equal(f.calls.filter(c=>c.name).length,2);}finally{geo.mock.restore();await app.close();}
});
