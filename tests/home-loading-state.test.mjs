import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {createPinia,defineStore} from 'pinia';
import {parse,compileScript} from '@vue/compiler-sfc';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{await new Promise(r=>setImmediate(r));await Vue.nextTick();};
const event=id=>({id,title:'Event '+id,scope:'global',ends_at:new Date(Date.now()+60000).toISOString(),count:4});
function setup(){
  const pending=[];
  const request=kind=>{const d=defer();pending.push({...d,kind});return d.promise;};
  const api={fetchProtests:()=>request('list'),fetchProtest:()=>request('detail')};
  const source=fs.readFileSync('apps/web/src/stores/protests.js','utf8').replace(/^import .*;\n/gm,'').replace('export const useProtestsStore','const useProtestsStore');
  const context={defineStore,ref:Vue.ref,computed:Vue.computed,api,useDeviceStore:()=>({getLocks:()=>({}),simCountry:'ES'}),REGIONS:{},inRegion:()=>false,fmtTime:String,displayScope:p=>p.dominio_email?'institutional':p.scope,i18n:{global:{t:k=>k}}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.getStore=useProtestsStore;',context);
  return {store:context.getStore(createPinia()),pending};
}
async function mountHome(store){
  const node=(tag,text='')=>({tag,text,props:{},children:[],parent:null});
  const renderer=Vue.createRenderer({
    createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
    setText:(n,text)=>n.text=text,setElementText:(n,text)=>{n.text=text;n.children=[];},
    insert:(n,p,anchor)=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);const at=anchor?p.children.indexOf(anchor):-1;p.children.splice(at<0?p.children.length:at,0,n);n.parent=p;},
    remove:n=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
    parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
    patchProp:(n,key,before,after)=>n.props[key]=after,setScopeId(){},
  });
  const {descriptor}=parse(fs.readFileSync('apps/web/src/screens/HomeScreen.vue','utf8'));
  let source=compileScript(descriptor,{id:'home-loading-test',inlineTemplate:true}).content;
  source=source.replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g,(_,names)=>`const { ${names.replace(/\bas\b/g,':')} }=Vue;`).replace(/^import[^\n]+from[^\n]+\n/gm,'').replace('export default','const Component=');
  const child=Vue.defineComponent({setup:()=>()=>null});
  const context={Vue,useRouter:()=>({push(){}}),useI18n:()=>({locale:Vue.ref('es')}),useProtestsStore:()=>store,useDeviceStore:()=>({}),mapLocation:()=>({country:null,approximate:true}),localStorage:{getItem:()=> '1',setItem(){}},WorldMap:child,ActiveTab:child,QueueTab:child,SlotsTab:child,fmt:String,ISO_NUM_TO_A2:{},localizedCountry:()=>'',displayScope:p=>p.scope};
  vm.createContext(context);const Component=vm.runInContext(source+';Component;',context);
  const root=node('root');const app=renderer.createApp(Component);app.config.globalProperties.$t=k=>k;app.mount(root);await Vue.nextTick();
  const descendants=n=>[n,...n.children.flatMap(descendants)];
  return {nodes:()=>descendants(root),find:id=>descendants(root).find(n=>n.props.id===id),unmount:()=>app.unmount()};
}

test('only a successful first list establishes a true empty state',async()=>{
  const {store,pending}=setup();assert.equal(store.hasLoaded,false);assert.equal(store.loading,false);
  const first=store.loadProtests();assert.equal(store.loading,true);assert.equal(store.hasLoaded,false);
  pending[0].resolve([]);await first;
  assert.equal(store.hasLoaded,true);assert.equal(store.loading,false);assert.equal(store.error,null);assert.equal(store.protests.length,0);
});

test('initial failure stays distinct from empty and manual retry preserves its error until success',async()=>{
  const {store,pending}=setup();const first=store.loadProtests();pending[0].reject(new Error('private diagnostic'));await first;
  assert.equal(store.hasLoaded,false);assert.equal(store.error,'private diagnostic');assert.equal(store.loading,false);
  const retry=store.loadProtests();assert.equal(store.loading,true);assert.equal(store.error,'private diagnostic');assert.equal(store.hasLoaded,false);
  pending[1].resolve([]);await retry;assert.equal(store.hasLoaded,true);assert.equal(store.error,null);
});

test('background refresh preserves actual rows and successful-load knowledge through failure',async()=>{
  const {store,pending}=setup();const first=store.loadProtests();pending[0].resolve([event('kept')]);await first;
  const row=store.protests[0];const refresh=store.loadProtests();assert.equal(store.hasLoaded,true);assert.equal(store.protests[0],row);
  pending[1].reject(new Error('offline'));await refresh;
  assert.equal(store.hasLoaded,true);assert.equal(store.protests[0],row);assert.equal(store.error,'offline');
});

test('an old success cannot establish hasLoaded while a newer request is pending or failed',async()=>{
  const {store,pending}=setup();const old=store.loadProtests();const latest=store.loadProtests();
  pending[0].resolve([event('old')]);await old;assert.equal(store.hasLoaded,false);assert.equal(store.loading,true);assert.equal(store.protests.length,0);
  pending[1].reject(new Error('current failure'));await latest;assert.equal(store.hasLoaded,false);assert.equal(store.error,'current failure');
});

test('old success after current failure cannot turn a failed first load into a successful empty state',async()=>{
  const {store,pending}=setup();const old=store.loadProtests();const latest=store.loadProtests();
  pending[1].reject(new Error('current failure'));await latest;pending[0].resolve([]);await old;
  assert.equal(store.hasLoaded,false);assert.equal(store.error,'current failure');assert.equal(store.loading,false);
});

test('an old failure cannot undo a newer success or its loaded flag',async()=>{
  const {store,pending}=setup();const old=store.loadProtests();const latest=store.loadProtests();
  pending[1].resolve([event('current')]);await latest;pending[0].reject(new Error('old failure'));await old;
  assert.equal(store.hasLoaded,true);assert.equal(store.error,null);assert.deepEqual(Array.from(store.protests,p=>p.id),['current']);
});

test('direct-link lookup and cached lookup do not claim the home list was loaded',async()=>{
  const {store,pending}=setup();const detail=store.fetchProtestById('direct');pending[0].resolve(event('direct'));await detail;
  assert.equal(store.hasLoaded,false);assert.equal(store.protests.length,1);assert.equal(store.loading,false);
  await store.fetchProtestById('direct');assert.equal(pending.length,1);assert.equal(store.hasLoaded,false);
});

test('invalid list data is a failed load instead of a successful empty response',async()=>{
  const {store,pending}=setup();const first=store.loadProtests();pending[0].resolve({wrong:'shape'});await first;
  assert.equal(store.hasLoaded,false);assert.ok(store.error);assert.equal(store.protests.length,0);
});

test('Home renders initial status, then fixed error, single-flight retry status and successful completion',async()=>{
  const {store,pending}=setup();const view=await mountHome(store);
  try{
    assert.equal(view.find('events-loading').props.role,'status');assert.ok(view.nodes().some(n=>n.text==='home.loadingEvents'));assert.equal(view.find('load-failed'),undefined);
    const first=store.loadProtests();pending[0].reject(new Error('secret server failure'));await first;await flush();
    assert.equal(view.find('events-loading'),undefined);const alert=view.find('load-failed');assert.equal(alert.props.role,'alert');assert.ok(!view.nodes().some(n=>n.text?.includes('secret server failure')));
    const button=alert.children.find(n=>n.tag==='button');button.props.onClick();button.props.onClick();await flush();
    assert.equal(pending.length,2);assert.equal(store.loading,true);assert.ok(store.error);assert.equal(view.find('load-failed').children.find(n=>n.tag==='button').props.disabled,true);
    assert.ok(view.nodes().some(n=>n.text==='home.loadingEvents'));assert.equal(view.find('events-loading'),undefined);
    pending[1].resolve([]);await flush();assert.equal(store.hasLoaded,true);assert.equal(view.find('events-loading'),undefined);assert.equal(view.find('load-failed'),undefined);
  }finally{view.unmount();}
});

test('Home shows refresh status while the store keeps its known rows',async()=>{
  const {store,pending}=setup();const first=store.loadProtests();pending[0].resolve([event('kept')]);await first;
  const view=await mountHome(store);
  try{
    assert.equal(view.find('events-loading'),undefined);const refresh=store.loadProtests();await flush();
    assert.equal(view.find('events-loading').props.role,'status');assert.deepEqual(Array.from(store.protests,p=>p.id),['kept']);
    pending[1].resolve([event('new')]);await refresh;await flush();assert.equal(view.find('events-loading'),undefined);assert.deepEqual(Array.from(store.protests,p=>p.id),['new']);
  }finally{view.unmount();}
});
