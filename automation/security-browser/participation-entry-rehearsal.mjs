// Synthetic browser journey: every request is fulfilled locally or aborted.
// No real OTP, geolocation, notifications, provider or production mutations.
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.S16_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('apps/web/dist'),checks=[],requests=[],unexpected=[],errors=[];
async function waitForCount(read,expected) {
  for(let i=0;i<100&&read()<expected;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(read(),expected);
}
const ID='11111111-1111-4111-8111-111111111111',INSTITUTION='22222222-2222-4222-8222-222222222222';
const events=[{id:ID,title:'Synthetic selected event',scope:'global',risk_level:'low',country:null,ends_at:'2099-12-31T23:59:59Z',count:1,saldo_euros:10},
  {id:INSTITUTION,title:'Synthetic institution',scope:'regional',risk_level:'low',country:'ES',dominio_email:'example.invalid',ends_at:'2099-12-31T23:59:59Z',count:1,saldo_euros:10}];
const browser=await chromium.launch({headless:true});
try {
  for(const locale of ['es','en','fr','zh'])for(const width of [360,390]) {
    const messages=JSON.parse(readFileSync(resolve('apps/web/src/locales',locale+'.json'),'utf8'));
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height:844},isMobile:true,hasTouch:true,locale});
    await context.addInitScript(({locale})=>{localStorage.setItem('vc_lang',locale);localStorage.setItem('vc_map_seen','1');}, {locale});
    await context.addInitScript(()=>{window.__notificationRequests=0;Notification.requestPermission=async()=>{window.__notificationRequests++;return 'denied';};});
    let sms=0,joins=0,emailSends=0,emailChecks=0,releaseSms,releaseEmail,releaseCheck;
    let smsResponse={sent:true},smsStatus=200,holdSms=false,holdEmail=false,holdCheck=false;
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
        if(req.method()==='GET'&&u.pathname==='/api/protests')return json(listOverride ?? events);
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
    await page.goto('https://voiceprotest.org/#/auth');await page.waitForURL('**/#/');
    await page.goto('https://voiceprotest.org/#/verify');await page.waitForURL('**/#/');assert.equal(sms,0);assert.equal(joins,0);
    checks.push({id:`no_destination_${locale}_${width}`,ok:true});
    await page.evaluate(id=>sessionStorage.setItem('vc_last_joined',id),ID);
    await page.goto('https://voiceprotest.org/#/auth');await page.locator('#phone-in').fill('600000001');
    await page.getByRole('button',{name:messages.auth.sendCode,exact:true}).click();await page.locator('.otp-row').waitFor();assert.equal(sms,1);
    assert.ok((await page.locator('.auth-protest-title').textContent()).includes(events[0].title));
    const resend=page.getByRole('button',{name:messages.auth.resend,exact:true});
    holdSms=true;await resend.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.auth-resend button')?.disabled===true);
    await waitForCount(()=>sms,2);await page.keyboard.press('Enter');assert.equal(sms,2);assert.equal(joins,0);
    releaseSms();holdSms=false;await resend.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.auth-resend button')?.disabled);
    checks.push({id:`real_resend_keyboard_single_request_${locale}_${width}`,ok:true});
    smsStatus=429;smsResponse={code:'otp_rate_limited'};await resend.click();await page.waitForFunction(()=>!document.querySelector('.auth-resend button')?.disabled);assert.equal(sms,3);assert.equal(await page.locator('.otp-row').count(),1);assert.equal(joins,0);
    checks.push({id:`resend_quota_recovers_${locale}_${width}`,ok:true});
    await page.getByRole('button',{name:messages.auth.changeNumber,exact:true}).click();await page.locator('#phone-in').waitFor();
    smsStatus=200;smsResponse={};await page.getByRole('button',{name:messages.auth.sendCode,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.auth-submit-btn')?.disabled);assert.equal(await page.locator('.otp-row').count(),0);
    smsResponse={sent:true};await page.getByRole('button',{name:messages.auth.sendCode,exact:true}).click();await page.locator('.otp-row').waitFor();
    for(let i=0;i<6;i++)await page.locator('.otp-box').nth(i).fill(String(i+1));
    await page.getByRole('button',{name:messages.auth.verify,exact:true}).click();await page.locator('.success-scr').waitFor();assert.equal(joins,1);
    checks.push({id:`selected_event_success_${locale}_${width}`,ok:true});
    await page.locator('#s-verify .success-scr button').last().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#s-verify .success-scr button').last().evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.success-scr').getBoundingClientRect();return a.top>=b.top-1&&a.bottom<=b.bottom+1;}),true);
    checks.push({id:`receipt_actions_scroll_reachable_${locale}_${width}`,ok:true});
    assert.ok((await page.locator('.participation-receipt').textContent()).includes('44444444-4444-4444-8444-444444444444'));
    // Simulate another tab changing the shared identity while this tab keeps token A.
    await page.evaluate(()=>{localStorage.setItem('vc_device_id','other-tab-identity');localStorage.setItem('vc_device_secret','b'.repeat(64));});
    await page.reload();await page.locator('.participation-receipt').waitFor();assert.equal(joins,1);
    assert.ok((await page.locator('.participation-receipt').textContent()).includes(messages.participation.savedConfirmation));
    checks.push({id:`confirmed_reload_ignores_other_tab_identity_${locale}_${width}`,ok:true});
    await page.getByRole('button',{name:messages.verify.notiOff,exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__notificationRequests),0);
    checks.push({id:`notification_refuses_other_identity_before_permission_${locale}_${width}`,ok:true});
    await page.goto('https://voiceprotest.org/#/verify-institucional/'+INSTITUTION);
    await page.locator('#institution-verify-email').fill('synthetic@example.invalid');
    holdEmail=true;await page.locator('#institution-verify-email').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#s-verify-institucional .btn-primary')?.disabled===true);
    await page.keyboard.press('Enter');await waitForCount(()=>emailSends,1);releaseEmail();holdEmail=false;
    await page.locator('#institution-verify-code').waitFor();await page.locator('#institution-verify-code').fill('123456');
    await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('vc_census_session:'))throw new DOMException('Synthetic storage failure','QuotaExceededError');return set.call(this,k,v);};});
    holdCheck=true;await page.locator('#institution-verify-code').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#s-verify-institucional .btn-primary')?.disabled===true);
    await page.keyboard.press('Enter');await waitForCount(()=>emailChecks,1);releaseCheck();holdCheck=false;
    await page.locator('.suc-hash').waitFor();assert.ok((await page.locator('.suc-hash').textContent()).includes('66666666-6666-4666-8666-666666666666'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    checks.push({id:`institutional_double_enter_${locale}_${width}`,ok:true});
    await page.locator('#s-verify-institucional .success-scr button').last().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#s-verify-institucional .success-scr button').last().evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.success-scr').getBoundingClientRect();return a.top>=b.top-1&&a.bottom<=b.bottom+1;}),true);
    checks.push({id:`institutional_receipt_actions_scroll_reachable_${locale}_${width}`,ok:true});
    assert.ok((await page.locator('#s-verify-institucional').textContent()).includes(messages.participation.censusNotSaved));
    checks.push({id:`receipt_survives_census_storage_failure_${locale}_${width}`,ok:true});
    await page.reload();await page.locator('.suc-hash').waitFor();assert.equal(emailChecks,1);
    assert.ok((await page.locator('#s-verify-institucional').textContent()).includes(messages.participation.savedConfirmation));
    checks.push({id:`institutional_reload_no_write_${locale}_${width}`,ok:true});
    const confirmedStorage=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));
    await page.getByRole('button',{name:messages.participation.anotherEmail,exact:true}).click();
    await page.locator('#institution-verify-email').fill('synthetic@example.invalid');
    await page.getByRole('button',{name:messages.verificacional.sendCode,exact:true}).click();await page.locator('#institution-verify-code').waitFor();
    await page.locator('#institution-verify-code').fill('123456');emailStatus=429;
    await page.getByRole('button',{name:messages.verificacional.verifyCode,exact:true}).click();
    await page.getByRole('alert').filter({hasText:messages.participation.rateLimited}).waitFor();assert.equal(emailChecks,2);
    checks.push({id:`institutional_quota_is_not_wrong_code_${locale}_${width}`,ok:true});
    emailStatus=503;await page.getByRole('button',{name:messages.verificacional.verifyCode,exact:true}).click();
    await page.getByRole('alert').filter({hasText:messages.participation.uncertain}).waitFor();assert.equal(emailChecks,3);
    await page.reload();await page.getByRole('alert').filter({hasText:messages.participation.uncertain}).waitFor();assert.equal(emailChecks,3);
    checks.push({id:`institutional_uncertain_reload_no_write_${locale}_${width}`,ok:true});
    await page.evaluate(id=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('vc_participation_outcome:v1:phone:')&&key.endsWith(':'+id))sessionStorage.removeItem(key);sessionStorage.setItem('vc_last_joined',id);},ID);
    joinStatus=width===360?201:503;joinResponse=width===360?{}:{error:'synthetic-after-commit'};
    await page.goto('https://voiceprotest.org/#/verify');await page.getByRole('alert').filter({hasText:messages.participation.uncertain}).waitFor();assert.equal(joins,2);
    await page.reload();await page.getByRole('alert').filter({hasText:messages.participation.uncertain}).waitFor();assert.equal(joins,2);assert.equal(await page.locator('.participation-receipt').count(),0);
    checks.push({id:`uncertain_${width===360?'missing_receipt':'503'}_reload_no_write_${locale}_${width}`,ok:true});
    // Fresh documents and an empty list exercise the institutional direct-link fallback.
    listOverride=[];
    const beforeSends=emailSends,beforeChecks=emailChecks;
    const direct=async name=>{
      await page.evaluate(()=>sessionStorage.clear());
      await page.goto(`https://voiceprotest.org/?ux=${name}#/verify-institucional/${INSTITUTION}`);
    };
    detailStatus=503;detailResponse={error:'synthetic'};
    await direct('unavailable');
    await page.getByRole('alert').filter({hasText:messages.verificacional.loadError}).waitFor();
    assert.equal(await page.locator('#institution-verify-email').count(),0);
    detailStatus=200;detailResponse=events[1];
    await page.getByRole('button',{name:messages.verificacional.retry,exact:true}).click();
    await page.locator('#institution-verify-email').waitFor();
    assert.ok((await page.locator('#s-verify-institucional').textContent()).includes(events[1].title));
    checks.push({id:`institutional_direct_link_error_retry_${locale}_${width}`,ok:true});
    detailStatus=404;detailResponse={error:'synthetic-not-found'};
    await direct('missing');
    await page.getByRole('alert').filter({hasText:messages.verificacional.notFound}).waitFor();
    assert.equal(await page.locator('#institution-verify-email').count(),0);
    checks.push({id:`institutional_direct_link_missing_${locale}_${width}`,ok:true});
    detailStatus=200;detailResponse={...events[1],dominio_email:null};
    await direct('noninstitutional');
    await page.getByRole('alert').filter({hasText:messages.verificacional.notInstitutional}).waitFor();
    assert.equal(await page.locator('#institution-verify-email').count(),0);
    checks.push({id:`institutional_direct_link_wrong_method_${locale}_${width}`,ok:true});
    detailResponse={...events[1],ends_at:'2000-01-01T00:00:00Z'};
    await direct('closed');
    await page.getByRole('alert').filter({hasText:messages.verificacional.closed}).waitFor();
    assert.equal(await page.locator('#institution-verify-email').count(),0);
    checks.push({id:`institutional_direct_link_closed_${locale}_${width}`,ok:true});
    detailResponse=events[1];holdDetail=true;
    await direct('slow');
    await page.getByRole('status').filter({hasText:messages.verificacional.loadingEvent}).waitFor();
    assert.equal(await page.locator('#institution-verify-email').count(),0);
    await waitForCount(()=>Number(!!releaseDetail),1);releaseDetail();holdDetail=false;
    await page.locator('#institution-verify-email').waitFor();
    checks.push({id:`institutional_direct_link_loading_no_form_${locale}_${width}`,ok:true});
    await page.evaluate(saved=>{sessionStorage.clear();for(const [k,v] of Object.entries(saved))sessionStorage.setItem(k,v);},confirmedStorage);
    detailStatus=404;detailResponse={error:'synthetic-not-found'};
    await page.goto(`https://voiceprotest.org/?ux=receipt-missing#/verify-institucional/${INSTITUTION}`);
    await page.locator('.suc-hash').waitFor();
    assert.ok((await page.locator('.suc-hash').textContent()).includes('66666666-6666-4666-8666-666666666666'));
    assert.equal(emailSends,beforeSends);assert.equal(emailChecks,beforeChecks);
    checks.push({id:`institutional_saved_receipt_survives_missing_event_${locale}_${width}`,ok:true});
    await context.close();
  }
  assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
} finally {
  await browser.close();
  const report={status:checks.length===160&&!errors.length&&!unexpected.length?'PASS':'FAIL',checks,requests,unexpected,errors,externalMutations:0};
  writeFileSync(process.env.UX_REPORT||'/tmp/participation-entry-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(report.status!=='PASS') process.exitCode=1;
}
