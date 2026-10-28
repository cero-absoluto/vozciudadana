import {mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify,{LogController} from 'fastify';
export const sentinel='SYNTHETIC_PRIVATE_SERVER';
export async function bootPrivacyServer({capture=true}={}) {
process.env.NODE_ENV='test';process.env.CLIENT_IP_MODE='cidr';delete process.env.TRUSTED_PROXY_CIDRS;delete process.env.CLIENT_IP_DIAGNOSTIC_UNTIL;
process.env.PHONE_HASH_SECRET='synthetic-phone-key';process.env.NULLIFIER_SECRET='synthetic-nullifier-key';process.env.EMAIL_OTP_SECRET='synthetic-otp-key';process.env.DEVICE_SECRET_PEPPER='synthetic-device-key';process.env.PARTICIPATION_TOKEN_SECRET='synthetic-participation-key';
let app;let providerCalls=0;const lines=[];
function createTestServer(options){app=Fastify({...options,logger:capture?{...options.logger,stream:{write(chunk){lines.push(String(chunk));}}}:options.logger});app.listen=async()=>{await app.ready();return 'synthetic-no-socket';};return app;}
createTestServer.LogController=LogController;
mock.module('fastify',{defaultExport:createTestServer});
const q=new Proxy({}, {get(target,key){if(key==='then')return (resolve,reject)=>Promise.resolve({data:null,error:{message:sentinel,code:'synthetic'}}).then(resolve,reject);return ()=>q;}});
mock.module('../../apps/api/src/services/supabase.js',{namedExports:{supabase:{from(){return q;},rpc(){throw new Error('unexpected synthetic RPC');}}}});
mock.module('../../apps/api/src/services/twilio.js',{namedExports:{sendOtp(){providerCalls++;throw new Error('provider prohibited');},verifyOtp(){providerCalls++;throw new Error('provider prohibited');}}});
const realInterval=globalThis.setInterval,realTimeout=globalThis.setTimeout;
// The production push plugin schedules workers; this assembly test must never run them.
mock.method(globalThis,'setInterval',(fn,delay,...args)=>fn.name==='hourlyJob'?{unref(){}}:realInterval(fn,delay,...args));
mock.method(globalThis,'setTimeout',(fn,delay,...args)=>fn.name==='hourlyJob'?{unref(){}}:realTimeout(fn,delay,...args));
mock.module('resend',{namedExports:{Resend:class {constructor(){this.emails={send(){providerCalls++;throw new Error('provider prohibited');}};}}}});
await import('../../apps/api/src/server.js');
return {app,lines,providerCalls:()=>providerCalls};
}
