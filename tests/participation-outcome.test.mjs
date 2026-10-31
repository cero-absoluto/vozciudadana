import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness,deferred,flush} from './helpers/participation-harness.mjs';
import {requestJson,withClientDeadline} from '../apps/web/src/services/requestJson.js';
import {validReceipt,readOutcome,writeOutcome,beginOutcome,participationErrorKey,uncertainOutcome} from '../apps/web/src/lib/participationOutcome.js';
const RECEIPT='44444444-4444-4444-8444-444444444444';
const phoneContext='phone:synthetic-device:selected';
const copySession=(from,to)=>{for(const [k,v] of from.memory)to.memory.set(k,v);};
test('interleaved mounts in one tab dispatch once and cannot overwrite the resulting receipt',async()=>{
  const wait=deferred(),a=harness('VerifyScreen'),b=harness('VerifyScreen');b.context.sessionStorage=a.context.sessionStorage;
  let calls=0;const join=()=>{calls++;return wait.promise;};a.api.joinProtest=join;b.api.joinProtest=join;
  const first=a.mount(),second=b.mount();await flush();assert.equal(calls,1);
  wait.resolve({receipt:RECEIPT});await Promise.all([first,second]);assert.equal(readOutcome(a.context.sessionStorage,phoneContext).state,'completed');
  assert.equal(writeOutcome(a.context.sessionStorage,phoneContext,{state:'rejected',attemptId:'late-instance'}),false);
  assert.equal(readOutcome(a.context.sessionStorage,phoneContext).receipt,RECEIPT);
});
test('unmounted preflight cannot dispatch after a remount',async()=>{
  const wait=deferred(),a=harness('VerifyScreen'),b=harness('VerifyScreen');a.store.loadProtests=()=>wait.promise;
  const first=a.mount();a.unmount();b.context.sessionStorage=a.context.sessionStorage;await b.mount();wait.resolve();await first;
  assert.equal(a.calls.some(x=>x[0]==='join'),false);assert.equal(b.calls.filter(x=>x[0]==='join').length,1);
});
test('a pending owner is exclusive, a rejected request permits a new owner, and completion is monotonic',()=>{
  const f=harness('VerifyScreen'),storage=f.context.sessionStorage;
  const a=beginOutcome(storage,phoneContext,'A');assert.equal(a.started,true);assert.equal(beginOutcome(storage,phoneContext,'B').started,false);
  assert.equal(writeOutcome(storage,phoneContext,{state:'rejected',attemptId:'foreign'}),false);
  assert.equal(writeOutcome(storage,phoneContext,{state:'rejected',attemptId:a.attemptId}),true);
  const b=beginOutcome(storage,phoneContext,'B');assert.equal(b.started,true);assert.notEqual(a.attemptId,b.attemptId);
  assert.equal(writeOutcome(storage,phoneContext,{state:'completed',receipt:RECEIPT,attemptId:a.attemptId}),false);
  assert.equal(writeOutcome(storage,phoneContext,{state:'completed',receipt:RECEIPT,attemptId:b.attemptId}),true);
  assert.equal(writeOutcome(storage,phoneContext,{state:'uncertain',attemptId:b.attemptId}),false);
});
test('new canonical verified identity cannot receive the earlier identity’s receipt',async()=>{
  const f=harness('VerifyScreen');writeOutcome(f.context.sessionStorage,phoneContext,{state:'completed',receipt:RECEIPT,title:'Earlier identity'});
  f.device.getDeviceId=()=> 'new-canonical-id';await f.mount();assert.equal(f.calls.filter(x=>x[0]==='join').length,1);assert.notEqual(f.state.confirmedTitle.value,'Earlier identity');
});
test('institutional local storage or CAPTCHA preflight failure cannot spend another email request',async()=>{
  for(const failure of ['storage','captcha']){
    let calls=0;const f=harness('VerifyInstitucionalScreen',{sendEmailOtp:async()=>{calls++;}});
    if(failure==='storage')f.context.sessionStorage.setItem=()=>{throw Error('synthetic');};
    else f.context.window.grecaptcha.execute=async()=>{throw Error('synthetic');};
    await f.state.sendOtp();assert.equal(calls,0);assert.equal(f.state.loading.value,false);
    assert.equal(f.state.emailError.value,'participation.'+(failure==='storage'?'storageUnavailable':'preflightUnavailable'));
  }
});
for(const result of ['rejected','uncertain','malformed','restored','pending'])test('GPS cache cleanup is scheduled independently of '+result,async()=>{
  const f=harness('VerifyScreen',{joinProtest:async()=>{if(result==='rejected')throw {status:403};if(result==='uncertain')throw {status:503};return {};}}),timers=[],removed=[];
  f.context.setTimeout=(fn,ms)=>timers.push({fn,ms});f.context.localStorage.removeItem=key=>removed.push(key);
  if(result==='restored'||result==='pending')writeOutcome(f.context.sessionStorage,phoneContext,{state:result==='restored'?'completed':'pending',receipt:RECEIPT,title:'Synthetic'});
  await f.mount();const cleanup=timers.find(x=>x.ms===5000);assert.ok(cleanup);cleanup.fn();
  assert.deepEqual(removed,['vc_gps_lat','vc_gps_lng','vc_gps_accuracy','vc_gps_ts']);
});
for(const stage of ['transport','body'])test('deadline bounds '+stage+' even if the mocked transport ignores abort; no retry',async()=>{
  let calls=0,signal;
  await assert.rejects(requestJson('https://synthetic.invalid',{method:'POST'},{timeoutMs:10,fetchImpl:async(_url,options)=>{
    calls++;signal=options.signal;if(stage==='transport')return new Promise(()=>{});
    return {ok:true,status:201,json:()=>new Promise(()=>{})};
  }}),{code:'REQUEST_TIMEOUT'});
  assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('challenge/dependency deadline also bounds a callback that never settles',async()=>{
  await assert.rejects(withClientDeadline(()=>new Promise(()=>{}),{timeoutMs:10}),{code:'REQUEST_TIMEOUT'});
});
for(const body of [null,42,'not-json'])test('successful invalid body never becomes success '+JSON.stringify(body),async()=>{
  await assert.rejects(requestJson('synthetic',{}, {fetchImpl:async()=>({ok:true,status:201,json:async()=>body})}),{code:'INVALID_API_RESPONSE'});
});
test('unparseable successful JSON fails, while a 429 with no JSON keeps its HTTP rejection',async()=>{
  const mock=ok=>async()=>({ok,status:ok?201:429,json:async()=>{throw Error('synthetic');}});
  await assert.rejects(requestJson('synthetic',{}, {fetchImpl:mock(true)}),{code:'INVALID_API_RESPONSE'});
  await assert.rejects(requestJson('synthetic',{}, {fetchImpl:mock(false)}),{status:429});
});
test('confirmed receipt precedes secondary refresh, survives refresh failure and is restored without network',async()=>{
  const f=harness('VerifyScreen');let loads=0;f.store.loadProtests=()=>++loads===1?Promise.resolve():new Promise(()=>{});
  await f.mount();assert.equal(f.state.success.value,true);assert.equal(f.state.receipt.value,RECEIPT);assert.equal(loads,2);
  const saved=readOutcome(f.context.sessionStorage,phoneContext);assert.equal(saved.state,'completed');assert.equal(saved.receipt,RECEIPT);
  const reload=harness('VerifyScreen');copySession(f,reload);await reload.mount();
  assert.equal(reload.state.success.value,true);assert.equal(reload.state.savedConfirmation.value,true);assert.equal(reload.state.confirmedTitle.value,'Synthetic selected event');assert.equal(reload.calls.length,0);
});
for(const response of [{},null,{receipt:'sha256:invented'},{receipt:'synthetic-not-a-receipt'}])test('missing/malformed receipt remains uncertain and reload cannot replay '+JSON.stringify(response),async()=>{
  let calls=0;const f=harness('VerifyScreen',{joinProtest:async()=>{calls++;return response;}});await f.mount();
  assert.equal(calls,1);assert.equal(f.state.success.value,false);assert.equal(f.state.outcomeMessage.value,'participation.uncertain');
  const reload=harness('VerifyScreen');copySession(f,reload);await reload.mount();assert.equal(reload.calls.length,0);assert.equal(reload.state.success.value,false);assert.equal(reload.state.outcomeMessage.value,'participation.uncertain');
});
for(const error of [{status:503},{code:'REQUEST_TIMEOUT'},{}])test('ambiguous join error never replays after reload '+JSON.stringify(error),async()=>{
  const f=harness('VerifyScreen',{joinProtest:async()=>{throw error;}});await f.mount();
  assert.equal(readOutcome(f.context.sessionStorage,phoneContext).state,'uncertain');
  const reload=harness('VerifyScreen');copySession(f,reload);await reload.mount();assert.equal(reload.calls.length,0);
});
test('write-ahead marker is present during an unanswered request and a reload does not send',async()=>{
  const pending=deferred();let sent=0;const f=harness('VerifyScreen',{joinProtest:()=>{sent++;assert.equal(readOutcome(f.context.sessionStorage,phoneContext).state,'pending');return pending.promise;}});
  const mounting=f.mount();await flush();assert.equal(sent,1);
  const reload=harness('VerifyScreen');copySession(f,reload);await reload.mount();assert.equal(reload.calls.length,0);assert.equal(reload.state.outcomeMessage.value,'participation.uncertain');
  pending.resolve({receipt:RECEIPT});await mounting;assert.equal(f.state.success.value,true);
});
test('unavailable write-ahead storage blocks dispatch; failure saving completion does not erase a real receipt',async()=>{
  const before=harness('VerifyScreen');before.context.sessionStorage.setItem=()=>{throw Error('quota');};await before.mount();assert.equal(before.calls.some(x=>x[0]==='join'),false);assert.equal(before.state.outcomeMessage.value,'participation.storageUnavailable');
  const after=harness('VerifyScreen');const set=after.context.sessionStorage.setItem;after.context.sessionStorage.setItem=(k,v)=>{if(v.includes('"completed"'))throw Error('quota');set(k,v);};await after.mount();
  assert.equal(after.state.success.value,true);assert.equal(after.state.receipt.value,RECEIPT);assert.equal(after.state.receiptNotSaved.value,true);assert.equal(readOutcome(after.context.sessionStorage,phoneContext).state,'pending');
});
test('corrupt, foreign and other-device journals never authorize a confirmation or erase a pending guard',async()=>{
  assert.equal(validReceipt('fake'),false);const f=harness('VerifyScreen');
  f.memory.set('vc_participation_outcome:v1:'+phoneContext,'broken');await f.mount();assert.equal(f.state.success.value,false);assert.equal(f.calls.length,0);
  const g=harness('VerifyScreen');writeOutcome(g.context.sessionStorage,'phone:other:selected',{state:'completed',receipt:RECEIPT,title:'Other person'});await g.mount();assert.equal(g.calls.some(x=>x[0]==='join'),true);assert.notEqual(g.state.confirmedTitle.value,'Other person');
});
const errorCases=[[400,'requestRejected'],[401,'verificationRejected'],[402,'noFunds'],[403,'requirements'],[404,'notAvailable'],[409,'alreadyRecorded'],[410,'closed'],[429,'rateLimited'],[503,'uncertain'],[undefined,'uncertain']];
for(const [status,key] of errorCases)test('institutional error '+status+' has fixed truthful feedback '+key,async()=>{
  const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:async()=>{throw {status,message:'sensitive synthetic server text'};}});await f.state.verifyOtp();
  assert.equal(f.state.loading.value,false);assert.equal(f.state.step.value,status===503||!status?4:1);
  if(uncertainOutcome({status}))assert.equal(f.state.outcomeMessage.value,'participation.uncertain');else assert.equal(f.state.otpError.value,'participation.'+key);
  assert.equal(participationErrorKey({status}),'participation.'+key);
});
test('institutional receipt is confirmed despite census-session persistence failure, and reload makes no write',async()=>{
  const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:async()=>{throw {code:'CENSUS_SESSION_NOT_SAVED',verified:true,receipt:RECEIPT};}});
  await f.state.verifyOtp();assert.equal(f.state.step.value,3);assert.equal(f.state.receiptHash.value,RECEIPT);assert.equal(f.state.censusNotSaved.value,true);
});
test('institutional incomplete success is uncertain, never a wrong-code claim',async()=>{
  const f=harness('VerifyInstitucionalScreen',{verifyEmailOtp:async()=>({verified:true})});await f.state.verifyOtp();assert.equal(f.state.step.value,4);assert.equal(f.state.receiptHash.value,'');
});
test('institutional reload restores an actual completed record and pending blocks a new verification',async()=>{
  const nonce='55555555-5555-4555-8555-555555555555',context='email:selected:'+nonce;
  for(const state of ['completed','pending']){
    const f=harness('VerifyInstitucionalScreen');f.memory.set('vc_institutional_outcome_context:selected',nonce);writeOutcome(f.context.sessionStorage,context,{state,receipt:RECEIPT,title:'Institutional event'});await f.mount();
    assert.equal(f.state.step.value,state==='completed'?3:4);assert.equal(f.calls.length,0);
    if(state==='pending'){let calls=0;f.api.verifyEmailOtp=async()=>{calls++;};await f.state.verifyOtp();assert.equal(calls,0);}
  }
});
test('journal has no phone/email/OTP/credential/GPS data and locales have matching outcome keys',()=>{
  const f=harness('VerifyScreen');writeOutcome(f.context.sessionStorage,phoneContext,{state:'completed',receipt:RECEIPT,title:'Synthetic event',phone:'secret',token:'secret',gps_lat:43});
  const record=readOutcome(f.context.sessionStorage,phoneContext);assert.deepEqual(Object.keys(record).sort(),['at','context','receipt','state','title','v']);
  const locales=['es','en','fr','zh'].map(l=>JSON.parse(readFileSync(new URL('../apps/web/src/locales/'+l+'.json',import.meta.url),'utf8')).participation);
  for(const locale of locales){assert.deepEqual(Object.keys(locale).sort(),Object.keys(locales[0]).sort());for(const value of Object.values(locale))assert.ok(value.trim().length>2);}
});
