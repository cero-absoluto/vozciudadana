// Execute actual Vue script handlers with synthetic browser/stores; no network or OTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {withClientDeadline} from '../apps/web/src/services/requestJson.js';
import * as outcomes from '../apps/web/src/lib/participationOutcome.js';
const read=name=>readFileSync(new URL('../apps/web/src/screens/'+name+'.vue',import.meta.url),'utf8');
const auth=read('AuthScreen');
const gpsHandler=auth.slice(auth.indexOf('async function requestGpsFlow()'),auth.indexOf('async function sendSMS()'));
for(const target of [{scope:'local',risk_level:'high'},{scope:'regional',risk_level:'critical'},{scope:'local',risk_level:'low',dominio_email:'synthetic.invalid'}])test('IDV-02 auth does not request location for '+JSON.stringify(target),async()=>{
 let reads=0;const context={joiningProtest:{value:target},sessionStorage:{getItem:()=>{reads++;return 'low';}},device:{gpsReady:false},showGpsModal:{value:false},navigator:{geolocation:{getCurrentPosition(){throw Error('must not request GPS');}}}};
 vm.createContext(context);vm.runInContext(gpsHandler+';globalThis.run=requestGpsFlow;',context);await context.run();assert.equal(context.showGpsModal.value,false);assert.equal(reads,0,'cached risk is not trusted');
});
const verify=read('VerifyScreen').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'').replaceAll('import.meta.env.VITE_API_URL',"'https://api.invalid'").replaceAll('import.meta.env.VITE_RECAPTCHA_KEY',"'synthetic'").replaceAll("import('@/services/api.js')",'Promise.resolve(apiFixture)');
for(const risk of ['high','critical','low'])test('IDV-02 final join '+risk+' handles cached GPS according to current target',async()=>{
 let mounted;const payloads=[],target={id:'synthetic',scope:'local',risk_level:risk};
 const memory=new Map([['vc_last_joined','synthetic']]);
 const context={...outcomes,withClientDeadline,ref:value=>({value}),onMounted:fn=>{mounted=fn;},onUnmounted(){},useRouter:()=>({push(){}}),useI18n:()=>({t:key=>key,locale:{value:'en'}}),
 useProtestsStore:()=>({protests:[target],loadProtests:async()=>{},joinProtest(){}}),useDeviceStore:()=>({getDeviceId:()=> 'synthetic-device',gpsReady:true,gpsLat:43,gpsLng:-3,gpsAccuracy:5}),
 useUiStore:()=>({gpsLat:43,gpsLng:-3,gpsAccuracy:5,showToast(){},revealInstallBanner(){}}),
 sessionStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value))},localStorage:{getItem:()=> '43',removeItem(){}},setTimeout(){},
 window:{grecaptcha:{execute:async()=> 'synthetic'}},navigator:{},
 apiFixture:{joinProtest:async(_id,payload)=>{payloads.push(payload);return {receipt:'44444444-4444-4444-8444-444444444444',gps_update_token:'synthetic-token'};}},
 };
 vm.createContext(context);vm.runInContext(verify+';globalThis.offer=showGpsReinforce;globalThis.reinforce=reinforceGps;',context);await mounted();
 assert.equal(payloads.length,1);assert.equal(payloads[0].gps_lat,risk==='low'?43:null);assert.equal(payloads[0].gps_lng,risk==='low'?-3:null);assert.equal(payloads[0].gps_accuracy,risk==='low'?5:null);
 assert.equal(context.offer.value,false);
 if(risk!=='low')await context.reinforce(); // no navigator geolocation in this fixture: any call would fail

});
