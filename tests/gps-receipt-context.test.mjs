import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as Vue from 'vue';
import {harness,deferred,flush} from './helpers/participation-harness.mjs';
const RECEIPT='44444444-4444-4444-8444-444444444444';
const TOKEN='synthetic-reinforcement-token';
async function fixture(){
  let acceptGps,rejectGps,geolocationCalls=0;
  const patches=[],scope=Vue.effectScope();
  const f=scope.run(()=>harness('VerifyScreen',{
    joinProtest:async()=>({receipt:RECEIPT,gps_update_token:TOKEN}),
    patchAdhesionGps:async(id,payload)=>{patches.push({id,payload});return {ok:true};},
  },{reactive:Vue.reactive,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,globals:{navigator:{userAgent:'Synthetic',geolocation:{getCurrentPosition(resolve,reject){geolocationCalls++;acceptGps=resolve;rejectGps=reject;}}}}}));
  await f.mount();f.toasts.length=0;f.navigation.length=0;
  const state=vm.runInContext('({showGpsReinforce,gpsReinforceDone,gpsUpdateToken,confirmedIdentity,confirmedProtestId,reinforcing})',f.context);
  return {...f,...state,patches,geolocationCalls:()=>geolocationCalls,
    resolveGps:()=>acceptGps({coords:{latitude:40,longitude:-3,accuracy:10}}),rejectGps:()=>rejectGps({code:1}),
    cleanup(){f.unmount();scope.stop();}};
}
function change(f,kind){
  if(kind==='destination')f.memory.set('vc_last_joined','another');
  if(kind==='identity')f.memory.set('vc_device_id','another-device');
  if(kind==='scope')f.store.protests[0].scope='regional';
  if(kind==='risk')f.store.protests[0].risk_level='high';
  if(kind==='domain')f.store.protests[0].dominio_email='example.invalid';
  if(kind==='token')f.gpsUpdateToken.value='replacement-token';
  if(kind==='withdraw')f.showGpsReinforce.value=false;
  if(kind==='ABA'){f.store.protests[0].risk_level='critical';f.store.protests[0].risk_level='low';}
  if(kind==='unmount')f.unmount();
}
for(const kind of ['destination','identity','scope','risk','domain','token','withdraw','ABA','unmount'])for(const result of ['success','failure'])test(`pending GPS ${result} after ${kind} sends no coordinates and emits no result`,async()=>{
  const f=await fixture();try{
    const pending=f.state.reinforceGps();assert.equal(f.geolocationCalls(),1);
    change(f,kind);result==='success'?f.resolveGps():f.rejectGps();await pending;
    assert.deepEqual(f.patches,[]);assert.deepEqual(f.toasts,[]);assert.deepEqual(f.navigation,[]);
    assert.equal(f.showGpsReinforce.value,kind!=='withdraw');assert.equal(f.gpsReinforceDone.value,false);
  }finally{f.cleanup();}
});
for(const kind of ['destination','identity','scope','risk','domain','token','withdraw','ABA','unmount'])for(const result of ['success','failure','expired'])test(`pending PATCH ${result} after ${kind} cannot change the receipt UI`,async()=>{
  const f=await fixture(),wait=deferred();try{
    f.api.patchAdhesionGps=async(id,payload)=>{f.patches.push({id,payload});return wait.promise;};
    const pending=f.state.reinforceGps();f.resolveGps();await flush();assert.equal(f.patches.length,1);
    change(f,kind);result==='success'?wait.resolve({ok:true}):wait.reject(result==='expired'?{status:410}:{status:503});await pending;
    assert.equal(f.patches.length,1);assert.deepEqual(f.toasts,[]);assert.deepEqual(f.navigation,[]);
    assert.equal(f.showGpsReinforce.value,kind!=='withdraw');assert.equal(f.gpsReinforceDone.value,false);assert.equal(f.state.receipt.value,RECEIPT);
  }finally{f.cleanup();}
});
test('valid global low-risk reinforcement preserves existing policy, snapshots its token and sends exactly once',async()=>{
 const f=await fixture();try{
   const pending=f.state.reinforceGps();await f.state.reinforceGps();assert.equal(f.geolocationCalls(),1);
   f.resolveGps();await pending;assert.equal(f.patches.length,1);assert.equal(f.patches[0].id,'selected');
   assert.equal(f.patches[0].payload.gps_update_token,TOKEN);assert.equal(f.patches[0].payload.gps_lat,40);
   assert.equal(f.showGpsReinforce.value,false);assert.equal(f.gpsReinforceDone.value,true);assert.deepEqual(f.toasts,['verify.gpsReinforceSuccess']);
   assert.equal(f.state.receipt.value,RECEIPT);assert.equal(f.reinforcing.value,false);
   await f.state.reinforceGps();assert.equal(f.geolocationCalls(),1);assert.equal(f.patches.length,1);
 }finally{f.cleanup();}
});
for(const failure of [{code:1},{status:410}])test('current-context failure remains honest and preserves the receipt '+JSON.stringify(failure),async()=>{
 const f=await fixture();try{
  if(failure.code){const pending=f.state.reinforceGps();f.rejectGps();await pending;assert.deepEqual(f.toasts,['auth.gpsErrorDeniedAndroid']);assert.equal(f.showGpsReinforce.value,true);}
  else {f.api.patchAdhesionGps=async()=>{throw failure;};const pending=f.state.reinforceGps();f.resolveGps();await pending;assert.equal(f.showGpsReinforce.value,false);assert.deepEqual(f.toasts,[]);}
  assert.equal(f.gpsReinforceDone.value,false);assert.equal(f.state.receipt.value,RECEIPT);assert.equal(f.reinforcing.value,false);
 }finally{f.cleanup();}
});
