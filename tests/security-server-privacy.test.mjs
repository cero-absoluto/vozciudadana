import test from 'node:test';
import assert from 'node:assert/strict';
import {bootPrivacyServer,sentinel} from './helpers/privacy-server-fixture.mjs';
test('actual server wiring boots without sockets/providers and applies private logs and safe errors',async()=>{
 const {app,lines,providerCalls}=await bootPrivacyServer();try{
 for(const request of [{url:'/'+sentinel+'?token='+sentinel},{method:'POST',url:'/api/users/request-otp',payload:{phone:sentinel,otp:sentinel}},{url:'/api/protests?scope=global',headers:{authorization:'Bearer '+sentinel}}]){
 const r=await app.inject(request);assert.ok(r.statusCode>=400,r.body);assert.ok(!r.body.includes(sentinel),r.body);
 }
 const health=await app.inject('/health');assert.equal(health.statusCode,200);assert.equal(providerCalls(),0);
 const text=lines.join('');assert.ok(!text.includes(sentinel));const events=text.trim().split('\n').filter(Boolean).map(JSON.parse);assert.ok(events.some(x=>x.code==='http_response'));assert.ok(events.some(x=>x.code==='request_error'));assert.ok(events.some(x=>x.code==='CENSUS_OTP_RETENTION_FAILED'));for(const e of events)for(const k of Object.keys(e))assert.ok(['level','time','reqId','code','statusCode','method','routeGroup'].includes(k),k);
 }finally{await app.close();}
});
