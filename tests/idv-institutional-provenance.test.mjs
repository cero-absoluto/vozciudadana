import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
process.env.NULLIFIER_SECRET='synthetic-idv04-nullifier';
const calls=[];
mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'synthetic'}};}}}});
const {verifyInstitutionalOtpAndCreateAdhesion}=await import('../apps/api/src/lib/adhesionService.js');
for(const founder of [false,true])for(const mode of ['valid','error','http','invalid'])test('institutional RPC country requires actual IP evidence: '+mode+' founder='+founder,async()=>{
 const f=mock.method(globalThis,'fetch',async()=>({ok:mode!=='http',json:async()=>mode==='error'?{error:true,country_code:'ES'}:{country_code:mode==='invalid'?'ESP':'ES'}}));
 try {
  await verifyInstitutionalOtpAndCreateAdhesion({emailHash:'a'.repeat(64),protestId:'11111111-1111-4111-8111-111111111111',submittedOtpHash:'synthetic-otp-hash',location:{ip:'8.8.8.8',latitude:40,longitude:-3},institutionalExpiresAt:'2027-08-31T00:00:00Z',creatorKeyHash:founder?'synthetic-key':null,challengeId:'22222222-2222-4222-8222-222222222222'});
  assert.equal(calls.at(-1).args.p_pais_code,mode==='valid'?'ES':null);
  assert.equal(calls.at(-1).name,founder?'verify_census_founder_adhesion':'verify_institutional_challenge_and_create_adhesion');
  assert.equal(f.mock.callCount(),1);assert.ok(String(f.mock.calls[0].arguments[0]).startsWith('https://ipapi.co/'));
 }finally{f.mock.restore();}
});
