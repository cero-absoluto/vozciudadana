import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps/web/src/screens/AuthScreen.vue',import.meta.url),'utf8').match(/async function verifyOTP\(\) \{[\s\S]*?\n\}/)[0];
async function run({response,error,doubleSubmit=false}={}){
 let apiCalls=0;
 const store=new Map([['vc_device_secret','old-secret']]),session=new Map(),toasts=[],nav=[];
 const context={otpError:{value:''},authActive:true,otpAbortController:null,otpDigits:{value:['1','2','3','4','5','6']},requestedOtp:{value:{phone:'+34600000001',countryCode:'ES',protestId:'synthetic'}},sending:{value:false},
  device:{getDeviceId:()=> 'old-device',setDeviceId:id=>store.set('id',id),setDeviceSecret:secret=>store.set('vc_device_secret',secret)},
  api:{verifyOtp:async()=>{apiCalls++;if(error)throw error;return response;}},sessionStorage:{getItem:k=>k==='vc_last_joined'?'synthetic':null,setItem:(k,v)=>session.set(k,v)},localStorage:{removeItem:k=>store.delete(k)},
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
 const f=await run({response:{verified:true,device_id:'new-device',participation_token:'token',device_secret:'new-proof'}});assert.equal(f.store.get('vc_device_secret'),'new-proof');assert.equal(f.store.get('id'),'new-device');
});
test('a success without its canonical identity cannot reuse the previous identity context',async()=>{
 const f=await run({response:{verified:true,participation_token:'synthetic-token'}});assert.equal(f.session.size,0);assert.deepEqual(f.nav,[]);assert.equal(f.context.otpError.value,'auth.otpUnavailable');assert.deepEqual(f.toasts,[]);
});
for(const [status,key] of [[401,'otpIncorrect'],[429,'otpRateLimited'],[503,'otpUnavailable'],[undefined,'otpUnavailable']])test('browser handles OTP failure '+status,async()=>{
 const f=await run({error:{status}});assert.equal(f.context.otpError.value,'auth.'+key);assert.deepEqual(f.toasts,[]);assert.equal(f.nav.length,0);assert.equal(f.session.size,0);assert.equal(f.context.sending.value,false);assert.equal(f.store.get('vc_device_secret'),'old-secret');
});
test('temporary OTP failure message exists in all four languages',()=>{
 for(const lang of ['es','en','fr','zh'])assert.ok(JSON.parse(readFileSync(new URL('../apps/web/src/locales/'+lang+'.json',import.meta.url),'utf8')).auth.otpUnavailable);
});

function pasteHarness({ active = true, sending = false } = {}) {
  const component = readFileSync(new URL('../apps/web/src/screens/AuthScreen.vue', import.meta.url), 'utf8');
  assert.ok(component.includes('@paste.prevent="onOtpPaste"'));
  const handlers = ['onOtpPaste', 'fillOtpDigits'].map(name => component.match(new RegExp('function ' + name + '\\([^]*?\\n}'))[0]).join('\n');
  let checks = 0, focus = 0;
  const context = { authActive: active, sending: { value: sending }, otpDigits: { value: ['9','','','','',''] }, otpRefs: { value: Array.from({ length: 6 }, () => ({ focus() { focus++; } })) }, verifyOTP() { checks++; } };
  vm.createContext(context);
  vm.runInContext(handlers + ';globalThis.paste=onOtpPaste;globalThis.fill=fillOtpDigits;', context);
  return { context, paste(text) { context.paste({ clipboardData: { getData: () => text } }); }, checks: () => checks, focus: () => focus };
}
test('complete OTP paste fills six boxes without submitting, including whitespace', () => {
  for (const text of ['123456', '123 456', ' 123456\n']) {
    const f = pasteHarness(); f.paste(text);
    assert.equal(f.context.otpDigits.value.join(''), '123456');
    assert.equal(f.checks(), 0); assert.equal(f.focus(), 1);
  }
});
test('invalid or incomplete OTP paste preserves the existing code', () => {
  for (const text of ['123', '1234567', 'abc123456', '１２３４５６', '']) {
    const f = pasteHarness(); f.paste(text);
    assert.equal(f.context.otpDigits.value.join(''), '9');
    assert.equal(f.checks(), 0); assert.equal(f.focus(), 0);
  }
});
test('paste cannot alter a pending verification or an abandoned view', () => {
  for (const state of [{ sending: true }, { active: false }]) {
    const f = pasteHarness(state); f.paste('123456');
    assert.equal(f.context.otpDigits.value.join(''), '9');
    assert.equal(f.checks(), 0); assert.equal(f.focus(), 0);
  }
});
test('existing autofill still submits once after distributing the code', () => {
  const f = pasteHarness(); f.context.fill('123456');
  assert.equal(f.context.otpDigits.value.join(''), '123456');
  assert.equal(f.checks(), 1);
});

test('OTP errors are persistently rendered and associated with every code input', () => {
  const component = readFileSync(new URL('../apps/web/src/screens/AuthScreen.vue', import.meta.url), 'utf8');
  assert.match(component, /<p v-if="otpError" id="auth-otp-error" role="alert"[^>]*>{{ otpError }}<\/p>/);
  assert.ok(component.includes(':aria-describedby="otpError ? \'auth-otp-error\' : null"'));
  assert.ok(!source.includes('setTimeout'));
});
