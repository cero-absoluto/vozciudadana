import test from 'node:test';
import assert from 'node:assert/strict';
import {createPushConsentController} from '../apps/web/src/lib/pushConsent.js';
import {withClientDeadline} from '../apps/web/src/services/requestJson.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const endpoint={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
function fixture({enabled=false,registration='missing',existing=null,stored=endpoint}={}){
  let context={device_id:'device-A',device_secret:'a'.repeat(64),protest_id:'11111111-1111-4111-8111-111111111111'},revision=0,consent=enabled,transport=registration;
  let permissions=0,subscribes=0,unsubscribes=0,reads=0,localTransport=existing,storedTransport=stored;
  const requests=[],states=[];
  const browser={getRegistration:async()=>({pushManager:{getSubscription:async()=>localTransport}}),requestPermission:async()=>{permissions++;return 'granted';},ready:async()=>({pushManager:{getSubscription:async()=>localTransport,subscribe:async()=>{subscribes++;localTransport={...endpoint,unsubscribe:async()=>{unsubscribes++;}};return localTransport;}}}),decodeKey:()=>new Uint8Array([1]),locale:()=> 'es',timezone:()=> 'Europe/Madrid'};
  const f={fetch:async(url,opts)=>{
    const body=JSON.parse(opts.body||'{}');requests.push({url,body});
    if(url.endsWith('/preferences')){reads++;const value=body.subscription;const matches=transport==='present'&&value?.endpoint===storedTransport.endpoint&&value?.keys?.p256dh===storedTransport.keys.p256dh&&value?.keys?.auth===storedTransport.keys.auth;return response({ok:true,enabled:consent,revision,registration:matches?'present':'missing'});}
    if(url.endsWith('/revoke')){consent=false;return response({ok:true,enabled:false,revision:++revision});}
    if(url.endsWith('/vapid-public-key'))return response({publicKey:'synthetic'});
    if(body.consent_revision!==revision)return response({error:'PUSH_CONSENT_STALE'},409);
    consent=true;transport='present';storedTransport=body.subscription;return response({ok:true,enabled:true,revision:++revision},201);
  }};
  const controller=createPushConsentController({getContext:()=>context,onChange:value=>states.push({...value}),deadline:fn=>withClientDeadline(fn,{timeoutMs:100}),fetchImpl:(...args)=>f.fetch(...args),baseUrl:'https://api.invalid',browser});
  return {controller,browser,requests,states,setLocalTransport:value=>localTransport=value,setContext:value=>context=value,getContext:()=>context,permissions:()=>permissions,subscribes:()=>subscribes,unsubscribes:()=>unsubscribes,reads:()=>reads,setFetch:fn=>f.fetch=fn,getFetch:()=>f.fetch};
}
function response(data,status=200){return {ok:status>=200&&status<300,status,json:async()=>data};}
test('activation requires an authoritative preference read and never runs on construction',async()=>{
 const f=fixture();await f.controller.enable();assert.deepEqual(f.requests,[]);assert.equal(f.permissions(),0);await f.controller.refresh();assert.equal(f.controller.snapshot().state,'disabled');assert.equal(f.permissions(),0);
});
test('a stored enabled preference without transport is repair, never an enabled confirmation',async()=>{
 const f=fixture({enabled:true});await f.controller.refresh();assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.permissions(),0);
});
test('existing transport is reused without subscribe, unsubscribe or a VAPID request',async()=>{
 const f=fixture({existing:endpoint});await f.controller.refresh();await f.controller.enable();assert.equal(f.controller.snapshot().state,'enabled');assert.equal(f.subscribes(),0);assert.equal(f.unsubscribes(),0);assert.ok(!f.requests.some(r=>r.url.endsWith('/vapid-public-key')));const save=f.requests.find(r=>r.url.endsWith('/subscribe'));assert.equal(save.body.consent_revision,0);assert.equal(save.body.subscription.endpoint,endpoint.endpoint);
});
test('revocation needs neither a provider subscription nor notification permission',async()=>{
 const f=fixture({enabled:true});f.browser.requestPermission=()=>{throw Error('must not prompt');};f.browser.ready=()=>{throw Error('must not access provider');};await f.controller.refresh();await f.controller.revoke();assert.deepEqual(f.controller.snapshot(),{state:'disabled',pending:false,revision:1});assert.equal(f.permissions(),0);assert.equal(f.subscribes(),0);assert.equal(f.requests.at(-1).body.protest_id,f.getContext().protest_id);assert.equal('endpoint' in f.requests.at(-1).body,false);
});
test('revoke can proceed when the initial preference read failed without guessing an endpoint',async()=>{
 const f=fixture(),fetch=f.getFetch();f.setFetch((url,opts)=>url.endsWith('/preferences')?Promise.reject(Error('synthetic outage')):fetch(url,opts));await f.controller.refresh();assert.equal(f.controller.snapshot().state,'error');await f.controller.revoke();assert.equal(f.controller.snapshot().state,'disabled');assert.equal(f.subscribes(),0);
});
for(const phase of ['refresh','enable','revoke'])for(const change of ['identity','dispose','invalidate'])test(phase+' response cannot update a changed '+change+' context',async()=>{
 const f=fixture(),wait=deferred(),fetch=f.getFetch();if(phase!=='refresh')await f.controller.refresh();
 const target=phase==='refresh'?'/preferences':phase==='enable'?'/subscribe':'/revoke';
 f.setFetch(async(url,opts)=>{const res=await fetch(url,opts);if(url.endsWith(target))await wait.promise;return res;});
 const pending=f.controller[phase]();await flush();if(change==='dispose')f.controller.dispose();else if(change==='invalidate')f.controller.invalidate();else f.setContext({...f.getContext(),device_id:'identity-B'});
 const before=f.states.length;wait.resolve();await pending;
 assert.notEqual(f.controller.snapshot().state,'enabled');if(change==='dispose')assert.equal(f.states.length,before);assert.equal(f.unsubscribes(),0);
});
for(const code of ['PUSH_ENDPOINT_OWNED','PUSH_CONSENT_STALE'])test(code+' never retries, transfers or revokes transport',async()=>{
 const f=fixture(),fetch=f.getFetch();await f.controller.refresh();f.setFetch((url,opts)=>url.endsWith('/subscribe')?response({error:code},409):fetch(url,opts));await f.controller.enable();assert.equal(f.controller.snapshot().state,'error');assert.equal(f.unsubscribes(),0);assert.equal(f.subscribes(),1);const count=f.requests.length;await f.controller.enable();assert.equal(f.requests.length,count);assert.equal(f.permissions(),1);
});
for(const phase of ['enable','revoke'])for(const malformed of [null,{}, {ok:true,enabled:true,revision:-1}, {ok:true,enabled:false,revision:0}])test(phase+' rejects malformed acknowledgement '+JSON.stringify(malformed),async()=>{
 const f=fixture(),fetch=f.getFetch();await f.controller.refresh();const path=phase==='enable'?'/subscribe':'/revoke';f.setFetch((url,opts)=>url.endsWith(path)?response(malformed):fetch(url,opts));await f.controller[phase]();assert.equal(f.controller.snapshot().state,'uncertain');assert.equal(f.unsubscribes(),0);
});
test('an uncertain mutation can be reconciled by a later authoritative read without replay',async()=>{
 const f=fixture(),fetch=f.getFetch();await f.controller.refresh();f.setFetch(async(url,opts)=>{const res=await fetch(url,opts);if(url.endsWith('/revoke'))throw Error('response lost after commit');return res;});await f.controller.revoke();assert.equal(f.controller.snapshot().state,'uncertain');const count=f.requests.filter(r=>r.url.endsWith('/revoke')).length;await f.controller.refresh();assert.equal(f.controller.snapshot().state,'disabled');assert.equal(f.requests.filter(r=>r.url.endsWith('/revoke')).length,count);
});
test('a late provider result after its deadline cannot register a ghost subscription',async()=>{
 const f=fixture(),wait=deferred();f.browser.ready=async()=>({pushManager:{getSubscription:async()=>null,subscribe:()=>wait.promise}});await f.controller.refresh();await f.controller.enable();assert.equal(f.controller.snapshot().state,'error');wait.resolve(endpoint);await flush();assert.ok(!f.requests.some(r=>r.url.endsWith('/subscribe')));assert.equal(f.unsubscribes(),0);
});
test('global proof changed after permission blocks provider and server write',async()=>{
 const f=fixture(),wait=deferred();await f.controller.refresh();f.browser.requestPermission=()=>wait.promise;const pending=f.controller.enable();f.setContext(null);wait.resolve('granted');await pending;assert.equal(f.subscribes(),0);assert.ok(!f.requests.some(r=>r.url.endsWith('/subscribe')));assert.equal(f.controller.snapshot().state,'unavailable');
});
test('revocation without a prior read rejects a zero revision acknowledgement',async()=>{
 const f=fixture();f.setFetch(async()=>response({ok:true,enabled:false,revision:0}));await f.controller.revoke();assert.equal(f.controller.snapshot().state,'uncertain');
});

for(const inspection of ['missing','unsupported','failure','timeout'])test('server consent with '+inspection+' local transport is repair without permission or provider mutation',async()=>{
 const f=fixture({enabled:true,registration:'present'});
 if(inspection==='missing')f.browser.getRegistration=async()=>({pushManager:{getSubscription:async()=>null}});
 if(inspection==='unsupported')f.browser.getRegistration=async()=>undefined;
 if(inspection==='failure')f.browser.getRegistration=async()=>{throw Error('synthetic inspection failure');};
 if(inspection==='timeout')f.browser.getRegistration=()=>new Promise(()=>{});
 await f.controller.refresh();assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.permissions(),0);assert.equal(f.subscribes(),0);assert.equal(f.unsubscribes(),0);
 await f.controller.revoke();assert.equal(f.controller.snapshot().state,'disabled');
});
test('server consent plus an existing local transport is registered without asking permission',async()=>{
 const f=fixture({enabled:true,registration:'present',existing:endpoint});await f.controller.refresh();assert.equal(f.controller.snapshot().state,'enabled');assert.equal(f.permissions(),0);assert.equal(f.subscribes(),0);
});
test('a transport inspection that resolves after identity changed cannot confirm registration',async()=>{
 const f=fixture({enabled:true,registration:'present'}),wait=deferred();f.browser.getRegistration=()=>wait.promise;const pending=f.controller.refresh();await flush();f.setContext({...f.getContext(),device_id:'another-device'});wait.resolve({pushManager:{getSubscription:async()=>endpoint}});await pending;assert.equal(f.controller.snapshot().state,'unavailable');assert.equal(f.permissions(),0);
});

for(const mismatch of ['endpoint','p256dh','auth'])test('a different local '+mismatch+' is not confirmed by a transport stored for this identity',async()=>{
 const other={endpoint:endpoint.endpoint,keys:{...endpoint.keys}};
 if(mismatch==='endpoint')other.endpoint+='-another';else other.keys[mismatch]=(mismatch==='p256dh'?'C'.repeat(87):'b'.repeat(22));
 const f=fixture({enabled:true,registration:'present',existing:other});await f.controller.refresh();
 assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.reads(),1);assert.deepEqual(f.requests[0].body.subscription,other);assert.equal(f.permissions(),0);assert.equal(f.subscribes(),0);assert.equal(f.unsubscribes(),0);
});
test("metadata from a foreign local transport cannot confirm the identity's different server transport",async()=>{
 const foreign={endpoint:endpoint.endpoint+'-foreign',keys:{p256dh:'C'.repeat(87),auth:'b'.repeat(22)}};
 const f=fixture({enabled:true,registration:'present',existing:foreign});await f.controller.refresh();assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.requests[0].body.device_id,'device-A');assert.equal(f.reads(),1);assert.equal(f.unsubscribes(),0);
});
for(const rotation of ['endpoint','p256dh','auth'])test('local '+rotation+' rotation while the server read is pending prevents confirmation',async()=>{
 const f=fixture({enabled:true,registration:'present',existing:endpoint}),wait=deferred(),fetch=f.getFetch();
 f.setFetch(async(url,opts)=>{const res=await fetch(url,opts);if(url.endsWith('/preferences'))await wait.promise;return res;});
 const pending=f.controller.refresh();await flush();const changed={endpoint:endpoint.endpoint,keys:{...endpoint.keys}};
 if(rotation==='endpoint')changed.endpoint+='-rotated';else changed.keys[rotation]=rotation==='p256dh'?'D'.repeat(87):'c'.repeat(22);
 f.setLocalTransport(changed);wait.resolve();await pending;assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.reads(),1);assert.deepEqual(f.requests[0].body.subscription,endpoint);assert.equal(f.permissions(),0);assert.equal(f.unsubscribes(),0);
});
test('toJSON metadata is copied so later object mutation cannot rewrite the sent snapshot',async()=>{
 const serialized={endpoint:endpoint.endpoint,keys:{...endpoint.keys}},subscription={toJSON:()=>serialized};
 const f=fixture({enabled:true,registration:'present',existing:subscription}),wait=deferred(),fetch=f.getFetch();
 f.setFetch(async(url,opts)=>{const res=await fetch(url,opts);if(url.endsWith('/preferences'))await wait.promise;return res;});
 const pending=f.controller.refresh();await flush();serialized.keys.auth='d'.repeat(22);wait.resolve();await pending;
 assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.requests[0].body.subscription.keys.auth,endpoint.keys.auth);assert.equal(f.reads(),1);
});
for(const invalid of [null,{endpoint:endpoint.endpoint},{endpoint:endpoint.endpoint,keys:{p256dh:'',auth:'x'}},{endpoint:endpoint.endpoint,keys:{p256dh:'B'.repeat(86),auth:'a'.repeat(22)}},{endpoint:endpoint.endpoint,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(21)}},{toJSON(){throw Error('synthetic serialization failure');}}])test('unusable local metadata is omitted while server preference remains readable '+String(invalid),async()=>{
 const f=fixture({enabled:true,registration:'present',existing:invalid});await f.controller.refresh();assert.equal(f.controller.snapshot().state,'repair');assert.equal(f.reads(),1);assert.equal('subscription' in f.requests[0].body,false);assert.equal(f.permissions(),0);assert.equal(f.subscribes(),0);await f.controller.revoke();assert.equal(f.controller.snapshot().state,'disabled');
});
test('identity invalidated during the post-response probe cannot receive a registered state',async()=>{
 const f=fixture({enabled:true,registration:'present',existing:endpoint}),wait=deferred();let probes=0;
 f.browser.getRegistration=async()=>{if(++probes===2)return wait.promise;return {pushManager:{getSubscription:async()=>endpoint}};};
 const pending=f.controller.refresh();await flush();assert.equal(probes,2);f.setContext(null);wait.resolve({pushManager:{getSubscription:async()=>endpoint}});await pending;
 assert.equal(f.controller.snapshot().state,'unavailable');assert.equal(f.reads(),1);assert.equal(f.permissions(),0);
});
