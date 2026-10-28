import {isValidClientIp} from './clientIp.js';
// Enabled only through the explicit client IP policy. The operator must
// first establish an isolated HTTP-edge listener with no private/TCP bypass.
// This acknowledgement is an operational prerequisite, not peer authentication.
export function railwayEdgeIpResolver({isolatedHttpIngressConfirmed=false}={}){
 if(isolatedHttpIngressConfirmed!==true)throw Error('Verified isolated Railway HTTP ingress is required');
 return raw=>{
  const occurrences=(raw.rawHeaders||[]).filter((_,i)=>i%2===0).filter(k=>k.toLowerCase()==='x-real-ip').length;
  const ip=raw.headers?.['x-real-ip'];
  if(occurrences!==1||!isValidClientIp(ip))throw Object.assign(new Error('CLIENT_IP_UNAVAILABLE'),{statusCode:400});
  if(!ip.includes(':'))return ip;
  const normalized=new URL(`http://[${ip}]/`).hostname.slice(1,-1);
  const mapped=normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if(!mapped)return normalized;
  const hi=parseInt(mapped[1],16),lo=parseInt(mapped[2],16);
  return [hi>>>8,hi&255,lo>>>8,lo&255].join('.');
 };
}
