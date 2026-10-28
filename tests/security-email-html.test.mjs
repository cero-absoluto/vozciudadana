import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, createHmac, randomInt } from 'node:crypto';

const source=readFileSync(new URL('../apps/api/src/routes/institucional.js',import.meta.url),'utf8')
  .replace(/^import [\s\S]*?;\n/gm,'').replace('export default async function institucionalRoutes','async function institucionalRoutes');
for(const language of ['es','en','fr','zh']) test('institutional '+language+' email renders malicious title as text through mocked delivery',async()=>{
  const malicious=`<a href="https://evil.invalid/?a=1&b=2">'Title'</a>`;
  let delivery;
  const q={select(){return q;},eq(){return q;},single:async()=>({data:{dominio_email:'example.invalid',title:malicious,requiere_censo:true,ends_at:'2099-01-01'}})};
  const context={createHash,createHmac,randomInt,ipQuotaKey:x=>x,consumeOtpDeliveryQuota:async()=>true,verifyRecaptcha:async()=>{},
    process:{env:{PHONE_HASH_SECRET:'synthetic-key',EMAIL_OTP_SECRET:'synthetic-otp-key'}},
    supabase:{from:()=>q,rpc:async()=>({data:{allowed:true,challenge_id:'33333333-3333-3333-3333-333333333333'}})},
    Resend:class{constructor(){this.emails={send:async data=>{delivery=data;return {error:null};}};}},console};
  vm.createContext(context);vm.runInContext(source+';globalThis.register=institucionalRoutes;',context);
  let handler;await context.register({post(path,_opts,fn){if(path==='/send-otp')handler=fn;}});
  const result=await handler({body:{email:'person@example.invalid',protest_id:'11111111-1111-1111-1111-111111111111',recaptcha_token:'mock',purpose:'census'},headers:{'accept-language':language},ip:'203.0.113.1'},{header(){}});
  assert.equal(result.sent,true);assert.equal(delivery.to,'person@example.invalid');
  assert.ok(!delivery.html.includes('<a '));assert.ok(!delivery.html.includes(malicious));
  assert.ok(delivery.html.includes('&lt;a href=&quot;https://evil.invalid/?a=1&amp;b=2&quot;&gt;&#39;Title&#39;&lt;/a&gt;'));
  assert.match(delivery.html,/<strong>.*<\/strong>/);
});
