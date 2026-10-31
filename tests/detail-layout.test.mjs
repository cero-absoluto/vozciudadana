import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Vue from 'vue';
import {createI18n} from 'vue-i18n';
import {parse,compileScript} from '@vue/compiler-sfc';
const all=n=>[n,...n.children.flatMap(all)];
const text=n=>n.text+n.children.map(text).join('');
const hasClass=(n,c)=>String(n.props.class??'').split(/\s+/).includes(c);
const inside=(n,p)=>{for(let x=n;x;x=x.parent)if(x===p)return true;return false;};
const event=extra=>({id:'selected',title:'Chosen event',desc:'Description of the public event',demands:'Requested action',focal_point:'Public authority',scope:'global',risk_level:'low',joined:false,saldo_euros:2,donaciones_count:2,donaciones_total:3,timer:3600,endsAtMs:100000,ends_at:new Date(100000).toISOString(),count:4,cities:2,viralCount:5,...extra});
async function mountDetail(extra={},options={}){
  const lang=options.lang??'es';const messages=JSON.parse(fs.readFileSync('apps/web/src/locales/'+lang+'.json','utf8'));
  const i18n=createI18n({legacy:false,locale:lang,messages:{[lang]:messages}});
  const make=(tag,value='')=>({tag,text:value,props:{},children:[],parent:null});
  const renderer=Vue.createRenderer({
    createElement:tag=>make(tag),createText:t=>make('#text',t),createComment:t=>make('#comment',t),
    setText:(n,t)=>n.text=t,setElementText:(n,t)=>{n.text=t;n.children=[];},
    insert:(n,p,anchor)=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);const at=anchor?p.children.indexOf(anchor):-1;p.children.splice(at<0?p.children.length:at,0,n);n.parent=p;},
    remove:n=>{if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
    parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
    patchProp:(n,k,prev,next)=>n.props[k]=next,setScopeId(){},
  });
  const navigation=[],writes=[],shares=[];const memory=new Map();
  const router={push:p=>navigation.push(p),back(){}};
  const store=Vue.reactive({protests:[event(extra)],canJoin:p=>options.decision??(p.joined?{ok:false,joined:true}:{ok:true}),scopeBadge:()=>({cls:'sb-global',icon:'',label:'Global'})});
  const api={fetchGrupoPorConvocatoria:async()=>{if(options.censusExists)return {group_id:'existing-group'};throw {status:404};}};
  const {descriptor}=parse(fs.readFileSync('apps/web/src/screens/DetailScreen.vue','utf8'));
  let source=compileScript(descriptor,{id:'detail-layout-test',inlineTemplate:true}).content;
  source=source.replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g,(_,names)=>`const { ${names.replace(/\bas\b/g,':')} }=Vue;`).replace(/^import[^\n]+from[^\n]+\n/gm,'').replace('import.meta.env.VITE_API_URL',"'https://synthetic.invalid'").replace('export default','const Component=');
  const context={Vue,useI18n:()=>i18n.global,useRoute:()=>({params:{id:'selected'}}),useRouter:()=>router,useProtestsStore:()=>store,useDeviceStore:()=>({}),useUiStore:()=>({openShare:c=>shares.push(c)}),localizedCountry:()=>'',fmt:String,fmtTime:()=> '01:00',inRegion:()=>true,api,Date:{parse:Date.parse,now:()=>1000},sessionStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>{writes.push([k,v]);memory.set(k,String(v));}},fetch:async()=>({json:async()=>({})}),ProtestTiming:Vue.defineComponent({setup:()=>()=>null})};
  vm.createContext(context);const Component=vm.runInContext(source+';Component;',context);
  const root=make('root');const app=renderer.createApp(Component);app.config.globalProperties.$t=i18n.global.t;app.config.globalProperties.$router=router;app.mount(root);
  const flush=async()=>{await new Promise(r=>setImmediate(r));await Vue.nextTick();};await flush();
  const nodes=()=>all(root);const byClass=c=>nodes().find(n=>hasClass(n,c));
  return {store,navigation,writes,memory,shares,t:i18n.global.t,nodes,byClass,flush,unmount:()=>app.unmount(),cta:()=>byClass('join-footer')?.children.flatMap(all).find(n=>n.tag==='button'&&hasClass(n,'btn-primary')),click:async n=>{n.props.onClick?.({target:n,currentTarget:n});await flush();}};
}

test('detail header and optional financing belong to the scrollable body while only one primary CTA remains in footer',async()=>{
  const f=await mountDetail();try{
    const body=f.byClass('d-scroll'),footer=f.byClass('join-footer'),header=f.byClass('detail-hdr'),funding=f.byClass('detail-funding');
    assert.ok(inside(header,body));assert.ok(inside(funding,body));assert.ok(!inside(funding,footer));assert.ok(!inside(header,footer));
    const ctas=f.nodes().filter(n=>n.tag==='button'&&hasClass(n,'btn-primary'));assert.equal(ctas.length,1);assert.ok(inside(ctas[0],footer));
    assert.ok(text(body).includes('Public authority'));assert.ok(text(body).includes('Requested action'));
    const donation=all(funding).find(n=>n.tag==='a');assert.ok(donation.props.href.startsWith('https://ko-fi.com/voiceprotest?'));assert.equal(donation.props.onClick,undefined);
    assert.ok(text(funding).includes(f.t('detail.fundingOptional')));assert.deepEqual(f.navigation,[]);assert.deepEqual(f.writes,[]);
  }finally{f.unmount();}
});

for(const risk of ['high','critical'])test(risk+' risk remains unfolded immediately before the footer CTA and is its accessible description',async()=>{
  const f=await mountDetail({risk_level:risk});try{
    const footer=f.byClass('join-footer');const riskNode=f.nodes().find(n=>n.props.id==='detail-risk-info');const cta=f.cta();
    assert.ok(riskNode);assert.ok(inside(riskNode,footer));assert.ok(text(riskNode).includes(f.t('detail.riskHigh')));
    assert.equal(f.nodes().filter(n=>n.props.id==='detail-risk-info').length,1);assert.equal(cta.props['aria-describedby'],'detail-risk-info');
    assert.ok(all(footer).indexOf(riskNode)<all(footer).indexOf(cta));
    for(let n=riskNode;n;n=n.parent){assert.notEqual(n.tag,'details');assert.notEqual(n.tag,'summary');assert.ok(!n.props.hidden);}
    assert.equal(f.nodes().filter(n=>n.tag==='button'&&hasClass(n,'btn-primary')).length,1);
  }finally{f.unmount();}
});

test('zero balance has an explanation beside the disabled CTA and never dispatches a join',async()=>{
  const f=await mountDetail({saldo_euros:0});try{
    const footer=f.byClass('join-footer'),cta=f.cta();const balance=f.nodes().find(n=>n.props.id==='detail-balance-info');
    assert.ok(inside(balance,footer));assert.ok(text(balance).includes(f.t('detail.donAgotado')));assert.equal(cta.props.disabled,true);
    assert.equal(cta.props['aria-describedby'],'detail-balance-info');assert.equal(text(cta).trim(),f.t('detail.joinSinSaldo'));
    assert.ok(text(f.byClass('detail-funding')).includes(f.t('detail.fundingOptional')));
    await f.click(cta);assert.deepEqual(f.navigation,[]);assert.deepEqual(f.writes,[]);
  }finally{f.unmount();}
});

test('a closed event hides financing and participation and retains a single working report action',async()=>{
  const f=await mountDetail({timer:0,endsAtMs:500});try{
    assert.equal(f.byClass('detail-funding'),undefined);assert.equal(f.nodes().some(n=>n.props.id==='detail-risk-info'),false);
    const cta=f.cta();assert.equal(text(cta).trim(),f.t('detail.closedInformeBtn'));
    assert.ok(text(f.byClass('join-footer')).includes(f.t('detail.closedTitle')));await f.click(cta);
    assert.deepEqual(f.navigation,['/informe/selected']);assert.deepEqual(f.writes,[]);
  }finally{f.unmount();}
});

test('joined state remains disabled and cannot navigate or rewrite participation context',async()=>{
  const f=await mountDetail({joined:true,risk_level:'high'});try{
    const cta=f.cta();assert.equal(cta.props.disabled,true);assert.equal(text(cta).trim(),f.t('detail.joinJoined'));
    assert.equal(f.nodes().some(n=>n.props.id==='detail-risk-info'),false);await f.click(cta);assert.deepEqual(f.navigation,[]);assert.deepEqual(f.writes,[]);
  }finally{f.unmount();}
});

for(const lang of ['es','en','fr','zh'])for(const method of ['phone','email','new census','existing census'])test('detail '+method+' CTA remains correctly labelled and routed in '+lang,async()=>{
  const institutional=method!=='phone';const census=method.includes('census');const exists=method==='existing census';
  const f=await mountDetail(institutional?{scope:'regional',dominio_email:'example.invalid',requiere_censo:census}:{},{lang,censusExists:exists});
  try{
    const key=method==='phone'?'detail.joinAnon':method==='email'?'detail.joinEmail':exists?'detail.joinCensus':'detail.joinInitCensus';
    assert.equal(text(f.cta()).trim(),f.t(key));assert.equal(f.cta().props.disabled,false);
    await f.click(f.cta());assert.deepEqual(f.navigation,[method==='phone'?'/auth':method==='email'?'/verify-institucional/selected':exists?'/grupo/selected':'/grupo/selected?iniciar=true']);
    assert.ok(text(f.byClass('detail-funding')).includes(f.t('detail.fundingOptional')));
    assert.doesNotMatch(f.t('detail.donAgotadoHint'),/20|0[.,]05/);
    assert.equal(f.nodes().some(n=>n.text?.includes(f.t('detail.donPosibles'))),false);
  }finally{f.unmount();}
});

for(const joined of [false,true])test('closed '+(joined?'joined':'not joined')+' census does not expose the formerly hidden group or viral-count actions',async()=>{
  const f=await mountDetail({scope:'regional',dominio_email:'example.invalid',requiere_censo:true,timer:0,endsAtMs:500,joined,viralCount:12},{censusExists:true});
  try{
    assert.equal(f.byClass('detail-funding'),undefined);
    const buttons=f.nodes().filter(n=>n.tag==='button');
    assert.equal(buttons.some(n=>text(n).trim()===f.t('detail.seeCensus')),false);
    assert.equal(buttons.some(n=>text(n).trim()===f.t('detail.myGroup')),false);
    assert.equal(f.nodes().some(n=>text(n).includes(f.t('detail.viralCountSuffix'))),false);
    await f.click(f.cta());assert.deepEqual(f.navigation,['/informe/selected']);
  }finally{f.unmount();}
});

test('high risk and exhausted balance are both associated with the same disabled participation control',async()=>{
  const f=await mountDetail({risk_level:'high',saldo_euros:0});
  try{
    const ids=f.cta().props['aria-describedby'].split(' ');assert.deepEqual(ids,['detail-risk-info','detail-balance-info']);
    for(const id of ids){const note=f.nodes().find(n=>n.props.id===id);assert.ok(note);assert.ok(inside(note,f.byClass('join-footer')));}
    assert.equal(f.cta().props.disabled,true);await f.click(f.cta());assert.deepEqual(f.navigation,[]);assert.deepEqual(f.writes,[]);
  }finally{f.unmount();}
});
