import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref,computed,reactive,watch} from 'vue';
import {createI18n} from 'vue-i18n';
const source=fs.readFileSync('apps/web/src/screens/DetailScreen.vue','utf8');
const event=extra=>({id:'selected',title:'Chosen event',scope:'global',risk_level:'low',joined:false,saldo_euros:1,timer:3600,endsAtMs:100000,ends_at:new Date(100000).toISOString(),...extra});
function fixture(extra={},lang='es'){
  let clock=1000,decision={ok:true};const navigation=[],writes=[],checks=[],memory=new Map([['vc_last_joined','previous']]);
  const messages=JSON.parse(fs.readFileSync('apps/web/src/locales/'+lang+'.json','utf8'));
  const i18n=createI18n({legacy:false,locale:lang,messages:{[lang]:messages}});
  const store=reactive({protests:[event(extra)],canJoin:p=>{checks.push(p.id);return decision;}});
  const api={fetchGrupoPorConvocatoria:async()=>{throw {status:404};}};
  const context={ref,computed,watch,onMounted(){},onUnmounted(){},api,useRoute:()=>({params:{id:'selected'}}),useRouter:()=>({push:p=>navigation.push(p)}),useProtestsStore:()=>store,useDeviceStore:()=>({}),useUiStore:()=>({openShare(){}}),useI18n:()=>i18n.global,
    Date:{parse:Date.parse,now:()=>clock},sessionStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>{writes.push([k,v]);memory.set(k,String(v));}}};
  vm.createContext(context);vm.runInContext(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://synthetic.invalid'")+'\nglobalThis.state={onJoin,joinLabel,donacionesInfo,censoExiste,cj,isClosed,loadCensus,censusStatus,censusBlocked,grupoId};',context);
  return {state:context.state,store,navigation,writes,memory,checks,t:i18n.global.t,resolveCensus:async exists=>{api.fetchGrupoPorConvocatoria=async()=>{if(exists)return {group_id:'33333333-3333-4333-8333-333333333333',name:'Existing group'};throw {status:404};};await context.state.loadCensus();},setClock:v=>clock=v,setDecision:v=>decision=v};
}
function noDispatch(f){f.state.onJoin();assert.deepEqual(f.navigation,[]);assert.deepEqual(f.writes,[]);assert.equal(f.memory.get('vc_last_joined'),'previous');}

for(const balance of [0,-1,null,undefined])test('join handler refuses an unavailable balance '+balance+' without altering a previous destination',()=>{
  const f=fixture({saldo_euros:balance});assert.equal(f.state.joinLabel.value,f.t('detail.joinSinSaldo'));noDispatch(f);
});

test('join activation rechecks a balance that changed after the UI was rendered',()=>{
  const f=fixture();assert.equal(f.state.joinLabel.value,f.t('detail.joinAnon'));f.store.protests[0].saldo_euros=0;noDispatch(f);
});

test('join activation refuses a missing event rather than using a previous destination',()=>{
  const f=fixture();assert.equal(f.state.cj.value.ok,true);f.store.protests=[];noDispatch(f);
});

test('an already joined event cannot dispatch even if a stale policy response says ok',()=>{
  const f=fixture({joined:true});assert.equal(f.state.joinLabel.value,f.t('detail.joinJoined'));noDispatch(f);
});

for(const reason of ['lock','geo'])test('join handler rechecks a new '+reason+' rejection instead of the rendered computed result',()=>{
  const f=fixture();assert.equal(f.state.cj.value.ok,true);
  f.setDecision({ok:false,[reason]:true});assert.equal(f.state.cj.value.ok,true,'actual Vue computed retains the old decision without reactive writes');
  noDispatch(f);assert.equal(f.checks.length,2);
});

for(const extra of [{timer:0},{timer:-1},{timer:NaN},{endsAtMs:1000},{endsAtMs:999}])test('closed or unresolved event state cannot dispatch '+JSON.stringify(extra),()=>{
  const f=fixture(extra);noDispatch(f);
});

test('absolute expiry blocks activation with a cached open computed and a stalled countdown',()=>{
  const f=fixture({endsAtMs:2000});assert.equal(f.state.isClosed.value,false);assert.equal(f.state.cj.value.ok,true);
  f.setClock(3000);assert.equal(f.state.isClosed.value,false);assert.equal(f.store.protests[0].timer,3600);
  noDispatch(f);
});

test('absolute expiry also uses the server date when a legacy event has no endsAtMs',()=>{
  const f=fixture({endsAtMs:null,ends_at:new Date(2000).toISOString()});assert.equal(f.state.isClosed.value,false);
  f.setClock(3000);noDispatch(f);
});

for(const scope of ['global','national','regional','local'])test('open funded '+scope+' event retains the phone route and explicit destination/risk context',()=>{
  const f=fixture({scope,risk_level:'high'});f.state.onJoin();assert.deepEqual(f.navigation,['/auth']);
  assert.equal(f.memory.get('vc_last_joined'),'selected');assert.equal(f.memory.get('vc_protest_id'),'selected');
  assert.equal(f.memory.get('vc_risk_level'),'high');assert.equal(f.memory.get('vc_protest_scope'),scope);
  assert.equal(f.memory.get('vc_protest_ends_at'),new Date(100000).toISOString());
});

test('institutional email event keeps its verification route without rewriting a phone session',()=>{
  const f=fixture({scope:'regional',dominio_email:'example.invalid',requiere_censo:false});
  assert.equal(f.state.joinLabel.value,f.t('detail.joinEmail'));f.state.onJoin();
  assert.deepEqual(f.navigation,['/verify-institucional/selected']);assert.deepEqual(f.writes,[]);assert.equal(f.memory.get('vc_last_joined'),'previous');
});

for(const exists of [false,true])test('census '+(exists?'existing':'not yet created')+' keeps its route and matching action label',async()=>{
  const f=fixture({scope:'regional',dominio_email:'example.invalid',requiere_censo:true});await f.resolveCensus(exists);
  assert.equal(f.state.joinLabel.value,f.t(exists?'detail.joinCensus':'detail.joinInitCensus'));
  f.memory.set('vc_group_id','existing-context');f.state.onJoin();
  assert.deepEqual(f.navigation,[exists?'/grupo/selected':'/grupo/selected?iniciar=true']);assert.equal(f.memory.get('vc_group_id'),'existing-context');
  assert.equal(f.memory.get('vc_last_joined'),'previous');
});

for(const lang of ['es','en','fr','zh'])test('census start/join labels are correctly paired using real '+lang+' translations',async()=>{
  const f=fixture({scope:'regional',dominio_email:'example.invalid',requiere_censo:true},lang);
  await f.resolveCensus(false);assert.equal(f.state.joinLabel.value,f.t('detail.joinInitCensus'));await f.resolveCensus(true);
  assert.equal(f.state.joinLabel.value,f.t('detail.joinCensus'));
});

test('detail financing exposes its recorded amounts without inventing a verification capacity from a client cost',()=>{
  const f=fixture({saldo_euros:2,donaciones_count:3,donaciones_total:7});
  const info=f.state.donacionesInfo.value;assert.equal(info.saldo_euros,2);assert.equal(info.donaciones_count,3);assert.equal(info.donaciones_total,7);
  assert.equal(Object.hasOwn(info,'adhesiones_posibles'),false);
});
