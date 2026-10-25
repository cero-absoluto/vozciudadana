import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps/web/src/screens/InviteScreen.vue','utf8');
const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://mock.invalid'");
function harness(fetch){let mounted;const context={ref:v=>({value:v}),onMounted:f=>{mounted=f;},useI18n:()=>({t:k=>k}),useRoute:()=>({params:{token:'test-token'}}),useRouter:()=>({push(){throw Error('unexpected navigation');}}),useUiStore:()=>({showToast(){}}),fetch};vm.createContext(context);vm.runInContext(script+'\nglobalThis.state={estado,invitacion,cargarInvitacion};',context);return {state:context.state,mount:()=>mounted()};}
test('invite distinguishes invalid or used links from transient HTTP errors',async()=>{
 for(const status of [400,404,410,429,500,503]){const h=harness(async()=>({ok:false,status}));await h.mount();assert.equal(h.state.estado.value,[400,404,410].includes(status)?'invalida':'error');}
});
test('invite network and invalid JSON failures are retryable',async()=>{
 for(const fetch of [async()=>{throw Error('offline');},async()=>({ok:true,json:async()=>{throw Error('invalid JSON');}})]){const h=harness(fetch);await h.mount();assert.equal(h.state.estado.value,'error');}
});
test('invite retry recovers and prevents duplicate pending requests',async()=>{
 let calls=0,release;const h=harness(()=>{calls++;if(calls===1)throw Error('offline');return new Promise(r=>release=r);});await h.mount();const pending=h.state.cargarInvitacion();assert.equal(h.state.estado.value,'cargando');await h.state.cargarInvitacion();assert.equal(calls,2);release({ok:true,json:async()=>({institucion:'Example',region:'Region',group_id:'g',protest_id:'p'})});await pending;assert.equal(h.state.estado.value,'valida');assert.equal(h.state.invitacion.value.group_id,'g');
});
test('invite renders a translated retry action for transient error',()=>{
 assert.match(source,/v-if="estado === 'error'"/);assert.match(source,/@click="cargarInvitacion"/);
 for(const locale of ['es','en','fr','zh']){const m=JSON.parse(fs.readFileSync(`apps/web/src/locales/${locale}.json`,'utf8'));for(const k of ['loadError','retry'])assert.ok(typeof m.invite[k]==='string'&&m.invite[k].trim());}
});
