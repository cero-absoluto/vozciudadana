import test from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch } from '../apps/api/src/lib/sourceCheck.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolveSourceAddresses } from '../apps/api/src/lib/sourceDns.js';
import { wikidataDomainLookup } from '../apps/api/src/lib/sourceCheck.js';
const lookup=async()=>[{address:'93.184.216.34',family:4}];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});

test('source fetch preserves successful text and metadata',async()=>{
  const r=await safeFetch('https://example.invalid/',100,500,{lookup,fetchImpl:async()=>html('<title>Valid</title>')});
  assert.equal(r.ok,true);assert.equal(r.html,'<title>Valid</title>');assert.equal(r.finalUrl,'https://example.invalid/');
});
test('source deadline bounds a stuck DNS lookup before any fetch',async()=>{
  let calls=0;
  const r=await safeFetch('https://example.invalid/',15,500,{lookup:()=>new Promise(()=>{}),fetchImpl:()=>{calls++;}});
  assert.equal(r.reason,'timeout');assert.equal(calls,0);
});
test('source deadline aborts stalled headers',async()=>{
  let signal;
  const r=await safeFetch('https://example.invalid/',15,500,{lookup,fetchImpl:(_u,o)=>{signal=o.signal;return new Promise(()=>{});}});
  assert.equal(r.reason,'timeout');assert.equal(signal.aborted,true);
});
test('source deadline remains active after headers and cancels stalled body',async()=>{
  let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<html>'));},cancel(){cancelled=true;}});
  const r=await safeFetch('https://example.invalid/',15,500,{lookup,fetchImpl:async()=>html(body)});
  assert.equal(r.reason,'timeout');assert.equal(cancelled,true);
});
test('redirects share one DNS/header/body budget rather than resetting it',async()=>{
  let calls=0;
  const r=await safeFetch('https://example.invalid/',60,500,{
    lookup:async()=>{await sleep(25);return lookup();},
    fetchImpl:async()=>{calls++;await sleep(25);return new Response(null,{status:302,headers:{location:'/next'}});},
  });
  assert.equal(r.reason,'timeout');assert.equal(calls,1);
});
test('source redirect bodies are released and new targets are checked',async()=>{
  let cancelled=false, calls=0;
  const r=await safeFetch('https://example.invalid/',100,500,{lookup:async(host)=>host==='internal.invalid'?[{address:'127.0.0.1',family:4}]:lookup(),fetchImpl:async()=>{
    calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{location:'http://internal.invalid/'}});
  }});
  assert.equal(r.reason,'private_address');assert.equal(calls,1);assert.equal(cancelled,true);
});
test('source byte limit preserves a bounded prefix and cancels excess',async()=>{
  let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('abcdefghij'));},cancel(){cancelled=true;}});
  const r=await safeFetch('https://example.invalid/',100,5,{lookup,fetchImpl:async()=>html(body)});
  assert.equal(r.ok,true);assert.equal(r.html,'abcde');assert.equal(cancelled,true);
});
test('source body read errors become controlled failures',async()=>{
  const r=await safeFetch('https://example.invalid/',100,500,{lookup,fetchImpl:async()=>html(new ReadableStream({start(c){c.error(new Error('private detail'));}}))});
  assert.deepEqual(r,{ok:false,reason:'fetch_error'});
});
test('source rejects invalid schemes and excessive redirects without network',async()=>{
  let calls=0;
  const options={lookup,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'/again'}});}};
  assert.equal((await safeFetch('file:///etc/passwd',100,500,options)).reason,'blocked_scheme');assert.equal(calls,0);
  assert.equal((await safeFetch('https://example.invalid/',100,500,options)).reason,'too_many_redirects');assert.equal(calls,4);
});
test('source keeps paywall semantics and cancels rejected content',async()=>{
  const r=await safeFetch('https://example.invalid/',100,500,{lookup,fetchImpl:async()=>new Response('summary',{status:403,headers:{'content-type':'text/html'}})});
  assert.equal(r.ok,true);assert.equal(r.paywallLike,true);
  let cancelled=false;
  const rejected=await safeFetch('https://example.invalid/',100,500,{lookup,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'image/png'}})});
  assert.equal(rejected.reason,'non_html');assert.equal(cancelled,true);
});
test('real loopback HTTP body is aborted after headers without external requests',async()=>{
  const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.write('<html>');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    const r=await safeFetch('https://example.invalid/',120,500,{lookup,fetchImpl:(_url,options)=>fetch(origin,options)});
    assert.equal(r.reason,'timeout');
  } finally { server.closeAllConnections();await new Promise(r=>server.close(r)); }
});
test('source deadline cancels both real resolver operations through its isolated resolver',async()=>{
  const pending=[];let cancelled=0,fetches=0;
  const resolver={resolve4:()=>new Promise((_,reject)=>pending.push(reject)),resolve6:()=>new Promise((_,reject)=>pending.push(reject)),cancel(){cancelled++;for(const reject of pending)reject(Object.assign(new Error(),{code:'ECANCELLED'}));}};
  const r=await safeFetch('https://example.invalid/',15,500,{lookup:(host,opts)=>resolveSourceAddresses(host,{...opts,resolverFactory:()=>resolver}),fetchImpl:()=>{fetches++;}});
  assert.equal(r.reason,'timeout');assert.ok(cancelled>=1);assert.equal(fetches,0);
});
test('resolver accepts absent IPv6 but rejects an unchecked failing family',async()=>{
  for(const code of ['ENODATA','ETIMEOUT']){
    const resolver={resolve4:async()=>['93.184.216.34'],resolve6:async()=>{throw Object.assign(new Error(),{code});},cancel(){}};
    const run=()=>resolveSourceAddresses('example.invalid',{resolverFactory:()=>resolver});
    if(code==='ENODATA')assert.deepEqual(await run(),[{address:'93.184.216.34',family:4}]);
    else await assert.rejects(run(),/dns_error/);
  }
});
test('private IPv6 literals stay blocked after full address-policy validation',async()=>{
  for(const literal of ['[::1]','[::ffff:7f00:1]','[::ffff:a9fe:a9fe]']) {
    assert.equal((await resolveSourceAddresses(literal,{resolverFactory(){throw Error('no DNS expected');}})).length,1);
    let fetched=false;
    const result=await safeFetch('http://'+literal+'/',100,500,{fetchImpl:async()=>{fetched=true;}});
    assert.equal(result.ok,false);assert.equal(fetched,false);
  }
  assert.deepEqual(await resolveSourceAddresses('93.184.216.34'),[{address:'93.184.216.34',family:4}]);
  assert.equal(await wikidataDomainLookup('a"b.com'),null);
});
