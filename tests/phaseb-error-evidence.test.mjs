import test from 'node:test';
import assert from 'node:assert/strict';
import { postFailureEvidence, makePhaseBApi, send, requestBody } from '../automation/phaseb/phaseb.mjs';
import { loadPolicy } from '../automation/preflight/preflight.mjs';
test('error evidence is bounded, allowlisted, and omits secrets and URL queries', () => {
 const token='synthetic-secret-value';
 const r=postFailureEvidence({json:{message:'Resource not accessible by integration', documentation_url:'https://docs.github.com/rest/issues/comments?secret=x#create', body:'not copied', errors:['not copied']}, evidence:{request_id:'ABC:123',accepted_permissions:'issues=write; pull_requests=write',rate_limit_remaining:'42',retry_after:'60',authorization:token}}, {GITHUB_TOKEN:token});
 assert.deepEqual(r,{message:'Resource not accessible by integration',documentation_url:'https://docs.github.com/rest/issues/comments',request_id:'ABC:123',accepted_permissions:'issues=write; pull_requests=write',rate_limit_remaining:'42',retry_after:'60'});
 assert.equal(postFailureEvidence({json:{message:token}}, {GITHUB_TOKEN:token}).message,'[REDACTED]');
 assert.equal(postFailureEvidence({json:{message:'x'.repeat(1000)}}).message.length,512);
 assert.equal(postFailureEvidence({json:{message:'a\nb'}}).message,'a b');
 for(const u of ['https://evil.example/error','https://docs.github.com.evil/error','https://user:password@docs.github.com/error','http://docs.github.com/error','invalid']) assert.equal(postFailureEvidence({json:{documentation_url:u}}).documentation_url,null);
 assert.equal(postFailureEvidence({json:{message:{secret:token}}}).message,null);
});
test('API adapter preserves only selected response headers and makes exactly one call', async () => {
 let n=0;
 const api=makePhaseBApi({token:'fixture',fetchImpl:async (_url,options)=>{
  n++; assert.equal(options.method,'POST');
  return {status:403,json:async()=>({message:'Forbidden'}),headers:new Headers({'x-github-request-id':'REQ','x-accepted-github-permissions':'issues=write','x-ratelimit-remaining':'10','retry-after':'60','set-cookie':'never copied','authorization':'never copied'})};
 }});
 const r=await api('POST','/repos/example/repo/issues/1/comments',{body:'fixture'});
 assert.equal(n,1); assert.equal(r.status,403);
 assert.deepEqual(Object.keys(r.evidence).sort(),['accepted_permissions','rate_limit_remaining','request_id','retry_after']);
 assert.equal(r.evidence.request_id,'REQ'); assert.ok(!JSON.stringify(r).includes('never copied'));
 let calls=0;
 const broken=makePhaseBApi({token:'fixture',fetchImpl:async()=>{calls++;throw Error('offline');}});
 await assert.rejects(broken('POST','/fixture',{}));assert.equal(calls,1);
});
test('send retains error evidence without retry, success claims, or extra writes', async () => {
 const policy=loadPolicy(), repository=policy.repository, sha='a'.repeat(40);let posts=0;
 const api=async(method,p)=>{
  if(method==='POST'){posts++;return {status:403,json:{message:'Resource not accessible by integration',documentation_url:'https://docs.github.com/rest/issues/comments'},evidence:{request_id:'REQ',accepted_permissions:'issues=write; pull_requests=write'}};}
  if(/\/pulls\/77$/.test(p))return {status:200,json:{state:'open',merged:false,base:{ref:'main',repo:{full_name:repository}},head:{ref:'phaseb/probe',sha,repo:{full_name:repository}},user:policy.owners[0]}};
  if(p.includes('/files'))return {status:200,json:[{filename:'automation/phaseb-synthetic/probe.txt',status:'added',changes:1}]};
  return {status:200,json:[]};
 };
 const env={GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR_ID:String(policy.owners[0].id),GITHUB_RUN_ID:'123'};
 const r=await send({api,repository,pr:77,expectedSha:sha,env,policy});
 assert.equal(posts,1);assert.equal(r.sent,false);assert.equal(r.state,'not_created');assert.equal(r.status,403);
 assert.equal(r.error_evidence.message,'Resource not accessible by integration');
 assert.equal(r.error_evidence.request_id,'REQ');assert.deepEqual(r.reasons,['post_failed_no_retry']);
 assert.match(requestBody(sha,'123'),/^@codex review/);
});
