import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ref=v=>({value:v}),computed=f=>({get value(){return f();}});
const storeSource=fs.readFileSync('apps/web/src/stores/protests.js','utf8');
function storeHarness(fetchProtest){const context={ref,computed,defineStore:(_,setup)=>setup,useDeviceStore:()=>({getLocks:()=>({})}),api:{fetchProtest}};vm.createContext(context);vm.runInContext(storeSource.replace(/^import .*;\n/gm,'').replace('export const useProtestsStore','const useProtestsStore')+'\nglobalThis.store=useProtestsStore();',context);return context.store;}
test('direct lookup returns null only for 404; network and server failures reject',async()=>{
 const missing=storeHarness(async()=>{throw Object.assign(Error(),{status:404});});assert.equal(await missing.fetchProtestById('p'),null);
 for(const fail of [()=>{throw Error('offline');},()=>{throw Object.assign(Error(),{status:503});}]){const store=storeHarness(fail);await assert.rejects(store.fetchProtestById('p'));assert.equal(store.protests.value.length,0);}
});
test('direct lookup preserves successful normalization and cached results',async()=>{
 let calls=0;const store=storeHarness(async()=>{calls++;return {id:'p',title:'Example',scope:'global',ends_at:new Date(Date.now()+60000).toISOString()};});const p=await store.fetchProtestById('p');assert.equal(p.title,'Example');assert.equal(store.protests.value.length,1);assert.equal(await store.fetchProtestById('p'),p);assert.equal(calls,1);
});
const source=fs.readFileSync('apps/web/src/screens/DetailScreen.vue','utf8');
function detailHarness(fetchById){let mounted;const store={protests:[],fetchProtestById:fetchById};const context={ref,computed,watch(){},onUnmounted(){},onMounted:f=>{mounted=f;},useRoute:()=>({params:{id:'p'}}),useRouter:()=>({}),useProtestsStore:()=>store,useDeviceStore:()=>({}),useUiStore:()=>({}),useI18n:()=>({t:k=>k,locale:{value:'en'}}),fetch:async()=>({json:async()=>({})})};vm.createContext(context);vm.runInContext(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://mock.invalid'")+'\nglobalThis.state={loadingFallback,notFound,loadError,loadDetail};',context);return {state:context.state,store,mount:()=>mounted()};}
test('detail distinguishes missing event from a retryable failure',async()=>{
 const missing=detailHarness(async()=>null);await missing.mount();assert.equal(missing.state.notFound.value,true);assert.equal(missing.state.loadError.value,false);
 const failed=detailHarness(async()=>{throw Error('offline');});await failed.mount();assert.equal(failed.state.notFound.value,false);assert.equal(failed.state.loadError.value,true);assert.equal(failed.state.loadingFallback.value,false);
});
test('detail retry clears error and ignores concurrent attempts',async()=>{
 let calls=0,release;const h=detailHarness(()=>{calls++;if(calls===1)throw Error('offline');return new Promise(r=>release=r);});await h.mount();const pending=h.state.loadDetail();assert.equal(h.state.loadError.value,false);await h.state.loadDetail();assert.equal(calls,2);const p={id:'p',scope:'global',timer:60};h.store.protests.push(p);release(p);await pending;assert.equal(h.state.loadingFallback.value,false);assert.equal(h.state.loadError.value,false);assert.equal(h.state.notFound.value,false);
});
test('detail exposes translated failure and retry',()=>{assert.match(source,/v-else-if="loadError"/);assert.match(source,/@click="loadDetail"/);assert.ok(source.includes("$t('home.loadFailed')"));assert.ok(source.includes("$t('home.retry')"));});
