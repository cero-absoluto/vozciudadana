import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/web/src/screens/VerifyScreen.vue',import.meta.url),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://api.example.invalid'").replaceAll('import.meta.env.VITE_RECAPTCHA_KEY',"'synthetic'");
function fixture(statuses=[201],secret='a'.repeat(64),errorCode='PUSH_ENDPOINT_OWNED'){
  const requests=[],toasts=[];let permissions=0,subscriptions=0,unsubscribed=0;
  const reg={pushManager:{subscribe:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+(++subscriptions),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)},unsubscribe:async()=>{unsubscribed++;return true;}})}};
  const context={ref:value=>({value}),onMounted(){},useRouter:()=>({}),useI18n:()=>({t:key=>key,locale:{value:'en'}}),
    useDeviceStore:()=>({getDeviceId:()=> 'local-device-id',getDeviceSecret:()=>secret}),
    useProtestsStore:()=>({protests:[]}),useUiStore:()=>({showToast:msg=>toasts.push(msg)}),
    sessionStorage:{getItem:key=>key==='vc_last_joined'?'11111111-1111-1111-1111-111111111111':null},localStorage:{getItem:()=> 'en'},
    navigator:{language:'en',serviceWorker:{ready:Promise.resolve(reg)}},Notification:{requestPermission:async()=>{permissions++;return 'granted';}},
    Intl,Uint8Array,window:{atob:globalThis.atob},fetch:async(url,opts)=>{
      if(url.endsWith('vapid-public-key'))return {json:async()=>({publicKey:'dGVzdA'})};
      requests.push(JSON.parse(opts.body));const status=statuses[requests.length-1];return {status,ok:status>=200&&status<300,json:async()=>({error:errorCode})};
    }};
  vm.createContext(context);vm.runInContext(source+';globalThis.run=activarNotificacion;globalThis.state=notiActivada;',context);
  return {run:()=>context.run(),activated:()=>context.state.value,requests,toasts,permissions:()=>permissions,unsubscribed:()=>unsubscribed};
}
test('push browser uses the same local device id and secret, without a sessionStorage id',async()=>{
  const f=fixture();await f.run();assert.equal(f.activated(),true);assert.equal(f.requests[0].device_id,'local-device-id');assert.equal(f.requests[0].device_secret,'a'.repeat(64));
});
test('generic conflict and non-ownership failures never unsubscribe the browser',async()=>{
  for(const status of [401,404,409]){
    const f=fixture([status],'a'.repeat(64),'OTHER_CONFLICT');await f.run();
    assert.equal(f.activated(),false);assert.equal(f.unsubscribed(),0);assert.equal(f.requests.length,1);
  }
});
test('browser recovers a stale endpoint through a new subscription, never owner transfer',async()=>{
  const f=fixture([409,201]);await f.run();assert.equal(f.activated(),true);assert.equal(f.unsubscribed(),1);assert.equal(f.requests.length,2);assert.notEqual(f.requests[0].subscription.endpoint,f.requests[1].subscription.endpoint);
});
test('registration failures remain inactive and display a translated error',async()=>{
  for(const f of [fixture([503]),fixture([409,409]),fixture([201],null)]){
    await f.run();assert.equal(f.activated(),false);assert.deepEqual(f.toasts,['verify.notiError']);
    if(f.requests.length===0)assert.equal(f.permissions(),0);
  }
  for(const lang of ['es','en','fr','zh'])assert.ok(JSON.parse(readFileSync('apps/web/src/locales/'+lang+'.json','utf8')).verify.notiError);
});
