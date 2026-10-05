import {createHmac} from 'node:crypto';
import {isSmsIntegrationCandidate} from './smsIntegrationCandidate.js';
import {FundingError} from './isolatedService.js';
const registered = new WeakSet();
const stop = code => { throw new FundingError(code, 503); };
// Only disposable route harnesses. No environment flag activates this in server.js.
export function createParticipationRouteRehearsal({candidate,database,boundCents,secret,scope}) {
  if(process.env.NODE_ENV==='production'||!isSmsIntegrationCandidate(candidate)||
     !Number.isSafeInteger(boundCents)||boundCents<=0||typeof secret!=='string'||secret.length<32||
     typeof scope!=='function'||!database) stop('isolated_route_rehearsal_required');
  const operations=new Map(), locks=new Map();
  async function serial(k,run){const before=locks.get(k)??Promise.resolve();let release;const current=new Promise(r=>release=r);locks.set(k,current);await before;try{return await run();}finally{release();if(locks.get(k)===current)locks.delete(k);}}
  const key=(phone,device,event)=>createHmac('sha256',secret).update(JSON.stringify([phone,device,event])).digest('hex');
  const rehearsal={database,async isScoped(event){return !!event&&await scope(event);},
    async sendOtp(phone,{protest_id,device_id,request_key}={}){
      if(phone!=='+15005550006'||!device_id||!request_key||!await rehearsal.isScoped(protest_id)) stop('event_sms_purpose_required');
      const opKey='synthetic_sms_route_'+createHmac('sha256',secret).update(JSON.stringify([protest_id,device_id,phone,request_key])).digest('hex');
      const k=key(phone,device_id,protest_id);
      return serial(k,async()=>{
      const previous=operations.get(k);
      if(previous&&previous.operationKey!==opKey) stop('unresolved_attempt_requires_review');
      const prepared=await candidate.prepare({eventId:protest_id,operationKey:opKey,boundCents,currency:'EUR'});
      operations.set(k,{operationId:prepared.operationId,operationKey:opKey});
      const result=await candidate.dispatch(prepared.operationId);
      return {sent:result.sent===true,operation_id:prepared.operationId,simulated:true};
      });
    },
    async verifyOtp(phone,code,{device_id,protest_id,operation_id}={}){
      if(phone!=='+15005550006'||!await rehearsal.isScoped(protest_id)||operations.get(key(phone,device_id,protest_id))?.operationId!==operation_id) return false;
      return (await candidate.check(operation_id,code)).approved===true;
    }
  };
  registered.add(rehearsal);return Object.freeze(rehearsal);
}
export function routeRehearsal(value){
  if(value===undefined)return null;
  if(process.env.NODE_ENV==='production'||!registered.has(value))stop('isolated_route_rehearsal_required');
  return value;
}
