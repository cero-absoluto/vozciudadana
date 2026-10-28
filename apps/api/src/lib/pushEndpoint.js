// Only browser push providers; the endpoint is never an arbitrary webhook.
export function isAllowedPushEndpoint(value){
  if(typeof value!=='string'||value.length>2048)return false;
  try{
    const u=new URL(value),host=u.hostname;
    // Browser endpoints are serialized URLs. Avoid parser differences with
    // the push library, which uses Node's legacy URL parser internally.
    if(u.href!==value)return false;
    const windows=host.endsWith('.notify.windows.com');
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash
      &&(!u.port||u.port==='443')
      &&(windows?(u.pathname.length>1||u.search.length>1):!u.search&&u.pathname.length>1
        &&(host==='fcm.googleapis.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.push.apple.com')));
  }catch{return false;}
}
