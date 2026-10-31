import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createI18n} from 'vue-i18n';
import {ref,computed,reactive} from 'vue';
import {harness,deferred,flush,read} from './helpers/participation-harness.mjs';
import {readOutcome,writeOutcome} from '../apps/web/src/lib/participationOutcome.js';
const RECEIPT='44444444-4444-4444-8444-444444444444';
const NONCE='33333333-3333-4333-8333-333333333333';
const CONTEXT='email:selected:'+NONCE;
const event=extra=>({id:'selected',title:'Chosen institution',dominio_email:'example.invalid',timer:3600,...extra});
function fresh(overrides={}) {
  const f=harness('VerifyInstitucionalScreen',overrides);
  f.store.protests=[];
  f.state.activeContext.value=null;
  f.state.sentContext.value=null;
  return f;
}
function record(f,state) {
  f.memory.set('vc_institutional_outcome_context:selected',NONCE);
  if(state==='uncertain')writeOutcome(f.context.sessionStorage,CONTEXT,{state:'pending',attemptId:NONCE});
  writeOutcome(f.context.sessionStorage,CONTEXT,{state,receipt:RECEIPT,title:'Original confirmed event',attemptId:state==='uncertain'?NONCE:undefined});
}

test('institutional direct entry waits for the exact event before allowing an email request',async()=>{
  let sends=0;const wait=deferred();const f=fresh({sendEmailOtp:async()=>{sends++;return {sent:true,challenge_id:NONCE};}});
  const ids=[];f.store.fetchProtestById=id=>{ids.push(id);return wait.promise;};
  const mounting=f.mount();assert.equal(f.state.availability.value,'loading');
  await f.state.sendOtp();assert.equal(sends,0);
  wait.resolve(event());await mounting;
  assert.deepEqual(ids,['selected']);assert.equal(f.state.availability.value,'ready');assert.equal(f.state.dominio.value,'example.invalid');
  await f.state.sendOtp();assert.equal(sends,1);assert.equal(f.state.step.value,2);
});

test('a failed event load has a manual single-flight retry and never spends an email request',async()=>{
  let loads=0,sends=0;const wait=deferred();const f=fresh({sendEmailOtp:async()=>{sends++;}});
  f.store.fetchProtestById=async()=>{loads++;if(loads===1)throw {status:503};return wait.promise;};
  await f.mount();assert.equal(f.state.availability.value,'error');await f.state.sendOtp();assert.equal(sends,0);
  const retry=f.state.loadProtest();const duplicate=f.state.loadProtest();await duplicate;
  assert.equal(loads,2);assert.equal(f.state.availability.value,'loading');
  wait.resolve(event());await retry;assert.equal(f.state.availability.value,'ready');assert.equal(sends,0);
});

for(const [name,result,availability] of [
  ['missing',null,'missing'],['not institutional',event({dominio_email:null}),'noninstitutional'],
  ['malformed domain',event({dominio_email:'your institution'}),'noninstitutional'],
  ['closed',event({timer:0}),'closed'],['unknown closing state',event({timer:undefined}),'closed'],
])test('institutional direct entry blocks '+name+' without an OTP request',async()=>{
  let sends=0;const f=fresh({sendEmailOtp:async()=>{sends++;}});f.store.fetchProtestById=async()=>result;
  await f.mount();assert.equal(f.state.availability.value,availability);await f.state.sendOtp();assert.equal(sends,0);assert.notEqual(f.state.dominio.value,'your institution');
});

for(const state of ['completed','pending','uncertain'])test('restored '+state+' precedes unavailable event loading and cannot replay OTP',async()=>{
  let sends=0,verifies=0,loads=0;const f=fresh({sendEmailOtp:async()=>{sends++;},verifyEmailOtp:async()=>{verifies++;}});
  f.store.fetchProtestById=async()=>{loads++;throw {status:404};};record(f,state);
  await f.mount();assert.equal(loads,0);assert.equal(f.state.step.value,state==='completed'?3:4);
  if(state==='completed'){assert.equal(f.state.receiptHash.value,RECEIPT);assert.equal(f.state.confirmedTitle.value,'Original confirmed event');}
  await f.state.sendOtp();await f.state.verifyOtp();assert.equal(sends,0);assert.equal(verifies,0);
});

test('a new explicit verification after a restored receipt resolves the event before enabling the form',async()=>{
  const f=fresh();record(f,'completed');await f.mount();
  const wait=deferred();f.store.fetchProtestById=()=>wait.promise;
  f.state.newInstitutionalVerification();assert.equal(f.state.step.value,1);assert.equal(f.state.availability.value,'loading');
  wait.resolve(event());await flush();assert.equal(f.state.availability.value,'ready');assert.equal(f.state.activeContext.value,null);
});

test('resolved direct-link context survives removal from the background list without inventing a domain',async()=>{
  const f=fresh();f.store.fetchProtestById=async()=>event();await f.mount();
  f.store.protests=[];assert.equal(f.state.availability.value,'ready');assert.equal(f.state.dominio.value,'example.invalid');
  f.store.protests=[event({dominio_email:'changed.invalid'})];assert.equal(f.state.dominio.value,'changed.invalid');
});

for(const change of ['domain','closure','email','unmount'])test('institutional send cancels before dispatch when '+change+' changes during CAPTCHA',async()=>{
  const wait=deferred();let sends=0;const f=harness('VerifyInstitucionalScreen',{sendEmailOtp:async()=>{sends++;}});
  f.context.window.grecaptcha.execute=()=>wait.promise;
  const pending=f.state.sendOtp();await flush();
  if(change==='domain')f.store.protests[0].dominio_email='changed.invalid';
  if(change==='closure')f.store.protests[0].timer=0;
  if(change==='email')f.state.email.value='other@example.invalid';
  if(change==='unmount')f.unmount();
  wait.resolve('synthetic');await pending;assert.equal(sends,0);assert.equal(f.state.loading.value,false);
});

test('a sent code preserves its email even if the mutable form changes after dispatch',async()=>{
  const wait=deferred();let payload;const f=harness('VerifyInstitucionalScreen',{sendEmailOtp:()=>wait.promise,verifyEmailOtp:async p=>{payload=p;return {verified:true,receipt:RECEIPT};}});
  const sending=f.state.sendOtp();await flush();f.state.email.value='other@example.invalid';wait.resolve({sent:true,challenge_id:NONCE});await sending;
  await f.state.verifyOtp();assert.equal(payload.email,'synthetic@example.invalid');assert.equal(payload.protest_id,'selected');assert.equal(f.state.step.value,3);
});

for(const change of ['domain','closure','unmount'])test('verification never dispatches if '+change+' changes while its module is loading',async()=>{
  let verifies=0;const wait=deferred();const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:async()=>{verifies++;}});
  f.context.apiFixture=wait.promise;const pending=f.state.verifyOtp();
  if(change==='domain')f.store.protests[0].dominio_email='changed.invalid';
  if(change==='closure')f.store.protests[0].timer=0;
  if(change==='unmount')f.unmount();
  wait.resolve(f.api);await pending;assert.equal(verifies,0);assert.equal(f.state.loading.value,false);
});

test('verification snapshots OTP and email before module preparation and retains the original receipt title',async()=>{
  let payload;const wait=deferred();const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:async p=>{payload=p;return {verified:true,receipt:RECEIPT};}});
  f.context.apiFixture=wait.promise;const pending=f.state.verifyOtp();f.state.otp.value='654321';f.state.email.value='other@example.invalid';
  f.store.protests[0].title='A different title';wait.resolve(f.api);await pending;
  assert.equal(payload.otp,'123456');assert.equal(payload.email,'synthetic@example.invalid');assert.equal(f.state.confirmedTitle.value,'Synthetic selected event');
});

test('completed or uncertain journal wins over domain and closing changes before verification',async()=>{
  for(const state of ['completed','uncertain']){
    let verifies=0;const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:async()=>{verifies++;}});
    if(state==='uncertain')writeOutcome(f.context.sessionStorage,f.state.activeContext.value,{state:'pending',attemptId:NONCE});
    writeOutcome(f.context.sessionStorage,f.state.activeContext.value,{state,receipt:RECEIPT,title:'Saved title',attemptId:state==='uncertain'?NONCE:undefined});
    f.store.protests[0].dominio_email='changed.invalid';f.store.protests[0].timer=0;f.state.otp.value='';
    await f.state.verifyOtp();assert.equal(verifies,0);assert.equal(f.state.step.value,state==='completed'?3:4);
    if(state==='completed')assert.equal(f.state.receiptHash.value,RECEIPT);
  }
});

test('changing email cannot interrupt an institutional send or verification',async()=>{
  for(const operation of ['sendOtp','verifyOtp']){
    const wait=deferred();const f=harness('VerifyInstitucionalScreen',{[operation==='sendOtp'?'sendEmailOtp':'verifyEmailOtp']:()=>wait.promise});
    const pending=f.state[operation]();await flush();const before=f.state.activeContext.value;
    f.state.changeEmail();assert.equal(f.state.loading.value,true);assert.equal(f.state.activeContext.value,before);
    wait.resolve(operation==='sendOtp'?{sent:true,challenge_id:NONCE}:{verified:true,receipt:RECEIPT});await pending;
  }
});

test('institutional form exposes translated placeholder and no substitute domain',()=>{
  const source=read('VerifyInstitucionalScreen');assert.ok(source.includes("$t('verificacional.emailPlaceholder', { domain: dominio })"));assert.ok(!source.includes('Ej:'));assert.ok(!source.includes("t('verificacional.yourInstitution')"));
  const hints=['es','en','fr','zh'].map(lang=>JSON.parse(fs.readFileSync(new URL('../apps/web/src/locales/'+lang+'.json',import.meta.url),'utf8')).auth.phoneHint);
  assert.equal(hints.length,4);assert.ok(hints.every(h=>h.length>0));assert.doesNotMatch(hints.join(' '),/indescifrable|undecipherable|indéchiffrable|无法破解/i);
});

test('resolved event expiry uses its absolute deadline even after removal from a background list',async()=>{
  const f=fresh();f.store.fetchProtestById=async()=>event({endsAtMs:2000});f.context.Date={parse:Date.parse,now:()=>1000};
  await f.mount();assert.equal(f.state.availability.value,'ready');f.context.Date.now=()=>3000;
  assert.equal(f.state.availability.value,'closed');await f.state.sendOtp();assert.equal(f.state.sentContext.value,null);
});

test('a confirmed response after event closure retains its original receipt, context and title',async()=>{
  const wait=deferred();const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:()=>wait.promise});
  const originalContext=f.state.activeContext.value;const pending=f.state.verifyOtp();await flush();
  f.store.protests[0].timer=0;f.store.protests[0].title='Changed while pending';
  wait.resolve({verified:true,receipt:RECEIPT});await pending;
  assert.equal(f.state.step.value,3);assert.equal(f.state.receiptHash.value,RECEIPT);assert.equal(f.state.confirmedTitle.value,'Synthetic selected event');
  assert.equal(readOutcome(f.context.sessionStorage,originalContext).receipt,RECEIPT);
});

test('a domain change before code dispatch gives explicit context feedback without sending',async()=>{
  const wait=deferred();let sends=0;const f=harness('VerifyInstitucionalScreen',{sendEmailOtp:async()=>{sends++;}});
  f.context.window.grecaptcha.execute=()=>wait.promise;const pending=f.state.sendOtp();await flush();
  f.store.protests[0].dominio_email='changed.invalid';wait.resolve('synthetic');await pending;
  assert.equal(f.state.emailError.value,'verificacional.contextChanged');assert.equal(sends,0);
});


for(const lang of ['es','en','fr','zh'])test('real vue-i18n renders the institutional email placeholder in '+lang,()=>{
  const messages=JSON.parse(fs.readFileSync(new URL('../apps/web/src/locales/'+lang+'.json',import.meta.url),'utf8'));
  const i18n=createI18n({legacy:false,locale:lang,messages:{[lang]:messages}});
  const rendered=i18n.global.t('verificacional.emailPlaceholder',{domain:'example.invalid'});
  assert.match(rendered,/@example\.invalid/);assert.doesNotMatch(rendered,/\{domain\}|\{'@'\}/);
  assert.equal(i18n.global.t('auth.phoneHint'),messages.auth.phoneHint);
});


for(const operation of ['sendOtp','verifyOtp'])test('real cached Vue computed cannot permit '+operation+' after absolute expiry during asynchronous preparation',async()=>{
  let clock=1000,sends=0,verifies=0;
  const wait=deferred();
  const f=harness('VerifyInstitucionalScreen',{
    sendEmailOtp:async()=>{sends++;return {sent:true,challenge_id:NONCE};},
    verifyEmailOtp:async()=>{verifies++;return {verified:true,receipt:RECEIPT};},
  },{ref,computed,reactive,globals:{Date:{now:()=>clock,parse:Date.parse}}});
  f.store.protests[0].endsAtMs=2000;
  // A background list refresh stops updating the resolved snapshot's timer.
  await f.mount();f.store.protests=[];
  assert.equal(f.state.availability.value,'ready');
  if(operation==='sendOtp')f.context.window.grecaptcha.execute=()=>wait.promise;
  else f.context.apiFixture=wait.promise;
  const pending=f.state[operation]();await flush();
  // Read as a rendered view would after the handler updated its checked timestamp.
  assert.equal(f.state.availability.value,'ready');clock=3000;
  // Date.now is not reactive: the actual Vue computed really is still cached ready.
  assert.equal(f.state.availability.value,'ready');
  wait.resolve(operation==='sendOtp'?'synthetic':f.api);await pending;
  assert.equal(sends,0);assert.equal(verifies,0);assert.equal(f.state.loading.value,false);
  assert.equal(f.state.availability.value,'closed');
});

test('real Vue cached ready cannot permit an initial send after absolute expiry',async()=>{
  let clock=1000,sends=0;
  const f=harness('VerifyInstitucionalScreen',{sendEmailOtp:async()=>{sends++;}},
    {ref,computed,reactive,globals:{Date:{now:()=>clock,parse:Date.parse}}});
  f.store.protests[0].endsAtMs=2000;await f.mount();f.store.protests=[];
  assert.equal(f.state.availability.value,'ready');clock=3000;assert.equal(f.state.availability.value,'ready');
  await f.state.sendOtp();assert.equal(sends,0);assert.equal(f.state.availability.value,'closed');
});
