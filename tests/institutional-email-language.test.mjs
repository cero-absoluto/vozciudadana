import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('apps/web/src/screens/VerifyInstitucionalScreen.vue','utf8');
function harness(lang){const messages=JSON.parse(fs.readFileSync('apps/web/src/locales/'+lang+'.json','utf8'));const t=(key,params={})=>key.split('.').reduce((v,k)=>v[k],messages).replace(/\{(\w+)\}/g,(_,k)=>params[k]??'');const context={onMounted(){},onUnmounted(){},ref:v=>({value:v}),computed:f=>({get value(){return f();}}),useI18n:()=>({t}),useRoute:()=>({params:{protestId:'p'}}),useRouter:()=>({}),useProtestsStore:()=>({protests:[{id:'p',dominio_email:'example.edu'}]}),useUiStore:()=>({})};vm.createContext(context);vm.runInContext(source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_RECAPTCHA_KEY',"''")+'\nglobalThis.state={email,emailError,sendOtp,step,loading};',context);return {state:context.state,t};}
for(const [name,input,key,params] of [['empty','  ','errEmail',{}],['invalid','person','errEmailInvalid',{}],['wrong domain','person@wrong.edu','errDomain',{domain:'@example.edu'}]]){
 test('institutional verification translates '+name+' validation before sending a code',async()=>{
  for(const lang of ['es','en','fr','zh']){const h=harness(lang);h.state.email.value=input;await h.state.sendOtp();assert.equal(h.state.emailError.value,h.t('verificacional.'+key,params));assert.equal(h.state.step.value,1);assert.equal(h.state.loading.value,false);}
 });
}
