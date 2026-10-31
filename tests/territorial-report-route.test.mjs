import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
mock.module('../apps/api/src/services/supabase.js',{namedExports:{supabase:{}}});
const {default:routes}=await import('../apps/api/src/routes/protests.js');
const id='11111111-1111-4111-8111-111111111111';
const rows=[{gps_confirmed:true,ciudad:'Synthetic',pais_code:'ES',adhesion_osm_id:123},{gps_confirmed:true,ciudad:'Elsewhere',pais_code:'ES'},{gps_confirmed:false,pais_code:'ES'},{gps_confirmed:true,ciudad:'Synthetic',pais_code:'FR',adhesion_osm_id:123},{gps_confirmed:false,pais:'Spain'}].map((a,i)=>({id:'22222222-2222-4222-8222-'+String(i+1).padStart(12,'0'),created_at:'2026-01-01T00:00:00Z',...a}));
async function appFor({error=null,data=rows,count=5,scope='local',cap=500}={}){
 const database={from(table){let start=0,end=499;const q={select(){return q;},eq(){return q;},is(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},single:async()=>({data:{id,scope,country:'ES',country_name:'España',convocatoria_ciudad_nombre:'Synthetic',convocatoria_osm_id:123,count}}),abortSignal:async()=>({data:Array.isArray(data)?data.slice(start,Math.min(end+1,start+cap)):data,error,count:Array.isArray(data)?data.length:0})};return q;}};
 const app=Fastify();await app.register(sensible);await app.register(routes,{dependencies:{database}});return app;
}
test('actual report route partitions all five rows without trusting OSM collision or country names',async()=>{
 const app=await appFor();try{const r=await app.inject('/'+id+'/informe');assert.equal(r.statusCode,200,r.body);const b=r.json(),dg=b.desglose_geografico_local;for(const key of ['gps_local','gps_nacional','nacionales_sin_gps','internacionales','sin_pais'])assert.equal(dg[key],1,key);assert.equal(dg.total,5);assert.equal(dg.local_verified.geo_scope_source,'gps_geocoder_name_country');assert.deepEqual(b.distribucion_paises,['ES','FR']);assert.equal(b.evidential_scope.demonstrates.find(x=>x.key==='demonstrates.local_verified_municipality').params.total,5);}finally{await app.close();}
});
test('analyzed denominator is explicit when the stored counter differs',async()=>{
 const app=await appFor({count:20});try{const r=await app.inject('/'+id+'/informe'),b=r.json();assert.equal(b.total_adhesiones,20);assert.equal(b.desglose_geografico_local.total,5);assert.equal(b.desglose_geografico_local.reported_total,20);assert.equal(b.evidential_scope.demonstrates.find(x=>x.key==='demonstrates.local_verified_municipality').params.total,5);}finally{await app.close();}
});
for(const result of [{data:null},{error:{message:'PRIVATE_DATABASE_DETAIL'}}])test('report row read failure returns controlled 503 rather than a geographic classification',async()=>{
 const app=await appFor(result);try{const r=await app.inject('/'+id+'/informe');assert.equal(r.statusCode,503);assert.equal(r.headers['cache-control'],'no-store');assert.ok(!r.body.includes('PRIVATE_DATABASE_DETAIL'));}finally{await app.close();}
});

test('stored counter below analyzed rows never creates negative non-GPS counts',async()=>{
 const app=await appFor({count:1,cap:2});try{const r=await app.inject('/'+id+'/informe'),b=r.json();assert.equal(r.statusCode,200,r.body);assert.equal(b.total_analizado,5);assert.equal(b.adhesiones_sin_gps,2);assert.equal(b.report_coverage.complete,true);assert.equal(b.report_coverage.counter_matches,false);}finally{await app.close();}
});
test('regional report route compares region rather than city',async()=>{
 const app=await appFor({scope:'regional',data:rows.map((a,i)=>({...a,ciudad:'Elsewhere',region:i===0?'Synthetic':'Elsewhere'}))});try{const r=await app.inject('/'+id+'/informe');assert.equal(r.statusCode,200,r.body);assert.equal(r.json().desglose_geografico_local.gps_local,1);}finally{await app.close();}
});

test('actual report derives mixed methods from rows and never exposes row identifiers',async()=>{
 const app=await appFor({data:rows.map((r,i)=>({...r,verification_method:i===0?'phone_otp':i===1?'institutional_email_otp':null}))});
 try{const r=await app.inject('/'+id+'/informe');assert.equal(r.statusCode,200,r.body);const scope=r.json().evidential_scope;assert.equal(scope.version,2);assert.equal(scope.recorded_methods.counts.unknown,3);assert.equal(scope.recorded_methods.counts.phone_otp,1);assert.ok(!r.body.includes(rows[0].id));}finally{await app.close();}
});
