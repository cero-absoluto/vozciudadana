import {withRequestDeadline} from './requestDeadline.js';
const FIELDS='id, verification_method, ciudad, region, pais, pais_code, idioma, created_at, gps_confirmed, fiabilidad, senales, adhesion_osm_id';
// Bound public report work. Never turn a platform row cap into a partial report.
export const MAX_REPORT_ROWS=20_000;
export async function readReportAdhesions(database,protestId,{timeoutMs=6000,pageSize=500,maxPages=80}={}) {
 return withRequestDeadline(timeoutMs,async(signal,wait)=>{
  const rows=[],seen=new Set();let expected=null;
  for(let page=0;page<maxPages;page++) {
   const end=rows.length+Math.min(pageSize,expected===null?pageSize:expected-rows.length)-1;
   const result=await wait(database.from('adhesions').select(FIELDS,{count:'exact'}).eq('protest_id',protestId).is('deleted_at',null)
    .order('created_at',{ascending:true}).order('id',{ascending:true}).range(rows.length,end).abortSignal(signal));
   if(result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count<0 || result.count>MAX_REPORT_ROWS)throw new Error('Report data unavailable');
   if(expected===null)expected=result.count;
   if(result.count!==expected || result.data.length>end-rows.length+1 || rows.length+result.data.length>expected)throw new Error('Report changed during read');
   for(const row of result.data) {
    if(typeof row?.id!=='string' || seen.has(row.id))throw new Error('Report data inconsistent');
    seen.add(row.id);rows.push(row);
   }
   if(rows.length===expected)return rows;
   if(result.data.length===0)throw new Error('Report data incomplete');
  }
  throw new Error('Report read limit reached');
 });
}
