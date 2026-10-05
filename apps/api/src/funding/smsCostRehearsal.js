import {createHash,timingSafeEqual} from 'node:crypto';
import {FundingError} from './isolatedService.js';
const check=(v,c,s=400)=>{if(!v)throw new FundingError(c,s);};
const guard=mode=>check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_sms_required',503);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function createSmsFixtureProvider({secret,fundingSecret,ownerSecret,participationSecret,mode,scenario='accepted'}){
 guard(mode);check([secret,fundingSecret,ownerSecret,participationSecret].every(x=>typeof x==='string'&&Buffer.byteLength(x)>=32)&&![fundingSecret,ownerSecret,participationSecret].includes(secret),'sms_fixture_secret_required',503);
 check(['accepted','no_send','response_lost'].includes(scenario),'invalid_sms_scenario');const calls=new Map();
 function normalize(credential,input){
  const a=Buffer.from(typeof credential==='string'?credential:''),b=Buffer.from(secret);check(a.length===b.length&&timingSafeEqual(a,b),'sms_evidence_auth_required',401);
  check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['operationId','reference','kind','amountCents','currency'].includes(k)),'invalid_sms_fact');
  const {operationId,reference,kind,amountCents=null,currency=null}=input;
  check(uuid(operationId)&&typeof reference==='string'&&/^synthetic_sms_fact_[a-z0-9_-]{1,96}$/.test(reference)&&['accepted','failed','unknown','priced','no_charge'].includes(kind)&&(kind==='priced'?Number.isSafeInteger(amountCents)&&amountCents>0&&typeof currency==='string'&&/^[A-Z]{3}$/.test(currency):amountCents===null&&currency===null),'invalid_sms_fact');
  const n={operationId:operationId.toLowerCase(),reference,kind,amountCents,currency};return {...n,evidenceRef:'e0000000-0000-0000-0000-000000000002',digest:createHash('sha256').update(JSON.stringify(n)).digest('hex')};
 }
 return {kind:'synthetic_sms_provider',normalize,calls:op=>calls.get(op)??0,async dispatch(op){calls.set(op,(calls.get(op)??0)+1);if(scenario==='response_lost')throw Error('synthetic_response_loss');return normalize(secret,{operationId:op,reference:'synthetic_sms_fact_dispatch_'+op.replaceAll('-',''),kind:scenario==='no_send'?'no_charge':'accepted'});},unknown(op){return normalize(secret,{operationId:op,reference:'synthetic_sms_fact_unknown_'+op.replaceAll('-',''),kind:'unknown'});}};
}
export function createSmsCostRehearsal({executorDatabase,evidenceDatabase,provider,mode}){
 guard(mode);check(provider?.kind==='synthetic_sms_provider','sms_fixture_provider_required',503);
 async function tx(database,sql,args){let c;try{c=await database.connect();await c.query('BEGIN');const result=(await c.query(sql,args)).rows[0].result;await c.query('COMMIT');return result;}catch(e){try{await c?.query('ROLLBACK');}catch{}const code=['idempotency_conflict','invalid_sms','unknown_sms','sms_actor_required','sms_dispatch_closed','sms_pending_items','event_not_open','event_not_ended','insufficient_event_funds','pending_items'].find(x=>e.message?.includes(x));throw new FundingError(code??'sms_rehearsal_unavailable',code?409:503);}finally{c?.release();}}
 const exec=(fn,args)=>tx(executorDatabase,`SELECT funding_sms_fixture_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args);
 const store=n=>tx(evidenceDatabase,'SELECT funding_sms_fixture_private.receive($1,$2,$3,$4,$5,$6,$7) AS result',[n.operationId,n.reference,n.kind,n.amountCents,n.currency,n.evidenceRef,n.digest]);
 return {
  async prepare(input){check(input&&Object.keys(input).every(k=>['eventId','operationKey','boundCents','currency'].includes(k))&&uuid(input.eventId)&&typeof input.operationKey==='string'&&/^synthetic_sms_[a-z0-9_-]{1,96}$/.test(input.operationKey)&&Number.isSafeInteger(input.boundCents)&&input.boundCents>0&&input.currency==='EUR','invalid_sms_operation');return exec('prepare',[input.eventId,input.operationKey,input.boundCents,input.currency]);},
  async dispatch(operationId){check(uuid(operationId),'invalid_sms_operation');const claim=await exec('claim',[operationId]);if(!claim.claimed)return {...claim,simulated:true};let notice;try{notice=await provider.dispatch(operationId);}catch{notice=provider.unknown(operationId);}await store(notice);return {claimed:true,state:await exec('project',[operationId]),simulated:true,costVerified:false};},
  async ingestEvidence(credential,input){const n=provider.normalize(credential,input);const result=await store(n);return {...result,received:true,simulated:true};},
  async project(operationId){check(uuid(operationId),'invalid_sms_operation');return exec('project',[operationId]);},
  async close(eventId,settle=false){check(uuid(eventId)&&typeof settle==='boolean','invalid_sms_operation');return exec('close',[eventId,settle]);}
 };
}
