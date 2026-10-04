import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPayPalQualificationFixture,createPayPalQualificationContract} from '../apps/api/src/funding/paypalQualification.js';
const created='2030-12-31T22:50:00Z',now='2030-12-31T22:55:00Z',deadline='2030-12-31T23:00:00Z'; // Amsterdam year boundary.
const binding={orderRef:'pp_fixture_order',intentRef:'pp_fixture_intent',receiverRef:'pp_fixture_receiver',amountCents:1000,currency:'EUR',createdAt:created,localDeadline:deadline,eventDeadline:deadline,yearDeadline:deadline};
const record={...binding,mode:'synthetic',revision:1,observedAt:now,orderStatus:'APPROVED',captureStatus:null};
const request={orderRef:binding.orderRef,operationRef:'pp_fixture_operation',verifiedSession:true,reservationBound:true};
function fixture({b={},r={},clock=now}={}){const transport=createPayPalQualificationFixture({mode:'isolated',records:[{...record,...r}]});return {transport,contract:createPayPalQualificationContract({mode:'isolated',transport,bindings:[{...binding,...b}],now:()=>clock})};}
test('closed fixture and isolated mode required; caller eligibility cannot qualify provider',()=>{
 assert.throws(()=>createPayPalQualificationFixture({mode:'production',records:[]}),/isolated_only/);
 assert.throws(()=>createPayPalQualificationContract({mode:'isolated',transport:{retrieve(){}},bindings:[],now:()=>now}),/closed_fixture_required/);
 assert.equal(fixture().contract.qualification({accountEligible:true,timeMappingProven:true}).verdict,'NOT_QUALIFIED');
});
test('unknown order and URL never cause retrieval or capture assessment',async()=>{
 const {transport,contract}=fixture();for(const orderRef of ['unknown','https://example.invalid']){assert.equal((await contract.observe(orderRef)).reason,'unknown_reference');assert.equal(contract.requestCapture({...request,orderRef}).reason,'unknown_reference');}assert.equal(transport.stats().reads,0);
});
test('capture assessment needs financing OTP and bound quota before any request',()=>{
 for(const patch of [{verifiedSession:false},{reservationBound:false}])assert.equal(fixture().contract.requestCapture({...request,...patch}).reason,'financing_authority_required');
});
test('local, event, year and closed-event boundaries stop new capture assessments',()=>{
 for(const key of ['localDeadline','eventDeadline','yearDeadline'])assert.equal(fixture({b:{[key]:now}}).contract.requestCapture(request).reason,'capture_window_closed');
 assert.equal(fixture({b:{eventClosed:true}}).contract.requestCapture(request).reason,'capture_window_closed');
});
test('concurrent capture assessments bind once; new operation cannot duplicate capture',async()=>{
 const {contract}=fixture();const results=await Promise.all(Array.from({length:20},()=>Promise.resolve(contract.requestCapture(request))));assert.ok(results.every(r=>r.action==='CAPTURE_REQUEST_FIXTURE'));
 assert.equal(contract.requestCapture({...request,operationRef:'pp_fixture_another'}).reason,'capture_operation_already_bound');assert.ok(results.every(r=>!r.productionActivation&&!r.releaseReservation));
});
test('amount, currency, intent, receiver and mode mismatches retain hold',async()=>{
 for(const r of [{amountCents:999},{currency:'USD'},{intentRef:'pp_fixture_other'},{receiverRef:'pp_fixture_other'},{mode:'live'}])assert.equal((await fixture({r}).contract.observe(binding.orderRef)).reason,'binding_mismatch');
});
test('approval, pending, failed attempt, unknown outcome and voided order never release quota',async()=>{
 for(const r of [{captureStatus:null},{captureStatus:'PENDING'},{captureStatus:'UNKNOWN'},{captureStatus:'FAILED'},{captureStatus:'DECLINED'},{orderStatus:'VOIDED'}]){const out=await fixture({r}).contract.observe(binding.orderRef);assert.equal(out.action,'HOLD');assert.equal(out.releaseReservation,false);}
});
test('lost capture response or retrieval failure retains hold',async()=>{
 const {contract}=fixture({r:{queryFailure:true}});contract.requestCapture(request);assert.equal((await contract.observe(binding.orderRef)).reason,'query_unavailable');
});
test('capture create_time/update_time/receipt date never become successful payment date',async()=>{
 const {contract}=fixture({r:{captureStatus:'COMPLETED',captureRef:'pp_fixture_capture',create_time:now,update_time:now,webhookTime:now}});contract.requestCapture(request);assert.equal((await contract.observe(binding.orderRef)).reason,'successful_time_mapping_unproven');
});
test('synthetic success requires bound request; duplicate notification assessment excludes PII',async()=>{
 const {contract}=fixture({r:{captureStatus:'COMPLETED',captureRef:'pp_fixture_capture',effectiveSuccessfulAt:now,payer:{name:'discard',email:'discard'},phone:'discard'}});
 assert.equal((await contract.observe(binding.orderRef)).reason,'capture_request_unbound');contract.requestCapture(request);
 const results=await Promise.all(Array.from({length:20},()=>contract.observe(binding.orderRef)));assert.ok(results.every(r=>r.action==='EVIDENCED_SUCCESS_FIXTURE'));assert.ok(!JSON.stringify(results).includes('discard'));assert.ok(results.every(r=>!r.releaseReservation));
});
test('pending-to-completed at boundary or after event closes requires review',async()=>{
 for(const b of [{},{eventClosed:true}]){const {contract}=fixture({b,r:{captureStatus:'COMPLETED',captureRef:'pp_fixture_capture',effectiveSuccessfulAt:deadline,observedAt:deadline},clock:deadline});assert.equal((await contract.observe(binding.orderRef)).reason,'late_or_closed_capture');}
});
test('reordered/same-revision changes and final reversal are reviewed without quota restoration',async()=>{
 const {transport,contract}=fixture();contract.requestCapture(request);await contract.observe(binding.orderRef);
 transport.set(binding.orderRef,{captureStatus:'PENDING'});assert.equal((await contract.observe(binding.orderRef)).reason,'contradictory_observation');
 transport.set(binding.orderRef,{revision:2,captureStatus:'COMPLETED',captureRef:'pp_fixture_capture',effectiveSuccessfulAt:now});assert.equal((await contract.observe(binding.orderRef)).action,'EVIDENCED_SUCCESS_FIXTURE');
 transport.set(binding.orderRef,{revision:1,captureStatus:'PENDING'});assert.equal((await contract.observe(binding.orderRef)).reason,'contradictory_observation');
 transport.set(binding.orderRef,{revision:3,captureStatus:'REFUNDED'});assert.equal((await contract.observe(binding.orderRef)).reason,'terminal_changed');
});
test('stale/future observations and refund facts cannot confirm or release',async()=>{
 for(const r of [{observedAt:created},{observedAt:deadline},{captureStatus:'REFUNDED'},{captureStatus:'PARTIALLY_REFUNDED'}]){const out=await fixture({r}).contract.observe(binding.orderRef);assert.equal(out.action,'REVIEW');assert.equal(out.releaseReservation,false);}
});
test('binding snapshot is copied and capture request output cannot mutate replay',()=>{
 const b={...binding};const transport=createPayPalQualificationFixture({mode:'isolated',records:[record]});const contract=createPayPalQualificationContract({mode:'isolated',transport,bindings:[b],now:()=>now});b.receiverRef='pp_fixture_changed';const first=contract.requestCapture(request);first.action='forged';assert.equal(contract.requestCapture(request).action,'CAPTURE_REQUEST_FIXTURE');
});
test('one operation reference cannot be rebound to another order',()=>{
 const second={...binding,orderRef:'pp_fixture_second',intentRef:'pp_fixture_second_intent'};
 const transport=createPayPalQualificationFixture({mode:'isolated',records:[record,{...record,...second}]});
 const contract=createPayPalQualificationContract({mode:'isolated',transport,bindings:[binding,second],now:()=>now});contract.requestCapture(request);
 assert.equal(contract.requestCapture({...request,orderRef:second.orderRef}).reason,'idempotency_conflict');
});
test('malformed revision, capture reference and successful time fail closed',async()=>{
 for(const r of [{revision:0},{captureStatus:'COMPLETED',captureRef:null},{captureStatus:'COMPLETED',captureRef:'pp_fixture_capture',effectiveSuccessfulAt:'2030-12-31T22:49:00Z'},{captureStatus:'UNRECOGNIZED'}]){const {contract}=fixture({r});contract.requestCapture(request);assert.equal((await contract.observe(binding.orderRef)).action,'REVIEW');}
});
test('pending capture later completing across year retains hold for review',async()=>{
 let clock=now;const transport=createPayPalQualificationFixture({mode:'isolated',records:[{...record,captureStatus:'PENDING'}]});
 const contract=createPayPalQualificationContract({mode:'isolated',transport,bindings:[binding],now:()=>clock});contract.requestCapture(request);assert.equal((await contract.observe(binding.orderRef)).action,'HOLD');
 clock='2030-12-31T23:01:00Z';transport.set(binding.orderRef,{revision:2,observedAt:clock,captureStatus:'COMPLETED',captureRef:'pp_fixture_capture',effectiveSuccessfulAt:clock,create_time:now});
 const out=await contract.observe(binding.orderRef);assert.equal(out.reason,'late_or_closed_capture');assert.equal(out.releaseReservation,false);
});
