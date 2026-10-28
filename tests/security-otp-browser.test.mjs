import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps/web/src/screens/AuthScreen.vue',import.meta.url),'utf8').match(/async function verifyOTP\(\) \{[\s\S]*?\n\}/)[0];
async function run({response,error,doubleSubmit=false}={}){
 let apiCalls=0;
 const store=new Map([['vc_device_secret','old-secret']]),session=new Map(),toasts=[],nav=[];
 const context={otpAbortController:null,otpDigits:{value:['1','2','3','4','5','6']},phone:{value:'600000001'},dialCode:{value:'34'},countryCode:{value:'ES'},sending:{value:false},
  device:{getDeviceId:()=> 'old-device',setDeviceId:id=>store.set('id',id),setDeviceSecret:secret=>store.set('vc_device_secret',secret)},
  api:{verifyOtp:async()=>{apiCalls++;if(error)throw error;return response;}},sessionStorage:{setItem:(k,v)=>session.set(k,v)},localStorage:{removeItem:k=>store.delete(k)},
  clearForceOtp(){},ui:{showToast:x=>toasts.push(x)},t:x=>x,router:{push:x=>nav.push(x)}};
 vm.createContext(context);vm.runInContext(source+';globalThis.verify=verifyOTP;',context);
 const first=context.verify();if(doubleSubmit)await context.verify();await first;
 return {store,session,toasts,nav,context,apiCalls};
}
test('WebOTP autofill and manual confirmation cannot send two overlapping checks',async()=>{
 const f=await run({doubleSubmit:true,response:{verified:true,device_id:'old-device',participation_token:'token'}});
 assert.equal(f.apiCalls,1);assert.deepEqual(f.nav,['/verify']);assert.deepEqual(f.toasts,[]);
});
test('switching canonical identity without new proof removes unrelated stored secret',async()=>{
 const f=await run({response:{verified:true,device_id:'canonical',participation_token:'token'}});assert.equal(f.store.has('vc_device_secret'),false);assert.equal(f.store.get('id'),'canonical');assert.equal(f.session.get('vc_participation_token'),'token');assert.deepEqual(f.nav,['/verify']);
});
test('new identity keeps its newly minted proof',async()=>{
 const f=await run({response:{verified:true,device_id:'new-id',participation_token:'token',device_secret:'new-proof'}});assert.equal(f.store.get('vc_device_secret'),'new-proof');assert.equal(f.store.get('id'),'new-id');
});
for(const [status,key] of [[401,'otpIncorrect'],[429,'otpRateLimited'],[503,'otpUnavailable'],[undefined,'otpUnavailable']])test('browser handles OTP failure '+status,async()=>{
 const f=await run({error:{status}});assert.deepEqual(f.toasts,['auth.'+key]);assert.equal(f.nav.length,0);assert.equal(f.session.size,0);assert.equal(f.context.sending.value,false);assert.equal(f.store.get('vc_device_secret'),'old-secret');
});
test('temporary OTP failure message exists in all four languages',()=>{
 for(const lang of ['es','en','fr','zh'])assert.ok(JSON.parse(readFileSync(new URL('../apps/web/src/locales/'+lang+'.json',import.meta.url),'utf8')).auth.otpUnavailable);
});
