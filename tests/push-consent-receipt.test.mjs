import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as Vue from 'vue';
import {harness,flush,deferred} from './helpers/participation-harness.mjs';
import {writeOutcome} from '../apps/web/src/lib/participationOutcome.js';
const receipt='44444444-4444-4444-8444-444444444444';
function fixture(response=async()=>({ok:true,status:200,json:async()=>({ok:true,enabled:true,revision:3,registration:'present'})})){
 const scope=Vue.effectScope(),requests=[];
 const device={gpsReady:false,getDeviceId:()=> 'synthetic-device',getDeviceSecret:()=> 'a'.repeat(64)};
 const f=scope.run(()=>harness('VerifyScreen',{}, {reactive:Vue.reactive,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,globals:{useDeviceStore:()=>device,navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic'})}})}},fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});assert.ok(url.endsWith('/api/push/preferences'));return response();}}}));
 const state=vm.runInContext('({pushPreferenceState,canManagePush,notiPending,notiActivada})',f.context);
 return {...f,...state,requests,cleanup(){f.unmount();scope.stop();}};
}
test('new valid receipt loads server preference without requesting browser permission',async()=>{
 const f=fixture();try{await f.mount();await flush();assert.equal(f.state.success.value,true);assert.equal(f.state.receipt.value,receipt);assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.device_id,'synthetic-device');assert.equal(f.requests[0].body.protest_id,'selected');assert.equal(f.pushPreferenceState.value,'enabled');assert.equal(f.notiActivada.value,true);assert.equal(f.canManagePush.value,true);assert.equal(f.calls.filter(c=>c[0]==='join').length,1);}finally{f.cleanup();}
});
test('restored receipt loads preference while preserving display-only adhesion recovery',async()=>{
 const f=fixture();try{assert.equal(writeOutcome(f.context.sessionStorage,'phone:synthetic-device:selected',{state:'completed',receipt,title:'Restored event',attemptId:'55555555-5555-4555-8555-555555555555'}),true);await f.mount();await flush();assert.equal(f.state.success.value,true);assert.equal(f.state.savedConfirmation.value,true);assert.equal(f.state.receipt.value,receipt);assert.equal(f.calls.filter(c=>c[0]==='join'||c[0]==='load').length,0);assert.equal(f.requests.length,1);assert.equal(f.pushPreferenceState.value,'enabled');}finally{f.cleanup();}
});
test('preference read failure never undoes the confirmed receipt or replays participation',async()=>{
 const f=fixture(async()=>({ok:false,status:503,json:async()=>({error:'synthetic'})}));try{await f.mount();await flush();assert.equal(f.pushPreferenceState.value,'error');assert.equal(f.notiActivada.value,false);assert.equal(f.state.success.value,true);assert.equal(f.state.receipt.value,receipt);assert.equal(f.calls.filter(c=>c[0]==='join').length,1);assert.deepEqual(f.navigation,[]);}finally{f.cleanup();}
});
test('a late preference read after unmount cannot confirm notifications',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise);try{await f.mount();await flush();assert.equal(f.requests.length,1);f.unmount();wait.resolve({ok:true,status:200,json:async()=>({ok:true,enabled:true,revision:1,registration:'present'})});await flush();assert.equal(f.notiActivada.value,false);assert.equal(f.notiPending.value,false);assert.equal(f.state.receipt.value,receipt);}finally{f.cleanup();}
});
