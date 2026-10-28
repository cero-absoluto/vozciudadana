import {isValidClientIp} from './clientIp.js';
// Preserve the full address for location evidence; group only abuse-control keys.
export function ipQuotaKey(ip,prefix=64){
 if(![48,64].includes(prefix))throw new TypeError('Unsupported quota prefix');
 if(!isValidClientIp(ip))return 'invalid-client-ip';
 if(!ip.includes(':'))return ip;
 const canonical=new URL(`http://[${ip}]/`).hostname.slice(1,-1);
 const halves=canonical.split('::');
 const left=halves[0]?halves[0].split(':'):[];
 const right=halves[1]?halves[1].split(':'):[];
 const words=(halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left).map(x=>parseInt(x,16));
 const mapped=words.slice(0,5).every(x=>x===0)&&words[5]===0xffff;
 const compatible=words.slice(0,6).every(x=>x===0)&&words[6]>0;
 const nat64=words[0]===0x64&&words[1]===0xff9b&&words.slice(2,6).every(x=>x===0);
 if(mapped||compatible||nat64)return [words[6]>>>8,words[6]&255,words[7]>>>8,words[7]&255].join('.');
 return words.slice(0,prefix/16).map(x=>x.toString(16)).join(':')+'::/'+prefix;
}
