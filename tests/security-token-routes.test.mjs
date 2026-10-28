import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {registerSafeErrorHandler} from '../apps/api/src/lib/safeErrors.js';
import {signParticipationToken} from '../apps/api/src/lib/participationToken.js';
process.env.PARTICIPATION_TOKEN_SECRET='synthetic-token-key';process.env.ADMIN_SECRET='synthetic-admin';process.env.KOFI_VERIFICATION_TOKEN='synthetic-kofi';
let dbCalls=0;const database={from(){dbCalls++;throw new Error('synthetic authenticated database boundary');},rpc(){dbCalls++;throw new Error('synthetic authenticated database boundary');}};
mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:database}});
const {default:webhooks}=await import('../apps/api/src/routes/webhooks.js');const {default:protests}=await import('../apps/api/src/routes/protests.js');
async function fixture(){const app=Fastify();await app.register(sensible);registerSafeErrorHandler(app);await app.register(webhooks,{prefix:'/webhooks'});await app.register(protests,{prefix:'/protests',dependencies:{database,verifyCaptcha:async()=>{}}});return app;}
test('Ko-fi rejects malformed/missing/wrong credentials before accessing donation data',async()=>{
 const app=await fixture();dbCalls=0;try{for(const value of [null,[],{}, {verification_token:null},{verification_token:123},{verification_token:'wrong'},{verification_token:'x'.repeat(4097)}]){const r=await app.inject({method:'POST',url:'/webhooks/kofi',payload:{data:JSON.stringify(value)}});assert.equal(r.statusCode,401,r.body);}assert.equal(dbCalls,0);const accepted=await app.inject({method:'POST',url:'/webhooks/kofi',payload:{data:JSON.stringify({verification_token:'synthetic-kofi',amount:0})}});assert.equal(accepted.statusCode,400);assert.equal(accepted.json().error,'Invalid amount');assert.equal(dbCalls,0);}finally{await app.close();}
});
test('manual funding rejects wrong or unconfigured credentials before DB and preserves authorized flow',async()=>{
 const app=await fixture();dbCalls=0;try{for(const value of ['wrong','x'.repeat(4097)]){const r=await app.inject({method:'POST',url:'/protests/11111111-1111-4111-8111-111111111111/donar',payload:{importe:1,admin_secret:value}});assert.equal(r.statusCode,401,r.body);}assert.equal(dbCalls,0);delete process.env.ADMIN_SECRET;const missing=await app.inject({method:'POST',url:'/protests/11111111-1111-4111-8111-111111111111/donar',payload:{importe:1,admin_secret:'synthetic-admin'}});assert.equal(missing.statusCode,401);assert.equal(dbCalls,0);process.env.ADMIN_SECRET='synthetic-admin';const r=await app.inject({method:'POST',url:'/protests/11111111-1111-4111-8111-111111111111/donar',payload:{importe:1,admin_secret:'synthetic-admin'}});assert.equal(r.statusCode,500);assert.equal(dbCalls,1);assert.ok(!r.body.includes('synthetic authenticated'));}finally{await app.close();}
});
test('join rejects extra token segments before looking up identity or writing an adhesion',async()=>{
 const app=await fixture();dbCalls=0;try{const token=signParticipationToken({device_id:'synthetic-device',phone_hash:'a'.repeat(64),purpose:'join_protest'});const r=await app.inject({method:'POST',url:'/protests/11111111-1111-4111-8111-111111111111/join',payload:{participation_token:token+'.extra',recaptcha_token:'synthetic'}});assert.equal(r.statusCode,401,r.body);assert.equal(dbCalls,0);}finally{await app.close();}
});
