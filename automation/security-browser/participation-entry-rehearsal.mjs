// Synthetic browser journey: every request is fulfilled locally or aborted.
// No real OTP, geolocation, notifications, provider or production mutations.
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.S16_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('apps/web/dist'),checks=[],requests=[],unexpected=[],errors=[],detailMeasurements=[];
async function waitForCount(read,expected) {
  for(let i=0;i<100&&read()<expected;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(read(),expected);
}
const ID='11111111-1111-4111-8111-111111111111',INSTITUTION='22222222-2222-4222-8222-222222222222';
const events=[{id:ID,title:'Synthetic selected event',scope:'global',risk_level:'low',country:null,ends_at:'2099-12-31T23:59:59Z',count:1,saldo_euros:10},
  {id:INSTITUTION,title:'Synthetic institution',scope:'regional',risk_level:'low',country:'ES',dominio_email:'example.invalid',ends_at:'2099-12-31T23:59:59Z',count:1,saldo_euros:10}];
const browser=await chromium.launch({headless:true});
try {
  for(const locale of ['es','en','fr','zh'])for(const width of [320,360,390]) {
    const messages=JSON.parse(readFileSync(resolve('apps/web/src/locales',locale+'.json'),'utf8'));
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height:640},isMobile:true,hasTouch:true,locale});
    await context.addInitScript(({locale})=>{localStorage.setItem('vc_lang',locale);localStorage.setItem('vc_map_seen','1');localStorage.setItem('vc_map_intro','1');}, {locale});
    await context.addInitScript(()=>{window.__notificationRequests=0;Notification.requestPermission=async()=>{window.__notificationRequests++;return 'denied';};});
    await context.addInitScript(()=>{
      window.__gpsRequests=0;window.__gpsSuccess=null;window.__gpsFailure=null;
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,failure){window.__gpsRequests++;window.__gpsSuccess=success;window.__gpsFailure=failure;}}});
    });
    await context.addInitScript(()=>{
      window.__copyMode='success';window.__copies=[];
      window.__syntheticClipboard={writeText:async text=>{window.__copies.push(text);if(window.__copyMode==='reject')throw new Error('Synthetic clipboard denial');if(window.__copyMode==='defer')await new Promise(r=>window.__releaseCopy=r);}};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:window.__syntheticClipboard});
      window.__shares=[];window.open=(...args)=>{window.__shares.push(args);return {};};
    });
    let sms=0,joins=0,emailSends=0,emailChecks=0,releaseSms,releaseEmail,releaseCheck;
    let smsResponse={sent:true},smsStatus=200,holdSms=false,holdEmail=false,holdCheck=false;
    let mobileDetail=null,groupAvailable=false,groupMode='auto',groupReads=0,holdGroup=false,releaseGroup;
    let holdList=false,releaseList,listStatus=200,listReads=0;
    let listOverride=null,detailStatus=200,detailResponse=events[1],holdDetail=false,releaseDetail;
    let joinStatus=201,joinResponse={receipt:'44444444-4444-4444-8444-444444444444'},emailStatus=200;
    await context.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());requests.push({locale,width,host:u.host,path:u.pathname,method:req.method()});
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
      if(u.origin==='https://voiceprotest.org') {
        const file=resolve(root,u.pathname==='/'?'index.html':'.'+u.pathname);
        if(!file.startsWith(root+'/')||!existsSync(file))return route.fulfill({status:404,body:'missing'});
        return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});
      }
      if(u.hostname==='api.voiceprotest.org') {
        if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type'}});
        if(req.method()==='GET'&&u.pathname==='/api/protests') {listReads++;if(holdList)await new Promise(r=>releaseList=r);return json(listOverride ?? events,listStatus);}
        if(req.method()==='GET'&&u.pathname===`/api/grupos/convocatoria/${ID}`){groupReads++;if(holdGroup)await new Promise(r=>releaseGroup=r);if(groupMode==='network')return route.abort('connectionfailed');if(groupMode==='503')return json({error:'synthetic private failure'},503);if(groupMode==='invalid')return json({});return json(groupAvailable?{group_id:'33333333-3333-4333-8333-333333333333',name:'Synthetic census'}:{error:'synthetic absent'},groupAvailable?200:404);}
        if(req.method()==='GET'&&u.pathname===`/api/protests/${ID}`)return json(mobileDetail ?? events[0]);
        if(req.method()==='GET'&&u.pathname===`/api/protests/${ID}/informe`)return json({error:'synthetic report unavailable'},503);
        if(req.method()==='GET'&&u.pathname===`/api/protests/${INSTITUTION}`) {if(holdDetail)await new Promise(r=>releaseDetail=r);return json(detailResponse,detailStatus);}
        if(req.method()==='GET'&&u.pathname==='/api/ipinfo')return json({country_code:'ES',country_name:'Spain',city:'Synthetic'});
        if(req.method()==='GET'&&u.pathname==='/api/country-codes')return json([{iso2:'ES',dial_code:'34',flag:'ES'}]);
        if(req.method()==='POST'&&u.pathname==='/api/users/request-otp') {
          sms++;assert.deepEqual(req.postDataJSON(),{phone:'+34600000001',recaptcha_token:'synthetic-no-provider',protest_id:ID});
          if(holdSms)await new Promise(r=>releaseSms=r);
          return json(smsResponse,smsStatus);
        }
        if(req.method()==='POST'&&u.pathname==='/api/users/verify-otp')return json({verified:true,device_id:'synthetic-device',participation_token:'synthetic-token'});
        if(req.method()==='POST'&&u.pathname===`/api/protests/${ID}/join`) {joins++;return json(joinResponse,joinStatus);}
        if(req.method()==='POST'&&u.pathname==='/api/institucional/send-otp') {emailSends++;if(holdEmail)await new Promise(r=>releaseEmail=r);return json({sent:true,challenge_id:'33333333-3333-4333-8333-333333333333'});}
        if(req.method()==='POST'&&u.pathname==='/api/institucional/verify-otp') {emailChecks++;if(holdCheck)await new Promise(r=>releaseCheck=r);return json(emailStatus===200?{verified:true,receipt:'66666666-6666-4666-8666-666666666666',census_session:'v1.synthetic'}:{error:'synthetic'},emailStatus);}
      }
      if(u.hostname==='cdn.jsdelivr.net')return json({type:'Topology',objects:{countries:{type:'GeometryCollection',geometries:[]}},arcs:[]});
      if(['www.wikidata.org','query.wikidata.org'].includes(u.hostname))return json({search:[]});
      if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
      if(u.hostname==='www.google.com'&&u.pathname.startsWith('/recaptcha/'))return route.fulfill({contentType:'application/javascript',body:'window.grecaptcha={ready:fn=>fn(),execute:async()=>"synthetic-no-provider"};'});
      unexpected.push({host:u.host,path:u.pathname,method:req.method()});return route.abort();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push({locale,width,message:e.message}));
    const longEvent={...events[0],title:('Synthetic public campaign title ').repeat(5),demands:('Synthetic concrete demand. ').repeat(12),focal_point:'Synthetic public institution',description:('Synthetic public description. ').repeat(50)};
    const amplify=async scale=>{if(scale===1)return;await page.evaluate(scale=>{const nodes=[...document.querySelectorAll('body,body *')].filter(el=>!['SCRIPT','STYLE','SVG','PATH'].includes(el.tagName));const sizes=nodes.map(el=>parseFloat(getComputedStyle(el).fontSize));nodes.forEach((el,i)=>{if(Number.isFinite(sizes[i])&&sizes[i]>0)el.style.setProperty('font-size',sizes[i]*scale+'px','important');});},scale);};
    const measure=async(state,scale,locator)=>{
      const row={locale,width,height:640,state,textScale:scale};
      row.overflowX=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      row.controls=[];
      for(const control of await locator.all()){
        await control.scrollIntoViewIfNeeded();
        row.controls.push(await control.evaluate(el=>{const r=el.getBoundingClientRect();const x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2));const hit=document.elementFromPoint(x,y);return {name:el.getAttribute('aria-label')||el.textContent?.trim().slice(0,80)||el.id,withinViewport:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,reachable:!!hit&&(el===hit||el.contains(hit)),width:r.width,height:r.height};}));
      }
      if(state==='detail')row.scrollBody=await page.locator('#s-detail .d-scroll').evaluate(el=>el.clientHeight);
      row.ok=!row.overflowX&&row.controls.length>0&&row.controls.every(c=>c.withinViewport&&c.reachable)&&(state!=='detail'||row.scrollBody>=100);
      checks.push(row);detailMeasurements.push(row);
    };
    for(const scale of [1,2])for(const state of ['home','detail','phone','otp','gps']){
      await page.goto('https://voiceprotest.org/?ux=reset#/');
      await page.evaluate(id=>{localStorage.clear();sessionStorage.clear();sessionStorage.setItem('vc_last_joined',id);},ID);
      mobileDetail={...longEvent,scope:state==='gps'||state==='otp'?'local':'global',risk_level:state==='detail'?'high':'low'};listOverride=[mobileDetail];
      const hash=state==='home'?'#/':state==='detail'?`#/detail/${ID}`:'#/auth';
      await page.goto(`https://voiceprotest.org/?ux=reflow-${state}-${scale}${hash}`);
      if(state==='home'){
        await page.locator('.filter-row button').first().click();
        await page.locator('article.p-item').first().waitFor();await amplify(scale);await measure(state,scale,page.locator('article.p-item').first().getByRole('button'));
      }else if(state==='detail'){
        await page.locator('#s-detail .d-title').waitFor();await amplify(scale);await measure(state,scale,page.locator('#s-detail .join-footer .btn-primary'));
      }else{
        await page.locator('#phone-in').fill('600000001');
        if(state==='phone'){await amplify(scale);await measure(state,scale,page.locator('#phone-in, #cc-sel, .auth-submit-btn'));continue;}
        await page.getByRole('button',{name:messages.auth.sendCode,exact:true}).click();
        const dialog=page.getByRole('dialog',{name:messages.auth.gpsTitle,exact:true});await dialog.waitFor();
        if(state==='gps'){
          await amplify(scale);await measure(state,scale,dialog.getByRole('button'));await page.keyboard.press('Escape');await page.locator('.otp-row').waitFor();
        }else{
          await dialog.getByRole('button',{name:messages.auth.gpsDecline,exact:true}).click();await page.locator('.otp-row').waitFor();await amplify(scale);await measure(state,scale,page.locator('.otp-box, .auth-submit-btn, .auth-resend-link'));
        }
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  const report={status:checks.length===120&&!errors.length&&!unexpected.length?'DIAGNOSTIC_COMPLETE':'DIAGNOSTIC_INCOMPLETE',checks,requests,unexpected,errors,detailMeasurements,externalMutations:0,findings:checks.filter(c=>!c.ok),limits:'Synthetic reflow widths and explicit 200% computed font enlargement. Not native browser zoom, pinch zoom, physical iOS/Android or a complete accessibility audit.'};
  writeFileSync(process.env.UX_REPORT||'/tmp/participation-entry-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(report.status!=='DIAGNOSTIC_COMPLETE')process.exitCode=1;
}
