import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomInt} from 'node:crypto';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {consumeOtpVerificationQuota} from '../apps/api/src/lib/requestQuotas.js';
import {runOtpProvider,OtpProviderError,otpProviderFailure} from '../apps/api/src/lib/otpProvider.js';
const source=readFileSync(new URL('../apps/api/src/routes/institucional.js',import.meta.url),'utf8').replace(/^import [\s\S]*?;\n/gm,'').replace('export default async function institucionalRoutes','async function institucionalRoutes');
async function fixture(options={}){
 let sends=0;
 const q={select(){return q;},eq(){return q;},single:async()=>({data:{dominio_email:'example.invalid',title:'Synthetic',requiere_censo:true,ends_at:'2099-01-01'}})};
 const context={consumeOtpVerificationQuota,createHash,createHmac,randomInt,OtpProviderError,otpProviderFailure,runOtpProvider:op=>runOtpProvider(op,{timeoutMs:20}),ipQuotaKey:x=>x,
  process:{env:{PHONE_HASH_SECRET:'synthetic-key',EMAIL_OTP_SECRET:'synthetic-key'}},console,verifyRecaptcha:async()=>{},consumeOtpDeliveryQuota:async()=>true,
  supabase:{from:()=>q,rpc:async()=>options.reservation||{data:{allowed:true,challenge_id:'33333333-3333-4333-8333-333333333333'}}},
  Resend:class {constructor(){this.emails={send:async(_payload,opts)=>{sends++;assert.ok(opts.signal instanceof AbortSignal);assert.equal(opts.redirect,'error');if(options.hang)return new Promise(()=>{});if(options.throwError)throw new Error('private recipient');return options.delivery??{data:{id:'synthetic-delivery'}};}};}}};
 vm.createContext(context);vm.runInContext(source+';globalThis.register=institucionalRoutes;',context);
 const app=Fastify();if(options.verificationDenied)app.decorate('consumeOtpVerificationQuota',async(_req,rep)=>{rep.code(options.verificationDenied).send({error:'quota'});return false;});await app.register(sensible);await app.register(context.register);await app.ready();
 return {app,get sends(){return sends;},send:()=>app.inject({method:'POST',url:'/send-otp',payload:{email:'person@example.invalid',protest_id:'11111111-1111-4111-8111-111111111111',recaptcha_token:'synthetic'}})};
}
for(const options of [{throwError:true},{hang:true},{delivery:{}},{delivery:{error:{message:'private address'}}}])test('institutional delivery failure never claims sent '+JSON.stringify(options),async()=>{
 const f=await fixture(options);try{const r=await f.send();assert.equal(r.statusCode,503);assert.ok(!r.body.includes('private'));assert.equal(r.json().sent,undefined);assert.equal(r.headers['cache-control'],'no-store');assert.equal(f.sends,1);}finally{await f.app.close();}
});
test('broken reservation fails closed before delivery',async()=>{
 for(const reservation of [{error:{}},{data:{}},{data:{allowed:true,challenge_id:'invalid'}}]){const f=await fixture({reservation});try{assert.equal((await f.send()).statusCode,503);assert.equal(f.sends,0);}finally{await f.app.close();}}
});
test('successful delivery returns reserved challenge only after provider acceptance',async()=>{
 const f=await fixture();try{const r=await f.send();assert.equal(r.statusCode,200);assert.equal(r.json().sent,true);assert.equal(f.sends,1);}finally{await f.app.close();}
});

test('shared verification rejection gates both institutional verification routes',async()=>{
 for(const path of ['/verify-otp','/census-session']){const f=await fixture({verificationDenied:503});try{const r=await f.app.inject({method:'POST',url:path,payload:{email:'person@example.invalid',otp:'123456',protest_id:'11111111-1111-4111-8111-111111111111',challenge_id:'22222222-2222-4222-8222-222222222222'}});assert.equal(r.statusCode,503);assert.equal(f.sends,0);}finally{await f.app.close();}}
});
