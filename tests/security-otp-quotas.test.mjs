import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createClient} from '@supabase/supabase-js';
import {otpNetworkHash,consumeSharedOtpQuota,reserveSmsOtp} from '../apps/api/src/lib/otpQuotas.js';
import {registerRequestQuotas,consumeOtpDeliveryQuota,consumeOtpVerificationQuota} from '../apps/api/src/lib/requestQuotas.js';
process.env.PHONE_HASH_SECRET='synthetic-quota-secret';
function reply(){const r={status:200,headers:{},header(k,v){r.headers[k.toLowerCase()]=v;return r;},code(n){r.status=n;return r;},send(body){r.body=body;return r;}};return r;}
function dbFixture(result={data:{allowed:true}},hang=false){
 const calls=[];return {calls,rpc(name,args){const call={name,args};calls.push(call);return {abortSignal(signal){call.signal=signal;return hang?new Promise(()=>{}):Promise.resolve(result);}};}};
}
test('quota network hashes group IPv6 /48 delivery and /64 verification without exposing addresses',()=>{
 const a='2001:4860:1234:abcd::1',b='2001:4860:1234:ffff::2',c='2001:4860:1234:abcd::99';
 assert.equal(otpNetworkHash(a,'delivery'),otpNetworkHash(b,'delivery'));
 assert.notEqual(otpNetworkHash(a,'verify'),otpNetworkHash(b,'verify'));
 assert.equal(otpNetworkHash(a,'verify'),otpNetworkHash(c,'verify'));
 assert.notEqual(otpNetworkHash(a,'delivery'),otpNetworkHash(a,'verify'));
 assert.match(otpNetworkHash(a,'delivery'),/^[0-9a-f]{64}$/);
 assert.notEqual(otpNetworkHash('203.0.113.1','delivery'),otpNetworkHash('203.0.113.2','delivery'));
});
test('invalid network or missing hash secret never creates a shared key',()=>{
 assert.throws(()=>otpNetworkHash('invalid','delivery'));assert.throws(()=>otpNetworkHash('203.0.113.1','delivery',''));assert.throws(()=>otpNetworkHash('203.0.113.1','unknown'));
});
test('shared RPC receives only hashed network and subject material',async()=>{
 const db=dbFixture(),r=reply();assert.equal(await consumeSharedOtpQuota({ip:'203.0.113.1'},r,db,{action:'verify',phoneHash:'a'.repeat(64)}),true);
 assert.equal(db.calls[0].name,'consume_shared_otp_quota');assert.match(db.calls[0].args.p_subject_hash,/^[0-9a-f]{64}$/);assert.notEqual(db.calls[0].args.p_subject_hash,'a'.repeat(64));assert.ok(!JSON.stringify(db.calls[0].args).includes('203.0.113.1'));assert.equal(db.calls[0].signal.aborted,true);
});
for(const result of [{error:{message:'private details'}},{data:null},{data:{allowed:1}},{data:{allowed:false}},{data:{allowed:false,retry_after:-1}}])test('shared quota fails closed on malformed/error result '+JSON.stringify(result),async()=>{
 const r=reply(),db=dbFixture(result);assert.equal(await consumeSharedOtpQuota({ip:'203.0.113.1'},r,db,{action:'delivery'}),false);assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('private'));assert.equal(db.calls.length,1);
});
test('shared denial returns bounded Retry-After without revealing the limiting identity',async()=>{
 const r=reply();assert.equal(await consumeSharedOtpQuota({ip:'203.0.113.1'},r,dbFixture({data:{allowed:false,retry_after:120}}),{action:'delivery'}),false);assert.equal(r.status,429);assert.equal(r.headers['retry-after'],'120');assert.equal(r.body.code,'otp_rate_limited');
});
test('stalled shared quota RPC aborts within deadline without retry or local fallback',async()=>{
 const r=reply(),db=dbFixture(null,true);assert.equal(await consumeSharedOtpQuota({ip:'203.0.113.1'},r,db,{action:'delivery'},{timeoutMs:20}),false);assert.equal(r.status,503);assert.equal(db.calls.length,1);assert.equal(db.calls[0].signal.aborted,true);
});
test('SMS reservation RPC uses one bounded operation rather than separate check and insert',async()=>{
 const db=dbFixture({data:{allowed:true,request_id:'11111111-1111-4111-8111-111111111111'}});await reserveSmsOtp(db,{p_phone_hash:'a'.repeat(64)});assert.equal(db.calls.length,1);assert.equal(db.calls[0].name,'reserve_sms_otp');assert.equal(db.calls[0].signal.aborted,true);
});
test('installed Supabase SDK forwards quota RPC payload and AbortSignal to mocked transport',async()=>{
 let calls=0,signal;
 const db=createClient('https://synthetic.invalid','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,options)=>{
  calls++;assert.match(String(url),/\/rest\/v1\/rpc\/consume_shared_otp_quota$/);signal=options.signal;
  assert.equal(JSON.parse(options.body).p_action,'delivery');
  return new Response(JSON.stringify({allowed:true}),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 assert.equal(await consumeSharedOtpQuota({ip:'203.0.113.1'},reply(),db,{action:'delivery'}),true);
 assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('independent Fastify applications use the same shared network quota and stop before provider',async()=>{
 const db=dbFixture({data:{allowed:false,retry_after:60}}),apps=[];let delivered=0,verified=0;
 try{
  for(let i=0;i<2;i++){const app=Fastify();await registerRequestQuotas(app,{supabase:db});app.post('/send',async(req,rep)=>{if(!await consumeOtpDeliveryQuota(req,rep))return;delivered++;return {sent:true};});app.post('/verify',async(req,rep)=>{if(!await consumeOtpVerificationQuota(req,rep,'a'.repeat(64)))return;verified++;return {verified:true};});await app.ready();apps.push(app);}
  for(const app of apps)for(const path of ['/send','/verify'])assert.equal((await app.inject({method:'POST',url:path,remoteAddress:'203.0.113.1'})).statusCode,429);
  assert.equal(delivered,0);assert.equal(verified,0);assert.equal(db.calls.length,4);assert.equal(db.calls[0].args.p_network_hash,db.calls[2].args.p_network_hash);assert.equal(db.calls[1].args.p_network_hash,db.calls[3].args.p_network_hash);
 }finally{for(const app of apps)await app.close();}
});
test('production installer refuses an absent shared database',async()=>{
 const previous=process.env.NODE_ENV,app=Fastify();process.env.NODE_ENV='production';try{await assert.rejects(registerRequestQuotas(app),/Shared OTP quota database required/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;await app.close();}
});

test('same phone on another network gets a different verification subject key',async()=>{
 const db=dbFixture();for(const ip of ['203.0.113.1','203.0.113.2'])await consumeSharedOtpQuota({ip},reply(),db,{action:'verify',phoneHash:'a'.repeat(64)});assert.notEqual(db.calls[0].args.p_subject_hash,db.calls[1].args.p_subject_hash);
});
