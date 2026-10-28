import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createCipheriv} from 'node:crypto';
import {signParticipationToken,verifyParticipationToken,PARTICIPATION_TOKEN_TTL_MS,generateDeviceSecret,deviceSecretMatches} from '../apps/api/src/lib/participationToken.js';
import {issueCensusSession,verifyCensusSession,CENSUS_SESSION_TTL_MS} from '../apps/api/src/lib/censusSession.js';
import {credentialMatches} from '../apps/api/src/lib/credentialMatches.js';
process.env.PARTICIPATION_TOKEN_SECRET='synthetic-token-signing-key';process.env.DEVICE_SECRET_PEPPER='synthetic-device-pepper';
const now=1800000000000,identity={device_id:'synthetic-device',phone_hash:'a'.repeat(64),purpose:'join_protest'},pid='11111111-1111-4111-8111-111111111111';
const claims={...identity,iat:now,exp:now+PARTICIPATION_TOKEN_TTL_MS};
const seal=(value)=>{const b=Buffer.from(JSON.stringify(value)).toString('base64url');return b+'.'+createHmac('sha256',process.env.PARTICIPATION_TOKEN_SECRET).update(b).digest('base64url');};
test('current and legacy participation tokens retain the wire format, purpose, claims and signed expiry',()=>{
 const token=signParticipationToken(identity,now);assert.deepEqual(verifyParticipationToken(token,{expectedPurpose:'join_protest',now}),claims);
 assert.deepEqual(verifyParticipationToken(seal({...claims,exp:claims.exp+1}),{now}),{...claims,exp:claims.exp+1});
 assert.ok(verifyParticipationToken(seal({...claims,exp:claims.exp+1000}),{now}));assert.equal(verifyParticipationToken(seal({...claims,exp:claims.exp+1001}),{now}),null);
 assert.equal(verifyParticipationToken(token,{now:claims.exp}),null);assert.ok(verifyParticipationToken(token,{now:claims.exp-1}));assert.equal(verifyParticipationToken(token,{expectedPurpose:'census_management',now}),null);
});
test('extra segments, noncanonical encoding, wrong signature and excessive size are rejected',()=>{
 const token=seal(claims),[body,sig]=token.split('.');for(const value of [null,{},[],0,'',token+'.extra',token+'.',body+'=.'+sig,body+'.'+sig+'=',body+'.'+sig.slice(1),body+'.'+sig.slice(0,-1)+'!', 'a'.repeat(2049),'.'+sig,body+'.'])assert.equal(verifyParticipationToken(value,{now}),null);
 const tampered=Buffer.from(JSON.stringify({...claims,device_id:'attacker-device'})).toString('base64url')+'.'+sig;assert.equal(verifyParticipationToken(tampered,{now}),null);
});
const malformed=[null,[],{}, {...claims,device_id:[]},{...claims,device_id:''},{...claims,device_id:'a'.repeat(129)},{...claims,phone_hash:[identity.phone_hash]},{...claims,phone_hash:'A'.repeat(64)},{...claims,purpose:'other'},{...claims,iat:now+1},{...claims,iat:1.5},{...claims,iat:-1},{...claims,exp:String(claims.exp)},{...claims,exp:now},{...claims,exp:claims.exp-1},{...claims,extra:'role'},{...claims,iat:undefined}];
for(const [index,payload] of malformed.entries())test('valid HMAC cannot authorize malformed claims '+index,()=>assert.equal(verifyParticipationToken(seal(payload),{now}),null));
test('signer refuses malformed identities and unsafe clocks; verification rejects unsafe clocks',()=>{
 for(const value of [{...identity,purpose:undefined},{...identity,device_id:[]},{...identity,phone_hash:123}])assert.throws(()=>signParticipationToken(value,now),TypeError);
 for(const clock of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER,1.5])assert.throws(()=>signParticipationToken(identity,clock),TypeError);
 for(const clock of [-1,NaN,Infinity,1.5])assert.equal(verifyParticipationToken(seal(claims),{now:clock}),null);
});
test('generated device credentials authenticate and malformed proofs/hashes fail without throwing',()=>{
 const {secret,hash}=generateDeviceSecret();assert.equal(deviceSecretMatches(secret,hash),true);
 for(const value of [null,{},[],Buffer.from(secret),0,'',secret+'0',secret.toUpperCase()])assert.equal(deviceSecretMatches(value,hash),false);
 for(const value of [null,{},[],Buffer.from(hash),'',hash+'0',hash.toUpperCase()])assert.equal(deviceSecretMatches(secret,value),false);
 assert.equal(deviceSecretMatches('0'.repeat(64),hash),false);
});
function censusSeal(payload){const key=createHmac('sha256',process.env.PARTICIPATION_TOKEN_SECRET).update('VoiceProtest:census-management:aes256gcm:v1').digest(),iv=Buffer.alloc(12,1),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('census_management:v1'));const ct=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final()]);return ['v1',iv.toString('base64url'),ct.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');}
test('census session format and TTL remain unchanged and purposes cannot cross',()=>{
 const token=issueCensusSession({emailHash:identity.phone_hash,protestId:pid,emailHint:'a***@example.invalid'},now);assert.equal(verifyCensusSession(token,pid,now).expiresAt,now+CENSUS_SESSION_TTL_MS);assert.equal(verifyCensusSession(token+'.extra',pid,now),null);assert.equal(verifyCensusSession(token,pid,now+CENSUS_SESSION_TTL_MS),null);assert.equal(verifyParticipationToken(token,{now}),null);assert.equal(verifyCensusSession(seal(claims),pid,now),null);
});
test('authenticated census payloads still require exact types, purpose, fields, time and bounded hints',()=>{
 const base={purpose:'census_management',emailHash:identity.phone_hash,protestId:pid,iat:now,exp:now+CENSUS_SESSION_TTL_MS};
 for(const payload of [null,[],{...base,emailHash:[base.emailHash]},{...base,purpose:'join_protest'},{...base,role:'owner'},{...base,emailHint:'a***@'+'x'.repeat(253)},{...base,exp:base.exp+1}])assert.equal(verifyCensusSession(censusSeal(payload),pid,now),null);
 assert.throws(()=>issueCensusSession({emailHash:[identity.phone_hash],protestId:pid},now),TypeError);assert.throws(()=>issueCensusSession({emailHash:identity.phone_hash,protestId:pid},Number.MAX_SAFE_INTEGER),TypeError);
});
test('bounded credential digest comparison rejects missing/malformed values and never coerces types',()=>{
 assert.equal(credentialMatches('synthetic-secret','synthetic-secret'),true);assert.equal(credentialMatches('synthetic-secret','other-secret'),false);
 for(const value of [undefined,null,{},[],42,'','a'.repeat(4097)]){assert.equal(credentialMatches(value,'synthetic-secret'),false);assert.equal(credentialMatches('synthetic-secret',value),false);}assert.equal(credentialMatches('a'.repeat(4096),'a'.repeat(4096)),true);
});

test('legacy nonempty short device IDs retain signed participation without widening new registration schemas',()=>{
 const old={...identity,device_id:'legacy'};assert.equal(verifyParticipationToken(signParticipationToken(old,now),{now}).device_id,'legacy');
});
test('maximum-length masked email hint remains bounded and round-trips without truncating its domain',()=>{
 const domain=['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(60)].join('.');assert.equal(('a@'+domain).length,254);const hint='a***@'+domain;assert.equal(hint.length,257);const token=issueCensusSession({emailHash:identity.phone_hash,protestId:pid,emailHint:hint},now);assert.equal(verifyCensusSession(token,pid,now).emailHint,hint);assert.throws(()=>issueCensusSession({emailHash:identity.phone_hash,protestId:pid,emailHint:hint+'x'},now),TypeError);
});
test('missing secrets fail closed outside explicit development/test, for signing, verification and device hashing',()=>{
 const previous={mode:process.env.NODE_ENV,token:process.env.PARTICIPATION_TOKEN_SECRET,pepper:process.env.DEVICE_SECRET_PEPPER};const valid=seal(claims);
 try{delete process.env.PARTICIPATION_TOKEN_SECRET;delete process.env.DEVICE_SECRET_PEPPER;
 for(const mode of [undefined,'prod','staging','production']){if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;assert.throws(()=>signParticipationToken(identity,now),/required/);assert.throws(()=>verifyParticipationToken(valid,{now}),/required/);assert.throws(()=>generateDeviceSecret(),/required/);}
 for(const mode of ['test','development']){process.env.NODE_ENV=mode;const token=signParticipationToken(identity,now);assert.ok(verifyParticipationToken(token,{now}));}
 }finally{if(previous.mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous.mode;process.env.PARTICIPATION_TOKEN_SECRET=previous.token;process.env.DEVICE_SECRET_PEPPER=previous.pepper;}
});
