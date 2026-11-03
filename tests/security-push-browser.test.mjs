import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withClientDeadline} from '../apps/web/src/services/requestJson.js';
const source=readFileSync(new URL('../apps/web/src/screens/VerifyScreen.vue',import.meta.url),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://api.example.invalid'").replaceAll('import.meta.env.VITE_RECAPTCHA_KEY',"'synthetic'");
function fixture(statuses=[201],secret='a'.repeat(64),errorCode='PUSH_ENDPOINT_OWNED'){
  const requests=[],toasts=[],unmounted=[];let permissions=0,subscriptions=0,unsubscribed=0,globalId='local-device-id',currentSecret=secret;
  const memory=new Map([['vc_last_joined','11111111-1111-1111-1111-111111111111'],['vc_device_id','local-device-id']]);
  const reg={pushManager:{subscribe:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+(++subscriptions),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)},unsubscribe:async()=>{unsubscribed++;return true;}})}};
  const context={withClientDeadline:fn=>withClientDeadline(fn,{timeoutMs:30}),ref:value=>({value}),watch(){},onMounted(){},onUnmounted:fn=>unmounted.push(fn),useRouter:()=>({}),useI18n:()=>({t:key=>key,locale:{value:'en'}}),
    useDeviceStore:()=>({getDeviceId:()=>globalId,getDeviceSecret:()=>currentSecret}),
    useProtestsStore:()=>({protests:[]}),useUiStore:()=>({showToast:msg=>toasts.push(msg)}),
    sessionStorage:{getItem:key=>memory.get(key)??null},localStorage:{getItem:()=> 'en'},
    navigator:{language:'en',serviceWorker:{ready:Promise.resolve(reg)}},Notification:{requestPermission:async()=>{permissions++;return 'granted';}},
    Intl,Uint8Array,window:{atob:globalThis.atob},fetch:async(url,opts)=>{
      if(url.endsWith('vapid-public-key'))return {ok:true,json:async()=>({publicKey:'dGVzdA'})};
      requests.push(JSON.parse(opts.body));const status=statuses[requests.length-1];return {status,ok:status>=200&&status<300,json:async()=>({error:errorCode})};
    }};
  vm.createContext(context);vm.runInContext(source+';globalThis.run=activarNotificacion;globalThis.state=notiActivada;globalThis.flow={confirmedProtestId,confirmedIdentity,notiPending,receipt,success};',context);
  context.flow.receipt.value='44444444-4444-4444-8444-444444444444';context.flow.success.value=true;
  context.flow.confirmedProtestId.value='11111111-1111-1111-1111-111111111111';context.flow.confirmedIdentity.value='local-device-id';
  return {context,reg,memory,unmount:()=>unmounted.forEach(fn=>fn()),setSecret:value=>{currentSecret=value;},setGlobal:id=>{globalId=id;},subscriptions:()=>subscriptions,run:()=>context.run(),activated:()=>context.state.value,requests,toasts,permissions:()=>permissions,unsubscribed:()=>unsubscribed};
}
test('global identity B cannot subscribe from the receipt of tab identity A',async()=>{
 const f=fixture();f.setGlobal('identity-B');await f.run();assert.equal(f.permissions(),0);assert.equal(f.subscriptions(),0);assert.equal(f.requests.length,0);assert.equal(f.activated(),false);
});
test('a global identity switch while permission is pending blocks provider subscription and server save',async()=>{
 const f=fixture();let resolve;f.context.Notification.requestPermission=()=>new Promise(r=>resolve=r);
 const first=f.run();await f.run();f.setGlobal('identity-B');resolve('granted');await first;
 assert.equal(f.subscriptions(),0);assert.equal(f.requests.length,0);assert.equal(f.context.flow.notiPending.value,false);
});
test('VAPID network hang is bounded and never creates a push subscription',async()=>{
 const f=fixture();f.context.fetch=()=>new Promise(()=>{});await f.run();assert.equal(f.subscriptions(),0);assert.equal(f.requests.length,0);assert.equal(f.context.flow.notiPending.value,false);
});
test('identity changed at ownership conflict preserves the existing browser subscription',async()=>{
 const f=fixture([409]);const fetch=f.context.fetch;
 f.context.fetch=async(url,options)=>{const response=await fetch(url,options);if(url.endsWith('/subscribe')){const json=response.json;response.json=async()=>{const data=await json();f.setGlobal('identity-B');return data;};}return response;};
 await f.run();assert.equal(f.unsubscribed(),0);assert.equal(f.requests.length,1);assert.equal(f.activated(),false);
});
test('push uses a proof matching the confirmed per-tab identity',async()=>{
  const f=fixture();await f.run();assert.equal(f.activated(),true);assert.equal(f.requests[0].device_id,'local-device-id');assert.equal(f.requests[0].device_secret,'a'.repeat(64));
});
test('generic conflict and non-ownership failures never unsubscribe the browser',async()=>{
  for(const status of [401,404,409]){
    const f=fixture([status],'a'.repeat(64),'OTHER_CONFLICT');await f.run();
    assert.equal(f.activated(),false);assert.equal(f.unsubscribed(),0);assert.equal(f.requests.length,1);
  }
});
test('an ownership conflict preserves the browser endpoint without automatic retry or revocation',async()=>{
  const f=fixture([409,201]);await f.run();assert.equal(f.activated(),false);assert.equal(f.unsubscribed(),0);assert.equal(f.subscriptions(),1);assert.equal(f.requests.length,1);assert.deepEqual(f.toasts,['verify.notiError']);
  assert.equal(f.context.flow.receipt.value,'44444444-4444-4444-8444-444444444444');assert.equal(f.context.flow.success.value,true);
});
test('registration failures remain inactive and display a translated error',async()=>{
  for(const f of [fixture([503]),fixture([409,409]),fixture([201],null)]){
    await f.run();assert.equal(f.activated(),false);assert.deepEqual(f.toasts,['verify.notiError']);
    if(f.requests.length===0)assert.equal(f.permissions(),0);
  }
  for(const lang of ['es','en','fr','zh'])assert.ok(JSON.parse(readFileSync('apps/web/src/locales/'+lang+'.json','utf8')).verify.notiError);
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function delayedSave(f){
  let resolve,reject;const wait=new Promise((a,b)=>{resolve=a;reject=b;});const original=f.context.fetch;
  f.context.fetch=async(url,options)=>{const response=await original(url,options);if(url.endsWith('/subscribe'))await wait;return response;};
  return {resolve,reject};
}
for(const change of ['unmount','identity','destination','secret','storage-error'])for(const response of ['success','server-error','network-error'])test('pending push '+response+' stays silent after '+change,async()=>{
  const f=fixture([response==='success'?201:503]),wait=delayedSave(f);const pending=f.run();await flush();assert.equal(f.requests.length,1);
  if(change==='unmount')f.unmount();
  if(change==='identity')f.setGlobal('identity-B');
  if(change==='destination')f.memory.set('vc_last_joined','another-event');
  if(change==='secret')f.setSecret('b'.repeat(64));
  if(change==='storage-error')f.context.sessionStorage.getItem=()=>{throw Error('synthetic storage unavailable');};
  response==='network-error'?wait.reject(Error('synthetic transport failure')):wait.resolve();await pending;
  assert.equal(f.activated(),false);assert.deepEqual(f.toasts,[]);assert.equal(f.unsubscribed(),0);assert.equal(f.requests.length,1);assert.equal(f.context.flow.notiPending.value,false);
  assert.equal(f.context.flow.receipt.value,'44444444-4444-4444-8444-444444444444');assert.equal(f.context.flow.success.value,true);
});
test('a valid pending registration is single-flight and confirms only after save',async()=>{
 const f=fixture(),wait=delayedSave(f);const pending=f.run();await flush();await f.run();
 assert.equal(f.permissions(),1);assert.equal(f.subscriptions(),1);assert.equal(f.requests.length,1);assert.equal(f.activated(),false);assert.equal(f.context.flow.notiPending.value,true);
 wait.resolve();await pending;assert.equal(f.activated(),true);assert.equal(f.context.flow.notiPending.value,false);assert.deepEqual(f.toasts,[]);assert.equal(f.unsubscribed(),0);
});
test('activation after unmount cannot request permission or touch a browser subscription',async()=>{
 const f=fixture();f.unmount();await f.run();assert.equal(f.permissions(),0);assert.equal(f.subscriptions(),0);assert.equal(f.requests.length,0);assert.deepEqual(f.toasts,[]);assert.equal(f.activated(),false);
});
