import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps/web/src/screens/UnirseGrupoScreen.vue','utf8');
function harness(lang){let calls=0;const messages=JSON.parse(fs.readFileSync('apps/web/src/locales/'+lang+'.json','utf8'));const t=(key,params={})=>key.split('.').reduce((v,k)=>v[k],messages).replace(/\{(\w+)\}/g,(_,k)=>params[k]??'');const context={censusRecaptcha:async()=>'mock-captcha',ref:v=>({value:v}),computed:f=>({get value(){return f();}}),useI18n:()=>({t}),useRoute:()=>({params:{protestId:'p'},query:{}}),useRouter:()=>({}),useProtestsStore:()=>({protests:[{id:'p',dominio_email:'example.edu'}]}),useUiStore:()=>({}),api:{sendEmailOtp:async()=>{calls++;}},sessionStorage:{getItem:()=>null,setItem(){}}};vm.createContext(context);vm.runInContext(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'')+'\nglobalThis.state={email,emailError,solicitarOtp,paso};',context);return {state:context.state,t,calls:()=>calls};}
test('empty email uses existing translation and never sends a code',async()=>{
 for(const lang of ['es','en','fr','zh']){const h=harness(lang);h.state.email.value='  ';await h.state.solicitarOtp();assert.equal(h.state.emailError.value,h.t('unirse.errEmail'));assert.equal(h.calls(),0);assert.equal(h.state.paso.value,1);}
});
test('wrong domain uses translated message with domain while matching remains case-insensitive',async()=>{
 for(const lang of ['es','en','fr','zh']){const h=harness(lang);h.state.email.value='person@wrong.edu';await h.state.solicitarOtp();assert.equal(h.state.emailError.value,h.t('unirse.errDomain',{domain:'@example.edu'}));assert.equal(h.calls(),0);h.state.email.value='person@EXAMPLE.EDU';await h.state.solicitarOtp();assert.equal(h.calls(),1);assert.equal(h.state.paso.value,2);}
});
