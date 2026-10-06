import {createSmsCostRehearsal,createSmsFixtureProvider} from './smsCostRehearsal.js';
import {createExactCostService,createExactCostFixture} from './exactCostComponents.js';
import {isBlockedTwilioAdapter,hasPrivateLookupVault} from './blockedTwilioAdapter.js';
import {FundingError} from './isolatedService.js';
const check=(v,c,s=409)=>{if(!v)throw new FundingError(c,s);};
const candidates=new WeakSet();
const durableCandidates=new WeakSet();
export function createSmsIntegrationCandidate({mode,adapter,bridgeDatabase,executorDatabase,evidenceDatabase,ingestDatabase,calculatorDatabase,smsOptions,exactOptions}){
 check(mode==='isolated'&&process.env.NODE_ENV!=='production'&&isBlockedTwilioAdapter(adapter),'isolated_integration_required',503);
 check([smsOptions.secret,exactOptions.secret,exactOptions.proofSecret,exactOptions.fundingSecret,exactOptions.ownerSecret,exactOptions.participationSecret].every(k=>k!==adapter.referenceSecret),'distinct_reference_secret_required',503);
 const exactFixture=createExactCostFixture(exactOptions),costs=createExactCostService({mode,fixture:exactFixture,ingestDatabase,calculatorDatabase}),normalizer=createSmsFixtureProvider(smsOptions);
 async function bridge(fn,args){let c;try{c=await bridgeDatabase.connect();await c.query('BEGIN');const b=(await c.query(`SELECT funding_sms_bridge_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;await c.query('COMMIT');return b;}catch{try{await c?.query('ROLLBACK');}catch{}throw new FundingError('integration_binding_unavailable',503);}finally{c?.release();}}
 const provider={kind:'synthetic_sms_provider',async dispatch(id){await bridge('inspect',[id]);await adapter.dispatch(id);return normalizer.normalize(smsOptions.secret,{operationId:id,reference:'synthetic_sms_fact_integrated_'+id.replaceAll('-',''),kind:'accepted',amountCents:null,currency:null});},unknown:id=>normalizer.normalize(smsOptions.secret,{operationId:id,reference:'synthetic_sms_fact_integrated_'+id.replaceAll('-',''),kind:'unknown',amountCents:null,currency:null})};
 const sms=createSmsCostRehearsal({mode,executorDatabase,evidenceDatabase,provider});
 const candidate={
  async prepare(input){const p=await sms.prepare(input);const e=await costs.open({operationKey:'synthetic_exact_bridge_'+p.operationId.replaceAll('-',''),eventRef:input.eventId,purpose:'event_sms'});await bridge('bind',[p.operationId,e.operationId,input.eventId]);return {operationId:p.operationId,simulated:true};},
  async dispatch(id){await bridge('inspect',[id]);const r=await sms.dispatch(id);return {...r,sent:r.claimed&&r.state==='accepted',costVerified:false,settlementBlocked:true};},
  async check(id,code){const b=await bridge('inspect',[id]);return {...await adapter.check(id,code),eventId:b.event_id,costVerified:false,simulated:true};},
  async collect(id){const b=await bridge('inspect',[id]);const facts=await adapter.collect(id);for(const f of facts)await costs.receive(exactOptions.secret,{...f,operationId:b.exact_operation_id});return candidate.inspect(id);},
  async inspect(id){const b=await bridge('inspect',[id]);const cost=await costs.inspect(b.exact_operation_id);return {operationId:id,dispatchState:await sms.project(id),cost:{totals:cost.totals,components:cost.components,status:cost.status==='review'?'review':'pending_evidence'},feeBasis:'unknown',settlementBlocked:true,fundsMoved:false,simulated:true};},
  async close(eventId,settle=false){check(settle===false,'integration_settlement_blocked');return sms.close(eventId,false);}
 };
 candidates.add(candidate);if(hasPrivateLookupVault(adapter))durableCandidates.add(candidate);return Object.freeze(candidate);
}
// Private handler composition, not mounted by server.js or production route modules.
export function createSmsIntegrationHandlers({enabled=false,candidate,legacy,participation}){
 if(enabled)check(candidates.has(candidate)&&process.env.NODE_ENV!=='production'&&typeof participation?.admit==='function'&&typeof participation?.issue==='function'&&typeof participation?.join==='function','isolated_handlers_required',503);
 return {
  async requestOtp(input){if(!enabled)return legacy.requestOtp(input);check(input?.purpose==='event_sms'&&input.destination==='+15005550006'&&Object.keys(input).every(k=>['eventId','operationKey','boundCents','currency','purpose','destination'].includes(k)),'unsupported_otp_purpose');await participation.admit(input.eventId);const p=await candidate.prepare({eventId:input.eventId,operationKey:input.operationKey,boundCents:input.boundCents,currency:input.currency});return {operationId:p.operationId,...await candidate.dispatch(p.operationId)};},
  async verifyOtp(input){if(!enabled)return legacy.verifyOtp(input);check(input&&Object.keys(input).every(k=>['operationId','code'].includes(k)),'invalid_verification');const result=await candidate.check(input.operationId,input.code);return {approved:result.approved,participationToken:result.approved?await participation.issue(result.eventId):null,simulated:true};},
  async join(input){if(!enabled)return legacy.join(input);check(input?.method==='phone_otp','participation_policy_pending');const {sms_sent,...clean}=input;return participation.join(clean);}
 };
}

// Explicit registration for disposable Fastify harnesses only. Default registers nothing.
export async function registerSmsIntegrationCandidate(app,options={}){
 if(!options.enabled)return;
 const handlers=createSmsIntegrationHandlers(options);
 for(const [path,handler] of [['/request-otp','requestOtp'],['/verify-otp','verifyOtp'],['/join','join']]){
  app.post(path,async(req,reply)=>{try{return await handlers[handler](req.body);}catch(e){return reply.code(e instanceof FundingError?e.statusCode:503).send({error:'integration_request_failed'});}});
 }
}

export const isSmsIntegrationCandidate = value => candidates.has(value);
export const isDurableSmsIntegrationCandidate=value=>durableCandidates.has(value);
