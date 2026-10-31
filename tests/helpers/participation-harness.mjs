import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {participationGpsSnapshot} from '../../apps/web/src/lib/participationGps.js';
import {classifyJoinRejection,joinRejectionPath} from '../../apps/web/src/lib/joinRejection.js';
import {withClientDeadline,recaptchaToken} from '../../apps/web/src/services/requestJson.js';
import * as outcomes from '../../apps/web/src/lib/participationOutcome.js';
import {shouldSkipFastPath, clearForceOtp, preSmsRejectionKey,markForceOtp} from '../../apps/web/src/lib/nationalPreCheck.js';

// Execute the actual Vue scripts. Every service/browser capability is synthetic.
export const read = name => readFileSync(new URL('../../apps/web/src/screens/'+name+'.vue', import.meta.url),'utf8');
const script = name => read(name).match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*;\n/gm,'').replace(/import\.meta\.env\.\w+/g,"'synthetic'")
  .replaceAll("import('@/services/api.js')",'Promise.resolve(apiFixture)');
const ref = value => ({value});
const computed = fn => ({get value(){return fn();}});
export const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
export const flush = () => new Promise(r=>setImmediate(r));
export function harness(name='AuthScreen', overrides={}) {
  let mounted; const toasts=[],navigation=[],calls=[],unmounted=[];
  const memory=new Map([['vc_last_joined','selected'],['vc_device_id','synthetic-device'],['vc_participation_token','synthetic-token']]);
  const sessionStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
  const store={protests:[{id:'selected',scope:'global',risk_level:'low',title:'Synthetic selected event',dominio_email:name==='VerifyInstitucionalScreen'?'example.invalid':null}],
    loadProtests:async()=>{calls.push(['load']);},joinProtest:()=>calls.push(['localJoin'])};
  const api={requestOtp:async payload=>{calls.push(['request',payload]);return {sent:true};},
    verifyOtp:async payload=>{calls.push(['verify',payload]);return {verified:true,participation_token:'synthetic-token',device_id:'synthetic-device'};},
    fetchDeviceLocks:async()=>{calls.push(['locks']);return [];},fetchCountryCodes:async()=>[],
    sendEmailOtp:async()=>({sent:true,challenge_id:'33333333-3333-4333-8333-333333333333'}),verifyEmailOtp:async()=>({verified:true,receipt:'44444444-4444-4444-8444-444444444444'}),
    joinProtest:async()=>{calls.push(['join']);return {receipt:'44444444-4444-4444-8444-444444444444'};},...overrides};
  const device={gpsReady:false,getDeviceSecret:()=>null,getDeviceId:()=> 'synthetic-device'};
  const context={participationGpsSnapshot,classifyJoinRejection,joinRejectionPath,markForceOtp,...outcomes,withClientDeadline,recaptchaToken,crypto:{randomUUID:()=> '55555555-5555-4555-8555-555555555555'},ref,computed,onMounted:fn=>mounted=fn,onUnmounted:fn=>unmounted.push(fn),watch(){},
    useI18n:()=>({t:k=>k,locale:ref('es')}),useRouter:()=>({push:p=>navigation.push(p)}),
    useRoute:()=>({params:{protestId:'selected'}}),useProtestsStore:()=>store,
    useDeviceStore:()=>device,
    useUiStore:()=>({clearGps(){},showToast:m=>toasts.push(m),revealInstallBanner(){}}),
    shouldSkipFastPath,clearForceOtp,preSmsRejectionKey,sessionStorage,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},api,apiFixture:api,
    window:{grecaptcha:{ready:fn=>fn(),execute:async()=> 'synthetic-captcha'}},navigator:{},setTimeout(){},
  };
  vm.createContext(context);
  const exports=name==='AuthScreen'?'sendSMS,resendSMS,verifyOTP,changeNumber,phone,countryCode,countryCodes,otpDigits,otpVisible,requestedOtp,sending':name==='VerifyInstitucionalScreen'?'sendOtp,verifyOtp,email,otp,emailError,otpError,loading,step,activeContext,outcomeMessage,receiptHash,censusNotSaved,receiptNotSaved':'success,outcomeMessage,receipt,confirmedTitle,savedConfirmation,receiptNotSaved';
  vm.runInContext(script(name)+'\nglobalThis.state={'+exports+'};',context);
  const state=context.state;
  if(name==='AuthScreen'){state.phone.value='600000001';state.countryCodes.value=[{iso2:'ES',dial_code:'34'}];}
  if(name==='VerifyInstitucionalScreen'){state.email.value='synthetic@example.invalid';state.otp.value='123456';state.activeContext.value='email:selected:synthetic-context';}
  return {state,context,api,calls,toasts,navigation,memory,store,device,mount:()=>mounted(),unmount:()=>unmounted.forEach(fn=>fn())};
}
