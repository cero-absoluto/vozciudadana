import {createHash} from 'node:crypto';
import {createBlockedTwilioAdapter} from '../../apps/api/src/funding/blockedTwilioAdapter.js';
import {createSmsIntegrationCandidate} from '../../apps/api/src/funding/smsIntegrationCandidate.js';
import {smsProviderOptions,smsPrepareInput} from './funding-sms-closure-fixture.mjs';
import {exactCostOptions} from './funding-exact-cost-fixture.mjs';
export const integrationMigration=new URL('../../supabase/migrations/20261005055429_funding_sms_integration_bindings.sql',import.meta.url);
export const referenceSecret='synthetic_integration_provider_ref_distinct_32';
export const providerSid=(prefix,op,key='')=>prefix+createHash('sha256').update(op+':'+key).digest('hex').slice(0,32);
export function sdkResponder({prices=['0.005','0.005'],status='pending',fault=null,next=null,rawDelta={}}={}){
 return async ({operationId,method,path,params})=>{
  if(fault)throw Error('private phone +34999999999 OTP 123456 secret '+fault);
  const base={sid:providerSid('VE',operationId),service_sid:'VA'+'a'.repeat(32),status};
  if(method==='post')return {statusCode:200,body:{...base,status:path.endsWith('VerificationCheck')?'approved':status,to:'+34999999999',...rawDelta}};
  return {statusCode:200,body:{attempts:prices.map((value,n)=>({sid:providerSid('VL',operationId,String(n)),service_sid:base.service_sid,verification_sid:base.sid,channel:'sms',price:value===null?null:{value,currency:'USD'},date_updated:'2026-10-05T00:00:00Z',channel_data:{to:'+34999999999'},...rawDelta})),meta:{page:0,page_size:50,next_page_url:next,previous_page_url:null,key:'attempts',url:'https://verify.twilio.com/v2/Attempts'}}};
 };
}
export function buildIntegration(databases,options={}){
 const adapter=createBlockedTwilioAdapter({mode:'isolated',referenceSecret,respond:options.respond??sdkResponder(options)});
 const candidate=createSmsIntegrationCandidate({mode:'isolated',adapter,bridgeDatabase:databases.bridgeDatabase,executorDatabase:databases.executorDatabase,evidenceDatabase:databases.evidenceDatabase,ingestDatabase:databases.ingestDatabase,calculatorDatabase:databases.calculatorDatabase,smsOptions:smsProviderOptions,exactOptions:exactCostOptions});return {adapter,candidate};
}
export const integrationInput=(eventId,key)=>smsPrepareInput(eventId,'bridge_'+key);
