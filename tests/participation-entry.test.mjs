import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness,read,deferred,flush} from './helpers/participation-harness.mjs';
test('auth without a selected event cannot send or verify an OTP',async()=>{
  const f=harness();f.memory.delete('vc_last_joined');await f.mount();await f.state.sendSMS();await f.state.verifyOTP();
  assert.equal(f.calls.length,0);assert.ok(f.navigation.every(x=>x==='/'));
});
for(const id of [null,'absent'])test('verify never substitutes another event for '+id,async()=>{
  const f=harness('VerifyScreen');id?f.memory.set('vc_last_joined',id):f.memory.delete('vc_last_joined');await f.mount();
  assert.equal(f.calls.filter(x=>x[0]==='join').length,0);assert.equal(f.state.success.value,false);if(id)assert.equal(f.state.outcomeMessage.value,'participation.loadUnavailable');else assert.deepEqual(f.navigation,['/']);
  if(!id)assert.equal(f.calls.length,0);
});
test('verify refuses a destination changed while the list was loading',async()=>{
  const wait=deferred(),f=harness('VerifyScreen');f.store.loadProtests=()=>wait.promise;
  const pending=f.mount();f.memory.set('vc_last_joined','another');wait.resolve();await pending;
  assert.equal(f.calls.filter(x=>x[0]==='join').length,0);
});
test('explicit selected event still reaches join',async()=>{
  const f=harness('VerifyScreen');await f.mount();assert.equal(f.calls.filter(x=>x[0]==='join').length,1);assert.equal(f.state.success.value,true);
});
test('verify refuses a destination changed while reCAPTCHA was pending',async()=>{
  const f=harness('VerifyScreen'),wait=deferred();f.context.window.grecaptcha.execute=()=>wait.promise;
  const pending=f.mount();await flush();f.memory.set('vc_last_joined','another');wait.resolve('synthetic-captcha');await pending;
  assert.equal(f.calls.filter(x=>x[0]==='join').length,0);assert.equal(f.state.success.value,false);assert.deepEqual(f.navigation,['/']);
});
test('resend waits for the real result, sends once, skips reauth and preserves the request destination',async()=>{
  const f=harness();await f.state.sendSMS();f.calls.length=0;
  const wait=deferred();f.api.requestOtp=async payload=>{f.calls.push(['request',payload]);return wait.promise;};
  const first=f.state.resendSMS();await f.state.resendSMS();await flush();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].phone,'+34600000001');assert.deepEqual(f.toasts,[]);assert.equal(f.state.sending.value,true);
  wait.resolve({sent:true});await first;assert.deepEqual(f.toasts,['auth.resendToast']);assert.equal(f.state.sending.value,false);
  f.calls.length=0;f.state.otpDigits.value=['1','2','3','4','5','6'];await f.state.verifyOTP();
  assert.equal(f.calls[0][1].phone,'+34600000001');assert.equal(f.calls[0][1].country_code,'ES');
});
for(const response of [{sent:false},{},null])test('initial send rejects an unconfirmed result '+JSON.stringify(response),async()=>{
  const f=harness('AuthScreen',{requestOtp:async()=>response});await f.state.sendSMS();assert.equal(f.state.otpVisible.value,false);assert.equal(f.state.requestedOtp.value,null);assert.equal(f.state.sending.value,false);assert.deepEqual(f.toasts,['auth.verificationCannotContinue']);
});
for(const outcome of [{sent:false},{},null,{error:{status:429}},{error:{status:503}},{error:{}}])test('failed/unconfirmed resend never confirms delivery '+JSON.stringify(outcome),async()=>{
  const f=harness();await f.state.sendSMS();f.api.requestOtp=async()=>{if(outcome?.error)throw outcome.error;return outcome;};
  await f.state.resendSMS();assert.equal(f.toasts.includes('auth.resendToast'),false);assert.equal(f.state.otpVisible.value,true);assert.equal(f.state.sending.value,false);assert.equal(f.state.requestedOtp.value.phone,'+34600000001');
  if(outcome?.error?.status===429)assert.deepEqual(f.toasts,['auth.otpRateLimited']);
});
test('changed destination blocks resend and OTP checking without a service call',async()=>{
  const f=harness();await f.state.sendSMS();f.calls.length=0;f.memory.set('vc_last_joined','another');
  await f.state.resendSMS();await f.state.verifyOTP();assert.equal(f.calls.length,0);assert.equal(f.navigation.at(-1),'/');
});
test('changing number clears the accepted request, never sends and cannot interrupt a pending resend',async()=>{
  const f=harness();await f.state.sendSMS();const wait=deferred();f.api.requestOtp=()=>wait.promise;
  const pending=f.state.resendSMS();f.state.changeNumber();assert.equal(f.state.otpVisible.value,true);await flush();wait.resolve({sent:true});await pending;
  f.state.changeNumber();assert.equal(f.state.otpVisible.value,false);assert.equal(f.state.requestedOtp.value,null);assert.equal(f.state.otpDigits.value.join(''),'');
});
for(const handler of ['sendOtp','verifyOtp'])for(const fail of [false,true])test('institutional '+handler+' prevents overlap and unlocks after '+(fail?'failure':'success'),async()=>{
  const f=harness('VerifyInstitucionalScreen'),wait=deferred();let calls=0;
  f.api[handler==='sendOtp'?'sendEmailOtp':'verifyEmailOtp']=()=>{calls++;return wait.promise;};
  const first=f.state[handler]();await f.state[handler]();await flush();assert.equal(calls,1);assert.equal(f.state.loading.value,true);
  fail?wait.reject({status:503}):wait.resolve({sent:true,challenge_id:'33333333-3333-4333-8333-333333333333',verified:true,receipt:'44444444-4444-4444-8444-444444444444'});await first;assert.equal(f.state.loading.value,false);
});
test('resend and change-number are native buttons; confirmation exposes pending state',()=>{
  const source=read('AuthScreen');assert.match(source,/<button[^>]*@click="resendSMS"/);assert.match(source,/<button[^>]*@click="changeNumber"/);assert.match(source,/:aria-busy="sending" @click="verifyOTP"/);
  for(const lang of ['es','en','fr','zh']){const auth=JSON.parse(readFileSync(new URL('../apps/web/src/locales/'+lang+'.json',import.meta.url),'utf8')).auth;for(const key of ['working','changeNumber','resendToast'])assert.ok(auth[key]);}
});
const proofId='22222222-2222-4222-8222-222222222222';
test('SMS proof is bound to the accepted request and replacement resend',async()=>{
  const f=harness();await f.state.sendSMS();assert.equal(f.calls[0][1].device_id,'synthetic-device');
  const old=f.state.requestedOtp.value.requestId,wait=deferred();f.api.requestOtp=()=>wait.promise;
  const pending=f.state.resendSMS();await flush();assert.equal(f.state.requestedOtp.value.requestId,old);
  f.state.otpDigits.value=['1','2','3','4','5','6'];await f.state.verifyOTP();assert.equal(f.calls.some(c=>c[0]==='verify'),false);
  wait.resolve({sent:true,request_id:proofId});await pending;assert.equal(f.state.requestedOtp.value.requestId,proofId);
  f.state.otpDigits.value=['1','2','3','4','5','6'];await f.state.verifyOTP();
  assert.deepEqual({...f.calls.find(c=>c[0]==='verify')[1]},{phone:'+34600000001',otp:'123456',device_id:'synthetic-device',country_code:'ES',protest_id:'selected',request_id:proofId});
});
for(const request_id of [null,'',42,'invalid'])test('malformed SMS proof cannot enable confirmation '+request_id,async()=>{
  const f=harness('AuthScreen',{requestOtp:async()=>({sent:true,request_id})});await f.state.sendSMS();assert.equal(f.state.requestedOtp.value,null);assert.equal(f.state.otpVisible.value,false);
});
test('legacy confirmed send omits proof rather than inventing one',async()=>{
  const f=harness('AuthScreen',{requestOtp:async()=>({sent:true})});await f.state.sendSMS();f.state.otpDigits.value=['1','2','3','4','5','6'];await f.state.verifyOTP();assert.equal(Object.hasOwn(f.calls.find(c=>c[0]==='verify')[1],'request_id'),false);
});
const changeOtpContext={phone:f=>f.state.phone.value='600000002',country:f=>f.state.countryCode.value='FR',device:f=>f.device.getDeviceId=()=> 'different-device',destination:f=>f.memory.set('vc_last_joined','another'),target:f=>f.store.protests[0].country='FR',unmount:f=>f.unmount()};
for(const [name,change] of Object.entries(changeOtpContext))for(const stage of ['recaptcha','request','verify'])test('changed '+name+' discards pending '+stage,async()=>{
  const wait=deferred(),f=harness();
  if(stage==='verify')await f.state.sendSMS();
  if(stage==='recaptcha')f.context.window.grecaptcha.execute=()=>wait.promise;
  if(stage==='request')f.api.requestOtp=()=>wait.promise;
  if(stage==='verify'){f.state.otpDigits.value=['1','2','3','4','5','6'];f.api.verifyOtp=()=>wait.promise;}
  const pending=stage==='verify'?f.state.verifyOTP():f.state.sendSMS();await flush();change(f);
  wait.resolve(stage==='recaptcha'?'captcha':stage==='request'?{sent:true,request_id:proofId}:{verified:true,device_id:'canonical-device',participation_token:'replacement-token'});await pending;
  assert.equal(f.navigation.includes('/verify'),false);assert.equal(f.memory.get('vc_participation_token'),'synthetic-token');
  if(stage!=='verify')assert.equal(f.state.requestedOtp.value,null);
  if(stage==='recaptcha')assert.equal(f.calls.some(c=>c[0]==='request'),false);
});
test('client billing flags are absent from both screens and join payload',async()=>{
  for(const name of ['AuthScreen','VerifyScreen'])assert.doesNotMatch(read(name),/vc_sms_sent|sms_sent/);
  const f=harness('VerifyScreen');f.memory.set('vc_sms_sent','true');await f.mount();assert.equal(Object.hasOwn(f.calls.find(c=>c[0]==='join')[2],'sms_sent'),false);
});
for(const [name,change] of Object.entries(changeOtpContext).filter(([name])=>name!=='unmount'))test('changed '+name+' blocks verification before the API call',async()=>{
  const f=harness();await f.state.sendSMS();f.calls.length=0;f.state.otpDigits.value=['1','2','3','4','5','6'];change(f);await f.state.verifyOTP();assert.equal(f.calls.length,0);assert.equal(f.navigation.includes('/verify'),false);
});
test('late resend proof is discarded after device changes',async()=>{
  const f=harness();await f.state.sendSMS();const original=f.state.requestedOtp.value,wait=deferred();f.api.requestOtp=()=>wait.promise;
  const pending=f.state.resendSMS();await flush();f.device.getDeviceId=()=> 'changed-device';wait.resolve({sent:true,request_id:proofId});await pending;
  assert.equal(f.state.requestedOtp.value,original);assert.equal(f.toasts.includes('auth.resendToast'),false);
});
test('canonical identity is adopted only after verification of the captured request device',async()=>{
  const f=harness('AuthScreen',{verifyOtp:async payload=>{assert.equal(payload.device_id,'synthetic-device');return {verified:true,device_id:'canonical-device',participation_token:'canonical-token'};}});
  let adopted;f.device.setDeviceId=id=>{adopted=id;};await f.state.sendSMS();f.state.otpDigits.value=['1','2','3','4','5','6'];await f.state.verifyOTP();
  assert.equal(adopted,'canonical-device');assert.equal(f.memory.get('vc_participation_token'),'canonical-token');assert.equal(f.navigation.at(-1),'/verify');
});
