import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {FundingError} from './isolatedService.js';
const check=(v,c,s=400)=>{if(!v)throw new FundingError(c,s);};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const guard=mode=>check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_exact_cost_required',503);
export function canonicalCostDecimal(value){check(typeof value==='string'&&/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$/.test(value),'invalid_cost_decimal');const [i,f='']=value.split('.'),fraction=f.replace(/0+$/,'');return i+(fraction?'.'+fraction:'');}
export function createExactCostFixture({mode,secret,proofSecret,fundingSecret,ownerSecret,participationSecret}){
 guard(mode);const keys=[secret,proofSecret,fundingSecret,ownerSecret,participationSecret];check(keys.every(x=>typeof x==='string'&&Buffer.byteLength(x)>=32)&&new Set(keys).size===keys.length,'distinct_exact_cost_secrets_required',503);const proofs=new Map();
 function auth(value,expected){const a=Buffer.from(typeof value==='string'?value:''),b=Buffer.from(expected);check(a.length===b.length&&timingSafeEqual(a,b),'exact_fixture_auth_required',401);}
 return {kind:'synthetic_exact_cost',normalize(credential,input){auth(credential,secret);check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['operationId','reference','kind','revision','value','currency','qualification'].includes(k)),'invalid_exact_fact');const {operationId,reference,kind,revision,value=null,currency=null,qualification}=input;
 check(uuid(operationId)&&typeof reference==='string'&&/^synthetic_component_[a-z0-9_-]{1,96}$/.test(reference)&&['channel_attempt','verification_fee'].includes(kind)&&Number.isSafeInteger(revision)&&revision>0&&['provisional','final_fixture'].includes(qualification)&&(value===null?currency===null&&qualification==='provisional':typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)),'invalid_exact_fact');
 const canonical=value===null?null:canonicalCostDecimal(value),binding={operationId:operationId.toLowerCase(),reference,kind,revision,value:canonical,currency,qualification};return {...binding,sourceValue:value,evidenceRef:'e0000000-0000-0000-0000-000000000003',digest:hash(binding)};
 },issueCompleteness(credential,binding){auth(credential,proofSecret);check(binding&&uuid(binding.operationId)&&binding.snapshot?.operationId===binding.operationId&&Array.isArray(binding.manifest)&&['required','not_applicable'].includes(binding.feeBasis),'invalid_exact_proof');const id=randomUUID();proofs.set(id,JSON.parse(JSON.stringify(binding)));return id;},verifyProof(id,operationId){const b=proofs.get(id);check(b?.operationId===operationId,'exact_completeness_proof_required',401);return {...b,evidenceRef:'e0000000-0000-0000-0000-000000000004',digest:hash(b)};}};
}
export function createExactCostService({ingestDatabase,calculatorDatabase,fixture,mode}){
 guard(mode);check(fixture?.kind==='synthetic_exact_cost','exact_fixture_required',503);
 async function call(database,fn,args){let c;try{c=await database.connect();await c.query('BEGIN');const result=(await c.query(`SELECT funding_exact_cost_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;await c.query('COMMIT');return result;}catch(e){try{await c?.query('ROLLBACK');}catch{}const code=['idempotency_conflict','component_scope_conflict','invalid_exact','unknown_exact','exact_actor_required','exact_stale_binding','exact_incomplete'].find(x=>e.message?.includes(x));throw new FundingError(code??'exact_cost_unavailable',code?409:503);}finally{c?.release();}}
 return {
 async open(input){check(input&&Object.keys(input).every(k=>['operationKey','eventRef','purpose'].includes(k))&&typeof input.operationKey==='string'&&/^synthetic_exact_[a-z0-9_-]{1,96}$/.test(input.operationKey)&&(input.eventRef===null||uuid(input.eventRef))&&['event_sms','unassigned'].includes(input.purpose),'invalid_exact_operation');return {operationId:await call(ingestDatabase,'open_operation',[input.operationKey,input.eventRef,input.purpose]),simulated:true};},
 async receive(credential,input){const n=fixture.normalize(credential,input);return {...await call(ingestDatabase,'receive',[n.operationId,n.reference,n.kind,n.revision,n.sourceValue,n.currency,n.qualification,n.evidenceRef,n.digest]),received:true,simulated:true};},
 async inspect(operationId){check(uuid(operationId),'invalid_exact_operation');return call(calculatorDatabase,'snapshot',[operationId]);},
 async attest(operationId,proofHandle){check(uuid(operationId),'invalid_exact_operation');const p=fixture.verifyProof(proofHandle,operationId);return {status:await call(calculatorDatabase,'attest',[operationId,JSON.stringify(p.snapshot),JSON.stringify(p.manifest),p.feeBasis,p.evidenceRef,p.digest]),simulated:true,fundsMoved:false};}
 };
}
