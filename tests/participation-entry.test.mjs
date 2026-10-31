import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {shouldSkipFastPath, clearForceOtp, preSmsRejectionKey} from '../apps/web/src/lib/nationalPreCheck.js';

// Execute the actual Vue scripts. Every service/browser capability is synthetic.
const read = name => readFileSync(new URL('../apps/web/src/screens/'+name+'.vue', import.meta.url),'utf8');
const script = name => read(name).match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*;\n/gm,'').replace(/import\.meta\.env\.\w+/g,"'synthetic'")
  .replaceAll("import('@/services/api.js')",'Promise.resolve(apiFixture)');
const ref = value => ({value});
const computed = fn => ({get value(){return fn();}});
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush = () => new Promise(r=>setImmediate(r));
function harness(name='AuthScreen', overrides={}) {
  let mounted; const toasts=[],navigation=[],calls=[];
  const memory=new Map([['vc_last_joined','selected']]);
  const sessionStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
  const store={protests:[{id:'selected',scope:'global',risk_level:'low',dominio_email:name==='VerifyInstitucionalScreen'?'example.invalid':null}],
    loadProtests:async()=>{calls.push(['load']);},joinProtest:()=>calls.push(['localJoin'])};
  const api={requestOtp:async payload=>{calls.push(['request',payload]);return {sent:true};},
    verifyOtp:async payload=>{calls.push(['verify',payload]);return {participation_token:'synthetic-token',device_id:'synthetic-device'};},
    fetchDeviceLocks:async()=>{calls.push(['locks']);return [];},fetchCountryCodes:async()=>[],
    sendEmailOtp:async()=>{},verifyEmailOtp:async()=>({receipt:'synthetic-receipt'}),
    joinProtest:async()=>{calls.push(['join']);return {receipt:'synthetic-receipt'};},...overrides};
  const context={ref,computed,onMounted:fn=>mounted=fn,onUnmounted(){},watch(){},
    useI18n:()=>({t:k=>k,locale:ref('es')}),useRouter:()=>({push:p=>navigation.push(p)}),
    useRoute:()=>({params:{protestId:'selected'}}),useProtestsStore:()=>store,
    useDeviceStore:()=>({gpsReady:false,getDeviceSecret:()=>null,getDeviceId:()=> 'synthetic-device'}),
    useUiStore:()=>({showToast:m=>toasts.push(m),revealInstallBanner(){}}),
    shouldSkipFastPath,clearForceOtp,preSmsRejectionKey,sessionStorage,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},api,apiFixture:api,
    window:{grecaptcha:{ready:fn=>fn(),execute:async()=> 'synthetic-captcha'}},navigator:{},setTimeout(){},
  };
  vm.createContext(context);
  const exports=name==='AuthScreen'?'sendSMS,resendSMS,verifyOTP,changeNumber,phone,countryCode,countryCodes,otpDigits,otpVisible,requestedOtp,sending':name==='VerifyInstitucionalScreen'?'sendOtp,verifyOtp,email,otp,loading,step':'success';
  vm.runInContext(script(name)+'\nglobalThis.state={'+exports+'};',context);
  const state=context.state;
  if(name==='AuthScreen'){state.phone.value='600000001';state.countryCodes.value=[{iso2:'ES',dial_code:'34'}];}
  if(name==='VerifyInstitucionalScreen'){state.email.value='synthetic@example.invalid';state.otp.value='123456';}
  return {state,context,api,calls,toasts,navigation,memory,store,mount:()=>mounted()};
}
test('auth without a selected event cannot send or verify an OTP',async()=>{
  const f=harness();f.memory.delete('vc_last_joined');await f.mount();await f.state.sendSMS();await f.state.verifyOTP();
  assert.equal(f.calls.length,0);assert.ok(f.navigation.every(x=>x==='/'));
});
for(const id of [null,'absent'])test('verify never substitutes another event for '+id,async()=>{
  const f=harness('VerifyScreen');id?f.memory.set('vc_last_joined',id):f.memory.delete('vc_last_joined');await f.mount();
  assert.equal(f.calls.filter(x=>x[0]==='join').length,0);assert.equal(f.state.success.value,false);assert.deepEqual(f.navigation,['/']);
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
  const f=harness();await f.state.sendSMS();f.calls.length=0;f.state.phone.value='999999999';f.state.countryCode.value='FR';
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
  fail?wait.reject({status:503}):wait.resolve({receipt:'synthetic'});await first;assert.equal(f.state.loading.value,false);
});
test('resend and change-number are native buttons; confirmation exposes pending state',()=>{
  const source=read('AuthScreen');assert.match(source,/<button[^>]*@click="resendSMS"/);assert.match(source,/<button[^>]*@click="changeNumber"/);assert.match(source,/:aria-busy="sending" @click="verifyOTP"/);
  for(const lang of ['es','en','fr','zh']){const auth=JSON.parse(readFileSync(new URL('../apps/web/src/locales/'+lang+'.json',import.meta.url),'utf8')).auth;for(const key of ['working','changeNumber','resendToast'])assert.ok(auth[key]);}
});
