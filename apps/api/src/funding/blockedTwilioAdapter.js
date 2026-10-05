import twilio from 'twilio';
import {createHmac} from 'node:crypto';
import {canonicalCostDecimal} from './exactCostComponents.js';
import {FundingError} from './isolatedService.js';
const check=(v,c)=>{if(!v)throw new FundingError(c,409);};
const guard=mode=>check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_twilio_required');
const sid=(v,p)=>typeof v==='string'&&new RegExp('^'+p+'[a-f0-9]{32}$','i').test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const adapters=new WeakSet();
export const isBlockedTwilioAdapter=v=>adapters.has(v);
// The actual installed SDK is used, but its HTTP client has no network implementation.
export function createBlockedTwilioAdapter({mode,respond,referenceSecret,maxPages=3}){
 guard(mode);check(typeof respond==='function'&&typeof referenceSecret==='string'&&referenceSecret.length>=32&&Number.isSafeInteger(maxPages)&&maxPages>0&&maxPages<=10,'invalid_blocked_transport');
 const serviceSid='VA'+'a'.repeat(32),lookups=new Map(),calls=new Map();
 const ref=(kind,value)=>'synthetic_component_'+createHmac('sha256',referenceSecret).update(kind+':'+value).digest('hex');
 function client(operationId){return twilio('AC'+'a'.repeat(32),'synthetic_sdk_password_only',{autoRetry:false,logLevel:'silent',httpClient:{async request(r){
  const u=new URL(r.uri);check(u.origin==='https://verify.twilio.com'&&((r.method==='post'&&[(`/v2/Services/${serviceSid}/Verifications`),(`/v2/Services/${serviceSid}/VerificationCheck`)].includes(u.pathname))||(r.method==='get'&&u.pathname==='/v2/Attempts')),'blocked_transport_target');
  // No headers, credentials, phone, OTP, raw query or response enter the audit counter.
  const key=r.method+':'+u.pathname;calls.set(key,(calls.get(key)??0)+1);
  const response=await respond({operationId,method:r.method,path:u.pathname,params:r.params??{},data:r.data??{}});
  check(response&&Number.isInteger(response.statusCode)&&response.statusCode>=200&&response.statusCode<=599,'invalid_transport_response');
  return {statusCode:response.statusCode,body:JSON.stringify(response.body)};
 }}});}
 async function safe(work){try{return await work();}catch{throw new FundingError('provider_evidence_unavailable',503);}}
 const adapter={
  kind:'blocked_twilio_sdk',referenceSecret,
  counts:()=>Object.fromEntries(calls),
  async dispatch(operationId){guard(mode);check(uuid(operationId),'invalid_operation');return safe(async()=>{
   const r=await client(operationId).verify.v2.services(serviceSid).verifications.create({to:'+15005550006',channel:'sms'});
   check(sid(r.sid,'VE')&&r.serviceSid===serviceSid&&['pending','approved'].includes(r.status),'invalid_provider_binding');
   // Lookup is ephemeral and private; a recomposed adapter must not resend to recover it.
   lookups.set(operationId,r.sid);return {state:'accepted'};
  });},
  async check(operationId,code){guard(mode);check(code==='000000','synthetic_code_required');return safe(async()=>{
   const id=lookups.get(operationId);check(id,'lookup_unavailable');const r=await client(operationId).verify.v2.services(serviceSid).verificationChecks.create({verificationSid:id,code});
   check(r.sid===id&&r.serviceSid===serviceSid&&['pending','approved','canceled'].includes(r.status),'invalid_provider_binding');return {approved:r.status==='approved'};
  });},
  async collect(operationId){guard(mode);return safe(async()=>{
   const id=lookups.get(operationId);check(id,'lookup_unavailable');let page=await client(operationId).verify.v2.verificationAttempts.page({verificationSid:id,pageSize:50}),pages=0;const result=[];
   while(page){check(++pages<=maxPages&&Array.isArray(page.instances)&&page.instances.length<=50,'pagination_bound');for(const r of page.instances){
    check(sid(r.sid,'VL')&&r.verificationSid===id&&r.serviceSid===serviceSid&&r.channel==='sms','invalid_attempt_binding');
    const price=r.price;let value=null,currency=null;if(price!=null){check(typeof price==='object'&&typeof price.currency==='string'&&/^[A-Z]{3}$/.test(price.currency),'invalid_price_currency');value=canonicalCostDecimal(price.value);currency=price.currency;}
    result.push({reference:ref('attempt',r.sid),kind:'channel_attempt',revision:1,value,currency,qualification:'provisional'});
   }
   if(!page.nextPageUrl)break;check(pages<maxPages,'pagination_bound');const next=new URL(page.nextPageUrl);check(next.origin==='https://verify.twilio.com'&&next.pathname==='/v2/Attempts','blocked_pagination_target');page=await page.nextPage();
   }
   // No authenticated fee source or completeness source exists for this candidate.
   result.push({reference:ref('fee',id),kind:'verification_fee',revision:1,value:null,currency:null,qualification:'provisional'});
   return result;
  });}
 };
 adapters.add(adapter);return Object.freeze(adapter);
}
