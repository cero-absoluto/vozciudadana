import test from 'node:test';
import assert from 'node:assert/strict';
import {readReportAdhesions,MAX_REPORT_ROWS} from '../apps/api/src/lib/reportAdhesions.js';
function dbFor(rows,{cap=500,missingCount=false,duplicate=false,error=false,changed=false}={}){
 const calls=[];return {calls,from(){let start,end;const q={select(fields,options){assert.equal(options.count,'exact');assert.ok(fields.startsWith('id,'));return q;},eq(){return q;},is(){return q;},order(){return q;},range(a,b){start=a;end=b;return q;},abortSignal(signal){calls.push({start,end,signal});return Promise.resolve({data:duplicate&&start>0?[rows[0]]:rows.slice(start,Math.min(end+1,start+cap)),count:missingCount?null:rows.length+(changed&&start>0?1:0),error:error?{}:null});}};return q;}};
}
const rows=n=>Array.from({length:n},(_,i)=>({id:'synthetic-'+i}));
test('platform cap smaller than requested pages cannot silently truncate the report',async()=>{
 const db=dbFor(rows(1200),{cap:100});const result=await readReportAdhesions(db,'synthetic');assert.equal(result.length,1200);assert.equal(db.calls.length,12);assert.deepEqual(db.calls.map(c=>c.start),Array.from({length:12},(_,i)=>i*100));assert.ok(db.calls.every(c=>c.signal.aborted));
});
for(const options of [{missingCount:true},{duplicate:true,cap:1},{error:true},{changed:true,cap:1}])test('uncertain report coverage fails closed '+JSON.stringify(options),async()=>{
 await assert.rejects(readReportAdhesions(dbFor(rows(3),options),'synthetic'));
});
test('empty report is complete and bounded',async()=>{assert.deepEqual(await readReportAdhesions(dbFor([]),'synthetic'),[]);});
test('over-budget reports and exhausted page budgets fail rather than returning partial data',async()=>{
 await assert.rejects(readReportAdhesions(dbFor(rows(MAX_REPORT_ROWS+1)),'synthetic'));
 await assert.rejects(readReportAdhesions(dbFor(rows(3),{cap:1}),'synthetic',{maxPages:2}));
});
test('deadline covers even a transport that ignores abort',async()=>{
 const db={from(){const q={select(){return q;},eq(){return q;},is(){return q;},order(){return q;},range(){return q;},abortSignal(){return new Promise(()=>{});}};return q;}};
 await assert.rejects(readReportAdhesions(db,'synthetic',{timeoutMs:10}),{name:'TimeoutError'});
});

test('installed Supabase client sends exact count and ordered range pagination correctly',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const data=rows(5),requests=[];
 const client=createClient('https://synthetic-db.invalid','synthetic-not-a-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
  const u=new URL(url),start=Number(u.searchParams.get('offset')||0),size=Number(u.searchParams.get('limit'));
  assert.equal(size,Math.min(2,5-start));assert.equal(u.searchParams.get('order'),'created_at.asc,id.asc');assert.ok(new Headers(options.headers).get('prefer').includes('count=exact'));
  requests.push({start,signal:options.signal});
  return new Response(JSON.stringify(data.slice(start,start+size)),{status:200,headers:{'Content-Type':'application/json','Content-Range':`${start}-${start+size-1}/5`}});
 }}});
 assert.equal((await readReportAdhesions(client,'synthetic',{pageSize:2})).length,5);
 assert.deepEqual(requests.map(r=>r.start),[0,2,4]);assert.ok(requests.every(r=>r.signal.aborted));
});
