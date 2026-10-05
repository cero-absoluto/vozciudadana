import {randomUUID} from 'node:crypto';
export const exactCostMigration=new URL('../../supabase/migrations/20261005045706_funding_exact_cost_components.sql',import.meta.url);
export const exactCostOptions={mode:'isolated',secret:'synthetic_exact_ingest_secret_32_bytes',proofSecret:'synthetic_exact_completeness_secret_32_bytes',fundingSecret:'synthetic_exact_distinct_finance_32_bytes',ownerSecret:'synthetic_exact_distinct_owner_32_bytes',participationSecret:'synthetic_exact_distinct_participation_32_bytes'};
export const exactOperation=(key,eventRef=randomUUID())=>({operationKey:'synthetic_exact_'+key,eventRef,purpose:'event_sms'});
export const exactFact=(operationId,key,value='0.005',delta={})=>({operationId,reference:'synthetic_component_'+key,kind:'channel_attempt',revision:1,value,currency:'USD',qualification:'final_fixture',...delta});
export async function completeness(service,fixture,operationId,feeBasis='not_applicable',changes={}){const snapshot=await service.inspect(operationId);const binding={operationId,snapshot,manifest:snapshot.components.map(x=>x.reference),feeBasis,...changes};return fixture.issueCompleteness(exactCostOptions.proofSecret,binding);}
