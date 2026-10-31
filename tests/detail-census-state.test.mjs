import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ref,computed,reactive,watch} from 'vue';
const UUID_A='11111111-1111-4111-8111-111111111111';
const UUID_B='22222222-2222-4222-8222-222222222222';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(r=>setImmediate(r));
const event=id=>({id,title:'Event '+id,scope:'regional',dominio_email:'example.invalid',requiere_censo:true,joined:false,timer:3600,endsAtMs:100000,saldo_euros:2});
function fixture(){
  let mounted;const unmounted=[],stops=[],calls=[],navigation=[],writes=[];const memory=new Map([['vc_group_id','unrelated-session-group']]);
  const route=reactive({params:{id:'A'}});const store=reactive({protests:[event('A'),event('B')],canJoin:p=>p.joined?{ok:false,joined:true}:{ok:true},fetchProtestById:async id=>store.protests.find(p=>p.id===id)});
  let lookup=async()=>({group_id:UUID_A,name:'Group A'});
  const api={fetchGrupoPorConvocatoria:id=>{calls.push(id);return lookup(id);}};
  const context={ref,computed,watch:(...args)=>{const stop=watch(...args);stops.push(stop);return stop;},onMounted:fn=>mounted=fn,onUnmounted:fn=>unmounted.push(fn),
    useI18n:()=>({t:k=>k,locale:ref('es')}),useRoute:()=>route,useRouter:()=>({push:p=>navigation.push(p)}),useProtestsStore:()=>store,useDeviceStore:()=>({}),useUiStore:()=>({}),api,
    Date:{parse:Date.parse,now:()=>1000},sessionStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>{writes.push([k,v]);memory.set(k,String(v));}},fetch:async()=>({json:async()=>({})})};
  vm.createContext(context);const source=fs.readFileSync('apps/web/src/screens/DetailScreen.vue','utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://synthetic.invalid'");
  vm.runInContext(source+'\nglobalThis.state={needsCensus,censusStatus,censusBlocked,censoExiste,grupoId,loadCensus,loadDetail,onJoin,joinLabel,velocidadHoy,loadingFallback,loadError,notFound};',context);
  return{state:context.state,context,store,route,calls,navigation,writes,setLookup:fn=>lookup=fn,mount:()=>mounted(),unmount:()=>{unmounted.forEach(fn=>fn());stops.forEach(stop=>stop());}};
}
function assertNoJoin(f){f.state.onJoin();assert.deepEqual(f.navigation,[]);assert.deepEqual(f.writes,[]);}

test('initial census loading cannot send a user to founder mode or overwrite group context',()=>{
  const f=fixture();try{assert.equal(f.state.needsCensus.value,true);assert.equal(f.state.censusStatus.value,'loading');assert.equal(f.state.censusBlocked.value,true);assert.equal(f.state.joinLabel.value,'detail.censusLoading');assertNoJoin(f);}finally{f.unmount();}
});

test('a valid census lookup enables the existing-group route only for its event context',async()=>{
  const f=fixture();try{await f.state.loadCensus();assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.censoExiste.value,true);assert.equal(f.state.censusBlocked.value,false);assert.equal(f.state.grupoId.value,UUID_A);assert.equal(f.state.joinLabel.value,'detail.joinCensus');f.state.onJoin();assert.deepEqual(f.navigation,['/grupo/A']);assert.deepEqual(f.calls,['A']);}finally{f.unmount();}
});

test('only a confirmed 404 enables the census founder route',async()=>{
  const f=fixture();try{f.setLookup(async()=>{throw {status:404};});await f.state.loadCensus();assert.equal(f.state.censusStatus.value,'absent');assert.equal(f.state.censoExiste.value,false);assert.equal(f.state.censusBlocked.value,false);assert.equal(f.state.grupoId.value,null);assert.equal(f.state.joinLabel.value,'detail.joinInitCensus');f.state.onJoin();assert.deepEqual(f.navigation,['/grupo/A?iniciar=true']);}finally{f.unmount();}
});

for(const failure of [{status:401},{status:429},{status:503},{code:'REQUEST_TIMEOUT'},{code:'API_NETWORK_ERROR'},{code:'INVALID_API_RESPONSE'},new Error('offline'),{status:'404'}])test('census lookup failure '+JSON.stringify(failure)+' is retryable error rather than absent',async()=>{
  const f=fixture();try{f.setLookup(async()=>{throw failure;});await f.state.loadCensus();assert.equal(f.state.censusStatus.value,'error');assert.equal(f.state.censusBlocked.value,true);assert.equal(f.state.censoExiste.value,false);assert.equal(f.state.grupoId.value,null);assert.equal(f.state.joinLabel.value,'detail.censusUnavailable');assertNoJoin(f);await flush();assert.equal(f.calls.length,1);}finally{f.unmount();}
});

for(const data of [null,{},[],{group_id:null},{group_id:7},{group_id:'existing-group'},{group_id:'11111111-1111-0111-0111-111111111111'},{group_id:UUID_A+'extra'}])test('malformed successful census response '+JSON.stringify(data)+' cannot claim a group or founder permission',async()=>{
  const f=fixture();try{f.setLookup(async()=>data);await f.state.loadCensus();assert.equal(f.state.censusStatus.value,'error');assert.equal(f.state.grupoId.value,null);assert.equal(f.state.censusBlocked.value,true);assertNoJoin(f);}finally{f.unmount();}
});

test('manual retry after an error issues one lookup and clears stale group metadata until confirmed',async()=>{
  const f=fixture();try{
    await f.state.loadCensus();assert.equal(f.state.grupoId.value,UUID_A);
    f.setLookup(async()=>{throw {status:503};});await f.state.loadCensus();assert.equal(f.state.grupoId.value,null);
    const wait=defer();f.setLookup(()=>wait.promise);const retry=f.state.loadCensus();await f.state.loadCensus();
    assert.equal(f.calls.length,3);assert.equal(f.state.censusStatus.value,'loading');assert.equal(f.state.grupoId.value,null);assertNoJoin(f);
    wait.resolve({group_id:UUID_B,name:'Recovered'});await retry;assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.grupoId.value,UUID_B);
  }finally{f.unmount();}
});

for(const change of ['route','domain','scope','required','unmount'])test('late census response cannot authorize a changed '+change+' context',async()=>{
  const f=fixture();try{
    const wait=defer();f.setLookup(()=>wait.promise);const pending=f.state.loadCensus();assert.equal(f.calls.length,1);
    if(change==='route')f.route.params.id='B';
    if(change==='domain')f.store.protests[0].dominio_email='changed.invalid';
    if(change==='scope')f.store.protests[0].scope='global';
    if(change==='required')f.store.protests[0].requiere_censo=false;
    if(change==='unmount')f.unmount();
    assert.equal(f.state.censusStatus.value,'error');assert.equal(f.state.grupoId.value,null);
    wait.resolve({group_id:UUID_A,name:'Old response'});await pending;
    assert.equal(f.state.censusStatus.value,'error');assert.equal(f.state.grupoId.value,null);assert.equal(f.state.censoExiste.value,false);assert.equal(f.calls.length,1);
    if(['route','domain','unmount'].includes(change))assertNoJoin(f);
  }finally{f.unmount();}
});

test('leaving and returning to the same domain does not revive a response from an invalidated request',async()=>{
  const f=fixture();try{const wait=defer();f.setLookup(()=>wait.promise);const pending=f.state.loadCensus();f.store.protests[0].dominio_email='other.invalid';f.store.protests[0].dominio_email='example.invalid';wait.resolve({group_id:UUID_A});await pending;assert.equal(f.state.censusStatus.value,'error');assertNoJoin(f);}finally{f.unmount();}
});

test('a request for a newer route can succeed while an old request is still pending without inheriting its group',async()=>{
  const f=fixture();try{
    const a=defer(),b=defer();f.setLookup(id=>id==='A'?a.promise:b.promise);const first=f.state.loadCensus();f.route.params.id='B';const latest=f.state.loadCensus();
    b.resolve({group_id:UUID_B,name:'B'});await latest;a.resolve({group_id:UUID_A,name:'A'});await first;
    assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.grupoId.value,UUID_B);assert.equal(f.state.censoExiste.value,true);f.state.onJoin();assert.deepEqual(f.navigation,['/grupo/B']);
  }finally{f.unmount();}
});

test('an old 404 cannot convert a failed lookup for the newer route into founder permission',async()=>{
  const f=fixture();try{
    const a=defer();f.setLookup(id=>id==='A'?a.promise:Promise.reject({status:401}));const first=f.state.loadCensus();f.route.params.id='B';await f.state.loadCensus();a.reject({status:404});await first;
    assert.equal(f.state.censusStatus.value,'error');assert.equal(f.state.grupoId.value,null);assertNoJoin(f);
  }finally{f.unmount();}
});

test('changing a resolved domain immediately clears its known group and blocks cached navigation',async()=>{
  const f=fixture();try{await f.state.loadCensus();assert.equal(f.state.censusBlocked.value,false);f.store.protests[0].dominio_email='new.invalid';assert.equal(f.state.censusStatus.value,'error');assert.equal(f.state.grupoId.value,null);assert.equal(f.state.censoExiste.value,false);assertNoJoin(f);}finally{f.unmount();}
});

for(const altered of [{joined:true},{timer:0},{saldo_euros:0}])test('public census metadata can load for '+JSON.stringify(altered)+' while participation guards remain enforced',async()=>{
  const f=fixture();try{Object.assign(f.store.protests[0],altered);await f.state.loadCensus();assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.grupoId.value,UUID_A);assertNoJoin(f);}finally{f.unmount();}
});

test('the secondary report cannot delay or override a confirmed census result',async()=>{
  const f=fixture();try{
    const report=defer();f.context.fetch=()=>report.promise;const mounting=f.mount();await flush();
    assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.censusBlocked.value,false);f.state.onJoin();assert.deepEqual(f.navigation,['/grupo/A']);
    report.reject(new Error('report unavailable'));await mounting;assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.grupoId.value,UUID_A);
  }finally{f.unmount();}
});

test('loadDetail missing-event recovery starts the census lookup only after the exact event exists',async()=>{
  const f=fixture();try{
    const detail=defer();f.store.protests=[];f.store.fetchProtestById=()=>detail.promise;const loading=f.mount();assert.equal(f.calls.length,0);
    f.store.protests.push(event('A'));detail.resolve(f.store.protests[0]);await loading;assert.deepEqual(f.calls,['A']);assert.equal(f.state.censusStatus.value,'present');
  }finally{f.unmount();}
});


test('initial load and a manual census request cannot overlap or invent absence',async()=>{
  const f=fixture();try{const wait=defer();f.setLookup(()=>wait.promise);const mounting=f.mount();await flush();await f.state.loadCensus();assert.equal(f.calls.length,1);assert.equal(f.state.censusStatus.value,'loading');assertNoJoin(f);wait.reject({status:404});await mounting;assert.equal(f.state.censusStatus.value,'absent');}finally{f.unmount();}
});

test('a late detail lookup failure cannot update the error state of a newer route',async()=>{
  const f=fixture();try{
    const old=defer();f.store.protests=[];f.store.fetchProtestById=()=>old.promise;const mounting=f.mount();assert.equal(f.state.loadingFallback.value,true);
    f.route.params.id='B';f.store.protests.push(event('B'));assert.equal(f.state.loadingFallback.value,false);
    await f.state.loadDetail();assert.equal(f.state.censusStatus.value,'present');
    old.reject(new Error('old route failure'));await mounting;
    assert.equal(f.state.loadError.value,false);assert.equal(f.state.notFound.value,false);assert.equal(f.state.censoExiste.value,true);assert.deepEqual(f.calls,['B']);
  }finally{f.unmount();}
});

test('an unmounted detail lookup cannot start a census query or claim a missing event',async()=>{
  const f=fixture();const wait=defer();f.store.protests=[];f.store.fetchProtestById=()=>wait.promise;
  const mounting=f.mount();f.unmount();wait.resolve(null);await mounting;
  assert.equal(f.calls.length,0);assert.equal(f.state.notFound.value,false);assert.equal(f.state.grupoId.value,null);
});


test('a list refresh replacing the same event object does not invalidate an unchanged census context',async()=>{
  const f=fixture();try{await f.state.loadCensus();assert.equal(f.state.censusStatus.value,'present');
    f.store.protests=[{...event('A'),count:99},event('B')];
    assert.equal(f.state.censusStatus.value,'present');assert.equal(f.state.grupoId.value,UUID_A);assert.equal(f.state.censoExiste.value,true);assert.equal(f.calls.length,1);
  }finally{f.unmount();}
});

test('a pending lookup survives a list replacement with identical context without an automatic second request',async()=>{
  const f=fixture();try{const wait=defer();f.setLookup(()=>wait.promise);const pending=f.state.loadCensus();f.store.protests=[{...event('A'),title:'Refreshed title'},event('B')];
    assert.equal(f.state.censusStatus.value,'loading');wait.resolve({group_id:UUID_A,name:'Group A'});await pending;assert.equal(f.state.censusStatus.value,'present');assert.equal(f.calls.length,1);
  }finally{f.unmount();}
});
