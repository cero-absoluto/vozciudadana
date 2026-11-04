import {createHmac} from 'node:crypto';
import {withRequestDeadline} from './requestDeadline.js';

export const smsBillingEnabled = () => process.env.SMS_CONFIRMED_ADHESION_BILLING_ENABLED === 'true';
export const evidenceUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function smsCostCents(){
 const value = process.env.SMS_COST_EUR ?? '0.05';
 if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) throw new Error('SMS_BILLING_CONFIGURATION_INVALID');
 const [whole,fraction=''] = value.split('.');
 const amount = Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if (!Number.isSafeInteger(amount) || amount<1 || amount>9999999999) throw new Error('SMS_BILLING_CONFIGURATION_INVALID');
 return amount;
}
export function providerVerificationHash(sid){
 const secret=process.env.PHONE_HASH_SECRET;
 if (!secret || typeof sid!=='string' || !/^VE[0-9a-f]{32}$/i.test(sid)) throw new Error('SMS_PROVIDER_EVIDENCE_INVALID');
 return createHmac('sha256',secret).update('voiceprotest:sms-provider-verification:v1:'+sid.toLowerCase()).digest('hex');
}
export async function smsEvidenceRpc(database,name,args){
 const result=await withRequestDeadline(5000,signal=>database.rpc(name,args).abortSignal(signal));
 if (result?.error || !result?.data || result.data.ok!==true) throw new Error('SMS_EVIDENCE_UNAVAILABLE');
 return result.data;
}
export async function assertSmsEvidenceReady(database){
 if (!process.env.PHONE_HASH_SECRET) throw new Error('SMS_BILLING_CONFIGURATION_INVALID');
 smsCostCents();
 const data=await smsEvidenceRpc(database,'get_sms_billing_status',{});
 if (data.enabled!==true || data.proof_ttl_seconds!==1800) throw new Error('SMS_BILLING_PAUSED');
}

export function assertSmsEvidenceAck(data,expected){
 if (!data || data.ok!==true || !Object.entries(expected).every(([key,value])=>data[key]===value)) throw new Error('SMS_EVIDENCE_RESPONSE_INVALID');
 return data;
}
