import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {classifyJoinRejection} from '../apps/web/src/lib/joinRejection.js';
import {preSmsRejectionKey} from '../apps/web/src/lib/nationalPreCheck.js';
import {safeErrorResponse} from '../apps/api/src/lib/safeErrors.js';
const run=promisify(execFile),require=createRequire(import.meta.url);
test('actual server uses the final sanitizer on Pino default stdout, including child logs',async()=>{
 const {stdout}=await run(process.execPath,['--experimental-test-module-mocks',new URL('./fixtures/privacy-default-stdout.mjs',import.meta.url).pathname],{env:{NODE_ENV:'test'},timeout:15000,maxBuffer:100000});
 assert.ok(!stdout.includes('SYNTHETIC_PRIVATE_SERVER'));const records=stdout.trim().split('\n').map(JSON.parse);assert.ok(records.some(x=>x.code==='otp_provider_max_attempts'));assert.ok(records.some(x=>x.code==='http_response'));assert.ok(records.some(x=>x.code==='request_error'));for(const r of records)for(const k of Object.keys(r))assert.ok(['level','time','reqId','code','statusCode','method','routeGroup'].includes(k),k);
});
test('reviewed framework versions match lockfile and installed runtime; upgrades require privacy revalidation',()=>{
 const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
 for(const [name,version] of [['fastify','5.12.7'],['pino','10.3.1']]){assert.equal(lock.packages['node_modules/'+name].version,version);assert.equal(require(name+'/package.json').version,version);}
});
test('frontend status and machine-code contracts remain stable; generic errors stay generic',()=>{
 const asApiError=(status,body)=>Object.assign(new Error(body.error),{status,...(body.code?{code:body.code}:{})});
 for(const [status,body,kind] of [[401,{error:'VERIFICATION_REQUIRED'},'verification_required'],[410,{error:'PROTEST_CLOSED'},'closed'],[409,{error:'ALREADY_JOINED'},'already'],[402,{code:'SALDO_AGOTADO',error:'funding'},'no_funds'],[403,{code:'NATIONAL_ONLY',error:'national'},'national'],[403,{code:'NATIONAL_COUNTRY_SHARED_CODE',error:'national'},'national_shared_code'],[403,{code:'NATIONAL_COUNTRY_UNRESOLVED',error:'national'},'national_unresolved'],[403,{code:'NATIONAL_REVERIFICATION_REQUIRED',error:'national'},'national_reverification']])assert.equal(classifyJoinRejection(asApiError(status,body)).kind,kind);
 assert.equal(preSmsRejectionKey({code:'NATIONAL_COUNTRY_SHARED_CODE'}),'verify.toastNationalSharedCode');assert.equal(preSmsRejectionKey({code:'NATIONAL_COUNTRY_UNRESOLVED'}),'verify.toastNationalUnresolved');
 const denied=safeErrorResponse({statusCode:429,message:'SYNTHETIC_PRIVATE'});assert.equal(denied.status,429);assert.equal(classifyJoinRejection(asApiError(denied.status,denied.body)).kind,'generic');
});

test('domain error subclasses retain static messages even when given hostile constructor arguments',async()=>{
 mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:{}}});
 const domain=await import('../apps/api/src/lib/adhesionService.js');let checked=0;
 for(const Type of Object.values(domain))if(typeof Type==='function' && Type.prototype instanceof domain.AdhesionError){const value=new Type('SYNTHETIC_PRIVATE');assert.ok(!value.message.includes('SYNTHETIC_PRIVATE'));assert.ok(!value.code.includes('SYNTHETIC_PRIVATE'));checked++;}
 assert.ok(checked>=10);
});
