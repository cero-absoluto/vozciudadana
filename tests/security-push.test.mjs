import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash,timingSafeEqual} from 'node:crypto';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {isAllowedPushEndpoint} from '../apps/api/src/lib/pushEndpoint.js';
import {deviceSecretMatches,hashDeviceSecret} from '../apps/api/src/lib/participationToken.js';
process.env.DEVICE_SECRET_PEPPER='synthetic-test-pepper';
const secret='a'.repeat(64),deviceId='synthetic-device';
const endpoint='https://fcm.googleapis.com/fcm/send/synthetic';
const source=readFileSync(new URL('../apps/api/src/routes/push.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function pushRoutes','async function pushRoutes');
const subscription={endpoint,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
async function fixture({owner=true,verified=true,dbError=false,rpcError=null}={}){
  const calls=[],sent=[];
  const supabase={from(table){
    const q={select(){return q;},eq(key,value){calls.push({table,key,value});return q;},delete(){calls.push({delete:table});return q;},
      is(key,value){calls.push({table,key,value});return q;},in(){return Promise.resolve({data:table==='adhesions'?[{device_id:deviceId}]:[{endpoint:'https://127.0.0.1/internal',p256dh:'x',auth:'x'},{endpoint,p256dh:'x',auth:'x'}]});},
      maybeSingle:async()=>({data:{id:deviceId,verified_at:verified?'2026-01-01':null,device_secret_hash:hashDeviceSecret(secret)},error:dbError?{}:null}),then(resolve,reject){return Promise.resolve({data:table==='adhesions'?[{device_id:deviceId}]:null,error:null}).then(resolve,reject);}};
    return q;
  },rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:owner,error:rpcError};}};
  const context={supabase,isAllowedPushEndpoint,deviceSecretMatches,createHash,timingSafeEqual,console,process:{env:{ADMIN_SECRET:'synthetic-admin',VAPID_PUBLIC_KEY:'fake',VAPID_PRIVATE_KEY:'fake',VAPID_EMAIL:'mailto:test@example.invalid'}},
    webpush:{setVapidDetails(){},async sendNotification(sub,_payload,options){sent.push(sub);assert.equal(options.timeout,5000);}},
    setInterval(){},setTimeout(){}};
  vm.createContext(context);vm.runInContext(source+';globalThis.register=pushRoutes;',context);
  const app=Fastify();await app.register(sensible);await app.register(context.register);await app.ready();
  return {app,calls,sent};
}
for(const url of ['http://fcm.googleapis.com/fcm/send/a','https://127.0.0.1/x','https://fcm.googleapis.com.evil.invalid/x','https://evil.invalid/x','https://fcm.googleapis.com:444/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com/x?redirect=evil','https://fcm.googleapis.com/x#x','https://db3.notify.windows.com.evil.invalid/?token=synthetic','https://fcm.googleapis.com\\@evil.invalid/x','https://fcm.goog\tleapis.com/x'])
  test('push rejects arbitrary destination '+url,()=>assert.equal(isAllowedPushEndpoint(url),false));
test('push accepts supported browser provider HTTPS endpoints',()=>{
  for(const url of [endpoint,'https://updates.push.services.mozilla.com/wpush/v2/x','https://web.push.apple.com/Qx','https://db3.notify.windows.com/?token=synthetic','https://wns2.notify.windows.com/w/?token=synthetic'])assert.equal(isAllowedPushEndpoint(url),true,url);
});
test('push subscription requires device secret and never writes on failed authentication',async()=>{
  const f=await fixture();try{
    for(const payload of [{device_id:deviceId,subscription},{device_id:deviceId,device_secret:'b'.repeat(64),subscription}]){
      const r=await f.app.inject({method:'POST',url:'/subscribe',payload});assert.ok([400,401].includes(r.statusCode));
    }
    assert.equal(f.calls.some(c=>c.rpc),false);assert.equal(f.sent.length,0);
  }finally{await f.app.close();}
});
test('unverified device is denied and endpoint validation precedes RPC',async()=>{
  for(const verified of [false,true]){
    const f=await fixture({verified});try{
      const r=await f.app.inject({method:'POST',url:'/subscribe',payload:{device_id:deviceId,device_secret:secret,subscription:{...subscription,endpoint:'https://evil.invalid/'}}});
      assert.equal(r.statusCode,verified?400:401);assert.equal(f.calls.some(c=>c.rpc),false);
    }finally{await f.app.close();}
  }
});
test('subscription invokes atomic ownership RPC and ignores client-supplied expiry',async()=>{
  const f=await fixture();try{
    const r=await f.app.inject({method:'POST',url:'/subscribe',payload:{device_id:deviceId,device_secret:secret,subscription,ends_at:'2999-01-01'}});
    assert.equal(r.statusCode,201);const call=f.calls.find(c=>c.rpc);assert.equal(call.rpc,'save_owned_push_subscription');assert.equal(call.args.p_device_id,deviceId);assert.equal(call.args.p_endpoint,endpoint);assert.equal('p_ends_at' in call.args,false);
    assert.equal(f.sent.length,0);
  }finally{await f.app.close();}
});
test('another owner cannot replace a registered endpoint',async()=>{
  const f=await fixture({owner:false});try{
    const r=await f.app.inject({method:'POST',url:'/subscribe',payload:{device_id:deviceId,device_secret:secret,subscription}});assert.equal(r.statusCode,409);assert.equal(r.json().error,'PUSH_ENDPOINT_OWNED');
  }finally{await f.app.close();}
});
test('unverified device race and unknown protest are not ownership conflicts',async()=>{
  for(const [message,status] of [['VP_PUSH_DEVICE_UNVERIFIED',401],['VP_PUSH_PROTEST_NOT_FOUND',404]]){
    const f=await fixture({rpcError:{message}});try{
      const r=await f.app.inject({method:'POST',url:'/subscribe',payload:{device_id:deviceId,device_secret:secret,subscription}});assert.equal(r.statusCode,status);
    }finally{await f.app.close();}
  }
});
test('unsubscribe is authenticated and filters both device and endpoint',async()=>{
  const f=await fixture();try{
    let r=await f.app.inject({method:'POST',url:'/unsubscribe',payload:{device_id:deviceId,device_secret:'b'.repeat(64),endpoint}});assert.equal(r.statusCode,401);assert.equal(f.calls.some(c=>c.delete),false);
    r=await f.app.inject({method:'POST',url:'/unsubscribe',payload:{device_id:deviceId,device_secret:secret,endpoint}});assert.equal(r.statusCode,200);
    const filters=f.calls.filter(c=>c.table==='push_subscriptions');assert.ok(filters.some(c=>c.key==='device_id'&&c.value===deviceId));assert.ok(filters.some(c=>c.key==='endpoint'&&c.value===endpoint));
  }finally{await f.app.close();}
});
test('sender revalidates stored endpoints and never delivers to arbitrary historic URLs',async()=>{
  const f=await fixture();try{
    const r=await f.app.inject({method:'POST',url:'/notify',payload:{protest_id:'11111111-1111-1111-1111-111111111111',title:'synthetic',body:'synthetic',admin_secret:'synthetic-admin'}});
    assert.equal(r.statusCode,200);assert.equal(f.sent.length,1);assert.equal(f.sent[0].endpoint,endpoint);assert.ok(f.calls.some(c=>c.table==='adhesions'&&c.key==='deleted_at'&&c.value===null));
  }finally{await f.app.close();}
});
