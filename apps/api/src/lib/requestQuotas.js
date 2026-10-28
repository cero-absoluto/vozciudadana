import rateLimit from '@fastify/rate-limit';
import {ipQuotaKey} from './ipQuotaKey.js';
import {consumeSharedOtpQuota} from './otpQuotas.js';

// In-process defense in depth: shared across both OTP delivery routes and /64s.
// Database quotas below provide the shared boundary across restarts/replicas.
export async function registerRequestQuotas(app,{supabase}={}){
 if(!supabase && process.env.NODE_ENV==='production')throw new Error('Shared OTP quota database required');
 await app.register(rateLimit,{global:true,keyGenerator:req=>ipQuotaKey(req.ip),max:120,timeWindow:'1 minute'});
 const broad=app.createRateLimit({max:30,timeWindow:'10 minutes',keyGenerator:req=>'otp-broad:'+ipQuotaKey(req.ip,48)});
 app.decorate('consumeOtpNetworkQuota',async(req,reply)=>{
  const result=await broad(req);
  if(result.isExceeded){
   req.log.warn({code:'otp_network_rate_limited'},'OTP broad network quota exceeded');
   reply.header('retry-after',String(result.ttlInSeconds));
   reply.code(429).send({error:'RATE_LIMITED',code:'otp_network_rate_limited'});
   return false;
  }
  return supabase ? consumeSharedOtpQuota(req,reply,supabase,{action:'delivery'}) : true;
 });
 app.decorate('consumeOtpVerificationQuota',async(req,reply,phoneHash=null)=>
  supabase ? consumeSharedOtpQuota(req,reply,supabase,{action:'verify',phoneHash}) : true);
}

export async function consumeOtpVerificationQuota(req,reply,phoneHash=null){
 if(typeof req.server.consumeOtpVerificationQuota==='function')return req.server.consumeOtpVerificationQuota(req,reply,phoneHash);
 if(process.env.NODE_ENV==='production')throw new Error('OTP verification quota installer missing');
 return true;
}

// Call only after body validation and successful reCAPTCHA, before DB/provider.
export async function consumeOtpDeliveryQuota(req,reply){
 if(typeof req.server.consumeOtpNetworkQuota==='function')return req.server.consumeOtpNetworkQuota(req,reply);
 // Standalone non-production route fixtures may omit the server installer.
 if(process.env.NODE_ENV==='production')throw new Error('OTP quota installer missing');
 return true;
}
