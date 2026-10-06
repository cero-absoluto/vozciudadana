import {FundingError} from './isolatedService.js';
const stores=new WeakSet();
const deny=()=>{throw new FundingError('durable_route_store_unavailable',503);};
// Disposable candidate composition only. Credentials never come from route input.
export function createDurableRouteStore({mode,database}){
 if(mode!=='isolated'||process.env.NODE_ENV==='production'||!database?.connect)deny();
 async function call(fn,args){let c;try{
  c=await database.connect();await c.query('BEGIN');
  const actor=(await c.query(`SELECT rolsuper,rolbypassrls,
   pg_has_role(current_user,'funding_route_runtime','MEMBER') AS route,
   pg_has_role(current_user,'service_role','MEMBER') AS service,
   pg_has_role(current_user,'funding_runtime','MEMBER') AS finance
   FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(!actor?.route||actor.rolsuper||actor.rolbypassrls||actor.service||actor.finance)deny();
  const result=(await c.query(`SELECT funding_route_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
  await c.query('COMMIT');return result;
 }catch{try{await c?.query('ROLLBACK');}catch{}deny();}finally{c?.release();}}
 const store={claim:(binding,event,operation)=>call('claim',[binding,event,operation]),
  bind:(binding,operation,id)=>call('bind',[binding,operation,id]),
  lookup:binding=>call('lookup',[binding]),close:event=>call('close_participation',[event])};
 stores.add(store);return Object.freeze(store);
}
export const isDurableRouteStore=value=>stores.has(value);
