import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps/web/src/screens/ArchivoScreen.vue','utf8');
const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://mock.invalid'");
function harness(fetch){let mounted;const context={ref:v=>({value:v}),computed:f=>({get value(){return f();}}),onMounted:f=>{mounted=f;},useI18n:()=>({t:k=>k,locale:{value:'en'}}),localizedCountry:()=>'',fetch};vm.createContext(context);vm.runInContext(script+'\n globalThis.state={loading,protestas,loadError,loadArchive};',context);return {state:context.state,mount:()=>mounted()};}
test('archive HTTP failure is an error, and a successful retry can return a genuinely empty archive',async()=>{
 let calls=0;const h=harness(async()=>++calls===1?{ok:false,status:503,json:async()=>[]}:{ok:true,json:async()=>[]});
 await h.mount();assert.equal(h.state.loading.value,false);assert.ok(h.state.loadError.value);await h.state.loadArchive();assert.equal(calls,2);assert.equal(h.state.loadError.value,false);assert.equal(h.state.protestas.value.length,0);
});
test('archive network and malformed payload failures leave loading and expose error',async()=>{
 for(const fetch of [async()=>{throw Error('offline');},async()=>({ok:true,json:async()=>({error:'wrong shape'})}),async()=>({ok:true,json:async()=>{throw Error('invalid JSON');}})]){const h=harness(fetch);await h.mount();assert.equal(h.state.loading.value,false);assert.ok(h.state.loadError.value);}
});
test('archive retry ignores repeated invocation while loading',async()=>{
 let release,calls=0;const h=harness(()=>{calls++;return new Promise(r=>release=r);});const first=h.mount();await h.state.loadArchive();assert.equal(calls,1);release({ok:true,json:async()=>[]});await first;assert.equal(h.state.loading.value,false);
});
test('archive exposes a translated error and retry, and suppresses empty-list content during failure',()=>{
 const template=source.split('<script setup>')[0];assert.match(template,/v-if="!loading && !loadError"/);assert.match(template,/v-if="loadError"/);assert.match(template,/@click="loadArchive"/);
 for(const locale of ['es','en','fr','zh']){const m=JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`,'utf8'));for(const k of ['loadError','retry'])assert.ok(typeof m.archivo[k]==='string'&&m.archivo[k].trim());}
});
