import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publicReportId} from '../apps/web/src/lib/publicReportId.js';
const VALID_ID='11111111-1111-4111-8111-111111111111';
const source=fs.readFileSync('apps/web/src/screens/InformeScreen.vue','utf8');
const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://mock.invalid'");
function harness(fetch,id=VALID_ID){let mounted;const context={URL,publicReportId,ref:v=>({value:v}),computed:f=>({get value(){return f();}}),onMounted:f=>{mounted=f;},useRoute:()=>({params:{id}}),useI18n:()=>({t:k=>k,locale:{value:'en'}}),fetch};vm.createContext(context);vm.runInContext(script+'\nglobalThis.state={loading,error,notFound,data,loadReport,safeSourceUrl};',context);return {state:context.state,mount:()=>mounted()};}
test('report reserves not-found state for HTTP 404',async()=>{
 for(const status of [404,429,500,503]){const h=harness(async()=>({ok:false,status}));await h.mount();assert.equal(h.state.notFound.value,status===404);assert.equal(h.state.error.value,status!==404);assert.equal(h.state.loading.value,false);assert.equal(h.state.data.value,null);}
});
test('report network and invalid JSON failures show load error',async()=>{
 for(const fetch of [async()=>{throw Error('offline');},async()=>({ok:true,json:async()=>{throw Error('invalid JSON');}})]){const h=harness(fetch);await h.mount();assert.equal(h.state.error.value,true);assert.equal(h.state.notFound.value,false);assert.equal(h.state.loading.value,false);}
});
test('report retry recovers, clears errors and ignores concurrent requests',async()=>{
 let calls=0,release;const h=harness(()=>{calls++;if(calls===1)throw Error('offline');return new Promise(r=>release=r);});await h.mount();const pending=h.state.loadReport();assert.equal(h.state.loading.value,true);assert.equal(h.state.error.value,false);await h.state.loadReport();assert.equal(calls,2);release({ok:true,json:async()=>({protest:{id:'p'},total_adhesiones:0})});await pending;assert.equal(h.state.data.value.protest.id,'p');assert.equal(h.state.loading.value,false);assert.equal(h.state.error.value,false);
});
test('report preserves integrity-data loading after a successful report fetch',async()=>{
 const urls=[];const h=harness(async url=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/informe')?{protest:{hash_integridad:'hash'}}:{protest_id:'p'}};});await h.mount();assert.equal(urls.length,2);assert.ok(urls[1].endsWith('/integrity-data'));
});
test('report renders separate not-found and retryable error states in all languages',()=>{
 const template=source.split('<script setup>')[0];assert.match(template,/v-else-if="notFound"/);assert.match(template,/v-else-if="error"/);assert.match(template,/@click="loadReport"/);
 for(const locale of ['es','en','fr','zh']){const m=JSON.parse(fs.readFileSync('apps/web/src/locales/'+locale+'.json','utf8'));for(const k of ['loadError','retry'])assert.ok(typeof m.informe[k]==='string'&&m.informe[k].trim());}
});

test('malformed report id does not issue a fetch',async()=>{let calls=0;const h=harness(async()=>{calls++;throw Error();},'../bad');await h.mount();assert.equal(calls,0);assert.equal(h.state.notFound.value,true);assert.equal(h.state.loading.value,false);});

test('report source links allow absolute HTTP(S) only, without embedded credentials',async()=>{
 for(const [url,allowed] of [['javascript:alert(1)',false],['data:text/html,x',false],['//evil.invalid/x',false],['https://user:password@example.org',false],['HTTPS://example.org/path',true],['http://example.org',true]]){
  const h=harness(async()=>({ok:true,json:async()=>({protest:{fuente_url:url}})}));await h.mount();assert.equal(!!h.state.safeSourceUrl.value,allowed,url);
 }
});
