// Only composed by the isolated service. No provider, participation or production imports.
export function createSharedFundingAuthStore(database) {
  async function call(name,values) {
    try {
      const placeholders=values.map((_,i)=>`$${i+1}`).join(',');
      const result=await database.query(`SELECT funding_auth_private.${name}(${placeholders}) AS result`,values);
      return result.rows[0].result;
    } catch { const error=new Error('financial_auth_unavailable');error.code='financial_auth_unavailable';throw error; }
  }
  return {
    start:(id,rate,payload)=>call('start_challenge',[id,rate,JSON.stringify(payload)]),
    sent:(id,ok)=>call('finish_send',[id,ok]),
    claim:(id,operation)=>call('claim_challenge',[id,operation]),
    finish:(id,operation,outcome,digest)=>call('finish_verification',[id,operation,outcome,digest]),
    session:digest=>call('load_session',[digest]),
    cleanup:()=>call('cleanup_expired',[]),
  };
}
