import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {createI18n} from 'vue-i18n';
import {parse,compileScript} from '@vue/compiler-sfc';
const event=(extra={})=>({id:'selected',title:'Selected public event',scope:'global',color:'#123456',heat:10,count:5,timer:3600,...extra});
async function mountActive(lang='es',initial=[]){
  const make=(tag,text='')=>({tag,text,props:{},children:[],parent:null});
  const renderer=Vue.createRenderer({
    createElement:tag=>make(tag),createText:text=>make('#text',text),createComment:text=>make('#comment',text),
    setText:(n,text)=>n.text=text,setElementText:(n,text)=>{n.text=text;n.children=[];},
    insert:(n,p,anchor)=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);const at=anchor?p.children.indexOf(anchor):-1;p.children.splice(at<0?p.children.length:at,0,n);n.parent=p;},
    remove:n=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
    parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
    patchProp:(n,key,before,after)=>n.props[key]=after,setScopeId(){},
  });
  const messages=JSON.parse(fs.readFileSync('apps/web/src/locales/'+lang+'.json','utf8'));
  const i18n=createI18n({legacy:false,locale:lang,messages:{[lang]:messages}});
  const decisions=new Map();const emissions=[],navigation=[],toasts=[];
  const store=Vue.reactive({hasLoaded:false,loading:false,error:null,canJoin:p=>decisions.get(p.id)??{ok:!p.joined,joined:p.joined},scopeBadge:()=>({cls:'global',icon:'',label:'Global'})});
  const rows=Vue.ref(initial);const router={push:p=>navigation.push(p)};
  const {descriptor}=parse(fs.readFileSync('apps/web/src/components/home/ActiveTab.vue','utf8'));
  let source=compileScript(descriptor,{id:'active-keyboard-test',inlineTemplate:true}).content;
  source=source.replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g,(_,names)=>`const { ${names.replace(/\bas\b/g,':')} }=Vue;`).replace(/^import[^\n]+from[^\n]+\n/gm,'').replace('export default','const Component=');
  const context={Vue,useRouter:()=>router,useI18n:()=>i18n.global,useProtestsStore:()=>store,useUiStore:()=>({showToast:m=>toasts.push(m)}),fmt:String,fmtTime:()=> '01:00',localizedCountry:()=>'',ProtestTiming:Vue.defineComponent({setup:()=>()=>null})};
  vm.createContext(context);const Component=vm.runInContext(source+';Component;',context);
  const app=renderer.createApp({setup:()=>()=>Vue.h(Component,{protests:rows.value,onOpen:id=>emissions.push(id)})});
  app.config.globalProperties.$t=i18n.global.t;app.config.globalProperties.$router=router;
  const root=make('root');app.mount(root);await Vue.nextTick();
  const descendants=n=>[n,...n.children.flatMap(descendants)];
  const nodes=()=>descendants(root);
  const click=async node=>{
    const e={target:node,currentTarget:node,stopped:false,stopPropagation(){this.stopped=true;},preventDefault(){}};
    for(let n=node;n;n=n.parent){e.currentTarget=n;const fns=Array.isArray(n.props.onClick)?n.props.onClick:[n.props.onClick];for(const fn of fns)fn?.(e);if(e.stopped)break;}
    await Vue.nextTick();return e;
  };
  return {store,rows,decisions,emissions,navigation,toasts,t:i18n.global.t,nodes,click,flush:()=>Vue.nextTick(),unmount:()=>app.unmount(),articles:()=>nodes().filter(n=>n.tag==='article'),buttons:()=>nodes().filter(n=>n.tag==='button')};
}

test('ActiveTab exposes empty/create only after a completed successful list, never initial/loading/error/retry',async()=>{
  const f=await mountActive();
  try{
    const empty=()=>f.nodes().some(n=>n.text===f.t('active.empty'));
    assert.equal(empty(),false);assert.equal(f.buttons().length,0);
    f.store.loading=true;await f.flush();assert.equal(empty(),false);
    f.store.loading=false;f.store.error='server failure';await f.flush();assert.equal(empty(),false);
    f.store.loading=true;await f.flush();assert.equal(empty(),false);
    f.store.loading=false;f.store.error=null;f.store.hasLoaded=true;await f.flush();
    assert.equal(empty(),true);assert.equal(f.buttons().length,1);await f.click(f.buttons()[0]);assert.deepEqual(f.navigation,['/create']);
    // A successful empty list does not show stale empty/create while refreshed.
    f.store.loading=true;await f.flush();assert.equal(empty(),false);assert.equal(f.buttons().length,0);
    f.store.loading=false;f.store.error='refresh failed';await f.flush();assert.equal(empty(),false);
  }finally{f.unmount();}
});

test('ActiveTab keeps its actual cards visible during background refresh and error',async()=>{
  const f=await mountActive('es',[event()]);
  try{
    f.store.hasLoaded=true;await f.flush();assert.equal(f.articles().length,1);
    f.store.loading=true;await f.flush();assert.equal(f.articles().length,1);assert.equal(f.buttons().length,2);
    f.store.loading=false;f.store.error='offline';await f.flush();assert.equal(f.articles().length,1);assert.equal(f.buttons().length,2);
    assert.equal(f.nodes().some(n=>n.text==='offline'),false);
  }finally{f.unmount();}
});

for(const joined of [false,true])test('card '+(joined?'already joined':'joinable')+' uses two native labelled buttons and one activation emits exactly once',async()=>{
  const p=event({joined});const f=await mountActive('en',[p]);
  try{
    const article=f.articles()[0];assert.equal(article.props['aria-label'],p.title);assert.equal(article.props.onClick,undefined);
    assert.equal(article.props.tabindex,undefined);assert.equal(article.props.role,undefined);
    assert.equal(f.buttons().length,2);
    for(const button of f.buttons()){
      assert.equal(button.props.type,'button');assert.equal(button.props.onKeydown,undefined);assert.equal(button.props.onKeyup,undefined);
      assert.ok(button.props['aria-label'].includes(p.title));
      for(let ancestor=button.parent;ancestor;ancestor=ancestor.parent){assert.notEqual(ancestor.tag,'button');assert.notEqual(ancestor.tag,'a');assert.notEqual(ancestor.props.role,'button');}
    }
    const result=await f.click(f.buttons()[0]);assert.equal(result.stopped,true);assert.deepEqual(f.emissions,[p.id]);assert.equal(f.toasts.length,0);
    await f.click(f.buttons()[1]);assert.deepEqual(f.navigation,['/informe/'+p.id]);assert.deepEqual(f.emissions,[p.id]);
  }finally{f.unmount();}
});

for(const reason of ['lock','geo'])test('blocked '+reason+' card refuses join with fixed feedback but report stays usable once',async()=>{
  const p=event();const f=await mountActive('es',[p]);
  try{
    f.decisions.set(p.id,{ok:false,[reason]:true,msg:'Stored explanation'});
    // Rendering itself does not drive the interaction assertions: handlers recheck canJoin.
    await f.click(f.buttons()[0]);assert.deepEqual(f.emissions,[]);
    assert.deepEqual(f.toasts,[f.t(reason==='lock'?'active.toastLocked':'active.toastGeo')]);
    await f.click(f.buttons()[1]);assert.deepEqual(f.navigation,['/informe/'+p.id]);assert.deepEqual(f.emissions,[]);assert.equal(f.toasts.length,1);
  }finally{f.unmount();}
});

for(const lang of ['es','en','fr','zh'])for(const joined of [false,true])test('real translated button names include event and '+(joined?'joined':'join')+' action in '+lang,async()=>{
  const p=event({joined,title:'Specific event & context'});const f=await mountActive(lang,[p]);
  try{
    const [join,report]=f.buttons();
    assert.equal(join.props['aria-label'],p.title+' — '+(joined?f.t('active.joined',{time:'01:00'}):f.t('active.joinBtn')));
    assert.equal(report.props['aria-label'],p.title+' — '+f.t('informe.headerLabel'));
    assert.ok(!join.props['aria-label'].includes('active.join'));assert.ok(!report.props['aria-label'].includes('informe.headerLabel'));
  }finally{f.unmount();}
});
