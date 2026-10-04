import {createHash,randomBytes,randomUUID} from 'node:crypto';
const brands=new WeakSet(),services=new WeakSet();
const check=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code,statusCode:409});};
const isolated=mode=>check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only');
// The external fixture state survives WORKER/adapter recomposition, not provider destruction.
export function createLifecycleFixture({mode}){
 isolated(mode);const records=new Map();let fault=null;let creates=0;
 const transport={
  fault(value){check([null,'precreation_failure','response_lost','cancel422','query_timeout'].includes(value),'invalid_fixture_fault');fault=value;},
  set(operation,patch){check(records.has(operation),'unknown_fixture_reference');Object.assign(records.get(operation),structuredClone(patch));},
  stats:()=>({creates}),
  async execute(command){
   if(fault==='query_timeout')throw new Error('fixture_transport_unavailable');
   let item=records.get(command.operationRef);
   if(command.kind==='create'){
    check(item||command.allowCreate,'fixture_creation_window_closed');
    if(fault==='precreation_failure'&&!item)return {reference:null,status:'precreation_failed',amountCents:command.amountCents,currency:'EUR',revision:1,expiresAt:null,successfulAt:null,observedAt:new Date().toISOString()};
    if(!item){item={reference:'lc_'+randomBytes(16).toString('hex'),status:'open',amountCents:command.amountCents,currency:'EUR',revision:1,expiresAt:command.expiresAt,successfulAt:null};records.set(command.operationRef,item);creates++;}
    if(fault==='response_lost')throw new Error('fixture_response_lost');
   }
   check(item,'fixture_reference_unresolved');
   if(command.providerRef)check(item.reference===command.providerRef,'fixture_binding_mismatch');
   if(command.kind==='cancel'&&!['paid','canceled','expired','failed'].includes(item.status)&&fault!=='cancel422'){item.status='canceled';item.revision++;}
   // A cancel422 means no status transition; retrieval returns current provider state.
   return {...structuredClone(item),observedAt:new Date().toISOString()};
  },
 };
 brands.add(transport);return transport;
}
export const isDurableLifecycleService=x=>services.has(x);
export function createDurableLifecycleService({mode,finance,ingest,transport}){
 isolated(mode);check(brands.has(transport),'closed_lifecycle_fixture_required');
 async function q(db,s,args=[]){return (await db.query(s,args)).rows;}
 async function actor(db,role){const row=(await q(db,"SELECT current_user AS actor,rolsuper,rolbypassrls,pg_has_role(current_user,$1,'USAGE') AS allowed,pg_has_role(current_user,'service_role','MEMBER') AS service_member FROM pg_roles WHERE rolname=current_user",[role]))[0];check(row.allowed&&!row.rolsuper&&!row.rolbypassrls&&!row.service_member,'restricted_lifecycle_actor_required');if(role==='funding_provider_ingest')check(!(await q(db,"SELECT pg_has_role(current_user,'funding_runtime','MEMBER') AS financial"))[0].financial,'separate_ingest_actor_required');}
 const service={
  async begin({operationRef,year,annualToken,eventToken=null,eventId=null,amountCents}){
   await actor(finance,'funding_runtime');check(Number.isSafeInteger(amountCents)&&amountCents>0&&amountCents<=100000,'invalid_amount');
   const id=(await q(finance,'SELECT funding_private.begin_lifecycle($1,$2,$3,$4,$5,$6) AS id',[operationRef,year,annualToken,eventToken,eventId,amountCents]))[0].id;
   return {intentId:id,commandId:operationRef,simulated:true};
  },
  async request(intentId,operationRef,kind){await actor(finance,'funding_runtime');return (await q(finance,'SELECT funding_private.request_lifecycle_command($1,$2,$3) AS id',[intentId,operationRef,kind]))[0].id;},
  async expireLocal(intentId,operationRef){await actor(finance,'funding_runtime');const row=(await q(finance,'SELECT local_deadline<=funding_private.temporal_now() AS expired FROM funding_private.provider_lifecycles WHERE intent_id=$1',[intentId]))[0];check(row?.expired,'local_window_active');return service.request(intentId,operationRef,'retrieve');},
  async run(commandId){
   await actor(finance,'funding_runtime');
   await actor(ingest,'funding_provider_ingest');const worker=randomUUID();
   const command=(await q(ingest,'SELECT funding_private.claim_lifecycle_command($1,$2) AS command',[commandId,worker]))[0].command;
   if(command.completed){const row=(await q(ingest,'SELECT id,intent_id FROM funding_private.provider_observations WHERE command_id=$1',[commandId]))[0];check(row,'completed_command_without_evidence');return {observationId:row.id,intentId:row.intent_id};}
   let observation;
   try{observation=await transport.execute(command);}catch{
    await q(ingest,'SELECT funding_private.uncertain_lifecycle_command($1,$2)',[commandId,worker]);await q(finance,'SELECT funding_private.mark_lifecycle_uncertain($1)',[commandId]);return {uncertain:true,intentId:command.intentId};
   }
   const normalized={reference:observation.reference,revision:observation.revision,status:observation.status,amountCents:observation.amountCents,currency:observation.currency,successfulAt:observation.successfulAt??null,expiresAt:observation.expiresAt,observedAt:observation.observedAt};
   const digest=createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),id=randomUUID();
   try{await q(ingest,'SELECT funding_private.record_lifecycle_observation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,commandId,worker,normalized.reference,normalized.revision,normalized.status,normalized.amountCents,normalized.currency,normalized.successfulAt,normalized.expiresAt,normalized.observedAt,digest]);}
   catch(e){await q(ingest,'SELECT funding_private.uncertain_lifecycle_command($1,$2)',[commandId,worker]);throw e;}
   return {observationId:id,intentId:command.intentId};
  },
  async apply(intentId,observationId){await actor(finance,'funding_runtime');return (await q(finance,'SELECT funding_private.apply_lifecycle_observation($1,$2) AS result',[intentId,observationId]))[0].result;},
  async status(intentId){await actor(finance,'funding_runtime');return (await q(finance,'SELECT binding_state,local_deadline,remote_expires_at FROM funding_private.provider_lifecycles WHERE intent_id=$1',[intentId]))[0]??null;},
 };
 services.add(service);return service;
}
