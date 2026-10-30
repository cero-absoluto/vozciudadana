import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {contentSecurityPolicy,browserProtectionPlugin} from '../automation/security-browser/csp.mjs';
import {checkHealth,hasBrowserPolicy} from '../automation/security-browser/health-check.mjs';
const html=readFileSync('apps/web/index.html','utf8');
const protectedHtml=()=>browserProtectionPlugin({apiUrl:'https://api.voiceprotest.org'}).transformIndexHtml.handler(html);
test('CSP has explicit script origins, no script eval/inline, and exact JSON-LD hash',()=>{
 const csp=contentSecurityPolicy(html),code=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
 assert.ok(csp.includes("'sha256-"+createHash('sha256').update(code).digest('base64')+"'"));assert.ok(!/unsafe-eval|script-src [^;]*unsafe-inline/.test(csp));assert.ok(hasBrowserPolicy(protectedHtml()));
 assert.ok(protectedHtml().indexOf('Content-Security-Policy')<protectedHtml().indexOf('recaptcha/api.js'));
});
test('unreviewed API origin, inline script, missing charset and duplicate CSP fail build',()=>{
 for(const apiUrl of ['https://evil.invalid','https://key@api.voiceprotest.org','https://api.voiceprotest.org/?token=synthetic'])assert.throws(()=>contentSecurityPolicy(html,{apiUrl}));
 assert.throws(()=>contentSecurityPolicy(html+'<script>alert(1)</script>'));assert.throws(()=>browserProtectionPlugin({apiUrl:'https://api.voiceprotest.org'}).transformIndexHtml.handler(html.replace('<meta charset="UTF-8">','')));assert.throws(()=>browserProtectionPlugin({apiUrl:'https://api.voiceprotest.org'}).transformIndexHtml.handler(protectedHtml()));
});
function worker({cached,cacheControl='',networkError=false}={}){
 const handlers={},puts=[],deleted=[],opened=[],notifications=[],fetchCalls=[];let globalReads=0;
 const context={URL,Response,self:{location:{origin:'https://app.example'},addEventListener:(k,v)=>handlers[k]=v,skipWaiting(){},clients:{claim(){}},registration:{showNotification:async(...args)=>notifications.push(args)}},clients:{openWindow:async url=>opened.push(url)},caches:{keys:async()=>['vozciudadana-v5','vozciudadana-v6','another-app-cache'],delete:async k=>deleted.push(k),match:async()=>{globalReads++;return cached;},open:async()=>({match:async()=>cached,put:async(...x)=>puts.push(x),addAll:async()=>{}})},fetch:async(url,options)=>{fetchCalls.push({url,options});if(networkError)throw Error('synthetic');return new Response('public',{headers:{'cache-control':cacheControl}});}};
 vm.createContext(context);vm.runInContext(readFileSync('apps/web/public/service-worker.js','utf8'),context);
 return{handlers,puts,deleted,opened,notifications,fetchCalls,get globalReads(){return globalReads;},async request(url,options={}){let response;const pending=[];handlers.fetch({request:{method:'GET',url,headers:new Headers(),...options},respondWith:p=>response=Promise.resolve(p),waitUntil:p=>pending.push(p)});await response;await Promise.allSettled(pending);return !!response;}};
}
for(const url of ['https://app.example.evil/assets/x.js','https://app.example/api/users','https://app.example/?token=synthetic','https://app.example/fonts/pdf-sans-subset.ttf?r=1'])test('worker bypasses nonpublic request '+url,async()=>assert.equal(await worker().request(url),false));
for(const cache of ['reload','no-store'])test('worker respects explicit '+cache,async()=>assert.equal(await worker().request('https://app.example/assets/x.js',{cache}),false));
test('worker never stores private/no-store responses or authenticated requests',async()=>{for(const cacheControl of ['private','no-store']){const w=worker({cacheControl});assert.equal(await w.request('https://app.example/assets/x.js'),true);assert.equal(w.puts.length,0);}assert.equal(await worker().request('https://app.example/assets/x.js',{headers:new Headers({Authorization:'synthetic'})}),false);});
test('activation deletes only this application old caches',async()=>{const w=worker();let p;w.handlers.activate({waitUntil:x=>p=x});await p;assert.deepEqual(w.deleted,['vozciudadana-v5']);});
test('push is bounded text, fixed local images and same-origin navigation',async()=>{
 for(const url of ['javascript:alert(1)','https://evil.invalid/','https://app.example.evil/','https://user:pass@app.example/']){const w=worker();let p;w.handlers.push({data:{json:()=>({title:'A'.repeat(200),body:'B'.repeat(2000),url,icon:'https://evil.invalid/icon'})},waitUntil:x=>p=x});await p;const[n,o]=w.notifications[0];assert.equal(n.length,160);assert.equal(o.body.length,1024);assert.equal(o.icon,'/icon-192.png');w.handlers.notificationclick({notification:{data:o.data,close(){}},waitUntil:x=>p=x});await p;assert.equal(w.opened[0],'https://app.example/');}
 const w=worker();w.handlers.push({data:{json:()=>{throw Error();}},waitUntil(){assert.fail();}});assert.equal(w.notifications.length,0);
});
test('monitor uses only fixed public endpoints and never retains response/errors',async()=>{
 const seen=[];const r=await checkHealth({fetchImpl:async(url,options)=>{seen.push(url);assert.equal(options.redirect,'error');return new Response(new URL(url).hostname==='voiceprotest.org'?protectedHtml():JSON.stringify({status:'ok'}));}});assert.equal(r.ok,true);assert.equal(seen.length,11);assert.ok(!JSON.stringify(r).includes('Content-Security-Policy'));
});
for(const kind of ['timeout','large','status','json','policy'])test('monitor fails closed with bounded/redacted '+kind,async()=>{
 const r=await checkHealth({timeoutMs:15,fetchImpl:async()=>{if(kind==='timeout')return new Promise(()=>{});if(kind==='large')return new Response('private '.repeat(10000));if(kind==='status')return new Response('private',{status:500});if(kind==='json')return new Response('private');return new Response('<html>private</html>');}});assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes('private'));assert.equal(r.checks.length,11);
});
test('valid same-origin notification preserves the report route',async()=>{const w=worker();let p;const url='https://app.example/#/informe/11111111-1111-4111-8111-111111111111';w.handlers.push({data:{json:()=>({title:'Synthetic',body:'Synthetic',url})},waitUntil:x=>p=x});await p;w.handlers.notificationclick({notification:{data:w.notifications[0][1].data,close(){}},waitUntil:x=>p=x});await p;assert.equal(w.opened[0],url);});
test('widget rejects malformed ids before DOM or network work',()=>{
 const source=readFileSync('apps/web/public/widget.js','utf8');
 for(const id of ['<img src=x onerror=alert(1)>','javascript:alert(1)','not-a-uuid']){let effects=0;const document={querySelectorAll:()=>[{src:'https://voiceprotest.org/widget.js?id='+encodeURIComponent(id)}],createElement:()=>{effects++;throw Error();}};vm.runInNewContext(source,{URL,document,console:{warn(){}},fetch:()=>{effects++;throw Error();}});assert.equal(effects,0);}
});

test('precache also excludes private/no-store and omits credentials',async()=>{for(const cacheControl of ['private','no-store']){const w=worker({cacheControl});let p;w.handlers.install({waitUntil:x=>p=x});await p;assert.equal(w.puts.length,0);assert.equal(w.fetchCalls.length,5);assert.ok(w.fetchCalls.every(c=>c.options.credentials==='omit'&&c.options.cache==='reload'));}});

test('cache reads stay inside this application current cache',async()=>{const w=worker({cached:new Response('own')});assert.equal(await w.request('https://app.example/assets/x.js'),true);assert.equal(w.globalReads,0);});
test('monitor rejects broadened or late CSP',()=>{const good=protectedHtml();assert.ok(!hasBrowserPolicy(good.replace("script-src 'self'","script-src 'self' https://evil.invalid")));const meta=good.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];assert.ok(!hasBrowserPolicy(good.replace(meta,'')+meta));});

test('production build requires canonical API configuration',()=>{for(const apiUrl of [undefined,'','https://api.voiceprotest.org/'])assert.throws(()=>browserProtectionPlugin({apiUrl}).transformIndexHtml.handler(html));});
test('a commented policy is not effective policy',()=>{const good=protectedHtml();const meta=good.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];assert.ok(!hasBrowserPolicy(good.replace(meta,'<!--'+meta+'-->')));});
test('public report ids and route guards reject hostile fragments before fetch/render',async()=>{
 const {publicReportId,reportRouteGuard}=await import('../apps/web/src/lib/publicReportId.js');
 for(const id of ['../users','x"><script>alert(1)</script>',null,[],{},'not-a-uuid']){assert.equal(publicReportId(id),'');assert.deepEqual(reportRouteGuard({name:'public-report',params:{id}}),{path:'/',replace:true});}
 const id='11111111-1111-4111-8111-111111111111';assert.equal(publicReportId(id),id);assert.equal(reportRouteGuard({name:'public-report',params:{id}}),true);
});
test('widget counters remain numeric text with malformed API totals',async()=>{
 const source=readFileSync('apps/web/public/widget.js','utf8');
 for(const total of ['<img src=x onerror=alert(1)>',{},-1,1.5,Infinity]){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'0',replaceChildren(...children){this.children=children;}});return nodes.get(id);};
  const id='11111111-1111-4111-8111-111111111111',script={src:'https://voiceprotest.org/widget.js?id='+id,insertAdjacentElement(){}};
  const document={currentScript:script,querySelectorAll:()=>[],head:{appendChild(){}},createElement:()=>({}),getElementById:node};
  vm.runInNewContext(source,{document,URL,console:{warn(){}},setInterval(){},performance:{now:()=>0},requestAnimationFrame:fn=>fn(1000),fetch:async()=>({ok:true,json:async()=>({protest:{title:'Synthetic'},total_adhesiones:total,ciudades_distintas:'<img>',paises_distintos:-1})})});
  await new Promise(r=>setImmediate(r));assert.equal(node('vc-count-'+id).textContent,'0');assert.ok(node('vc-meta-'+id).children.every(c=>!c.textContent.includes('<img')));
 }
});
