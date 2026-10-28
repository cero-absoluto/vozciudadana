import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps/web/src/screens/MiGrupoScreen.vue','utf8');
const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'');
function harness(overrides={},query={iniciar:'true'},creatorKey=null){let mounted;const writes=[];const api={fetchGrupoPorConvocatoria:async()=>({group_id:'g'}),fetchGrupoEstado:async()=>({acreditados:12,pendientes:2,mis_vouches_restantes:3,objetivo:30,mi_estado:{},solicitudes:[]}),...overrides};const context={ref:v=>({value:v}),computed:f=>({get value(){return f();}}),onMounted:f=>{mounted=f;},useI18n:()=>({t:k=>k}),useRoute:()=>({params:{protestId:'p'},query}),useRouter:()=>({}),useProtestsStore:()=>({protests:[],loadProtests:async()=>{}}),useUiStore:()=>({showToast(){}}),sessionStorage:{getItem:()=>creatorKey,setItem:(...x)=>writes.push(x)},api};vm.createContext(context);vm.runInContext(script+'\nglobalThis.state={cargando,loadError,groupId,creandoGrupo,grupo,loadGroup};',context);return {state:context.state,mount:()=>mounted(),api,writes};}
test('group lookup network/server failure is not a missing group or a census invitation',async()=>{
 for(const fail of [()=>{throw Error('offline');},()=>{throw Object.assign(Error(),{status:503});}]){const h=harness({fetchGrupoPorConvocatoria:fail});await h.mount();assert.equal(h.state.loadError.value,true);assert.equal(h.state.cargando.value,false);assert.equal(h.state.creandoGrupo.value,false);assert.equal(h.writes.length,0);}
});
test('group HTTP 404 offers start-census flow only to the creator',async()=>{
 const h=harness({fetchGrupoPorConvocatoria:async()=>{throw Object.assign(Error(),{status:404});}},{iniciar:'true'},'creator-key');await h.mount();assert.equal(h.state.loadError.value,false);assert.equal(h.state.groupId.value,null);assert.equal(h.state.creandoGrupo.value,true);assert.equal(h.state.cargando.value,false);
});
test('failed group state is exposed instead of default counters and retry recovers',async()=>{
 const h=harness({fetchGrupoEstado:async()=>{throw Error('offline');}});await h.mount();assert.equal(h.state.loadError.value,true);h.api.fetchGrupoEstado=async()=>({acreditados:12,pendientes:2,mis_vouches_restantes:3,objetivo:30,mi_estado:{},solicitudes:[]});await h.state.loadGroup();assert.equal(h.state.loadError.value,false);assert.equal(h.state.grupo.value.acreditados,12);
});
test('group load guards concurrent attempts',async()=>{
 let release,calls=0;const h=harness({fetchGrupoPorConvocatoria:()=>{calls++;return new Promise(r=>release=r);}});const pending=h.mount();await Promise.resolve();await h.state.loadGroup();assert.equal(calls,1);release({group_id:'g'});await pending;assert.equal(h.state.cargando.value,false);
});
test('group loading and errors hide the absent and existing group branches and provide retry',()=>{
 assert.match(source,/v-if="\(!groupId \|\| needsAuth\) && !cargando && !loadError"/);assert.match(source,/v-if="groupId && !needsAuth && !cargando && !loadError"/);assert.match(source,/@click="loadGroup"/);assert.match(source,/v-if="loadError"/);
 for(const locale of ['es','en','fr','zh']){const m=JSON.parse(fs.readFileSync('apps/web/src/locales/'+locale+'.json','utf8'));for(const k of ['loading','loadError','retry'])assert.ok(typeof m.migrupo[k]==='string'&&m.migrupo[k].trim());}
});

test('non-creator cannot auto-start a missing census',async()=>{
 const h=harness({fetchGrupoPorConvocatoria:async()=>{throw Object.assign(Error(),{status:404});}});
 await h.mount();assert.equal(h.state.creandoGrupo.value,false);
});
