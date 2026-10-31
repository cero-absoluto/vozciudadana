import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPinia,defineStore} from 'pinia';
import {ref,shallowRef} from 'vue';
import {harness,read} from './helpers/participation-harness.mjs';
import {writeOutcome} from '../apps/web/src/lib/participationOutcome.js';

const RECEIPT='44444444-4444-4444-8444-444444444444';
const NONCE='33333333-3333-4333-8333-333333333333';
const UUID='12345678-1234-4234-8234-123456789abc';
function uiStore(){
  const source=fs.readFileSync(new URL('../apps/web/src/stores/ui.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace('export const useUiStore','const useUiStore');
  const context={defineStore,ref,shallowRef,i18n:{global:{locale:{value:'es'}}},setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.getStore=useUiStore;',context);
  const ui=context.getStore(createPinia());ui.showToast=()=>{};return ui;
}
const contextValue=ui=>JSON.parse(JSON.stringify(ui.shareContext));

test('opening share copies only immutable public metadata and never retains participant credentials',()=>{
  const ui=uiStore();const source={id:UUID,title:'Chosen event',receipt:RECEIPT,email:'private@example.invalid',token:'private token',gps:{lat:1}};
  assert.equal(ui.openShare(source),true);assert.equal(ui.showShareModal,true);assert.equal(ui.shareOpenId,1);
  assert.deepEqual(contextValue(ui),{id:UUID,title:'Chosen event'});assert.ok(Object.isFrozen(ui.shareContext));
  source.id='another';source.title='Changed after opening';assert.deepEqual(contextValue(ui),{id:UUID,title:'Chosen event'});
});

test('an open share dialog refuses replacement and each reopening gets a distinct opening identity',()=>{
  const ui=uiStore();assert.equal(ui.openShare({id:12,title:'First'}),true);const initial=ui.shareContext;
  assert.equal(ui.openShare({id:34,title:'Second'}),false);assert.equal(ui.shareOpenId,1);assert.equal(ui.shareContext,initial);
  // Vue can batch false/true; the opening sequence still invalidates asynchronous work.
  ui.showShareModal=false;assert.equal(ui.openShare({id:34,title:'Second'}),true);
  assert.equal(ui.shareOpenId,2);assert.notEqual(ui.shareContext,initial);assert.deepEqual(contextValue(ui),{id:'34',title:'Second'});
});

for(const invalid of [undefined,null,{}, {id:'',title:'Title'},{id:'event'}, {id:'event',title:''},
  {id:'event',title:' '.repeat(4)},{id:'../other',title:'Title'},{id:'id?other',title:'Title'},
  {id:'id/other',title:'Title'},{id:'id#other',title:'Title'},{id:{toString:()=>UUID},title:'Title'},
  {id:Infinity,title:'Title'},{id:-1,title:'Title'}, {id:'event',title:{toString:()=> 'Title'}},
])test('invalid share context cannot open or reuse a previously closed target '+JSON.stringify(invalid),()=>{
  const ui=uiStore();ui.openShare({id:UUID,title:'Previous'});ui.showShareModal=false;
  assert.equal(ui.openShare(invalid),false);assert.equal(ui.showShareModal,false);assert.equal(ui.shareContext,null);
});

test('detail sharing uses its displayed event instead of another session destination',()=>{
  const ui=uiStore();const current={value:{id:UUID,title:'Displayed detail'}};
  const source=read('DetailScreen').match(/function shareProtest\(\) \{[\s\S]*?\n\}/)[0];
  const context={ui,protest:current,sessionStorage:{getItem:()=> 'previous-event'}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.share=shareProtest;',context);
  assert.equal(context.share(),true);assert.deepEqual(contextValue(ui),{id:UUID,title:'Displayed detail'});
  ui.showShareModal=false;current.value=null;assert.equal(context.share(),false);assert.equal(ui.showShareModal,false);
});

test('SMS receipt sharing remains bound to its confirmed destination after the session and list change',async()=>{
  const ui=uiStore();const f=harness('VerifyScreen',{}, {ui});
  await f.mount();assert.equal(f.state.success.value,true);
  f.memory.set('vc_last_joined','unrelated-event');f.store.protests=[];
  assert.equal(f.state.shareProtest(),true);assert.deepEqual(contextValue(ui),{id:'selected',title:'Synthetic selected event'});
});

test('restored SMS receipt can share its original title with an empty event list and no new join',async()=>{
  const ui=uiStore();const f=harness('VerifyScreen',{}, {ui});f.store.protests=[];
  writeOutcome(f.context.sessionStorage,'phone:synthetic-device:selected',{state:'completed',receipt:RECEIPT,title:'Saved SMS title'});
  await f.mount();assert.equal(f.state.success.value,true);assert.equal(f.calls.length,0);
  f.memory.set('vc_last_joined','another-event');assert.equal(f.state.shareProtest(),true);
  assert.deepEqual(contextValue(ui),{id:'selected',title:'Saved SMS title'});
});

test('restored institutional receipt shares its route event without a list or SMS fallback',async()=>{
  const ui=uiStore();const f=harness('VerifyInstitucionalScreen',{}, {ui});f.store.protests=[];
  f.memory.set('vc_institutional_outcome_context:selected',NONCE);f.memory.set('vc_last_joined','old-SMS-event');
  writeOutcome(f.context.sessionStorage,'email:selected:'+NONCE,{state:'completed',receipt:RECEIPT,title:'Saved institutional title'});
  await f.mount();assert.equal(f.state.step.value,3);assert.equal(f.calls.length,0);
  assert.equal(f.state.shareProtest(),true);assert.deepEqual(contextValue(ui),{id:'selected',title:'Saved institutional title'});
});

for(const screen of ['VerifyScreen','VerifyInstitucionalScreen'])test(screen+' never opens share before an actual confirmed receipt',()=>{
  const ui=uiStore();const f=harness(screen,{}, {ui});
  assert.equal(f.state.shareProtest(),false);assert.equal(ui.showShareModal,false);assert.equal(ui.shareContext,null);
  if(screen==='VerifyScreen'){f.state.success.value=true;f.state.receipt.value='not-a-receipt';}
  else {f.state.step.value=3;f.state.receiptHash.value='not-a-receipt';}
  assert.equal(f.state.shareProtest(),false);assert.equal(ui.showShareModal,false);
});

test('notification consent information is visible before the action and is its accessible description',()=>{
  const source=read('VerifyScreen');const template=source.split('</template>')[0];
  const info=template.match(/<p\b[^>]*id="([^"]+)"[^>]*>\{\{ \$t\('verify\.notiInfo'\) \}\}<\/p>/);
  assert.ok(info,'existing translated privacy and optionality explanation is rendered');
  const action=template.match(/<button\b[^>]*@click="activarNotificacion"[^>]*>/)[0];
  assert.ok(action.includes('aria-describedby="'+info[1]+'"'));
  assert.ok(template.indexOf(info[0])<template.indexOf(action));
  assert.doesNotMatch(template,/@click="activarNotificacion\(\)"/);
});
