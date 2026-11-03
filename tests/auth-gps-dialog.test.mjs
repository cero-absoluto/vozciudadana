import test from 'node:test';
import assert from 'node:assert/strict';
import * as Vue from 'vue';
import {harness,read,flush} from './helpers/participation-harness.mjs';
function fixture(){
  const listeners=new Map(),writes=[],gps=[],toasts=[];let success,error,geoCalls=0;
  const document={activeElement:null,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const node=name=>Vue.markRaw({name,isConnected:true,disabled:false,focus(){document.activeElement=this;}});
  const origin=node('origin'),root=node('root'),accept=node('accept'),decline=node('decline'),dialog={contains:n=>n===accept||n===decline};document.activeElement=origin;
  const f=harness('AuthScreen',{}, {reactive:Vue.reactive,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,ui:{showToast:t=>toasts.push(t),setGps:(...args)=>gps.push(args)},globals:{document,navigator:{userAgent:'Synthetic',geolocation:{getCurrentPosition:(a,b)=>{geoCalls++;success=a;error=b;}}},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args),removeItem(){}}}});
  Object.assign(f.store.protests[0],{scope:'local',risk_level:'low'});
  f.state.authRoot.value=root;f.state.gpsDialog.value=dialog;f.state.gpsAccept.value=accept;f.state.gpsDecline.value=decline;
  return {...f,document,listeners,writes,gps,toasts,origin,root,accept,decline,success:()=>success({coords:{latitude:1,longitude:2,accuracy:3}}),error:()=>error({code:1}),geoCalls:()=>geoCalls};
}
const key=(key,shiftKey=false)=>({key,shiftKey,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){}});
test('GPS consent has named modal semantics and native non-submit choices',()=>{
  const s=read('AuthScreen');assert.match(s,/role="dialog" aria-modal="true" aria-labelledby="auth-gps-title" aria-describedby="auth-gps-note"/);assert.match(s,/id="auth-gps-title"/);assert.match(s,/id="auth-gps-note"/);assert.match(s,/ref="gpsAccept" type="button"/);assert.match(s,/ref="gpsDecline" type="button"/);
});
test('consent focuses decline, contains Tab/ShiftTab and focus moved outside, Escape declines exactly once',async()=>{
  const f=fixture();const pending=f.state.sendSMS();await flush();
  assert.equal(f.document.activeElement,f.decline);assert.equal(f.geoCalls(),0);
  let event=key('Tab');f.state.onGpsKeydown(event);assert.equal(event.prevented,true);assert.equal(f.document.activeElement,f.accept);
  event=key('Tab',true);f.state.onGpsKeydown(event);assert.equal(f.document.activeElement,f.decline);
  f.document.activeElement=f.origin;f.listeners.get('focusin')({target:f.origin});assert.equal(f.document.activeElement,f.decline);
  f.state.onGpsKeydown(key('Escape'));await pending;await flush();
  assert.equal(f.state.showGpsModal.value,false);assert.equal(f.geoCalls(),0);assert.equal(f.calls.filter(c=>c[0]==='request').length,1);assert.equal(f.listeners.has('focusin'),false);assert.equal(f.document.activeElement,f.origin);f.unmount();
});
test('closing consent restores an available screen fallback when its opener is disabled',async()=>{
 const f=fixture();const pending=f.state.sendSMS();await flush();f.origin.disabled=true;f.state.rechazarGps();await pending;await flush();assert.equal(f.document.activeElement,f.root);f.unmount();
});
test('valid consent captures coordinates once and continues with one SMS',async()=>{
 const f=fixture();const pending=f.state.sendSMS();await flush();f.state.aceptarGps();await flush();assert.equal(f.geoCalls(),1);f.success();await pending;assert.equal(f.gps.length,1);assert.equal(f.writes.length,4);assert.equal(f.calls.filter(c=>c[0]==='request').length,1);f.unmount();
});
for(const change of ['destination','scope','risk','domain','ABA','unmount'])for(const response of ['success','failure'])test('pending GPS '+response+' is ignored after '+change,async()=>{
 const f=fixture();const pending=f.state.sendSMS();await flush();f.state.aceptarGps();await flush();
 if(change==='destination')f.memory.set('vc_last_joined','another');
 if(change==='scope')f.store.protests[0].scope='national';
 if(change==='risk')f.store.protests[0].risk_level='high';
 if(change==='domain')f.store.protests[0].dominio_email='example.invalid';
 if(change==='ABA'){f.store.protests[0].risk_level='high';f.store.protests[0].risk_level='low';}
 if(change==='unmount')f.unmount();
 response==='success'?f.success():f.error();await pending;await flush();
 assert.deepEqual(f.gps,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.toasts,[]);assert.deepEqual(f.navigation,[]);assert.equal(f.calls.filter(c=>c[0]==='request').length,0);if(change!=='unmount')f.unmount();
});
for(const change of ['risk','ABA','unmount'])test('pending consent is cancelled on '+change+' without GPS or SMS',async()=>{
 const f=fixture();const pending=f.state.sendSMS();await flush();
 if(change==='unmount')f.unmount();else {f.store.protests[0].risk_level='critical';if(change==='ABA')f.store.protests[0].risk_level='low';}
 await pending;await flush();assert.equal(f.state.showGpsModal.value,false);assert.equal(f.geoCalls(),0);assert.equal(f.calls.length,0);assert.deepEqual(f.writes,[]);assert.equal(f.listeners.has('focusin'),false);if(change!=='unmount')f.unmount();
});
