import {createHash,createHmac} from 'node:crypto';
import {FundingError,fundingTokens} from './isolatedService.js';
const purposes=['annual','event','rate','session','otp','provider','review'];
const assert=(ok,code)=>{if(!ok)throw new FundingError(code,503);};
export function createFundingKeyContinuity({mode,database,versions,currentVersion,participationSecret}){
 assert(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only');
 assert(Array.isArray(versions)&&versions.length>0&&versions.some(v=>v.id===currentVersion),'key_provenance_required');
 const seen=new Set(),manifest=[];
 for(const v of versions){assert(/^[a-z0-9_]{1,32}$/.test(v.id)&&!seen.has(v.id),'key_provenance_required');seen.add(v.id);
 assert(['synthetic_v1_known','synthetic_split'].includes(v.provenance),'key_provenance_required');
 const secrets=purposes.map(p=>v.secrets?.[p]);for(const s of secrets)assert(typeof s==='string'&&Buffer.byteLength(s)>=32&&s!==participationSecret,'independent_funding_secret_required');
 if(v.provenance==='synthetic_split')assert(new Set(secrets).size===purposes.length,'purpose_key_reuse');
 for(const p of purposes)manifest.push({purpose:p,version:v.id});}
 for(const v of versions.filter(v=>v.provenance==='synthetic_split'))for(const p of purposes)for(const other of versions)for(const q of purposes)if(p!==q)assert(v.secrets[p]!==other.secrets[q],'purpose_key_reuse');
 // Copy config so callers cannot mutate a live keyring to bypass initial checks.
 const ring=versions.map(v=>({id:v.id,provenance:v.provenance,secrets:{...v.secrets}}));
 const mac=(secret,value)=>createHmac('sha256',secret).update(value).digest('hex');
 const sessionDigest=(v,bearer)=>mac(v.secrets.session,JSON.stringify(['voice-protest:funding:session:v1',bearer]));
 async function query(s,args=[]){try{return await database.query(s,args);}catch(e){throw new FundingError(e.message?.includes('quota_alias_conflict')?'quota_alias_conflict':'key_provenance_required',503);}}
 const candidates=(normalized,year,eventId)=>Object.fromEntries(['annual','event','rate'].map(p=>[p,ring.map(v=>{
 const token=p==='rate'?mac(v.secrets.rate,`rate:${normalized}`):fundingTokens(v.secrets[p],normalized,year,eventId)[p];return {version:v.id,token};})]));
 return {
  initialTokens(normalized,year,eventId){const v=ring.find(v=>v.id===currentVersion);return {annual:fundingTokens(v.secrets.annual,normalized,year,eventId).annual,event:eventId?fundingTokens(v.secrets.event,normalized,year,eventId).event:null};},
  async assertReady(){await query('SELECT funding_private.assert_key_manifest($1)',[JSON.stringify(manifest)]);const rows=(await query('SELECT purpose,version,provenance,key_commitment FROM funding_private.key_versions')).rows;assert(rows.every(r=>ring.find(v=>v.id===r.version)?.provenance===r.provenance&&createHash('sha256').update(ring.find(v=>v.id===r.version).secrets[r.purpose]).digest('hex')===r.key_commitment),'key_provenance_required');},
  async start(id,normalized,payload){await this.assertReady();const c=candidates(normalized,payload.year,payload.eventId);return (await query('SELECT funding_auth_private.start_continuity($1,$2,$3,$4,$5) AS result',[id,JSON.stringify(payload),JSON.stringify(c),JSON.stringify(manifest),currentVersion])).rows[0].result;},
  async finish(id,operation,outcome,bearer){await this.assertReady();const row=(await query('SELECT session_version FROM funding_auth_private.continuity_challenges WHERE challenge_id=$1',[id])).rows[0];assert(row,'key_provenance_required');const v=ring.find(v=>v.id===row.session_version);assert(v,'key_provenance_required');return (await query('SELECT funding_auth_private.finish_continuity($1,$2,$3,$4,$5) AS result',[id,operation,outcome,bearer?sessionDigest(v,bearer):null,JSON.stringify(manifest)])).rows[0].result;},
  async revoke(bearer){await this.assertReady();for(const v of ring){const digest=sessionDigest(v,bearer);await query('INSERT INTO funding_auth_private.session_revocations(digest) SELECT digest FROM funding_auth_private.verified_sessions WHERE digest=$1 ON CONFLICT DO NOTHING',[digest]);}return {revoked:true,source:'isolated_fixture'};},
  async session(bearer){await this.assertReady();const matches=[];for(const v of ring){const s=(await query('SELECT funding_auth_private.load_session($1) AS result',[sessionDigest(v,bearer)])).rows[0].result;if(s)matches.push(s);}assert(matches.length<=1,'session_version_conflict');const s=matches[0];if(!s)return null;
  const r=(await query("SELECT EXISTS(SELECT 1 FROM funding_private.quota_scopes WHERE purpose='annual' AND scope_ref=$1 AND canonical_token=$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM funding_private.quota_scopes WHERE purpose='event' AND scope_ref=$3 AND canonical_token=$4)) AS valid",[String(s.year),s.tokens.annual,s.eventId,s.tokens.event])).rows[0];assert(r.valid,'reverify_for_key_continuity');return s;},
 };
}

export function createIsolatedCleanupService({mode,database}){
 assert(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_only');
 return {async run(requestId){assert(/^[0-9a-f-]{36}$/.test(requestId),'invalid_cleanup_request');
 const actor=(await database.query("SELECT r.rolsuper,r.rolbypassrls,pg_has_role(current_user,'funding_cleanup','MEMBER') AS cleaner,pg_has_role(current_user,'funding_runtime','MEMBER') AS finance,pg_has_role(current_user,'funding_review','MEMBER') AS reviewer,pg_has_role(current_user,'service_role','MEMBER') AS service FROM pg_roles r WHERE rolname=current_user")).rows[0];
 assert(actor?.cleaner&&!actor.rolsuper&&!actor.rolbypassrls&&!actor.finance&&!actor.reviewer&&!actor.service,'cleanup_role_required');
 try{return (await database.query('SELECT funding_auth_private.run_cleanup($1) AS result',[requestId])).rows[0].result;}catch(e){throw new FundingError(e.message?.includes('cleanup_policy_required')?'cleanup_policy_required':'cleanup_unavailable',503);}
 }};
}
