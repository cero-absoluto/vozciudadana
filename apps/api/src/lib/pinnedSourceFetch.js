import http from 'node:http';
import https from 'node:https';
import { Readable, pipeline } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { isIP } from 'node:net';
import { isPublicSourceAddress } from './sourceAddressPolicy.js';

export function pinnedSourceFetch(url,{addresses,signal,headers},requestImpl){
  const parsed=new URL(url);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.port||parsed.username||parsed.password
    ||!addresses?.length||addresses.some(r=>!isPublicSourceAddress(r.address)||isIP(r.address)!==r.family))return Promise.reject(new Error('invalid_source_target'));
  const host=parsed.hostname.replace(/^\[|\]$/g,'');
  if(isIP(host)&&(!isPublicSourceAddress(host)||!addresses.some(r=>r.address===host)))return Promise.reject(new Error('invalid_source_target'));
  // No pooled socket can inherit a connection authorized for another answer.
  const options={agent:false,signal,headers:{...headers,Host:parsed.host,'Accept-Encoding':'gzip, deflate, br'},
    lookup(_hostname,opts,callback){
      const records=addresses.filter(r=>!opts.family||r.family===opts.family);
      queueMicrotask(()=>records.length?opts.all?callback(null,records):callback(null,records[0].address,records[0].family):callback(new Error('no_validated_address')));
    },
  };
  if(parsed.protocol==='https:')options.servername=isIP(host)?'':host;
  const request=requestImpl||(parsed.protocol==='https:'?https.request:http.request);
  return new Promise((resolve,reject)=>{
    const req=request(parsed,options,incoming=>{
      try {
      const responseHeaders=new Headers();
      for(const [key,value] of Object.entries(incoming.headers))if(value!==undefined)responseHeaders.set(key,Array.isArray(value)?value.join(', '):value);
      let body=incoming;
      const encoding=(incoming.headers['content-encoding']||'identity').toLowerCase();
      const decoder=encoding==='gzip'?createGunzip():encoding==='deflate'?createInflate():encoding==='br'?createBrotliDecompress():null;
      if(encoding!=='identity'&&!decoder){incoming.destroy();reject(new Error('unsupported_encoding'));return;}
      if(decoder){pipeline(incoming,decoder,()=>{});body=decoder;responseHeaders.delete('content-encoding');responseHeaders.delete('content-length');}
        const empty=[204,205,304].includes(incoming.statusCode);
        resolve(new Response(empty?null:Readable.toWeb(body),{status:incoming.statusCode,headers:responseHeaders}));
        if(empty)incoming.destroy();
      }catch(error){incoming.destroy();reject(error);}
    });
    req.on('error',reject);
    req.end();
  });
}
