import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createPinia,setActivePinia} from 'pinia';
import {harness} from './helpers/participation-harness.mjs';
const server = await createServer({root:'apps/web',server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
test.after(()=>server.close());
test('real UI store GPS is cleared while its consented payload stays in the flow snapshot',async()=>{
  const original=globalThis.localStorage;globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
  try {
    const {useUiStore}=await server.ssrLoadModule('/src/stores/ui.js');setActivePinia(createPinia());const ui=useUiStore();ui.setGps(0,2,5);
    const f=harness('VerifyScreen');let payload;f.api.joinProtest=async(_id,value)=>{payload=value;return {receipt:'44444444-4444-4444-8444-444444444444'};};
    // The setup already captured its store. Execute a fresh setup with the real store.
    const {readFileSync}=await import('node:fs'),vm=await import('node:vm');let mounted;
    const source=readFileSync('apps/web/src/screens/VerifyScreen.vue','utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replace(/import\.meta\.env\.\w+/g,"'synthetic'").replaceAll("import('@/services/api.js')",'Promise.resolve(apiFixture)');
    const context={...f.context,useUiStore:()=>ui,onMounted:fn=>mounted=fn};vm.createContext(context);vm.runInContext(source,context);await mounted();
    assert.equal(ui.gpsLat,null);assert.equal(ui.gpsLng,null);assert.equal(ui.gpsAccuracy,null);
    assert.equal(payload.gps_lat,0);assert.equal(payload.gps_lng,2);
  } finally {if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;}
});
test('real email API wrapper preserves a received receipt if census storage subsequently fails',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({verified:true,receipt:'44444444-4444-4444-8444-444444444444',census_session:'v1.synthetic'}),{status:200});};
  globalThis.sessionStorage={getItem:()=> '33333333-3333-4333-8333-333333333333',setItem(){throw Error('synthetic storage unavailable');},removeItem(){}};
  try {
    const api=await server.ssrLoadModule('/src/services/api.js');
    await assert.rejects(api.verifyEmailOtp({email:'synthetic@example.invalid',otp:'123456',protest_id:'11111111-1111-4111-8111-111111111111'}),error=>{
      assert.equal(error.code,'CENSUS_SESSION_NOT_SAVED');assert.equal(error.receipt,'44444444-4444-4444-8444-444444444444');assert.equal(error.verified,true);return true;
    });
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
});
for(const result of [{verified:true,receipt:'invalid'},{verified:false,receipt:'44444444-4444-4444-8444-444444444444'}])test('malformed success cannot persist a census credential '+JSON.stringify(result),async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage;let writes=0;
  globalThis.fetch=async()=>new Response(JSON.stringify({...result,census_session:'v1.synthetic'}),{status:200});
  globalThis.sessionStorage={getItem:()=> '33333333-3333-4333-8333-333333333333',setItem(){writes++;},removeItem(){}};
  try{const api=await server.ssrLoadModule('/src/services/api.js');await assert.rejects(api.verifyEmailOtp({email:'synthetic@example.invalid',otp:'123456',protest_id:'11111111-1111-4111-8111-111111111111'}),{code:'INVALID_API_RESPONSE'});assert.equal(writes,0);}
  finally{globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
});
