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
