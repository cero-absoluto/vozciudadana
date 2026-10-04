import {timingSafeEqual} from 'node:crypto';
import {FundingError} from './isolatedService.js';
const check=(value,code,status=400)=>{if(!value)throw new FundingError(code,status);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Separate test-only authority. No Supabase Auth, production Owner or PSP integration.
export function createIsolatedReviewAuthenticator({reviewSecret,fundingSecret,providerSecret,participationSecret,mode}){
 check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only',503);
 check([reviewSecret,fundingSecret,providerSecret,participationSecret].every(s=>typeof s==='string'&&Buffer.byteLength(s)>=32)&&![fundingSecret,providerSecret,participationSecret].includes(reviewSecret),'independent_review_secret_required',503);
 return {kind:'isolated_owner',authenticate(value){const a=Buffer.from(String(value??'')),b=Buffer.from(reviewSecret);return a.length===b.length&&timingSafeEqual(a,b);}};
}
export function createIsolatedReviewService({database,authenticator,mode}){
 check(mode==='isolated'&&process.env.NODE_ENV!=='production'&&authenticator?.kind==='isolated_owner','isolated_review_required',503);
 async function authorize(credential){
  check(authenticator.authenticate(credential),'review_authority_required',401);
  let actor;try{actor=(await database.query(`SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'funding_review','MEMBER') AS reviewer,
   pg_has_role(current_user,'funding_runtime','MEMBER') AS financial,pg_has_role(current_user,'service_role','MEMBER') AS service FROM pg_roles WHERE rolname=current_user`,[])).rows[0];}catch{throw new FundingError('review_unavailable',503);}
  check(actor?.reviewer&&!actor.rolsuper&&!actor.rolbypassrls&&!actor.financial&&!actor.service,'review_connection_required',503);
 }
 async function sql(text,args=[]){try{return await database.query(text,args);}catch(e){
  const known=['idempotency_conflict','invalid_review_decision','payment_not_eligible','source_not_eligible','dispute_review_required','refund_exceeds_gross','movement_not_eligible','review_source_insufficient','unknown_review_decision','review_already_revoked','review_provenance_required'];
  const code=known.find(c=>e.message?.includes(c));throw new FundingError(code??'review_unavailable',code?409:503);
 }}
 const caseSQL=`SELECT m.movement_ref,m.claimed_intent,m.kind,m.amount,m.currency,m.operation_ref,m.related_ref,m.effective_at,m.received_at,
  i.amount AS gross,i.state AS payment_state,i.event_id,a.source_account AS allocated_source,
  a.movement_ref IS NOT NULL AS allocated,ea.state AS event_state,ea.balance AS event_balance,
  funding_private.available_operational(ea.id) AS event_available,
  funding_private.available_operational('general') AS general_available,
  (SELECT balance FROM funding_private.accounts WHERE id='general') AS general_balance,
  m.effective_at>funding_private.temporal_now() AS evidence_future
  FROM funding_private.provider_movements m LEFT JOIN funding_private.intents i ON i.id=m.claimed_intent
  LEFT JOIN funding_private.movement_allocations a ON a.movement_ref=m.movement_ref
  LEFT JOIN funding_private.accounts ea ON ea.event_id=i.event_id`;
 const present=row=>({movementRef:row.movement_ref,intentId:row.claimed_intent,kind:row.kind,observedAmountCents:Number(row.amount),currency:row.currency,
  operationRef:row.operation_ref,relatedRef:row.related_ref,effectiveAt:row.effective_at,receivedAt:row.received_at,allocated:row.allocated,allocatedSource:row.allocated_source,
  grossCents:row.gross===null?null:Number(row.gross),paymentState:row.payment_state,eventState:row.event_state,
  eventBalanceCents:row.event_balance===null?null:Number(row.event_balance),eventAvailableCents:row.event_available===null?null:Number(row.event_available),generalAvailableCents:Number(row.general_available),generalBalanceCents:Number(row.general_balance),
  eventReservedCents:row.event_balance===null?null:Number(row.event_balance)-Number(row.event_available),generalReservedCents:Number(row.general_balance)-Number(row.general_available),
  reviewFlags:[row.currency!=='EUR'?'foreign_currency':null,row.payment_state!=='confirmed'?'payment_not_confirmed':null,!row.effective_at?'missing_effective_time':null,row.evidence_future?'future_effective_time':null,row.event_state==='settled'?'event_final':null,['refund','dispute_debit'].includes(row.kind)&&-Number(row.amount)>Number(row.gross)?'principal_exceeds_gross':null,!row.allocated?'unallocated':null].filter(Boolean)});
 return {
  async cases(credential,{after=null,limit=25}={}){
   await authorize(credential);check(Number.isInteger(limit)&&limit>0&&limit<=100&&(after===null||(typeof after==='string'&&after.length<=128)),'invalid_review_page');
   const rows=(await sql(caseSQL+' WHERE a.movement_ref IS NULL AND ($1::text IS NULL OR m.movement_ref>$1) ORDER BY m.movement_ref LIMIT $2',[after,limit+1])).rows;
   const more=rows.length>limit,items=rows.slice(0,limit).map(present);return {simulated:true,cashReconciliation:'not_certified',items,nextCursor:more?items.at(-1).movementRef:null};
  },
  async case(credential,ref){
   await authorize(credential);check(typeof ref==='string'&&ref.length>0&&ref.length<=128,'invalid_review_reference');
   const row=(await sql(caseSQL+' WHERE m.movement_ref=$1',[ref])).rows[0];check(row,'review_case_not_found',404);
   const decisions=(await sql(`SELECT d.id,d.operation_ref,d.action,d.amount,d.source_account,d.expires_at,
    r.decision_id IS NOT NULL AS revoked,p.request_id,p.evidence_ref,p.authority,
    h.state AS refund_state FROM funding_private.financial_review_decisions d
    LEFT JOIN funding_private.financial_decision_revocations r ON r.decision_id=d.id
    LEFT JOIN funding_private.review_authorizations p ON p.decision_id=d.id AND p.kind='issue'
    LEFT JOIN funding_private.refund_reservations h ON h.decision_id=d.id WHERE d.intent_id=$1 ORDER BY d.created_at,d.id`,[row.claimed_intent])).rows;
   return {simulated:true,cashReconciliation:'not_certified',case:present(row),decisions:decisions.map(d=>({decisionId:d.id,operationRef:d.operation_ref,action:d.action,amountCents:Number(d.amount),sourceAccount:d.source_account,expiresAt:d.expires_at,revoked:d.revoked,requestId:d.request_id,evidenceRef:d.evidence_ref,authority:d.authority??'legacy_fixture_unknown',refundState:d.refund_state}))};
  },
  async decide(credential,input){
   await authorize(credential);const {requestId,action,intentId,amountCents,sourceAccount,expiresAt,evidenceRef,movementRef=null}=input;
   check(uuid(requestId)&&uuid(intentId)&&uuid(evidenceRef)&&['refund_authorize','cover_exposure'].includes(action)&&Number.isSafeInteger(amountCents)&&amountCents>0&&typeof sourceAccount==='string'&&sourceAccount.length<=64&&typeof expiresAt==='string'&&Number.isFinite(Date.parse(expiresAt))&&(movementRef===null||(typeof movementRef==='string'&&movementRef.length>0&&movementRef.length<=128)),'invalid_review_decision');
   const id=(await sql('SELECT funding_private.issue_review_decision($1,$2,$3,$4,$5,$6,$7,$8) AS id',[requestId,action,intentId,amountCents,sourceAccount,expiresAt,evidenceRef,movementRef])).rows[0].id;
   return {simulated:true,decisionId:id,operationRef:requestId.toLowerCase(),fundsMoved:false,requiresFinancialRecheck:true};
  },
  async revoke(credential,decisionId,{requestId,evidenceRef}){
   await authorize(credential);check(uuid(decisionId)&&uuid(requestId)&&uuid(evidenceRef),'invalid_review_decision');
   await sql('SELECT funding_private.revoke_review_decision($1,$2,$3)',[requestId,decisionId,evidenceRef]);return {simulated:true,decisionId,revoked:true,fundsMoved:false};
  },
 };
}
export async function isolatedReviewRoutes(app,{service}){
 const invoke=fn=>async(req,reply)=>{try{return await fn(req);}catch(e){return reply.code(e.statusCode??503).send({error:e.code??'review_unavailable'});}};
 const auth=req=>req.headers['x-review-auth'];
 const id={type:'string',format:'uuid'},ref={type:['string','null'],minLength:1,maxLength:128};
 const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
 app.get('/review/cases',{schema:{querystring:object({after:{type:'string',maxLength:128},limit:{type:'integer',minimum:1,maximum:100}},[])}},invoke(req=>service.cases(auth(req),req.query)));
 app.get('/review/cases/:ref',invoke(req=>service.case(auth(req),req.params.ref)));
 app.post('/review/decisions',{schema:{body:object({requestId:id,action:{enum:['refund_authorize','cover_exposure']},intentId:id,amountCents:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},sourceAccount:{type:'string',minLength:1,maxLength:64},expiresAt:{type:'string',format:'date-time'},evidenceRef:id,movementRef:ref},['requestId','action','intentId','amountCents','sourceAccount','expiresAt','evidenceRef'])}},invoke(req=>service.decide(auth(req),req.body)));
 app.post('/review/decisions/:id/revocations',{schema:{body:object({requestId:id,evidenceRef:id},['requestId','evidenceRef'])}},invoke(req=>service.revoke(auth(req),req.params.id,req.body)));
}
