import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {runOtpProvider,OtpProviderError} from '../apps/api/src/lib/otpProvider.js';
import {Resend} from 'resend';
const source=readFileSync(new URL('../apps/api/src/services/twilio.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export async function','async function');
function fixture({result={status:'pending'},error,hang=false}={}){
 const calls=[];let options;
 const op=async args=>{calls.push(args);if(hang)return new Promise(()=>{});if(error)throw error;return result;};
 const context={process:{env:{TWILIO_ACCOUNT_SID:'synthetic-sid',TWILIO_AUTH_TOKEN:'synthetic-token',TWILIO_VERIFY_SID:'synthetic-service'}},
  twilio:(_sid,_token,opts)=>{options=opts;return {verify:{v2:{services:()=>({verifications:{create:op},verificationChecks:{create:op}})}}};},
  OtpProviderError,runOtpProvider:op=>runOtpProvider(op,{timeoutMs:20})};
 vm.createContext(context);vm.runInContext(source+';globalThis.api={sendOtp,verifyOtp};',context);return {...context.api,calls,get options(){return options;}};
}
test('Twilio send uses bounded socket timeout and disables automatic retry',async()=>{
 const f=fixture();await f.sendOtp('+34600000001');assert.equal(f.calls.length,1);assert.equal(f.options.timeout,8000);assert.equal(f.options.autoRetry,false);
});
for(const status of ['pending','expired','canceled','max_attempts_reached','deleted','failed'])test('Twilio check '+status+' never approves',async()=>assert.equal(await fixture({result:{status}}).verifyOtp('+34600000001','123456'),false));
test('only approved status authenticates',async()=>assert.equal(await fixture({result:{status:'approved'}}).verifyOtp('+34600000001','123456'),true));
for(const error of [{status:404,code:20404},{status:429,code:60202}])test('consumed/expired/exhausted challenge is generic invalid '+error.code,async()=>{
 const f=fixture({error});assert.equal(await f.verifyOtp('+34600000001','123456'),false);assert.equal(f.calls.length,1);
});
for(const error of [{status:401,message:'private credential'},{status:503,message:'private phone'},{status:404,code:99999},new Error('network private details')])test('Twilio outages discard provider internals '+String(error.status),async()=>{
 const f=fixture({error});await assert.rejects(f.verifyOtp('+34600000001','123456'),e=>e instanceof OtpProviderError&&e.kind==='unavailable'&&!e.message.includes('private')&&!e.cause);assert.equal(f.calls.length,1);
});
test('provider throttling is distinguished without retrying',async()=>{
 const f=fixture({error:{status:429,code:60207}});await assert.rejects(f.sendOtp('+34600000001'),e=>e.kind==='limited');assert.equal(f.calls.length,1);
});
test('malformed provider result cannot confirm send or verification',async()=>{
 for(const result of [null,{}, {status:'unknown'}]){await assert.rejects(fixture({result}).sendOtp('+34600000001'),OtpProviderError);await assert.rejects(fixture({result}).verifyOtp('+34600000001','123456'),OtpProviderError);}
});
test('hanging Twilio operation returns within the application deadline and is not retried',async()=>{
 const f=fixture({hang:true});await assert.rejects(f.verifyOtp('+34600000001','123456'),OtpProviderError);assert.equal(f.calls.length,1);
});
test('installed Resend SDK forwards AbortSignal and redirect policy to fetch; body stalls are bounded',async()=>{
 const original=globalThis.fetch;let signal,calls=0;
 globalThis.fetch=async(_url,opts)=>{calls++;signal=opts.signal;assert.equal(opts.redirect,'error');return {ok:true,json:()=>new Promise(()=>{})};};
 try{const resend=new Resend('synthetic-only');await assert.rejects(runOtpProvider(async signal=>resend.emails.send({to:'person@example.invalid',from:'test@example.invalid',subject:'synthetic',html:'synthetic'},{signal,redirect:'error'}),{timeoutMs:20}),OtpProviderError);assert.equal(signal.aborted,true);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
