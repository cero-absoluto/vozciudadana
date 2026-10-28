import {isIP} from 'node:net';
export function registerHealthRoutes(app,{diagnosticUntil=process.env.CLIENT_IP_DIAGNOSTIC_UNTIL,clock=Date.now}={}){
 const deadline=diagnosticUntil?Date.parse(diagnosticUntil):0;
 if(diagnosticUntil&&(!Number.isFinite(deadline)||deadline>clock()+15*60_000))throw new Error('Client IP diagnostic requires a valid deadline within 15 minutes');
 // Internal liveness deliberately does not require edge metadata.
 app.get('/health',{config:{rateLimit:false}},async()=>({status:'ok'}));
 // Optional, time-bounded comparison reveals no raw IP, credentials or hashes.
 // Readiness still traverses the ordinary client-IP policy and quotas.
 app.get('/ready',async(req,reply)=>{
  reply.header('Cache-Control','no-store');
  const expected=req.headers['x-vp-expected-egress'];
  if(deadline>clock()&&expected!==undefined){
   if(typeof expected!=='string'||isIP(expected)!==4)return reply.code(400).send({error:'INVALID_EXPECTED_EGRESS'});
   return {status:'ok',clientIpMatchesExpected:req.ip===expected};
  }
  return {status:'ok'};
 });
}
