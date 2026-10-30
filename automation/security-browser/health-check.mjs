import {fileURLToPath} from 'node:url';
import {contentSecurityPolicy,stripHtmlComments} from './csp.mjs';
export const CHECKS=[...['api.voiceprotest.org','reports.voiceprotest.org','vozciudadanaapi-production.up.railway.app'].flatMap((host,i)=>['health','ready'].map(path=>({id:`api_${i+1}_${path}`,url:`https://${host}/${path}`,type:'api'}))),...['/','/quienes-somos.html','/en/quienes-somos.html','/fr/quienes-somos.html','/zh/quienes-somos.html'].map((path,i)=>({id:'web_policy_'+i,url:'https://voiceprotest.org'+path,type:'web'}))];
export function hasBrowserPolicy(html){
 try{
  html=stripHtmlComments(html);
  const match=/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(html);
  return !!match && match[1]===contentSecurityPolicy(html)
    && match.index<html.search(/<script\b/i)
    && /<meta name="referrer" content="strict-origin">/i.test(html);
 }catch{return false;}
}
export async function checkHealth({fetchImpl=fetch,timeoutMs=5000,clock=Date.now}={}){
 const at=new Date(clock()).toISOString();
 const checks=await Promise.all(CHECKS.map(async item=>{
  const controller=new AbortController();let timer,reader,reason='TIMEOUT_OR_NETWORK';
  const task=(async()=>{
   const response=await fetchImpl(item.url,{signal:controller.signal,redirect:'error',cache:'no-store',headers:{Accept:item.type==='api'?'application/json':'text/html'}});
   if(response.status!==200){reason='HTTP_STATUS';throw Error();}
   reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
   if(!reader){reason='INVALID_BODY';throw Error();}
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(item.type==='api'?2048:65536)){reason='BODY_LIMIT';throw Error();}text+=decoder.decode(value,{stream:true});}
   text+=decoder.decode();
   if(item.type==='api'){let data;try{data=JSON.parse(text);}catch{reason='INVALID_HEALTH';throw Error();}if(data?.status!=='ok'||Object.keys(data).some(k=>k!=='status')){reason='INVALID_HEALTH';throw Error();}}
   else if(!hasBrowserPolicy(text)){reason='MISSING_BROWSER_POLICY';throw Error();}
   return {id:item.id,ok:true};
  })();
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},timeoutMs);})]);}
  catch{return{id:item.id,ok:false,reason};}
  finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 }));
 return {checked_at_utc:at,read_only:true,ok:checks.every(c=>c.ok),checks,limits:'Point-in-time public health and HTML policy checks. No user rows, credentials or provider actions; not a security guarantee or a replacement for external IP tests.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await checkHealth();console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=1;}
