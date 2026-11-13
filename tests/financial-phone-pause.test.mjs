import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {signParticipationToken} from '../apps/api/src/lib/participationToken.js';
import {phoneParticipationPaused} from '../apps/api/src/lib/phoneParticipationPause.js';
process.env.PARTICIPATION_TOKEN_SECRET='synthetic-paused-token-key';
let dbCalls=0,providerCalls=0,fetchCalls=0;
const database={from(){dbCalls++;throw Error('Unexpected database access while paused');},rpc:async()=>{dbCalls++;return {data:{id:'synthetic-institutional-receipt'}};}};
mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:database}});
mock.module('../apps/api/src/services/twilio.js',{namedExports:{sendOtp:async()=>{providerCalls++;throw Error('Unexpected provider call');},verifyOtp:async()=>{providerCalls++;throw Error('Unexpected provider call');}}});
const {default:users}=await import('../apps/api/src/routes/users.js');
const {default:protests}=await import('../apps/api/src/routes/protests.js');
const {createVerifiedAdhesion,verifyInstitutionalOtpAndCreateAdhesion}=await import('../apps/api/src/lib/adhesionService.js');
const ID='11111111-1111-4111-8111-111111111111';
const phone='+34600000001',device='synthetic-device';
async function fixture(){dbCalls=providerCalls=fetchCalls=0;const app=Fastify();await app.register(sensible);await app.register(users,{prefix:'/users'});await app.register(protests,{prefix:'/protests',dependencies:{verifyCaptcha:async()=>{providerCalls++;throw Error('Unexpected CAPTCHA while paused');}}});return app;}
for(const config of [{},{SMS_CONFIRMED_ADHESION_BILLING_ENABLED:'true',SMS_COST_EUR:'0.01',NODE_ENV:'production'},{PHONE_PARTICIPATION_PAUSED:'false',FINANCIAL_DONATIONS_ONLY_MODE:'false',NODE_ENV:'test'}])test('real phone pause cannot be enabled by environment: '+JSON.stringify(config),async()=>{
 const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);
 const app=await fixture();const network=mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('Unexpected network');});
 try {
  assert.equal(phoneParticipationPaused(),true);
  const token=signParticipationToken({device_id:device,phone_hash:'a'.repeat(64),purpose:'join_protest'});
  const requests=[['/users/request-otp',{phone,device_id:device,protest_id:ID,recaptcha_token:'synthetic'}],['/users/verify-otp',{phone,otp:'123456',device_id:device}],...['true','false'].map(sent=>['/protests/'+ID+'/join',{participation_token:token,recaptcha_token:'synthetic',sms_sent:sent==='true'}])];
  for(const [url,payload] of requests){const r=await app.inject({method:'POST',url,payload});assert.equal(r.statusCode,503,r.body);assert.equal(r.json().error,'PHONE_PARTICIPATION_PAUSED');assert.equal(r.headers['cache-control'],'no-store');assert.ok(!r.body.includes(phone));assert.ok(!r.body.includes(token));}
  await assert.rejects(createVerifiedAdhesion({protestId:ID,identity:{method:'phone_otp'},location:{ip:'8.8.8.8',latitude:40,longitude:-3}}),e=>e.code==='PHONE_PARTICIPATION_PAUSED');
  assert.equal(dbCalls,0);assert.equal(providerCalls,0);assert.equal(fetchCalls,0);
 }finally{network.mock.restore();await app.close();for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('real pause leaves institutional verification transaction reachable',async()=>{
 dbCalls=0;
 const result=await verifyInstitutionalOtpAndCreateAdhesion({emailHash:'a'.repeat(64),protestId:ID,submittedOtpHash:'synthetic-otp',location:{},institutionalExpiresAt:'2027-08-31T00:00:00Z',challengeId:'22222222-2222-4222-8222-222222222222'});
 assert.equal(result.id,'synthetic-institutional-receipt');assert.equal(dbCalls,1);
});
