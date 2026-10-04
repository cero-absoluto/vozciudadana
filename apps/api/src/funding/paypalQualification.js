// Closed, synthetic qualification contract only: no SDK, HTTP, SQL or production import.
const fixtures=new WeakSet();
const requireThat=(condition,code)=>{if(!condition)throw new Error(code);};
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const id=value=>typeof value==='string'&&/^pp_fixture_[a-z0-9_]{1,60}$/.test(value);
const isolated=mode=>requireThat(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only');
export function createPayPalQualificationFixture({mode,records}){
 isolated(mode);requireThat(Array.isArray(records),'fixture_records_required');
 const state=new Map();let reads=0;
 for(const row of records){requireThat(id(row.orderRef)&&!state.has(row.orderRef),'invalid_fixture_reference');state.set(row.orderRef,structuredClone(row));}
 const transport={
  set(orderRef,patch){requireThat(state.has(orderRef),'unknown_fixture_reference');state.set(orderRef,{...state.get(orderRef),...structuredClone(patch),orderRef});},
  async retrieve(orderRef){reads++;requireThat(state.has(orderRef),'unknown_fixture_reference');const row=state.get(orderRef);if(row.queryFailure)throw new Error('fixture_query_unavailable');return structuredClone(row);},
  stats:()=>({reads}),
 };fixtures.add(transport);return transport;
}
export function createPayPalQualificationContract({mode,transport,bindings,now}){
 isolated(mode);requireThat(fixtures.has(transport),'closed_fixture_required');requireThat(Array.isArray(bindings)&&typeof now==='function','invalid_configuration');
 const known=new Map(),observed=new Map(),requests=new Map();
 for(const b of bindings){
  requireThat(id(b.orderRef)&&id(b.intentRef)&&id(b.receiverRef)&&!known.has(b.orderRef)&&Number.isSafeInteger(b.amountCents)&&b.amountCents>0&&b.currency==='EUR','invalid_binding');
  const dates=[b.createdAt,b.localDeadline,b.eventDeadline,b.yearDeadline].map(time);
  requireThat(dates.every(Number.isFinite)&&Math.min(...dates.slice(1))>dates[0],'invalid_window');known.set(b.orderRef,structuredClone(b));
 }
 const result=(action,reason,extra={})=>({action,reason,releaseReservation:false,productionActivation:false,source:'paypal_qualification_fixture',...extra});
 const review=reason=>result('REVIEW',reason);
 const boundary=b=>Math.min(...[b.localDeadline,b.eventDeadline,b.yearDeadline].map(time));
 return {
  // This records a synthetic capture request assessment, never a provider call or quota reservation.
  requestCapture({orderRef,operationRef,verifiedSession=false,reservationBound=false}){
   const b=known.get(orderRef);if(!b)return review('unknown_reference');
   if(!verifiedSession||!reservationBound)return review('financing_authority_required');
   if(!id(operationRef))return review('invalid_operation');
   const prior=requests.get(operationRef);if(prior)return prior.orderRef===orderRef?structuredClone(prior.result):review('idempotency_conflict');
   if([...requests.values()].some(r=>r.orderRef===orderRef))return review('capture_operation_already_bound');
   const n=time(now());if(!Number.isFinite(n)||n<time(b.createdAt)||n>=boundary(b)||b.eventClosed)return review('capture_window_closed');
   const r=result('CAPTURE_REQUEST_FIXTURE','not_a_provider_submission',{operationRef});requests.set(operationRef,{orderRef,result:r});return structuredClone(r);
  },
  async observe(orderRef){
   const b=known.get(orderRef);if(!b)return review('unknown_reference');
   let r;try{r=await transport.retrieve(orderRef);}catch{return review('query_unavailable');}
   const n=time(now()),o=time(r.observedAt);if(!Number.isFinite(n)||!Number.isFinite(o)||o>n||n-o>30000)return review('stale_observation');
   if(r.mode!=='synthetic'||r.orderRef!==b.orderRef||r.intentRef!==b.intentRef||r.receiverRef!==b.receiverRef||r.amountCents!==b.amountCents||r.currency!==b.currency)return review('binding_mismatch');
   if(!Number.isSafeInteger(r.revision)||r.revision<1)return review('invalid_revision');
   // revision and effectiveSuccessfulAt are harness-only fields, not PayPal guarantees.
   const fingerprint=JSON.stringify([r.orderStatus,r.captureStatus??null,r.captureRef??null,r.effectiveSuccessfulAt??null]);
   const prior=observed.get(orderRef);
   if(prior&&(r.revision<prior.revision||(r.revision===prior.revision&&fingerprint!==prior.fingerprint)))return review('contradictory_observation');
   if(prior?.terminal&&fingerprint!==prior.fingerprint)return review('terminal_changed');
   if(r.captureStatus==='COMPLETED'){
    if(!id(r.captureRef))return review('capture_reference_required');
    const s=time(r.effectiveSuccessfulAt);if(!Number.isFinite(s))return review('successful_time_mapping_unproven');
    if(s<time(b.createdAt)||s>o)return review('invalid_successful_time');
    if(s>=boundary(b)||b.eventClosed)return review('late_or_closed_capture');
    if(![...requests.values()].some(x=>x.orderRef===orderRef))return review('capture_request_unbound');
    observed.set(orderRef,{revision:r.revision,fingerprint,terminal:true});
    return result('EVIDENCED_SUCCESS_FIXTURE','synthetic_timestamp_only',{successfulAt:new Date(s).toISOString(),amountCents:b.amountCents});
   }
   if(['REFUNDED','PARTIALLY_REFUNDED'].includes(r.captureStatus))return review('external_debit_requires_reconciliation');
   if(r.captureStatus&&!['PENDING','FAILED','DECLINED','UNKNOWN'].includes(r.captureStatus))return review('unknown_capture_status');
   if(!['CREATED','SAVED','APPROVED','PAYER_ACTION_REQUIRED','COMPLETED','VOIDED'].includes(r.orderStatus))return review('unknown_order_status');
   observed.set(orderRef,{revision:r.revision,fingerprint,terminal:false});
   // Approval, timeout, failed capture attempt or VOIDED order cannot prove absence of another capture.
   return result('HOLD','definitive_no_capture_evidence_unproven');
  },
  qualification(){return {verdict:'NOT_QUALIFIED',productionActivation:false,blockers:['account_eligibility_unverified','successful_time_mapping_unproven','definitive_no_capture_evidence_unproven','real_cost_and_retention_unverified']};},
 };
}
