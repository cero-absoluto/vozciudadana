import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {readFileSync} from 'node:fs';
import {PUBLIC_PROTEST_SELECT,PUBLIC_PROTEST_FIELDS,EXCLUDED_PROTEST_FIELDS,publicProtestSchema,toPublicProtest} from '../apps/api/src/lib/publicProtest.js';
const id='11111111-1111-4111-8111-111111111111';
const row={id,title:'Synthetic public title',description:'Public description',demands:'Public demand',scope:'global',count:0,cities:0,status:'closed',starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-10-02T00:00:00Z',created_at:'2026-10-01T00:00:00Z',dominio_email:null,requiere_censo:false,source_error:'PRIVATE_FAILURE',census_creator_key_hash:'PRIVATE_CREATOR_HASH',future_private_column:'PRIVATE_FUTURE',indexnow_last_notified_at:'PRIVATE_INTERNAL'};
let missing=false,empty=false,dbError=null,rpcData=row;const selects=[];
const database={rpc(){return Promise.resolve({data:rpcData,error:null});},from(table){let single=false;const q={select(fields){selects.push({table,fields});return q;},insert(){single=true;return q;},eq(){return q;},gt(){return q;},is(){return q;},order(){return q;},limit(){return q;},range(){return q;},abortSignal(){return q;},single(){single=true;return q;},then(resolve,reject){return Promise.resolve({data:table==='adhesions'?[]:missing?null:single?row:empty?[]:[row],error:dbError,count:0}).then(resolve,reject);}};return q;}};
mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:database}});
const {default:routes}=await import('../apps/api/src/routes/protests.js');
const {default:reports}=await import('../apps/api/src/routes/reports.js');
function noPrivate(value){const text=JSON.stringify(value);assert.ok(!text.includes('PRIVATE_'));assert.ok(!text.includes('future_private_column'));}
test('projection rejects unexpected current and future columns and handles missing records',()=>{
 const result=toPublicProtest(row);noPrivate(result);assert.equal(result.count,0);assert.equal(result.requiere_censo,false);assert.equal(result.dominio_email,null);assert.equal(result.status,'closed');assert.equal(toPublicProtest(null),null);
});
test('serializer independently blocks extra columns even without projection',async()=>{
 const app=Fastify();app.get('/',{schema:{response:{200:publicProtestSchema}}},()=>row);try{const r=await app.inject('/');assert.equal(r.statusCode,200);noPrivate(r.json());}finally{await app.close();}
});
test('real list, detail and report routes filter over-returned database rows',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(routes,{prefix:'/api/protests',dependencies:{database}});
 try{for(const path of ['/api/protests',`/api/protests/${id}`,`/api/protests/${id}/informe`]){const r=await app.inject(path);assert.equal(r.statusCode,200,r.body);noPrivate(r.json());const p=path.endsWith('/informe')?r.json().protest:Array.isArray(r.json())?r.json()[0]:r.json();assert.equal(p.title,row.title);assert.equal(p.status,'closed');}assert.ok(selects.filter(x=>x.table==='protests').every(x=>x.fields===PUBLIC_PROTEST_SELECT));}finally{await app.close();}
});
test('empty list and missing detail preserve public response shape',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(routes,{dependencies:{database}});try{empty=true;assert.deepEqual((await app.inject('/')).json(),[]);empty=false;missing=true;assert.equal((await app.inject(`/${id}`)).statusCode,404);}finally{missing=false;empty=false;await app.close();}
});
test('HTML report fetches explicit fields and never renders unknown internal values',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(reports);try{const r=await app.inject({url:`/${id}`,headers:{host:'reports.voiceprotest.org'}});assert.equal(r.statusCode,200);assert.ok(r.body.includes(row.title));assert.ok(!r.body.includes('PRIVATE_'));assert.equal(selects.at(-1).fields,PUBLIC_PROTEST_SELECT);}finally{await app.close();}
});
test('public contract covers all raw fields consumed by the web store',()=>{
 const source=readFileSync(new URL('../apps/web/src/stores/protests.js',import.meta.url),'utf8').split('const FALLBACK_PROTESTS')[0];
 for(const match of source.matchAll(/\bp\.([a-z_0-9]+)/g))assert.ok(PUBLIC_PROTEST_FIELDS.includes(match[1]),match[1]);
});

test('creation filters returned columns and preserves the one-time census creator key',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(routes,{dependencies:{database,verifyCaptcha:async()=>{},notifyIndex:()=>{},admissionRules:async()=>({ok:true,computedTargetValidation:'VALID',sourceInfo:{sourceType:'official_government',confidenceScore:90}})}});
 try{for(const census of [false,true]){
 const r=await app.inject({method:'POST',url:'/',payload:{title:'Synthetic public convocatoria',description:'Synthetic',demands:'Exigimos datos públicos',country:'ES',country_name:'España',scope:'global',duration_h:24,fuente_url:'https://example.org/source',tipo_abuso:'corruption',recaptcha_token:'synthetic',...(census?{dominio_email:'example.org',requiere_censo:true,convocatoria_pais:'ES'}:{})}});
 assert.equal(r.statusCode,201,r.body);noPrivate(r.json());assert.equal(r.headers['cache-control'],'no-store');if(census)assert.match(r.json().census_creator_key,/^[0-9a-f]{64}$/);else assert.equal(r.json().census_creator_key,undefined);
 }}finally{await app.close();}
});

test('all selected columns exist in the production metadata fixture; census RPC is scalar jsonb',()=>{
 const metadata=JSON.parse(readFileSync(new URL('./fixtures/public-protest-schema-20261028.json',import.meta.url)));
 for(const field of PUBLIC_PROTEST_FIELDS)assert.ok(metadata.columns.includes(field),field);
 assert.equal(metadata.rpc.result,'jsonb');assert.equal(metadata.rpc.set_returning,false);
});
test('report screen, HTML and evidential scope retain their direct raw fields',()=>{
 for(const path of ['../apps/web/src/screens/InformeScreen.vue','../apps/api/src/routes/reports.js','../apps/api/src/lib/evidentialScope.js']){
 const source=readFileSync(new URL(path,import.meta.url),'utf8');for(const m of source.matchAll(/\bprotest(?:\?\.|\.)([a-z_][a-z_0-9]*)/g))if(m[1]!=='org')assert.ok(PUBLIC_PROTEST_FIELDS.includes(m[1]),m[1]);
 }
});
test('JSON-LD cannot be closed by a malicious title and round-trips exactly',async()=>{
 const title=row.title;row.title='</script><script>window.x=1</script><form action=https://example.invalid> & \u2028\u2029';
 const app=Fastify();await app.register(sensible);await app.register(reports);
 try{const r=await app.inject({url:'/22222222-2222-4222-8222-222222222222',headers:{host:'reports.voiceprotest.org'}});assert.equal(r.statusCode,200);const json=r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];assert.ok(!json.includes('<'));const parsed=JSON.parse(json);assert.equal(parsed.name,row.title);assert.ok(!r.body.includes('<script>window.x=1</script>'));}finally{row.title=title;await app.close();}
});
test('database errors are sanitized, uncached 503 responses, not cached missing reports',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(routes,{prefix:'/api/protests',dependencies:{database}});await app.register(reports);
 try{dbError={code:'42703',message:'PRIVATE_DB_ERROR'};for(const path of ['/api/protests',`/api/protests/${id}`,`/api/protests/${id}/informe`,'/33333333-3333-4333-8333-333333333333']){const r=await app.inject({url:path,headers:{host:'reports.voiceprotest.org'}});assert.equal(r.statusCode,503,r.body);assert.equal(r.headers['cache-control'],'no-store');assert.ok(!r.body.includes('PRIVATE_'));}dbError=null;assert.equal((await app.inject({url:'/33333333-3333-4333-8333-333333333333',headers:{host:'reports.voiceprotest.org'}})).statusCode,200);}finally{dbError=null;await app.close();}
});
test('malformed census RPC responses never yield a successful creator-key-only response',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(routes,{dependencies:{database,verifyCaptcha:async()=>{},notifyIndex:()=>{throw new Error('must not notify');},admissionRules:async()=>({ok:true,computedTargetValidation:'VALID',sourceInfo:{sourceType:'official_government',confidenceScore:90}})}});
 try{for(const value of [[row],null,{}, {id:'invalid'}]){rpcData=value;const r=await app.inject({method:'POST',url:'/',payload:{title:'Synthetic',country_name:'España',scope:'global',duration_h:24,fuente_url:'https://example.org',tipo_abuso:'corruption',demands:'Exigimos datos',recaptcha_token:'synthetic',dominio_email:'example.org',requiere_censo:true,convocatoria_pais:'ES'}});assert.equal(r.statusCode,503,r.body);assert.equal(r.json().census_creator_key,undefined);assert.equal(r.headers['cache-control'],'no-store');}}finally{rpcData=row;await app.close();}
});
test('numeric public values serialize normally and malformed numeric values fail closed',async()=>{
 const app=Fastify();app.setErrorHandler((err,req,reply)=>reply.code(500).send({error:'Internal server error'}));app.get('/good',{schema:{response:{200:publicProtestSchema}}},()=>({...row,count:3,saldo_euros:1.25,convocatoria_osm_id:'1234567890123'}));app.get('/bad',{schema:{response:{200:publicProtestSchema}}},()=>({...row,count:'PRIVATE_NOT_A_NUMBER'}));try{const good=await app.inject('/good');assert.equal(good.statusCode,200);assert.equal(good.json().count,3);assert.equal(good.json().saldo_euros,1.25);assert.equal(good.json().convocatoria_osm_id,'1234567890123');const bad=await app.inject('/bad');assert.equal(bad.statusCode,500);assert.ok(!bad.body.includes('PRIVATE_'));}finally{await app.close();}
});

test('metadata columns are classified and public schema types match PostgreSQL',()=>{
 const metadata=JSON.parse(readFileSync(new URL('./fixtures/public-protest-schema-20261028.json',import.meta.url)));
 assert.deepEqual([...PUBLIC_PROTEST_FIELDS,...EXCLUDED_PROTEST_FIELDS].sort(),[...metadata.columns].sort());
 for(const column of metadata.column_metadata){if(!PUBLIC_PROTEST_FIELDS.includes(column.name))continue;const schema=publicProtestSchema.properties[column.name];if(column.name==='convocatoria_osm_id'){assert.equal(column.type,'bigint');continue;}const expected=['integer','smallint','numeric','double precision'].includes(column.type)?'number':column.type==='boolean'?'boolean':'string';assert.equal(schema.type,expected,column.name);}
 assert.equal(metadata.rpc.creator_hash_stored_in_private_table,true);
});
test('JSON-LD description round-trips raw text while HTML attributes and counts remain escaped',async()=>{
 const original={id:row.id,count:row.count,description:row.description};Object.assign(row,{id:'bad"><img src=x onerror=alert(1)>',count:'<img src=x onerror=alert(2)>',description:'Text & "quoted" <content>'});
 const app=Fastify();await app.register(sensible);await app.register(reports);try{const r=await app.inject({url:'/44444444-4444-4444-8444-444444444444',headers:{host:'reports.voiceprotest.org'}});assert.equal(r.statusCode,200);const json=r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];assert.equal(JSON.parse(json).description,row.description);assert.ok(!r.body.includes('<img src=x'));assert.ok(r.body.includes('&lt;img'));}finally{Object.assign(row,original);await app.close();}
});
test('ordinary creation database failure is sanitized without relying on server global error handler',async()=>{
 const app=Fastify();await app.register(sensible);await app.register(routes,{dependencies:{database,verifyCaptcha:async()=>{},notifyIndex:()=>{throw new Error('must not notify');},admissionRules:async()=>({ok:true,computedTargetValidation:'VALID',sourceInfo:{sourceType:'official_government',confidenceScore:90}})}});
 try{dbError={message:'PRIVATE_DB_FAILURE'};const r=await app.inject({method:'POST',url:'/',payload:{title:'Synthetic',country_name:'España',scope:'global',duration_h:24,fuente_url:'https://example.org',tipo_abuso:'corruption',demands:'Exigimos datos',recaptcha_token:'synthetic'}});assert.equal(r.statusCode,503);assert.equal(r.headers['cache-control'],'no-store');noPrivate(r.json());}finally{dbError=null;await app.close();}
});
