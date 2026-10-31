import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRecordedMethods} from '../apps/api/src/lib/recordedMethods.js';
import {buildEvidentialScope} from '../apps/api/src/lib/evidentialScope.js';
test('mixed institutional history does not become all-email evidence from configuration',()=>{
 const observed=summarizeRecordedMethods([{verification_method:'phone_otp',senales:'sim'},{verification_method:'institutional_email_otp',senales:'email_otp,ip'},{verification_method:null},{verification_method:'__proto__'}]);
 assert.equal(observed.counts.phone_otp,1);assert.equal(observed.counts.institutional_email_otp,1);assert.equal(observed.counts.unknown,2);
 const scope=buildEvidentialScope({scope:'local',dominio_email:'declared.invalid',requiere_censo:true},{total:4,recorded_methods:observed});
 assert.equal(scope.version,2);assert.ok(scope.methods.some(x=>x.key==='methods.recorded_unknown'&&x.params.count===2));
 assert.ok(!scope.demonstrates.some(x=>x.key==='demonstrates.institutional_affiliation'||x.key==='demonstrates.census_vouching'));
 assert.equal(scope.participation_rate,null);
});
test('empty report declares no observed method or IP signal',()=>{const s=buildEvidentialScope({scope:'national',country:'ES'},{recorded_methods:summarizeRecordedMethods([])});assert.deepEqual(s.methods,[]);});
test('national numbering claim is omitted for historical non-phone records',()=>{const s=buildEvidentialScope({scope:'national',country:'ES'},{recorded_methods:summarizeRecordedMethods([{verification_method:'institutional_email_otp'}])});assert.ok(!s.demonstrates.some(x=>x.key==='demonstrates.sim_country'));});

test('reference English renderer handles every version2 key without leaking key placeholders',async()=>{
 const {renderStatementEn}=await import('../apps/api/src/lib/evidentialScope.js');
 const scope=buildEvidentialScope({scope:'global'},{recorded_methods:summarizeRecordedMethods([{verification_method:'phone_otp'},{verification_method:'qr'},{verification_method:'eid'},{verification_method:null,senales:'ip',gps_confirmed:true}])});
 const text=JSON.stringify(renderStatementEn(scope));assert.ok(!text.includes('[methods.'));assert.ok(!text.includes('[not.'));assert.ok(!text.includes('[demonstrates.'));assert.ok(text.includes('Unknown historical method: 1'));
});

test('missing observations fail closed rather than deriving email/SMS from configuration',()=>{const scope=buildEvidentialScope({scope:'national',dominio_email:'declared.invalid',requiere_censo:true,count:100});assert.deepEqual(scope.methods,[]);assert.equal(scope.demonstrates[0].key,'demonstrates.evidence_unavailable');});
test('non-institutional report omits institutional and founder policy notes',()=>{const scope=buildEvidentialScope({scope:'global'},{recorded_methods:summarizeRecordedMethods([{verification_method:'phone_otp'}])});assert.ok(scope.outside_scope.some(x=>x.key==='not.device_credential_scope'));assert.ok(!scope.outside_scope.some(x=>x.key==='not.domain_scope'||x.key==='not.census_scope'||x.key==='not.institutional_expiry_scope'));});
