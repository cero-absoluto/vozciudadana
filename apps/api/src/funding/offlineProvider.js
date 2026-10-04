import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {FundingError} from './isolatedService.js';
const check=(ok,code,status=409)=>{if(!ok)throw new FundingError(code,status);};
const brands=new WeakSet();
const ref=prefix=>prefix+randomBytes(16).toString('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const identifier=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'[A-Za-z0-9_]{1,120}$').test(value)?value:null;
const fixtureOnly=mode=>check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only',503);

export function checkoutCapability({createdAt,expiresAt,minimumSeconds}){
 const created=new Date(createdAt).getTime(),expires=Math.floor(new Date(expiresAt).getTime()/1000)*1000;
 check(Number.isFinite(created)&&Number.isFinite(expires)&&Number.isSafeInteger(minimumSeconds)&&minimumSeconds>0&&expires-created>=minimumSeconds*1000,'funding_window_closed');
 return {createdAt:new Date(created).toISOString(),expiresAt:new Date(expires).toISOString(),expiresEpoch:expires/1000};
}
// Closed, branded in-memory provider fixture. No URL, SDK, network or arbitrary transport callback.
export function createOfflineFixtureTransport({mode,otpCode,signingSecret,now=()=>new Date()}){
 fixtureOnly(mode);check(/^\d{6}$/.test(otpCode??'')&&typeof signingSecret==='string'&&Buffer.byteLength(signingSecret)>=32,'offline_fixture_configuration_required',503);
 const challenges=new Map(),verifications=new Map(),checkouts=new Map(),payments=new Map();
 const counters={otpStarts:0,otpChecks:0,checkoutCreates:0,payments:0};let fault=null;
 const sign=(raw,t)=>createHmac('sha256',signingSecret).update(String(t)+'.').update(raw).digest('hex');
 const transport={
  kind:'offline_fixture',
  stats:()=>({...counters}),setFault(value){check([null,'otp_start','otp_check','checkout','checkout_response_lost'].includes(value),'invalid_fixture_fault');fault=value;},
  async startOtp({challengeId,to,serviceDomain}){
   check(serviceDomain==='fixture_funding_verify','fixture_service_mismatch');if(fault==='otp_start')throw new FundingError('offline_transport_unavailable',503);
   let verificationSid=challenges.get(challengeId);if(!verificationSid){verificationSid=ref('VE');challenges.set(challengeId,verificationSid);verifications.set(verificationSid,{challengeId,serviceDomain});counters.otpStarts++;}
   return {sid:verificationSid,status:'pending',to,serviceSid:'VA_fixture_funding',email:'discard@example.invalid'};
  },
  async checkOtp({verificationSid,code,serviceDomain}){
   if(fault==='otp_check')throw new FundingError('offline_transport_unavailable',503);
   counters.otpChecks++;const item=verifications.get(verificationSid);check(item&&item.serviceDomain===serviceDomain,'fixture_otp_binding_invalid');
   const a=Buffer.from(String(code)),b=Buffer.from(otpCode);return {sid:verificationSid,status:a.length===b.length&&timingSafeEqual(a,b)?'approved':'pending',to:'+31600000000',name:'discard fixture donor'};
  },
  async createCheckout(input){
   if(fault==='checkout')throw new FundingError('offline_transport_unavailable',503);
   const capability=checkoutCapability({createdAt:await now(),expiresAt:input.expiresAt,minimumSeconds:input.minimumSeconds});
   let item=checkouts.get(input.intentId);if(!item){item={intentId:input.intentId,amountCents:input.amountCents,currency:input.currency,checkoutRef:ref('cs_fixture_'),...capability};checkouts.set(input.intentId,item);counters.checkoutCreates++;}
   else check(item.amountCents===input.amountCents&&item.currency===input.currency,'idempotency_conflict');
   if(fault==='checkout_response_lost')throw new FundingError('offline_transport_uncertain',503);
   return {...item,customer:{email:'discard@example.invalid',name:'discard fixture donor'},url:null};
  },
  checkoutFor(intentId){const item=checkouts.get(intentId);return item?{...item}:null;},
  async pay(intentId,{effectivePaidAt=null}={}){
   const item=checkouts.get(intentId);check(item,'unknown_fixture_checkout');
   const paymentRef=ref('pi_fixture_'),proof={...item,paymentRef,effectivePaidAt:new Date(effectivePaidAt??await now()).toISOString(),semantic:'simulator_successful_payment:v2'};
   payments.set(paymentRef,proof);counters.payments++;return {...proof};
  },
  proof(paymentRef){const proof=payments.get(paymentRef);return proof?{...proof}:null;},
  async webhook(paymentRef,{eventRef=ref('evt_fixture_'),type='payment_intent.succeeded',created=1}={}){
   const p=payments.get(paymentRef);check(p,'unknown_fixture_payment');
   const raw=Buffer.from(JSON.stringify({id:eventRef,type,created,livemode:false,_fixtureMode:'offline',data:{object:{id:paymentRef,amount_received:p.amountCents,currency:p.currency.toLowerCase(),metadata:{funding_intent:p.intentId,checkout_ref:p.checkoutRef},customer:{name:'discard fixture donor',email:'discard@example.invalid',phone:'+31600000000'}}}}));
   const t=Math.floor(new Date(await now()).getTime()/1000);return {raw,signature:`t=${t},v1=${sign(raw,t)}`,eventRef};
  },
 };
 brands.add(transport);return transport;
}

export function createOfflineProviderAdapter({mode,database,transport,signingSecret,now=()=>new Date(),minimumCheckoutSeconds=1800}){
 fixtureOnly(mode);check(brands.has(transport),'closed_offline_transport_required',503);
 check(typeof signingSecret==='string'&&Buffer.byteLength(signingSecret)>=32&&Number.isSafeInteger(minimumCheckoutSeconds)&&minimumCheckoutSeconds>0,'offline_fixture_configuration_required',503);
 async function sql(text,args){try{return await database.query(text,args);}catch(e){const code=['idempotency_conflict','fixture_otp_binding_invalid','fixture_checkout_binding_invalid'].find(c=>e.message?.includes(c));throw new FundingError(code??'offline_binding_unavailable',code?409:503);}}
 return {
  kind:'simulator',source:'offline_fixture',minimumCheckoutSeconds,feeBoundCents:0,feeBoundKnown:true,
  // The existing unsigned simulator callback must not act as an alternate ingress.
  authenticate:()=>false,
  async startOtp(challengeId,phone){
   const r=await transport.startOtp({challengeId,to:phone,serviceDomain:'fixture_funding_verify'});
   check(/^VE[0-9a-f]{32}$/.test(r.sid)&&r.status==='pending','fixture_otp_binding_invalid');
   await sql("SELECT funding_private.bind_fixture_otp($1,$2,'fixture_funding_verify')",[challengeId,r.sid]);
  },
  async verifyOtp(challengeId,code){
   const reference=(await sql('SELECT funding_private.fixture_otp_reference($1) AS ref',[challengeId])).rows[0].ref;
   const r=await transport.checkOtp({verificationSid:reference,code,serviceDomain:'fixture_funding_verify'});check(r.sid===reference,'fixture_otp_binding_invalid');return r.status==='approved';
  },
  async checkout(intent){
   checkoutCapability({createdAt:await now(),expiresAt:intent.expiresAt,minimumSeconds:minimumCheckoutSeconds});
   const r=await transport.createCheckout({...intent,minimumSeconds:minimumCheckoutSeconds});
   await sql('SELECT funding_private.bind_fixture_checkout($1,$2,$3,$4,$5)',[intent.intentId,r.checkoutRef,r.createdAt,r.expiresAt,minimumCheckoutSeconds]);
   return {expiresAt:intent.expiresAt,actualFixtureExpiresAt:r.expiresAt,simulated:true};
  },
  async ingest(raw,signature){
   check(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=16384,'invalid_fixture_body',400);
   check(typeof signature==='string'&&signature.length<=2048,'invalid_provider_auth',401);
   const fields=signature.split(',').map(x=>x.trim()),timestamps=fields.filter(x=>x.startsWith('t='));
   check(timestamps.length===1&&/^t=\d{1,12}$/.test(timestamps[0]),'invalid_provider_auth',401);const t=Number(timestamps[0].slice(2));
   const n=Math.floor(new Date(await now()).getTime()/1000);check(Math.abs(n-t)<=300,'invalid_provider_auth',401); // Fixture-only signature window.
   const expected=createHmac('sha256',signingSecret).update(String(t)+'.').update(raw).digest();
   const valid=fields.filter(x=>/^v1=[0-9a-fA-F]{64}$/.test(x)).some(x=>timingSafeEqual(Buffer.from(x.slice(3),'hex'),expected));check(valid,'invalid_provider_auth',401);
   let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new FundingError('invalid_fixture_body',400);}
   check(payload&&payload.livemode===false&&payload._fixtureMode==='offline','offline_fixture_required',400);
   const eventRef=identifier(payload.id,'evt_');check(eventRef,'invalid_fixture_reference',400);
   const object=payload.data?.object??{},paymentRef=identifier(object.id,'pi_'),checkoutRef=identifier(object.metadata?.checkout_ref,'cs_');
   const intentId=uuid(object.metadata?.funding_intent)?object.metadata.funding_intent.toLowerCase():null;
   const amount=Number.isSafeInteger(object.amount_received)&&object.amount_received>0?object.amount_received:null;
   const currency=typeof object.currency==='string'&&/^[a-zA-Z]{3}$/.test(object.currency)?object.currency.toUpperCase():null;
   const kind=typeof payload.type==='string'&&/^[a-z][a-z0-9_.]{0,63}$/.test(payload.type)?payload.type:'unknown';
   const proof=transport.proof(paymentRef);
   const bound=Boolean(proof&&proof.paymentRef===paymentRef&&proof.checkoutRef===checkoutRef&&proof.intentId===intentId&&proof.amountCents===amount&&proof.currency===currency);
   const paidAt=bound?proof.effectivePaidAt:null; // Never event.created, receipt time or a caller-paidAt field.
   const result=(await sql('SELECT funding_private.ingest_fixture_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[eventRef,checkoutRef,paymentRef,intentId,amount,currency,paidAt,kind,bound])).rows[0].result;
   return {result,simulated:true,source:'offline_fixture'};
  },
 };
}

export async function offlineProviderRoutes(app,{adapter}){
 // Scoped parser preserves signature bytes only in transient request memory.
 app.removeContentTypeParser('application/json');
 app.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:16384},(req,body,done)=>done(null,body));
 app.post('/fixture/stripe-webhook',{bodyLimit:16384},async(req,reply)=>{try{return await adapter.ingest(req.body,req.headers['stripe-signature']);}catch(e){return reply.code(e.statusCode??503).send({error:e.code??'offline_binding_unavailable'});}});
}
