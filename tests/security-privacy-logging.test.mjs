import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {privacyFastifyOptions,registerPrivacyRequestLogging,safeLogRecord} from '../apps/api/src/lib/privacyLogging.js';
import {safeErrorResponse,registerSafeErrorHandler} from '../apps/api/src/lib/safeErrors.js';
const secret='SYNTHETIC_PRIVATE_SENTINEL';
function fixture(){const lines=[];const app=Fastify(privacyFastifyOptions({write(chunk){lines.push(String(chunk));}}));registerPrivacyRequestLogging(app);registerSafeErrorHandler(app);return {app,lines,records:()=>lines.join('').trim().split('\n').filter(Boolean).map(JSON.parse)};}
function assertPrivateAbsent(lines){const text=lines.join('');for(const value of [secret,'person@example.invalid','+34600000000','198.51.100.42','778899'])assert.ok(!text.includes(value),value);}
test('log policy preserves only enumerated events and bounded scalar operational fields',()=>{
 assert.deepEqual(safeLogRecord({code:'gps_update_failed',statusCode:503,method:'POST',routeGroup:'participation',url:secret,error:new Error(secret),phone:'+34600000000'}),{code:'gps_update_failed',statusCode:503,method:'POST',routeGroup:'participation'});
 assert.deepEqual(safeLogRecord({code:secret,statusCode:secret,method:secret,routeGroup:secret}),{code:'application_event'});
});
test('real Fastify/Pino request lifecycle omits URL path/query, IP, headers, bodies and caller request IDs',async()=>{
 const {app,lines,records}=fixture();await app.register(sensible);app.post('/api/users/device/:id',async(req)=>{req.log.info({code:'gps_token_issued',body:req.body,req,error:new Error(secret)},secret);return {ok:true};});
 try{const r=await app.inject({method:'POST',url:'/api/users/device/'+secret+'?token='+secret,remoteAddress:'198.51.100.42',headers:{authorization:'Bearer '+secret,cookie:'session='+secret,'x-request-id':secret,'request-id':secret,'user-agent':secret},payload:{phone:'+34600000000',email:'person@example.invalid',otp:'778899',secret}});assert.equal(r.statusCode,200);assertPrivateAbsent(lines);const events=records();assert.ok(events.some(x=>x.code==='gps_token_issued'));const response=events.find(x=>x.code==='http_response');assert.equal(response.statusCode,200);assert.equal(response.routeGroup,'auth');assert.match(response.reqId,/^[a-f0-9-]{36}$/);assert.ok(!events.some(x=>x.msg));}finally{await app.close();}
});
test('unmatched paths and validator/parser errors cannot echo caller data into logs or central errors',async()=>{
 const {app,lines}=fixture();app.post('/validated',{schema:{body:{type:'object',required:['known'],properties:{known:{type:'integer'}},additionalProperties:false}}},()=>({ok:true}));
 try{for(const request of [{url:'/'+secret+'?email=person@example.invalid'},{method:'POST',url:'/validated',payload:{known:secret}},{method:'POST',url:'/validated',headers:{'content-type':'application/json'},payload:'{"'+secret+'":'}]){const r=await app.inject(request);assert.ok(r.statusCode>=400);assert.ok(!r.body.includes(secret),r.body);}assertPrivateAbsent(lines);}finally{await app.close();}
});
for(const status of [400,401,403,404,409,429,500,503,599,'400',200,-1,NaN,Infinity])test('unknown error text is never returned or logged, status '+status,async()=>{
 const {app,lines}=fixture();app.get('/',()=>{throw Object.assign(new Error(secret+' person@example.invalid'),{statusCode:status,code:secret,detail:secret,cause:new Error(secret)});});try{const r=await app.inject('/');assert.ok(r.statusCode>=400&&r.statusCode<=599);assert.ok(!r.body.includes(secret));assert.equal(r.headers['cache-control'],'no-store');assertPrivateAbsent(lines);}finally{await app.close();}
});
test('business codes and known safe messages retain existing public meaning',()=>{
 for(const message of ['CENSUS_AUTH_REQUIRED','INVITE_INVALID','CREATOR_PROOF_REQUIRED','Código incorrecto o caducado','Demasiados intentos. Solicita un nuevo código.'])assert.equal(safeErrorResponse({statusCode:403,message}).body.error,message);
 assert.equal(safeErrorResponse({statusCode:500,message:'CENSUS_AUTH_REQUIRED'}).body.error,'Internal server error');
});
test('free text, errors, printf arguments, nested secrets and child bindings are discarded before serialization',async()=>{
 const {app,lines,records}=fixture();app.log.info(secret);app.log.error(new Error(secret));app.log.warn({code:'otp_provider_max_attempts',nested:{authorization:secret},err:new Error(secret)},'%s',secret);app.log.child({token:secret,reqId:secret}).info({code:'kofi_over_limit',amount:42},secret);try{await app.ready();assertPrivateAbsent(lines);assert.ok(records().some(x=>x.code==='otp_provider_max_attempts'));assert.ok(records().some(x=>x.code==='kofi_over_limit'));for(const r of records())for(const key of Object.keys(r))assert.ok(['level','time','reqId','code','statusCode','method','routeGroup'].includes(key),key);}finally{await app.close();}
});
test('rate-limit errors retain 429 and Retry-After without echoing supplied input',async()=>{
 const {default:rateLimit}=await import('@fastify/rate-limit');const {app,lines}=fixture();await app.register(rateLimit,{max:1,timeWindow:'1 minute'});app.get('/',()=>({ok:true}));try{assert.equal((await app.inject('/?token='+secret)).statusCode,200);const denied=await app.inject('/?token='+secret);assert.equal(denied.statusCode,429);assert.match(denied.headers['retry-after'],/^\d+$/);assert.equal(denied.json().error,'Too many requests');assertPrivateAbsent(lines);}finally{await app.close();}
});

test('real CAPTCHA and OTP failure helpers preserve safe public status/code contracts through actual handlers',async()=>{
 const {verifyRecaptcha}=await import('../apps/api/src/lib/recaptcha.js');const {OtpProviderError,otpProviderFailure,runOtpProvider}=await import('../apps/api/src/lib/otpProvider.js');
 const {app,lines}=fixture();await app.register(sensible);
 app.post('/captcha-rejected',async(req,reply)=>verifyRecaptcha(secret,'request_otp',req,reply,{env:{RECAPTCHA_SECRET:secret},fetchImpl:async()=>new Response(JSON.stringify({success:false,details:secret}),{status:200})}));
 app.post('/captcha-unavailable',async(req,reply)=>verifyRecaptcha(secret,'request_otp',req,reply,{env:{RECAPTCHA_SECRET:secret},fetchImpl:async()=>{throw new Error(secret);}}));
 app.post('/provider-limited',async(req,reply)=>otpProviderFailure(reply,new OtpProviderError('limited'),'SEND'));
 app.post('/provider-unavailable',async(req,reply)=>{try{await runOtpProvider(()=>{throw new Error(secret);});}catch(error){return otpProviderFailure(reply,error,'SEND');}});
 try{for(const [path,status,code] of [['/captcha-rejected',400],['/captcha-unavailable',503],['/provider-limited',429,'otp_rate_limited'],['/provider-unavailable',503,'otp_temporarily_unavailable']]){const r=await app.inject({method:'POST',url:path});assert.equal(r.statusCode,status,r.body);assert.ok(!r.body.includes(secret));if(code)assert.equal(r.json().code,code);if(status===429)assert.equal(r.headers['retry-after'],'60');}assertPrivateAbsent(lines);}finally{await app.close();}
});
