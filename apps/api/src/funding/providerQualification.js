// Isolated qualification/rehearsal only. Not imported by the production server.
// These contracts cannot create, cancel, refund or settle any provider payment.
const transports=new WeakSet();
const demand=(ok,code)=>{if(!ok)throw new Error(code);};
const instant=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
const profiles=Object.freeze({
 'stripe:checkout':Object.freeze({provider:'stripe',method:'checkout',minimumSeconds:1800,maximumSeconds:86400,successfulField:null,terminal:['expired'],source:'https://docs.stripe.com/api/checkout/sessions/create'}),
 'mollie:ideal':Object.freeze({provider:'mollie',method:'ideal',minimumSeconds:null,documentedExpirySeconds:900,successfulField:'paidAt',terminal:['canceled','expired','failed'],source:'https://docs.mollie.com/docs/handling-payment-status'}),
 'mollie:creditcard':Object.freeze({provider:'mollie',method:'creditcard',minimumSeconds:null,documentedExpirySeconds:1800,successfulField:'paidAt',terminal:['canceled','expired','failed'],source:'https://docs.mollie.com/docs/handling-payment-status'}),
 'mollie:paypal':Object.freeze({provider:'mollie',method:'paypal',minimumSeconds:null,documentedExpirySeconds:21600,successfulField:'paidAt',terminal:['canceled','expired','failed'],source:'https://docs.mollie.com/docs/handling-payment-status'}),
});
export function qualifyProviderWindow({provider,method,createdAt,remoteExpiresAt,localDeadline,eventDeadline,yearDeadline}){
 const p=profiles[provider+':'+method];if(!p)return {verdict:'NOT_QUALIFIED',reason:'unknown_method'};
 const [c,r,l,e,y]=[createdAt,remoteExpiresAt,localDeadline,eventDeadline,yearDeadline].map(instant);
 if(![c,r,l,e,y].every(Number.isFinite)||r<=c)return {verdict:'NOT_QUALIFIED',reason:'invalid_window'};
 if(p.minimumSeconds&&r-c<p.minimumSeconds*1000)return {verdict:'NOT_QUALIFIED',reason:'provider_minimum'};
 if(p.maximumSeconds&&r-c>p.maximumSeconds*1000)return {verdict:'NOT_QUALIFIED',reason:'provider_maximum'};
 if(r>Math.min(l,e,y))return {verdict:'NOT_QUALIFIED',reason:'remote_window_crosses_boundary'};
 // Mollie's published expiry is descriptive, not an enforceable deadline guarantee.
 if(provider==='mollie')return {verdict:'NOT_QUALIFIED',reason:'enforceable_expiry_unproven'};
 if(!p.successfulField)return {verdict:'NOT_QUALIFIED',reason:'successful_time_mapping_unproven'};
 return {verdict:'CONTRACT_ONLY',reason:'external_qualification_still_required'};
}
export function createQualificationFixture({mode,records}){
 demand(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only');
 demand(Array.isArray(records),'fixture_records_required');
 const state=new Map();let queries=0;
 for(const record of records){demand(/^qual_[a-z0-9_]{1,80}$/.test(record.reference)&&!state.has(record.reference),'invalid_fixture_reference');state.set(record.reference,structuredClone(record));}
 const t={
  set(reference,patch){demand(state.has(reference),'unknown_fixture_reference');state.set(reference,{...state.get(reference),...structuredClone(patch),reference});},
  stats:()=>({queries}),
  async retrieve(reference){queries++;demand(state.has(reference),'unknown_fixture_reference');const r=state.get(reference);if(r.queryFailure)throw new Error('fixture_query_unavailable');return structuredClone(r);},
 };
 transports.add(t);return t;
}
export function createQualificationObserver({mode,transport,bindings,now,maxObservationAgeSeconds=30}){
 demand(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only');demand(transports.has(transport),'closed_fixture_required');
 demand(typeof now==='function'&&Number.isSafeInteger(maxObservationAgeSeconds)&&maxObservationAgeSeconds>0,'invalid_observer_configuration');
 const known=new Map(),seen=new Map();
 for(const b of bindings){demand(/^qual_[a-z0-9_]{1,80}$/.test(b.reference)&&!known.has(b.reference)&&Number.isSafeInteger(b.amountCents)&&b.amountCents>0&&b.currency==='EUR'&&profiles[b.provider+':'+b.method],'invalid_binding');demand([b.createdAt,b.localDeadline,b.eventDeadline,b.yearDeadline].map(instant).every(Number.isFinite),'invalid_binding');known.set(b.reference,structuredClone(b));}
 const review=reason=>({action:'REVIEW',reason,releaseReservation:false,source:'qualification_fixture'});
 return {
  async observe(reference){
   // Notification content, return URLs and caller dates are never used as evidence.
   const b=known.get(reference);if(!b)return review('unknown_reference');
   let r;try{r=await transport.retrieve(reference);}catch{return review('query_unavailable');}
   const p=profiles[b.provider+':'+b.method],n=instant(await now()),o=instant(r.observedAt);
   if(!Number.isFinite(n)||!Number.isFinite(o)||o>n||n-o>maxObservationAgeSeconds*1000)return review('stale_observation');
   if(r.reference!==reference||r.provider!==b.provider||r.method!==b.method||r.amountCents!==b.amountCents||r.currency!==b.currency||r.createdAt!==b.createdAt||r.mode!=='synthetic')return review('binding_mismatch');
   if(!Number.isSafeInteger(r.revision)||r.revision<1)return review('invalid_revision');
   const normalized={status:r.status,paidAt:r.paidAt??null};const fingerprint=JSON.stringify(normalized),previous=seen.get(reference);
   if(previous&&(r.revision<previous.revision||(r.revision===previous.revision&&fingerprint!==previous.fingerprint)))return review('contradictory_observation');
   if(previous?.terminal&&fingerprint!==previous.fingerprint)return review('terminal_changed');
   const paid=r.status===(b.provider==='mollie'?'paid':'succeeded');
   if(paid){
    // Stripe successful timestamp is deliberately not fabricated from created/event.created.
    if(!p.successfulField)return review('successful_time_mapping_unproven');
    const s=instant(r[p.successfulField]);if(!Number.isFinite(s)||s<instant(b.createdAt)||s>o)return review('invalid_successful_time');
    if(s>=Math.min(instant(b.localDeadline),instant(b.eventDeadline),instant(b.yearDeadline))||b.eventClosed)return review('late_or_closed_payment');
    seen.set(reference,{revision:r.revision,fingerprint,terminal:true});
    return {action:'EVIDENCED_SUCCESS_FIXTURE',releaseReservation:false,successfulAt:new Date(s).toISOString(),amountCents:b.amountCents,source:'qualification_fixture'};
   }
   if(p.terminal.includes(r.status)){
    seen.set(reference,{revision:r.revision,fingerprint,terminal:true});
    return {action:'TERMINAL_NO_PAYMENT_FIXTURE',releaseReservation:true,source:'qualification_fixture'};
   }
   if(!['open','pending','authorized','processing','complete','cancel_requested'].includes(r.status))return review('unknown_status');
   seen.set(reference,{revision:r.revision,fingerprint,terminal:false});
   return {action:'HOLD',releaseReservation:false,source:'qualification_fixture'};
  },
 };
}
// No activation side effects: this returns a rehearsal verdict from explicit synthetic evidence.
export function rehearseCutover(e){
 const required=['syntheticOnly','writerFreezeObserved','inventoryComplete','referencesReconciled','quotaContinuityKnown','finalsPreserved','rollbackRehearsed','qualificationAccepted'];
 const blockers=required.filter(k=>e[k]!==true);
 if(!Number.isSafeInteger(e.pendingReferences)||e.pendingReferences!==0)blockers.push('pendingReferences');
 if(!Number.isSafeInteger(e.unknownReferences)||e.unknownReferences!==0)blockers.push('unknownReferences');
 if(!Array.isArray(e.activeWriters)||e.activeWriters.length!==1||e.activeWriters[0]!=='synthetic_candidate')blockers.push('singleWriter');
 return {verdict:blockers.length?'BLOCKED':'REHEARSAL_READY',blockers,productionActivation:false};
}
