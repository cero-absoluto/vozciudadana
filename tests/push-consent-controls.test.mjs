import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {parse,compileScript} from '@vue/compiler-sfc';
import {createI18n} from 'vue-i18n';
const {descriptor}=parse(readFileSync('apps/web/src/components/PushConsentControls.vue','utf8'));
const source=compileScript(descriptor,{id:'push-consent-test',inlineTemplate:true}).content
 .replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g,(_,names)=>`const {${names.replace(/\bas\b/g,':')}}=Vue;`).replace('export default','const Component=');
const Component=vm.runInNewContext(source+';Component;',{Vue});
function node(tag,text=''){return Vue.markRaw({tag,text,props:{},children:[],parent:null});}
const text=n=>n.text+n.children.map(text).join('');
const all=n=>[n,...n.children.flatMap(all)];
async function mount(lang,initial={}){
 const model=Vue.reactive({state:'disabled',pending:false,canManage:true,...initial}),events=[];
 const renderer=Vue.createRenderer({
  createElement:tag=>node(tag),createText:value=>node('#text',value),createComment:value=>node('#comment',value),
  setText:(n,value)=>n.text=value,setElementText:(n,value)=>{n.text=value;n.children=[];},patchProp:(n,key,_old,value)=>n.props[key]=value,
  insert(n,parent,anchor=null){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}n.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;i<0?parent.children.push(n):parent.children.splice(i,0,n);},
  remove(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1);}n.parent=null;},
  parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,setScopeId(){},
 });
 const messages=JSON.parse(readFileSync('apps/web/src/locales/'+lang+'.json','utf8'));
 const i18n=createI18n({legacy:false,locale:lang,messages:{[lang]:messages}});
 const Wrapper=Vue.defineComponent({setup:()=>()=>Vue.h(Component,{...model,onEnable:()=>events.push('enable'),onRevoke:()=>events.push('revoke'),onRefresh:()=>events.push('refresh')})});
 const root=node('root'),app=renderer.createApp(Wrapper);app.config.globalProperties.$t=i18n.global.t;app.mount(root);await Vue.nextTick();
 return {model,events,t:i18n.global.t,nodes:()=>all(root),buttons:()=>all(root).filter(n=>n.tag==='button'),status:()=>all(root).find(n=>n.props.id==='push-consent-state'),click:async n=>{n.props.onClick();await Vue.nextTick();},unmount:()=>app.unmount()};
}
const matrix={loading:[],enabled:['revoke'],disabled:['enable'],repair:['enable','revoke'],error:['refresh','revoke'],uncertain:['refresh','revoke'],unavailable:['refresh']};
for(const lang of ['es','en','fr','zh'])for(const [state,actions] of Object.entries(matrix))test(`push controls ${lang} ${state} expose only explicit allowed actions`,async()=>{
 const f=await mount(lang,{state});try{
  assert.deepEqual(f.events,[]);assert.equal(f.status().props.role,['error','uncertain'].includes(state)?'alert':'status');
  assert.deepEqual(f.buttons().map(n=>text(n).trim()),actions.map(a=>f.t('verify.push'+a[0].toUpperCase()+a.slice(1))));
  for(const [index,button] of f.buttons().entries()){
   assert.equal(button.props.type,'button');assert.ok(button.props['aria-describedby'].includes('push-consent-scope'));
   if(actions[index]==='revoke')assert.ok(button.props['aria-describedby'].includes('push-consent-queued'));
   await f.click(button);assert.equal(f.events.at(-1),actions[index]);
  }
  if(state==='repair')assert.equal(text(f.status()).trim(),f.t('verify.pushRepair'));
 }finally{f.unmount();}
});
for(const state of ['enabled','disabled','repair','error','uncertain'])test('push controls block disabled handler calls while pending: '+state,async()=>{
 const f=await mount('es',{state,pending:true});try{
  for(const button of f.buttons()){assert.equal(button.props.disabled,true);await f.click(button);}
  assert.deepEqual(f.events,[]);assert.equal(text(f.status()).trim(),f.t('verify.pushLoading'));
 }finally{f.unmount();}
});
test('push controls without verified access never emit and do not offer an action',async()=>{
 const f=await mount('es',{state:'error',canManage:false});try{assert.equal(f.buttons().length,0);assert.deepEqual(f.events,[]);}finally{f.unmount();}
});
test('server state changes never emit activation or revocation automatically',async()=>{
 const f=await mount('en');try{
  for(const state of Object.keys(matrix)){f.model.state=state;await Vue.nextTick();}
  assert.deepEqual(f.events,[]);
 }finally{f.unmount();}
});


test('push action descriptions include the parent consent explanation when provided',async()=>{
 const f=await mount('en',{informationId:'participation-notification-info'});try{for(const button of f.buttons())assert.ok(button.props['aria-describedby'].includes('participation-notification-info'));}finally{f.unmount();}
});
