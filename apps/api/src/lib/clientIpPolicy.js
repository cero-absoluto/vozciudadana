import {proxyTrustFromEnv} from './proxyPolicy.js';
import {railwayEdgeIpResolver} from './railwayEdgeIp.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function clientIpPolicyFromEnv(env=process.env){
 const mode=env.CLIENT_IP_MODE||'cidr';
 if(mode==='cidr')return {mode,trustProxy:proxyTrustFromEnv(env),install(){}};
 if(mode!=='railway_edge')throw Error('CLIENT_IP_MODE must be cidr or railway_edge');
 if(env.NODE_ENV!=='production')throw Error('Railway edge mode requires NODE_ENV=production');
 if(env.TRUSTED_PROXY_CIDRS?.trim())throw Error('Railway edge mode cannot be combined with TRUSTED_PROXY_CIDRS');
 const ids=[env.RAILWAY_PROJECT_ID,env.RAILWAY_ENVIRONMENT_ID,env.RAILWAY_SERVICE_ID];
 if(ids.some(id=>!UUID.test(id||''))||env.RAILWAY_EDGE_BOUNDARY!==ids.join('/'))throw Error('RAILWAY_EDGE_BOUNDARY must acknowledge this isolated project/environment/service');
 const resolve=railwayEdgeIpResolver({isolatedHttpIngressConfirmed:true});
 return {mode,trustProxy:false,install(app){
  // Root hook, installed before rate-limit and all application routes.
  app.addHook('onRequest',async req=>{
   // Only this already-routed, read-only health endpoint may omit client evidence.
   if(['GET','HEAD'].includes(req.method)&&req.routeOptions.url==='/health')return;
   Object.defineProperty(req,'ip',{value:resolve(req.raw)});
  });
 }};
}
