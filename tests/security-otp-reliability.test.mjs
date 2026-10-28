import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {OtpProviderError,otpProviderFailure} from '../apps/api/src/lib/otpProvider.js';
const phone='+34600000001', id='synthetic-device-1';
const source=readFileSync(new URL('../apps/api/src/routes/users.js',import.meta.url),'utf8').replace(/^import [\s\S]*?;\n/gm,'').replace('export default async function userRoutes','async function userRoutes');

async function fixture(options={}) {
 const calls=[],devices=options.devices||new Map();
 const hash=createHmac('sha256','synthetic-key').update(phone).digest('hex');
 const db={from(table){
  const state={table,op:'select',filters:{}};
  async function run(){
   calls.push({...state,filters:{...state.filters}});
   if(options.errorAt===table+':'+state.op)return {error:{message:'private database details'}};
   if(table==='devices'){
    let row=[...devices.values()].find(d=>Object.entries(state.filters).every(([k,v])=>d[k]===v));
    if(state.op==='insert'){
     if(options.concurrentPhone && ![...devices.values()].some(d=>d.phone_hash===hash)) devices.set('canonical-device',{id:'canonical-device',phone_hash:hash,device_secret_hash:'existing-hash'});
     if(devices.has(state.payload.id)||[...devices.values()].some(d=>d.phone_hash===state.payload.phone_hash))return {error:{code:'23505'}};
     devices.set(state.payload.id,{...state.payload});row=devices.get(state.payload.id);
    }
    if(state.op==='update'&&row)Object.assign(row,state.payload);
    return {data:row||null,error:null};
   }
   return {data:table==='protests'?{scope:'global'}:null,error:null};
  }
  const q={select(){return q;},eq(k,v){state.filters[k]=v;return q;},update(p){state.op='update';state.payload=p;return q;},insert(p){state.op='insert';state.payload=p;return q;},maybeSingle:run,single:run,then(a,b){return run().then(a,b);}};return q;
 },async rpc(name){calls.push({rpc:name});return options.rpcError?{error:{message:'private db'}}:name==='get_otp_cooldown'?{data:options.cooldown??0}:{data:options.limit??{allowed:true}};}};
 const context={createHash,createHmac,randomUUID,otpProviderFailure,supabase:db,ipQuotaKey:x=>x,process:{env:{PHONE_HASH_SECRET:'synthetic-key'}},console,
  consumeOtpDeliveryQuota:async()=>true,verifyRecaptcha:async()=>{},deriveNumberingCountry:()=>({country:'ES',resolution:'resolved_unshared',metaVersion:'synthetic'}),
  sendOtp:async()=>{calls.push({send:true});if(options.providerError)throw options.providerError;},verifyOtp:async()=>{calls.push({verify:true});if(options.providerError)throw options.providerError;return options.approved??true;},
  generateDeviceSecret:()=>({secret:'synthetic-secret-new',hash:'synthetic-hash-new'}),signParticipationToken:args=>'token:'+args.device_id,deviceSecretMatches:()=>false};
 vm.createContext(context);vm.runInContext(source+';globalThis.register=userRoutes;',context);
 const app=Fastify();await app.register(sensible);await app.register(context.register);await app.ready();
 return {app,calls,devices,hash,send:()=>app.inject({method:'POST',url:'/request-otp',payload:{phone,device_id:id,recaptcha_token:'synthetic'}}),verify:()=>app.inject({method:'POST',url:'/verify-otp',payload:{phone,device_id:id,otp:'123456'}})};
}
for(const scenario of [{rpcError:true},{cooldown:'0'},{limit:{}},{errorAt:'otp_requests:insert'}]) test('OTP send fails closed on broken database state '+JSON.stringify(scenario),async()=>{
 const f=await fixture(scenario);try{const r=await f.send();assert.equal(r.statusCode,503);assert.equal(f.calls.some(c=>c.send),false);assert.ok(!r.body.includes('private'));assert.equal(r.headers['cache-control'],'no-store');}finally{await f.app.close();}
});
test('OTP cooldown and quota denial do not call provider',async()=>{
 for(const scenario of [{cooldown:2},{limit:{allowed:false}}]){const f=await fixture(scenario);try{assert.equal((await f.send()).statusCode,429);assert.equal(f.calls.some(c=>c.send),false);}finally{await f.app.close();}}
});
test('wrong OTP does not expire any local request or mutate a device',async()=>{
 const f=await fixture({approved:false});try{const r=await f.verify();assert.equal(r.statusCode,401);assert.equal(f.calls.some(c=>c.op==='update'||c.op==='insert'),false);}finally{await f.app.close();}
});
test('provider outages are sanitized and never authenticate',async()=>{
 for(const providerError of [new Error('secret phone code'),new OtpProviderError('limited')]){const f=await fixture({providerError});try{
  const r=await f.verify();assert.equal(r.statusCode,providerError.kind==='limited'?429:503);assert.ok(!r.body.includes('secret'));assert.equal(f.calls.some(c=>c.table),false);
  const s=await f.send();assert.equal(s.statusCode,r.statusCode);assert.equal(f.calls.filter(c=>c.send).length,1);
 }finally{await f.app.close();}}
});
for(const errorAt of ['otp_requests:update','devices:select','devices:insert','devices:update']) test('approved OTP cannot bypass persistence failure '+errorAt,async()=>{
 const f=await fixture({errorAt,...(errorAt==='devices:update'?{devices:new Map([['canonical',{id:'canonical',phone_hash:createHmac('sha256','synthetic-key').update(phone).digest('hex')} ]])}:{})});
 try{const r=await f.verify();assert.equal(r.statusCode,503);assert.ok(!r.body.includes('token:'));assert.ok(!r.body.includes('secret-new'));}finally{await f.app.close();}
});
test('new identity gets a one-time secret without exposing the phone hash',async()=>{
 const f=await fixture();try{const r=await f.verify();assert.equal(r.statusCode,200);assert.equal(r.json().device_secret,'synthetic-secret-new');assert.ok(!r.body.includes(f.hash));assert.equal(r.headers['cache-control'],'no-store');}finally{await f.app.close();}
});
test('caller-controlled collision preserves old identity and issues a new id',async()=>{
 const devices=new Map([[id,{id,phone_hash:'other-phone-hash',device_secret_hash:'old-proof'}]]),f=await fixture({devices});
 try{const r=await f.verify();assert.equal(r.statusCode,200);assert.notEqual(r.json().device_id,id);assert.equal(devices.get(id).phone_hash,'other-phone-hash');assert.equal(devices.get(id).device_secret_hash,'old-proof');assert.equal(devices.size,2);}finally{await f.app.close();}
});
test('concurrent phone insertion reuses canonical id without returning a secret',async()=>{
 const f=await fixture({concurrentPhone:true});try{const r=await f.verify();assert.equal(r.statusCode,200);assert.equal(r.json().device_id,'canonical-device');assert.equal(r.json().device_secret,undefined);assert.equal(f.devices.get('canonical-device').device_secret_hash,'existing-hash');}finally{await f.app.close();}
});
