import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecaptcha } from '../apps/api/src/lib/recaptcha.js';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

const env = { NODE_ENV: 'production', RECAPTCHA_SECRET: 'synthetic-secret' };
const valid = { success: true, hostname: 'voiceprotest.org', action: 'request_otp', score: 0.7 };
function fixture(fetchImpl, timeoutMs = 50) {
  const codes = [], logs = [];
  const reply = Object.fromEntries([['badRequest',400],['serviceUnavailable',503],['internalServerError',500]].map(([name,code]) => [name, () => codes.push(code)]));
  return { codes, logs, run: () => verifyRecaptcha('synthetic-token', 'request_otp', { log: { warn: (...v) => logs.push(v) } }, reply, { fetchImpl, timeoutMs, env }) };
}
test('reCAPTCHA sends secrets in POST body, forbids redirects and checks valid v3 response', async () => {
  let options;
  const f = fixture(async (url, opts) => {
    assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify'); options=opts;
    return new Response(JSON.stringify(valid));
  });
  await f.run(); assert.deepEqual(f.codes, []);
  assert.equal(options.method,'POST'); assert.equal(options.redirect,'error');
  assert.equal(options.body.get('secret'),env.RECAPTCHA_SECRET);
  assert.equal(options.body.get('response'),'synthetic-token');
});
for (const [name, patch] of [
  ['missing hostname',{hostname:undefined}],['wrong hostname',{hostname:'attacker.invalid'}],
  ['missing score',{score:undefined}],['string score',{score:'0.9'}],
  ['NaN score',{score:NaN}],['infinite score',{score:Infinity}],
  ['low score',{score:0.49}],['out-of-range score',{score:1.1}],
  ['wrong action',{action:'create_protest'}],['missing action',{action:undefined}],
  ['truthy success',{success:'true'}],['false success',{success:false}],
  ['provider quota warning',{'error-codes':['Over free quota.']}],
  ['malformed errors',{'error-codes':'error'}],
]) test('reCAPTCHA rejects '+name, async () => {
  const f=fixture(async()=>({ok:true,json:async()=>({...valid,...patch})}));
  await assert.rejects(f.run(),/^Error: recaptcha$/); assert.deepEqual(f.codes,[400]);
  assert.ok(!JSON.stringify(f.logs).includes('synthetic-token'));
  assert.ok(!JSON.stringify(f.logs).includes('attacker.invalid'));
});
test('reCAPTCHA rejects null, arrays and malformed JSON',async()=>{
  for(const body of [null,[],{success:true}]) {
    const f=fixture(async()=>new Response(JSON.stringify(body)));
    await assert.rejects(f.run());assert.deepEqual(f.codes,[400]);
  }
  const f=fixture(async()=>new Response('not json'));
  await assert.rejects(f.run(),/recaptcha_unavailable/);assert.deepEqual(f.codes,[503]);
});
test('reCAPTCHA rejects HTTP failure without exposing provider response',async()=>{
  const f=fixture(async()=>new Response('synthetic-secret',{status:502}));
  await assert.rejects(f.run(),/recaptcha_unavailable/);assert.deepEqual(f.codes,[503]);
  assert.ok(!JSON.stringify(f.logs).includes('synthetic-secret'));
});
test('reCAPTCHA deadline covers stalled headers and stalled response body',async()=>{
  for(const stalledBody of [false,true]){
    let signal;
    const f=fixture(async(_url,opts)=>{
      signal=opts.signal;
      if(!stalledBody)return new Promise(()=>{});
      return {ok:true,json:()=>new Promise(()=>{})};
    },15);
    await assert.rejects(f.run(),/recaptcha_unavailable/);
    assert.equal(signal.aborted,true);assert.deepEqual(f.codes,[503]);
  }
});
test('reCAPTCHA accepts threshold boundary and configured hostname',async()=>{
  const f=fixture(async()=>new Response(JSON.stringify({...valid,hostname:'www.voiceprotest.org',score:0.5,'error-codes':[]})));
  await f.run();assert.deepEqual(f.codes,[]);
});
test('actual HTTP handler stops before protected work on invalid or unavailable CAPTCHA',async()=>{
  for(const [response,status] of [[{...valid,hostname:undefined},400],[null,503],[valid,200]]) {
    const app=Fastify();await app.register(sensible);let protectedCalls=0;
    app.post('/protected',async(req,reply)=>{
      await verifyRecaptcha('synthetic-token','request_otp',req,reply,{env,fetchImpl:async()=>{
        if(response===null)throw new Error('provider failed with synthetic-secret');
        return new Response(JSON.stringify(response));
      }});
      protectedCalls++;return {ok:true};
    });
    try {
      const r=await app.inject({method:'POST',url:'/protected'});
      assert.equal(r.statusCode,status);assert.equal(protectedCalls,status===200?1:0);
      assert.ok(!r.body.includes('synthetic-secret'));
    } finally { await app.close(); }
  }
});
