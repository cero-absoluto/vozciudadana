import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualifyProviderWindow,createQualificationFixture,createQualificationObserver,rehearseCutover} from '../apps/api/src/funding/providerQualification.js';
const t='2030-06-01T12:00:00Z',later='2030-06-01T12:40:00Z',deadline='2030-06-01T12:10:00Z',far='2031-01-01T00:00:00Z';
const binding=(patch={})=>({reference:'qual_payment',provider:'mollie',method:'ideal',amountCents:1000,currency:'EUR',createdAt:t,localDeadline:deadline,eventDeadline:far,yearDeadline:far,...patch});
const record=(patch={})=>({...binding(),status:'open',mode:'synthetic',observedAt:later,revision:1,...patch});
function observer({b={},r={},now=later}={}){const transport=createQualificationFixture({mode:'isolated',records:[record(r)]});return {transport,observe:createQualificationObserver({mode:'isolated',transport,bindings:[binding(b)],now:()=>now}).observe};}
const window=(patch={})=>({provider:'stripe',method:'checkout',createdAt:t,remoteExpiresAt:'2030-06-01T12:30:00Z',localDeadline:'2030-06-01T12:31:00Z',eventDeadline:far,yearDeadline:far,...patch});
test('Stripe rejects ten minutes and creation delay consuming minimum window',()=>{
 assert.equal(qualifyProviderWindow(window({remoteExpiresAt:deadline})).reason,'provider_minimum');
 assert.equal(qualifyProviderWindow(window({createdAt:'2030-06-01T12:00:01Z'})).reason,'provider_minimum');
});
test('longer Stripe window still needs successful-time mapping; excess24h rejected',()=>{
 assert.equal(qualifyProviderWindow(window()).reason,'successful_time_mapping_unproven');
 assert.equal(qualifyProviderWindow(window({remoteExpiresAt:'2030-06-02T12:00:01Z'})).reason,'provider_maximum');
});
test('remote window must fit all three local, event and year boundaries',()=>{
 for(const key of ['localDeadline','eventDeadline','yearDeadline'])assert.equal(qualifyProviderWindow(window({[key]:deadline})).reason,'remote_window_crosses_boundary');
});
test('Mollie descriptive method expiry never becomes an enforced deadline',()=>{
 for(const method of ['ideal','creditcard','paypal'])assert.equal(qualifyProviderWindow(window({provider:'mollie',method})).reason,'enforceable_expiry_unproven');
 assert.equal(qualifyProviderWindow(window({provider:'mollie',method:'multimethod'})).reason,'unknown_method');
});
test('malformed windows and unknown profiles fail closed',()=>{
 for(const patch of [{createdAt:'invalid'},{localDeadline:null},{remoteExpiresAt:t},{method:'unknown'}])assert.equal(qualifyProviderWindow(window(patch)).verdict,'NOT_QUALIFIED');
});
test('raw caller transport and production mode cannot compose',()=>{
 assert.throws(()=>createQualificationObserver({mode:'isolated',transport:{retrieve:()=>record()},bindings:[],now:()=>later}),/closed_fixture_required/);
 assert.throws(()=>createQualificationFixture({mode:'production',records:[]}),/isolated_only/);
});
test('unknown reference or URL never triggers a provider query',async()=>{
 const {transport,observe}=observer();for(const id of ['unknown','https://example.invalid','qual_unbound'])assert.equal((await observe(id)).action,'REVIEW');assert.equal(transport.stats().queries,0);
});
test('local expiry, pending, authorization and cancellation request all retain reservation',async()=>{
 for(const status of ['open','pending','authorized','processing','cancel_requested']){const {observe}=observer({r:{status}});assert.deepEqual(await observe('qual_payment'),{action:'HOLD',releaseReservation:false,source:'qualification_fixture'});}
});
test('cancel422/timeout leaves remote payment open or unknown and never releases',async()=>{
 const {transport,observe}=observer();transport.set('qual_payment',{status:'open',cancelResult:422});assert.equal((await observe('qual_payment')).releaseReservation,false);
 transport.set('qual_payment',{queryFailure:true});assert.equal((await observe('qual_payment')).reason,'query_unavailable');
});
test('only retrieved definitive no-payment status allows fixture release',async()=>{
 for(const status of ['canceled','expired','failed']){const {observe}=observer({r:{status}});assert.equal((await observe('qual_payment')).action,'TERMINAL_NO_PAYMENT_FIXTURE');assert.equal((await observe('qual_payment')).releaseReservation,true);}
});
test('stale and future observations cannot release even with canceled status',async()=>{
 for(const observedAt of [t,'2030-06-01T12:41:00Z',null]){const {observe}=observer({r:{status:'canceled',observedAt}});assert.equal((await observe('qual_payment')).reason,'stale_observation');}
});
test('binding amount, currency, mode and method are checked after retrieval',async()=>{
 for(const r of [{amountCents:999},{currency:'USD'},{mode:'live'},{method:'paypal'},{createdAt:deadline}])assert.equal((await observer({r}).observe('qual_payment')).reason,'binding_mismatch');
});
test('successful Mollie fixture takes paidAt and discards created, receipt time and PII',async()=>{
 const {observe}=observer({r:{status:'paid',paidAt:'2030-06-01T12:05:00Z',eventCreated:1,phone:'+31600000000',customer:{name:'discard'}}});
 const out=await observe('qual_payment');assert.equal(out.action,'EVIDENCED_SUCCESS_FIXTURE');assert.equal(out.successfulAt,'2030-06-01T12:05:00.000Z');assert.ok(!JSON.stringify(out).includes('discard'));assert.ok(!JSON.stringify(out).includes('+316'));assert.equal(out.releaseReservation,false);
});
test('Stripe success cannot invent a successful timestamp from payment creation',async()=>{
 const {observe}=observer({b:{provider:'stripe',method:'checkout'},r:{provider:'stripe',method:'checkout',status:'succeeded',paidAt:t}});assert.equal((await observe('qual_payment')).reason,'successful_time_mapping_unproven');
});
test('missing, earlier or future successful instant goes to review',async()=>{
 for(const paidAt of [null,'2030-06-01T11:59:59Z','2030-06-01T12:41:00Z'])assert.equal((await observer({r:{status:'paid',paidAt}}).observe('qual_payment')).reason,'invalid_successful_time');
});
test('late payment and closed event never authorize final-record mutation',async()=>{
 for(const data of [{r:{status:'paid',paidAt:deadline}},{b:{eventClosed:true},r:{status:'paid',paidAt:'2030-06-01T12:05:00Z'}},{b:{yearDeadline:'2030-06-01T12:04:00Z'},r:{status:'paid',paidAt:'2030-06-01T12:05:00Z'}}])assert.equal((await observer(data).observe('qual_payment')).reason,'late_or_closed_payment');
});
test('duplicate/concurrent notifications give one consistent assessment without financial effects',async()=>{
 const {observe}=observer({r:{status:'paid',paidAt:'2030-06-01T12:05:00Z'}});const results=await Promise.all(Array.from({length:20},()=>observe('qual_payment')));assert.ok(results.every(r=>r.action==='EVIDENCED_SUCCESS_FIXTURE'));assert.ok(results.every(r=>!r.releaseReservation));
});
test('out-of-order revisions, same-revision changes and terminal reversal require review',async()=>{
 const {transport,observe}=observer();await observe('qual_payment');transport.set('qual_payment',{status:'pending'});assert.equal((await observe('qual_payment')).reason,'contradictory_observation');
 transport.set('qual_payment',{revision:2,status:'canceled'});assert.equal((await observe('qual_payment')).releaseReservation,true);
 transport.set('qual_payment',{revision:3,status:'paid',paidAt:'2030-06-01T12:05:00Z'});assert.equal((await observe('qual_payment')).reason,'terminal_changed');
 transport.set('qual_payment',{revision:1,status:'open'});assert.equal((await observe('qual_payment')).reason,'contradictory_observation');
});
test('multimethod attempt-canceled is not payment-canceled; unknown status holds for review',async()=>{
 const {observe}=observer({r:{status:'open',attemptStatus:'canceled'}});assert.equal((await observe('qual_payment')).action,'HOLD');
 assert.equal((await observer({r:{status:'attempt_canceled'}}).observe('qual_payment')).action,'REVIEW');
});
const ready={syntheticOnly:true,writerFreezeObserved:true,inventoryComplete:true,referencesReconciled:true,quotaContinuityKnown:true,finalsPreserved:true,rollbackRehearsed:true,qualificationAccepted:true,pendingReferences:0,unknownReferences:0,activeWriters:['synthetic_candidate']};
test('cutover rehearsal blocks missing evidence, pending/unknown references and competing writers',()=>{
 for(const k of ['syntheticOnly','writerFreezeObserved','inventoryComplete','referencesReconciled','quotaContinuityKnown','finalsPreserved','rollbackRehearsed','qualificationAccepted'])assert.equal(rehearseCutover({...ready,[k]:false}).verdict,'BLOCKED');
 for(const patch of [{pendingReferences:1},{unknownReferences:1},{activeWriters:['legacy','synthetic_candidate']},{pendingReferences:null}])assert.equal(rehearseCutover({...ready,...patch}).verdict,'BLOCKED');
 assert.equal(rehearseCutover(ready).verdict,'REHEARSAL_READY');assert.equal(rehearseCutover(ready).productionActivation,false);
});
