import test from 'node:test';
import assert from 'node:assert/strict';
import {nextInstitutionalExpiry} from '../apps/api/src/lib/institutionalExpiry.js';
import {institutionalSecret} from '../apps/api/src/lib/institutionalSecret.js';
for(const [now,expected]of[
 ['2026-01-01T00:00:00Z','2026-08-31T00:00:00.000Z'],
 ['2026-08-30T23:59:59.999Z','2026-08-31T00:00:00.000Z'],
 ['2026-08-31T00:00:00Z','2027-08-31T00:00:00.000Z'],
 ['2026-10-29T08:00:00Z','2027-08-31T00:00:00.000Z'],
 ['2026-12-31T23:59:59Z','2027-08-31T00:00:00.000Z'],
 ['2028-02-29T23:00:00Z','2028-08-31T00:00:00.000Z'],
 ['2026-08-30T23:00:00-02:00','2027-08-31T00:00:00.000Z'],
])test('future institutional UTC boundary at '+now,()=>{const n=Date.parse(now),expiry=nextInstitutionalExpiry(n);assert.equal(expiry,expected);assert.ok(Date.parse(expiry)>n);});
test('invalid institutional clock is rejected',()=>assert.throws(()=>nextInstitutionalExpiry(NaN),TypeError));
test('institutional hashes fail closed unless development/test is explicit',()=>{
 const names=['PHONE_HASH_SECRET','EMAIL_OTP_SECRET'],previous=Object.fromEntries(['NODE_ENV',...names].map(n=>[n,process.env[n]]));
 try{
  for(const name of names){delete process.env[name];for(const mode of [undefined,'production','staging','prod','']){if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;assert.throws(()=>institutionalSecret(name),new RegExp(name+' is required'));}
  for(const mode of ['test','development']){process.env.NODE_ENV=mode;assert.equal(institutionalSecret(name),undefined);}
  for(const mode of ['production','staging','test']){process.env.NODE_ENV=mode;process.env[name]='synthetic-existing-key';assert.equal(institutionalSecret(name),'synthetic-existing-key');}delete process.env[name];}
 }finally{for(const[n,v]of Object.entries(previous)){if(v===undefined)delete process.env[n];else process.env[n]=v;}}
});
