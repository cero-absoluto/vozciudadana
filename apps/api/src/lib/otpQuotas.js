import {createHmac} from 'node:crypto';
import {ipQuotaKey} from './ipQuotaKey.js';
import {withRequestDeadline} from './requestDeadline.js';

export function otpNetworkHash(ip, action, secret=process.env.PHONE_HASH_SECRET) {
 if(!secret || !['delivery','verify'].includes(action)) throw new Error('OTP quota configuration unavailable');
 const key=ipQuotaKey(ip,action==='delivery'?48:64);
 if(key==='invalid-client-ip')throw new Error('OTP quota network unavailable');
 return createHmac('sha256',secret).update('vp-otp-'+action+'-network-v1:'+key).digest('hex');
}
async function rpc(db,name,args,{timeoutMs=5000}={}) {
 return withRequestDeadline(timeoutMs,signal=>db.rpc(name,args).abortSignal(signal));
}
export function reserveSmsOtp(db,args,options) { return rpc(db,'reserve_sms_otp',args,options); }
export async function consumeSharedOtpQuota(req,reply,db,{action,phoneHash=null},options) {
 try {
  const networkHash=otpNetworkHash(req.ip,action);
  const subjectHash=phoneHash===null?null:createHmac('sha256',process.env.PHONE_HASH_SECRET).update('vp-otp-verify-subject-network-v1:'+phoneHash+':'+networkHash).digest('hex');
  const {data,error}=await rpc(db,'consume_shared_otp_quota',{p_action:action,p_network_hash:networkHash,p_subject_hash:subjectHash},options);
  if(error || typeof data?.allowed!=='boolean')throw new Error('Quota unavailable');
  if(data.allowed)return true;
  if(!Number.isInteger(data.retry_after)||data.retry_after<1||data.retry_after>86400)throw new Error('Quota unavailable');
  reply.header('Retry-After',String(data.retry_after));
  reply.code(429).send({error:'RATE_LIMITED',code:'otp_rate_limited'});return false;
 } catch {
  reply.code(503).send({error:'OTP_QUOTA_UNAVAILABLE',code:'otp_temporarily_unavailable'});return false;
 }
}
