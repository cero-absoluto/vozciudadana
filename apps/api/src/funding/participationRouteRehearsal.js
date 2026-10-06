import {createHmac} from 'node:crypto';
import {isDurableSmsIntegrationCandidate} from './smsIntegrationCandidate.js';
import {FundingError} from './isolatedService.js';
import {isDurableRouteStore} from './durableRouteStore.js';
const registered = new WeakSet();
const stop = code => { throw new FundingError(code, 503); };
// Only disposable route harnesses. No environment flag activates this in server.js.
export function createParticipationRouteRehearsal({candidate,database,boundCents,secret,scope,store}) {
  if(process.env.NODE_ENV==='production'||!isDurableSmsIntegrationCandidate(candidate)||
     !Number.isSafeInteger(boundCents)||boundCents<=0||typeof secret!=='string'||secret.length<32||
     typeof scope!=='function'||!database||!isDurableRouteStore(store)) stop('isolated_route_rehearsal_required');
  const key=(phone,device,event)=>createHmac('sha256',secret).update(JSON.stringify([phone,device,event])).digest('hex');
  const rehearsal={database,async isScoped(event){return !!event&&await scope(event);},
    async sendOtp(phone,{protest_id,device_id,request_key}={}){
      protest_id=typeof protest_id==='string'?protest_id.toLowerCase():protest_id;
      if(phone!=='+15005550006'||!device_id||!request_key||!await rehearsal.isScoped(protest_id)) stop('event_sms_purpose_required');
      const opKey='synthetic_sms_route_'+createHmac('sha256',secret).update(JSON.stringify([protest_id,device_id,phone,request_key])).digest('hex');
      const k=key(phone,device_id,protest_id);
      const claim=await store.claim(k,protest_id,opKey);
      let id=claim.operationId;
      if(claim.won){
       const prepared=await candidate.prepare({eventId:protest_id,operationKey:opKey,boundCents,currency:'EUR'});
       id=prepared.operationId;await store.bind(k,opKey,id);
      }else if(claim.state!=='bound')stop('unresolved_attempt_requires_review');
      const result=await candidate.dispatch(id);
      return {sent:result.sent===true,operation_id:id,simulated:true};
    },
    async verifyOtp(phone,code,{device_id,protest_id,operation_id}={}){
      protest_id=typeof protest_id==='string'?protest_id.toLowerCase():protest_id;
      if(phone!=='+15005550006'||!await rehearsal.isScoped(protest_id)||(await store.lookup(key(phone,device_id,protest_id)))?.operationId!==operation_id) return false;
      return (await candidate.check(operation_id,code)).approved===true;
    },
    async closeParticipation(event){return store.close(event);}
  };
  registered.add(rehearsal);return Object.freeze(rehearsal);
}
export function routeRehearsal(value){
  if(value===undefined)return null;
  if(process.env.NODE_ENV==='production'||!registered.has(value))stop('isolated_route_rehearsal_required');
  return value;
}
