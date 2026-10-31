import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server = await createServer({root:'apps/web',server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
test.after(()=>server.close());
test('real email API wrapper preserves a received receipt if census storage subsequently fails',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({verified:true,receipt:'44444444-4444-4444-8444-444444444444',census_session:'v1.synthetic'}),{status:200});};
  globalThis.sessionStorage={getItem:()=> '33333333-3333-4333-8333-333333333333',setItem(){throw Error('synthetic storage unavailable');},removeItem(){}};
  try {
    const api=await server.ssrLoadModule('/src/services/api.js');
    await assert.rejects(api.verifyEmailOtp({email:'synthetic@example.invalid',otp:'123456',protest_id:'11111111-1111-4111-8111-111111111111'}),error=>{
      assert.equal(error.code,'CENSUS_SESSION_NOT_SAVED');assert.equal(error.receipt,'44444444-4444-4444-8444-444444444444');assert.equal(error.verified,true);return true;
    });
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
});
for(const result of [{verified:true,receipt:'invalid'},{verified:false,receipt:'44444444-4444-4444-8444-444444444444'}])test('malformed success cannot persist a census credential '+JSON.stringify(result),async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage;let writes=0;
  globalThis.fetch=async()=>new Response(JSON.stringify({...result,census_session:'v1.synthetic'}),{status:200});
  globalThis.sessionStorage={getItem:()=> '33333333-3333-4333-8333-333333333333',setItem(){writes++;},removeItem(){}};
  try{const api=await server.ssrLoadModule('/src/services/api.js');await assert.rejects(api.verifyEmailOtp({email:'synthetic@example.invalid',otp:'123456',protest_id:'11111111-1111-4111-8111-111111111111'}),{code:'INVALID_API_RESPONSE'});assert.equal(writes,0);}
  finally{globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;}
});
