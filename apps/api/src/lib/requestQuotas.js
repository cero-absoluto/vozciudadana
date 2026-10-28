import rateLimit from '@fastify/rate-limit';
import {ipQuotaKey} from './ipQuotaKey.js';

// In-process defense in depth: shared across both OTP delivery routes and /64s.
// It is not a distributed SMS budget. Restarts/replicas have separate counters.
export async function registerRequestQuotas(app){
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
  return true;
 });
}

// Call only after body validation and successful reCAPTCHA, before DB/provider.
export async function consumeOtpDeliveryQuota(req,reply){
 if(typeof req.server.consumeOtpNetworkQuota==='function')return req.server.consumeOtpNetworkQuota(req,reply);
 // Standalone non-production route fixtures may omit the server installer.
 if(process.env.NODE_ENV==='production')throw new Error('OTP quota installer missing');
 return true;
}
