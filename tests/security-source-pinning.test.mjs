import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { safeFetch } from '../apps/api/src/lib/sourceCheck.js';
import { pinnedSourceFetch } from '../apps/api/src/lib/pinnedSourceFetch.js';
import { isPublicSourceAddress } from '../apps/api/src/lib/sourceAddressPolicy.js';
import { createServer, request } from 'node:http';

const publicRecords=[{address:'93.184.216.34',family:4}];
function transport(body,headers={'content-type':'text/html'},inspect=()=>{}){
  return (url,options,callback)=>{
    inspect(url,options);const req=new EventEmitter();
    req.end=()=>options.lookup(url.hostname,{all:true},(error,addresses)=>{
      if(error){req.emit('error',error);return;}
      assert.deepEqual(addresses,publicRecords);
      const incoming=Readable.from([Buffer.from(body)]);incoming.headers=headers;incoming.statusCode=200;callback(incoming);
    });
    return req;
  };
}
test('source connects using exactly the validated answer, original Host/SNI, and verified TLS',async()=>{
  let resolutions=0,connections=0;
  const result=await safeFetch('https://news.example.invalid/article',100,500,{
    lookup:async()=>{resolutions++;return resolutions===1?publicRecords:[{address:'127.0.0.1',family:4}];},
    fetchImpl:(url,options)=>pinnedSourceFetch(url,options,transport('safe',undefined,(target,opts)=>{
      connections++;assert.equal(target.hostname,'news.example.invalid');assert.equal(opts.servername,'news.example.invalid');
      assert.equal(opts.agent,false);assert.notEqual(opts.rejectUnauthorized,false);
    })),
  });
  assert.equal(result.ok,true);assert.equal(result.html,'safe');assert.equal(resolutions,1);assert.equal(connections,1);
});
for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.1.2','172.31.0.1','192.168.1.1','192.0.0.1','198.18.0.1','198.51.100.1','203.0.113.1','255.255.255.255','::1','::','::ffff:7f00:1','::ffff:a9fe:a9fe','::ffff:127.0.0.1','64:ff9b::7f00:1','2002:7f00:1::','::127.0.0.1','fe80::1','fec0::1','fc00::1','ff02::1','2001:db8::1','3fff::1']) {
  test('source rejects special address '+address,()=>assert.equal(isPublicSourceAddress(address),false));
}
test('source accepts ordinary public IPv4/IPv6 and rejects invalid or scoped input',()=>{
  for(const address of ['93.184.216.34','8.8.8.8','2606:4700::1111','2001:4860:4860::8888'])assert.equal(isPublicSourceAddress(address),true,address);
  for(const address of ['bad','fe80::1%eth0','127.1','2130706433'])assert.equal(isPublicSourceAddress(address),false,address);
});
test('actual URL parser normalizations and mixed DNS families cannot reach fetch',async()=>{
  for(const url of ['http://127.1/','http://2130706433/','http://[::ffff:127.0.0.1]/','http://[64:ff9b::7f00:1]/']){
    let fetched=false;
    const r=await safeFetch(url,100,500,{lookup:async(host)=>[{address:host.replace(/^\[|\]$/g,''),family:host.includes(':')?6:4}],fetchImpl:async()=>{fetched=true;}});
    assert.equal(r.reason,'private_address');assert.equal(fetched,false);
  }
  const r=await safeFetch('https://example.invalid/',100,500,{lookup:async()=>[...publicRecords,{address:'::ffff:7f00:1',family:6}],fetchImpl(){throw Error('must not fetch');}});
  assert.equal(r.reason,'private_address');
});
test('pinned transport rejects private literal even with unrelated public address metadata',async()=>{
  await assert.rejects(()=>pinnedSourceFetch('http://127.0.0.1/',{addresses:publicRecords},()=>{throw Error('no connection allowed');}),/invalid_source_target/);
});
test('pinned transport decompresses before applying preview byte cap',async()=>{
  const result=await safeFetch('https://example.invalid/',100,5,{lookup:async()=>publicRecords,fetchImpl:(url,opts)=>pinnedSourceFetch(url,opts,transport(gzipSync('abcdefghij'),{'content-type':'text/html','content-encoding':'gzip'}))});
  assert.equal(result.ok,true);assert.equal(result.html,'abcde');
});
test('real loopback transport body closes on the shared deadline',async()=>{
  let closed=false;
  const server=createServer((_req,res)=>{res.on('close',()=>{closed=true;});res.writeHead(200,{'Content-Type':'text/html'});res.write('prefix');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const result=await safeFetch('http://example.invalid/',120,500,{lookup:async()=>publicRecords,fetchImpl:(url,opts)=>pinnedSourceFetch(url,opts,(_u,o,cb)=>request('http://127.0.0.1:'+server.address().port,{...o,lookup:undefined},cb))});
    assert.equal(result.reason,'timeout');await new Promise(r=>setTimeout(r,10));assert.equal(closed,true);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('invalid upstream header rejects the request without escaping the callback',async()=>{
  await assert.rejects(()=>pinnedSourceFetch('https://example.invalid/',{addresses:publicRecords},transport('safe',{'bad\nheader':'value'})),/invalid header name/i);
});
test('source rejects nonstandard ports and URL credentials before connecting',async()=>{
  for(const url of ['https://example.invalid:8443/','http://example.invalid:22/','https://user:password@example.invalid/']){
    let fetched=false;
    const result=await safeFetch(url,100,500,{lookup:async()=>publicRecords,fetchImpl:()=>{fetched=true;}});
    assert.equal(result.ok,false);assert.equal(fetched,false);
  }
});
test('redirects cannot change to a nonstandard public port',async()=>{
  let calls=0;
  const result=await safeFetch('https://example.invalid/',100,500,{lookup:async()=>publicRecords,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://example.invalid:8443/'}});}});
  assert.equal(result.reason,'blocked_port');assert.equal(calls,1);
});
