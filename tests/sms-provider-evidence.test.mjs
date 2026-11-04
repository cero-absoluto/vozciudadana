import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {OtpProviderError} from '../apps/api/src/lib/otpProvider.js';

process.env.TWILIO_ACCOUNT_SID='AC'+'1'.repeat(32);
process.env.TWILIO_AUTH_TOKEN='synthetic-sdk-token';
process.env.TWILIO_VERIFY_SID='VA'+'2'.repeat(32);
process.env.PHONE_HASH_SECRET='synthetic-provider-hash-key';
const phone='+34600000001',code='123456',sid='VE'+'ab'.repeat(16);
const calls=[],clients=[];
let respond;
mock.module('twilio',{defaultExport:(account,token,options)=>{
  clients.push({account,token,options});
  return {verify:{v2:{services:service=>{
    assert.equal(service,process.env.TWILIO_VERIFY_SID);
    const create=kind=>args=>{calls.push({kind,args});return respond(kind,args);};
    return {verifications:{create:create('send')},verificationChecks:{create:create('check')}};
  }}}};
}});
const {sendOtp,verifyOtp}=await import('../apps/api/src/services/twilio.js');
const {providerVerificationHash}=await import('../apps/api/src/lib/smsChargeEvidence.js');
const safeError=error=>{
  assert.ok(error instanceof OtpProviderError);
  assert.equal(error.message,'OTP provider unavailable');
  assert.equal(error.cause,undefined);
  for(const secret of [phone,sid,'https://synthetic.invalid/private'])assert.equal(JSON.stringify(error).includes(secret),false);
  return true;
};
test.beforeEach(()=>{calls.length=0;respond=()=>{throw new Error('unconfigured synthetic SDK');};});

test('real Twilio adapter explicitly returns provider evidence and disables SDK retries',async()=>{
  respond=kind=>Promise.resolve({status:kind==='send'?'pending':'approved',sid});
  assert.deepEqual(await sendOtp(phone,{evidence:true}),{status:'pending',sid});
  assert.deepEqual(await verifyOtp(phone,code,{evidence:true}),{approved:true,sid});
  assert.deepEqual(calls,[{kind:'send',args:{to:phone,channel:'sms'}},{kind:'check',args:{to:phone,code}}]);
  assert.equal(clients.length,1);
  assert.deepEqual(clients[0],{account:process.env.TWILIO_ACCOUNT_SID,token:process.env.TWILIO_AUTH_TOKEN,options:{timeout:8000,autoRetry:false}});
});
test('legacy callers keep undefined delivery and boolean approval without SID',async()=>{
  respond=kind=>Promise.resolve({status:kind==='send'?'pending':'approved'});
  assert.equal(await sendOtp(phone),undefined);
  assert.equal(await verifyOtp(phone,code),true);
  assert.equal(calls.length,2);
});
test('evidence mode refuses absent or malformed SID for pending and approved results',async()=>{
  for(const invalid of [undefined,'','VE'+'g'.repeat(32),'VA'+'a'.repeat(32),sid+'0']){
    respond=kind=>Promise.resolve({status:kind==='send'?'pending':'approved',sid:invalid});
    const before=calls.length;
    await assert.rejects(sendOtp(phone,{evidence:true}),safeError);
    await assert.rejects(verifyOtp(phone,code,{evidence:true}),safeError);
    assert.equal(calls.length,before+2);
  }
});
test('unapproved statuses cannot mint evidence even when provider returns a valid SID',async()=>{
  for(const status of ['pending','expired','canceled','max_attempts_reached','deleted','failed']){
    respond=()=>Promise.resolve({status,sid});
    assert.equal(await verifyOtp(phone,code,{evidence:true}),false);
  }
  assert.equal(calls.length,6);
});
test('provider errors discard identifying details without logging or extra attempts',async t=>{
  const logs=[];
  for(const method of ['log','warn','error'])t.mock.method(console,method,(...args)=>logs.push(args));
  const poison=new Error(`${phone} ${sid} https://synthetic.invalid/private`);
  poison.status=503;
  respond=()=>Promise.reject(poison);
  await assert.rejects(sendOtp(phone,{evidence:true}),safeError);
  await assert.rejects(verifyOtp(phone,code,{evidence:true}),safeError);
  assert.equal(calls.length,2);assert.deepEqual(logs,[]);
});
test('actual application deadline bounds a stalled SDK request and late approval is ignored',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let release;
  respond=()=>new Promise(resolve=>{release=resolve;});
  const pending=verifyOtp(phone,code,{evidence:true});
  const rejected=assert.rejects(pending,safeError);
  t.mock.timers.tick(10000);
  await rejected;
  release({status:'approved',sid});
  await Promise.resolve();
  assert.equal(calls.length,1);
});
test('provider hashes canonicalize case, use the configured secret and never expose raw SID',()=>{
  const first=providerVerificationHash(sid);
  assert.match(first,/^[0-9a-f]{64}$/);
  // Fixed HMAC fixture includes the provider-verification domain and lowercase SID.
  assert.equal(first,'15fd816222475d438d91e187962d924a5cf867180dba5db434e6b28682dc8e69');
  assert.equal(providerVerificationHash(sid.toUpperCase()),first);
  assert.notEqual(first,sid);
  assert.equal(first.includes(sid),false);
  const previous=process.env.PHONE_HASH_SECRET;
  try{
    process.env.PHONE_HASH_SECRET='another-synthetic-key';
    assert.notEqual(providerVerificationHash(sid),first);
    delete process.env.PHONE_HASH_SECRET;
    assert.throws(()=>providerVerificationHash(sid));
  }finally{process.env.PHONE_HASH_SECRET=previous;}
  for(const invalid of [undefined,'',sid+'0','VA'+'a'.repeat(32)])assert.throws(()=>providerVerificationHash(invalid));
});
