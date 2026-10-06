import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {FundingError} from './isolatedService.js';
const vaults=new WeakSet();
const deny=()=>{throw new FundingError('private_lookup_unavailable',503);};
export function createPrivateLookupVault({mode,database,key}){
 if(mode!=='isolated'||process.env.NODE_ENV==='production'||!database?.connect||!Buffer.isBuffer(key)||key.length!==32)deny();
 const secret=Buffer.from(key);
 async function tx(work){let c;try{c=await database.connect();await c.query('BEGIN');
  const a=(await c.query(`SELECT rolsuper,rolbypassrls,
   pg_has_role(current_user,'funding_lookup_runtime','MEMBER') AS vault,
   pg_has_role(current_user,'service_role','MEMBER') AS service,
   pg_has_role(current_user,'funding_runtime','MEMBER') AS finance,
   pg_has_role(current_user,'funding_route_runtime','MEMBER') AS route
   FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(!a?.vault||a.rolsuper||a.rolbypassrls||a.service||a.finance||a.route)deny();
  const r=await work(c);await c.query('COMMIT');return r;
 }catch{try{await c?.query('ROLLBACK');}catch{}deny();}finally{c?.release();}}
 function decrypt(id,row){if(!row)deny();const d=createDecipheriv('aes-256-gcm',secret,Buffer.from(row.iv,'hex'));d.setAAD(Buffer.from(id));d.setAuthTag(Buffer.from(row.tag,'hex'));return Buffer.concat([d.update(Buffer.from(row.ciphertext,'hex')),d.final()]).toString('utf8');}
 const vault={async put(id,sid){if(!/^[a-f0-9-]{36}$/.test(id)||!/^VE[a-f0-9]{32}$/i.test(sid))deny();
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(sid),cipher.final()]);
  return tx(async c=>{await c.query(`INSERT INTO funding_lookup_private.references(operation_id,iv,tag,ciphertext)
   VALUES($1,$2,$3,$4) ON CONFLICT(operation_id) DO NOTHING`,[id,iv.toString('hex'),cipher.getAuthTag().toString('hex'),data.toString('hex')]);
   const row=(await c.query('SELECT iv,tag,ciphertext FROM funding_lookup_private.references WHERE operation_id=$1 AND expires_at>clock_timestamp()',[id])).rows[0];
   if(decrypt(id,row)!==sid)deny();return {stored:true};});
 },async get(id){return tx(async c=>decrypt(id,(await c.query('SELECT iv,tag,ciphertext FROM funding_lookup_private.references WHERE operation_id=$1 AND expires_at>clock_timestamp()',[id])).rows[0]));}};
 vaults.add(vault);return Object.freeze(vault);
}
export const isPrivateLookupVault=value=>vaults.has(value);
