// Execute the actual Fastify routes, with synthetic database/provider capabilities.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,timingSafeEqual} from 'node:crypto';
import Fastify from 'fastify';
import {isAllowedPushEndpoint} from '../apps/api/src/lib/pushEndpoint.js';
import {deviceSecretMatches,hashDeviceSecret} from '../apps/api/src/lib/participationToken.js';
process.env.DEVICE_SECRET_PEPPER='synthetic-consent-pepper';
const source=readFileSync(new URL('../apps/api/src/routes/push.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function pushRoutes','async function pushRoutes');
const id='synthetic-device',secret='a'.repeat(64),protest='11111111-1111-4111-8111-111111111111',endpoint='https://fcm.googleapis.com/fcm/send/synthetic';
const proof={device_id:id,device_secret:secret,protest_id:protest};
const subscription={endpoint,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
async function fixture(options={}){
 const calls=[],sent=[],timers=[];let snapshots=0;
 const supabase={from(table){const q={select(){return q;},delete(){calls.push({delete:table});return q;},eq(key,value){calls.push({table,key,value});return q;},
  maybeSingle:async()=>({data:{id,verified_at:options.verified===false?null:'2026-01-01',device_secret_hash:hashDeviceSecret(secret)},error:options.authError?{message:'private synthetic database failure'}:null}),
  gte(){return q;},lte(){return q;},then(resolve,reject){return Promise.resolve({data:table==='protests'?(options.hourlyEvents??[]):null,error:null}).then(resolve,reject);}};return q;},
  rpc(name,args){calls.push({rpc:name,args});return {abortSignal(signal){assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);let data;
   if(name==='get_push_notification_preferences')data={ok:true,enabled:false,revision:0,registration:'missing'};
   else if(name==='revoke_push_notification_preferences')data={ok:true,enabled:false,revision:1};
   else if(name==='save_scoped_push_subscription')data={ok:true,enabled:true,revision:1};
   else if(name==='save_owned_push_subscription')data=true;
   else if(name==='list_scoped_push_subscriptions')data=[{device_id:id,endpoint,p256dh:'p256dh',auth:'auth',locale:'en',timezone:'UTC'}];
   else if(name==='push_subscription_can_deliver')data=true;
   else if(name==='prune_scoped_push_orphans')data=0;
   const result=options.rpc?.(name,args,++snapshots)??{data,error:null};return Promise.resolve(result);
  }};}};
 const context={Error,supabase,isAllowedPushEndpoint,deviceSecretMatches,createHash,timingSafeEqual,AbortSignal,console,
  process:{env:{ADMIN_SECRET:'synthetic-admin',VAPID_PUBLIC_KEY:'fake',VAPID_PRIVATE_KEY:'fake',VAPID_EMAIL:'mailto:synthetic@example.invalid',PUSH_SCOPED_ORPHAN_CLEANUP_ENABLED:options.cleanupEnabled?'true':undefined}},
  webpush:{setVapidDetails(){},async sendNotification(sub){sent.push(sub);if(options.providerError)throw options.providerError;}},
  setInterval(fn){timers.push(fn);},setTimeout(){}};
 vm.createContext(context);vm.runInContext(source+';globalThis.register=pushRoutes;',context);
 const app=Fastify();await app.register(context.register);await app.ready();return {app,calls,sent,timers,context};
}
const post=(f,url,payload=proof)=>f.app.inject({method:'POST',url,payload});
for(const path of ['/preferences','/revoke'])test(path+' authenticates proof before invoking consent RPC',async()=>{
 const f=await fixture();try{const r=await post(f,path,{...proof,device_secret:'b'.repeat(64)});assert.equal(r.statusCode,401);assert.equal(f.calls.some(c=>c.rpc),false);}finally{await f.app.close();}
});
for(const path of ['/preferences','/revoke'])test(path+' refuses unverified identities and unknown events distinctly',async()=>{
 const f=await fixture({verified:false});try{assert.equal((await post(f,path)).statusCode,401);assert.equal(f.calls.some(c=>c.rpc),false);}finally{await f.app.close();}
 const g=await fixture({rpc:()=>({data:null,error:{message:'VP_PUSH_PROTEST_NOT_FOUND'}})});try{const r=await post(g,path);assert.equal(r.statusCode,404);assert.equal(r.json().error,'PUSH_PROTEST_NOT_FOUND');}finally{await g.app.close();}
});
test('status reports missing transport without inventing activation and returns only public contract fields',async()=>{
 const f=await fixture({rpc:()=>({data:{ok:true,enabled:true,revision:2,registration:'missing',privateField:'not for client'},error:null})});try{
  const r=await post(f,'/preferences');assert.equal(r.statusCode,200);assert.deepEqual(r.json(),{ok:true,enabled:true,revision:2,registration:'missing'});assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c=>c.rpc).args)),{p_device_id:id,p_protest_id:protest});
 }finally{await f.app.close();}
});
test('status without a browser snapshot cannot certify an unrelated stored transport',async()=>{
 const f=await fixture({rpc:()=>({data:{ok:true,enabled:true,revision:3,registration:'present'},error:null})});try{
  const r=await post(f,'/preferences');assert.equal(r.statusCode,200);assert.deepEqual(r.json(),{ok:true,enabled:true,revision:3,registration:'missing'});assert.equal('p_endpoint' in f.calls.find(c=>c.rpc).args,false);
 }finally{await f.app.close();}
});
for(const [name,snapshot,expected] of [
 ['matching snapshot',subscription,'present'],
 ['another browser endpoint',{...subscription,endpoint:endpoint+'-new'},'missing'],
 ['changed public key',{...subscription,keys:{...subscription.keys,p256dh:'C'.repeat(87)}},'missing'],
 ['changed auth key',{...subscription,keys:{...subscription.keys,auth:'b'.repeat(22)}},'missing'],
])test('status proves exact current browser transport: '+name,async()=>{
 const f=await fixture({rpc:(name,args)=>({data:{ok:true,enabled:true,revision:2,registration:args.p_endpoint===endpoint&&args.p_p256dh===subscription.keys.p256dh&&args.p_auth===subscription.keys.auth?'present':'missing',privateField:'must-not-return'},error:null})});try{
  const r=await post(f,'/preferences',{...proof,subscription:snapshot});assert.equal(r.statusCode,200);assert.deepEqual(r.json(),{ok:true,enabled:true,revision:2,registration:expected});
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c=>c.rpc).args)),{p_device_id:id,p_protest_id:protest,p_endpoint:snapshot.endpoint,p_p256dh:snapshot.keys.p256dh,p_auth:snapshot.keys.auth});
  assert.ok(!r.body.includes('p256dh'));assert.ok(!r.body.includes('must-not-return'));
 }finally{await f.app.close();}
});
test('status authenticates device proof before checking an unsupported provider URL',async()=>{
 const f=await fixture();try{
  const sub={...subscription,endpoint:'https://evil.invalid/'};
  let r=await post(f,'/preferences',{...proof,device_secret:'b'.repeat(64),subscription:sub});assert.equal(r.statusCode,401);assert.equal(f.calls.some(c=>c.rpc),false);
  r=await post(f,'/preferences',{...proof,subscription:sub});assert.equal(r.statusCode,400);assert.deepEqual(r.json(),{error:'PUSH_ENDPOINT_INVALID'});assert.equal(f.calls.some(c=>c.rpc),false);
 }finally{await f.app.close();}
});
for(const sub of [{endpoint,keys:{p256dh:'short',auth:'a'.repeat(22)}},{endpoint,keys:{p256dh:'B'.repeat(87),auth:'short'}},{endpoint},null])test('status rejects malformed optional browser snapshot '+JSON.stringify(sub),async()=>{
 const f=await fixture();try{const r=await post(f,'/preferences',{...proof,subscription:sub});assert.equal(r.statusCode,400);assert.equal(f.calls.some(c=>c.rpc),false);}finally{await f.app.close();}
});
test('revoke is event-specific, works without endpoint, and never deletes the shared transport',async()=>{
 const f=await fixture();try{const r=await post(f,'/revoke');assert.equal(r.statusCode,200);assert.deepEqual(r.json(),{ok:true,enabled:false,revision:1});assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c=>c.rpc).args)),{p_device_id:id,p_protest_id:protest});assert.equal(f.calls.some(c=>c.delete),false);}finally{await f.app.close();}
});
for(const revision of [-1,2147483647,1.5,null,false,'0'])test('invalid consent revision is rejected before database write: '+revision,async()=>{
 const f=await fixture();try{const r=await post(f,'/subscribe',{...proof,subscription,consent_revision:revision});assert.equal(r.statusCode,400);assert.equal(f.calls.some(c=>c.rpc),false);}finally{await f.app.close();}
});
test('scoped subscribe requires an event and forwards current revision to the atomic RPC',async()=>{
 const f=await fixture();try{
  const missing={device_id:id,device_secret:secret,subscription,consent_revision:0};assert.equal((await post(f,'/subscribe',missing)).statusCode,400);assert.equal(f.calls.some(c=>c.rpc),false);
  const r=await post(f,'/subscribe',{...proof,subscription,consent_revision:0,ends_at:'2999-01-01'});assert.equal(r.statusCode,201);assert.deepEqual(r.json(),{ok:true,enabled:true,revision:1});const call=f.calls.find(c=>c.rpc);assert.equal(call.rpc,'save_scoped_push_subscription');assert.equal(call.args.p_consent_revision,0);assert.equal(call.args.p_protest_id,protest);assert.equal('p_ends_at' in call.args,false);
 }finally{await f.app.close();}
});
for(const [message,status,error] of [['VP_PUSH_CONSENT_STALE',409,'PUSH_CONSENT_STALE'],['VP_PUSH_PARTICIPATION_REQUIRED',403,'PUSH_PARTICIPATION_REQUIRED'],['VP_PUSH_DEVICE_UNVERIFIED',401,'PUSH_AUTH_REQUIRED']])test('scoped subscribe maps '+message+' without claiming success',async()=>{
 const f=await fixture({rpc:()=>({data:null,error:{message}})});try{const r=await post(f,'/subscribe',{...proof,subscription,consent_revision:0});assert.equal(r.statusCode,status);assert.deepEqual(r.json(),{error});}finally{await f.app.close();}
});
test('endpoint ownership conflict remains distinct and never deletes or retries',async()=>{
 const f=await fixture({rpc:()=>({data:{ok:false,error:'PUSH_ENDPOINT_OWNED'},error:null})});try{const r=await post(f,'/subscribe',{...proof,subscription,consent_revision:0});assert.equal(r.statusCode,409);assert.deepEqual(r.json(),{error:'PUSH_ENDPOINT_OWNED'});assert.equal(f.calls.filter(c=>c.rpc).length,1);assert.equal(f.calls.some(c=>c.delete),false);}finally{await f.app.close();}
});
for(const [path,data] of [['/preferences',{ok:true,enabled:true,revision:0,registration:'unknown'}],['/preferences',{ok:true,enabled:true,revision:-1,registration:'present'}],['/revoke',{ok:true,enabled:true,revision:1}],['/subscribe',{ok:true,enabled:false,revision:1}]])test('malformed RPC result cannot certify '+path+' '+JSON.stringify(data),async()=>{
 const f=await fixture({rpc:()=>({data,error:null})});try{const r=await post(f,path,path==='/subscribe'?{...proof,subscription,consent_revision:0}:proof);assert.equal(r.statusCode,500);assert.equal(r.json().message,'PUSH_CONSENT_UNAVAILABLE');}finally{await f.app.close();}
});
for(const message of ['private database detail','__proto__'])test('unknown RPC errors stay controlled: '+message,async()=>{
 const f=await fixture({rpc:()=>({data:null,error:{message}})});try{const r=await post(f,'/revoke');assert.equal(r.statusCode,500);assert.equal(r.json().message,'PUSH_CONSENT_UNAVAILABLE');assert.ok(!r.body.includes(message));}finally{await f.app.close();}
});
const notify=f=>post(f,'/notify',{protest_id:protest,title:'Synthetic',body:'Synthetic',admin_secret:'synthetic-admin'});
test('revocation after batch load blocks delivery at its final authorization check',async()=>{
 const f=await fixture({rpc:name=>name==='push_subscription_can_deliver'?{data:false,error:null}:undefined});try{const r=await notify(f);assert.equal(r.statusCode,200);assert.equal(r.json().sent,0);assert.equal(f.sent.length,0);assert.ok(f.calls.some(c=>c.rpc==='push_subscription_can_deliver'&&c.args.p_protest_id===protest&&c.args.p_device_id===id&&c.args.p_endpoint===endpoint));}finally{await f.app.close();}
});
test('delivery lookup and final-check database failures fail closed',async()=>{
 for(const name of ['list_scoped_push_subscriptions','push_subscription_can_deliver']){
  const f=await fixture({rpc:n=>n===name?{data:null,error:{message:'synthetic unavailable'}}:undefined});try{const r=await notify(f);assert.equal(f.sent.length,0);assert.equal(r.statusCode,name==='list_scoped_push_subscriptions'?500:200);}finally{await f.app.close();}
 }
});
test('terminal provider failures remove only the same owner and key snapshot',async()=>{
 const f=await fixture({providerError:{statusCode:410}});try{const r=await notify(f);assert.equal(r.statusCode,200);assert.equal(r.json().sent,0);for(const [key,value] of [['device_id',id],['endpoint',endpoint],['p256dh','p256dh'],['auth','auth']])assert.ok(f.calls.some(c=>c.table==='push_subscriptions'&&c.key===key&&c.value===value));}finally{await f.app.close();}
});
for(const cleanupEnabled of [false,true])test('hourly scheduling uses scoped delivery and cleanup is explicitly gated: '+cleanupEnabled,async()=>{
 const f=await fixture({cleanupEnabled,hourlyEvents:[{id:protest,title:'Synthetic',count:1,cities_count:1}],rpc:name=>name==='push_subscription_can_deliver'?{data:false,error:null}:undefined});try{
  await f.timers[0]();assert.equal(f.sent.length,0);assert.ok(f.calls.some(c=>c.rpc==='list_scoped_push_subscriptions'&&c.args.p_protest_id===protest));assert.equal(f.calls.some(c=>c.rpc==='prune_scoped_push_orphans'),cleanupEnabled);assert.equal(f.calls.some(c=>c.delete),false);
 }finally{await f.app.close();}
});
