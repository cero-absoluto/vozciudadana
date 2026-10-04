import {createHash,randomUUID} from 'node:crypto';
import {FundingError} from './isolatedService.js';
import {createIsolatedReviewAuthenticator,createIsolatedReviewService} from './isolatedReview.js';
const check=(v,c,s=403)=>{if(!v)throw new FundingError(c,s);};
export function ownerOperationDigest(kind,input){
 const keys=kind==='issue'?['requestId','action','intentId','amountCents','sourceAccount','expiresAt','evidenceRef','movementRef']:['requestId','decisionId','evidenceRef'];
 check(['issue','revoke'].includes(kind)&&input&&Object.keys(input).every(k=>keys.includes(k)),'invalid_owner_binding',400);
 const normalized=keys.map(k=>[k,input[k]??null]);return createHash('sha256').update(JSON.stringify([kind,normalized])).digest('hex');
}
// Identity verification is an independently composed fixture adapter, never caller metadata.
export function createOwnerAuthorityService({database,identity,mode}){
 check(mode==='isolated'&&process.env.NODE_ENV!=='production'&&identity?.kind==='synthetic_verified_identity'&&typeof identity.verify==='function'&&typeof identity.verifyConfirmation==='function','isolated_owner_authority_required',503);
 const secret=randomUUID()+randomUUID();
 const auth=createIsolatedReviewAuthenticator({reviewSecret:secret,fundingSecret:'fixture-finance-'.repeat(4),providerSecret:'fixture-provider-'.repeat(4),participationSecret:'fixture-participation-'.repeat(4),mode});
 async function tx(fn){const client=await database.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 async function verify(client,credential,sensitive=false){
  const claims=await identity.verify(credential);check(claims?.issuer==='synthetic_owner_issuer'&&claims.audience==='funding_owner_review'&&typeof claims.subject==='string'&&typeof claims.sessionId==='string'&&/^[a-f0-9-]{36}$/i.test(claims.sessionId)&&Number.isInteger(claims.epoch)&&Number.isFinite(claims.expiresAt)&&claims.expiresAt>Date.now(),'owner_identity_required');
  if(sensitive)check(claims.stepUp===true,'owner_confirmation_required');
  const actor=(await client.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'funding_review','MEMBER') AS reviewer,pg_has_role(current_user,'funding_runtime','MEMBER') AS finance,pg_has_role(current_user,'service_role','MEMBER') AS service FROM pg_roles WHERE rolname=current_user")).rows[0];
  check(actor?.reviewer&&!actor.rolsuper&&!actor.rolbypassrls&&!actor.finance&&!actor.service,'review_connection_required',503);
  const principal=(await client.query('SELECT id FROM funding_owner_private.principals WHERE issuer=$1 AND subject=$2',[claims.issuer,claims.subject])).rows[0];check(principal,'owner_identity_required');
  await client.query('SELECT funding_owner_private.check_authority($1,$2)',[principal.id,claims.epoch]);
  check(!(await client.query('SELECT session_id FROM funding_owner_private.session_revocations WHERE session_id=$1',[claims.sessionId])).rows.length,'owner_session_revoked');return {principal:principal.id,epoch:claims.epoch};
 }
 async function operate(credential,kind,input,challengeId,confirmation){return tx(async client=>{
  const p=await verify(client,credential,true),digest=ownerOperationDigest(kind,input);
  check(await identity.verifyConfirmation(confirmation,{digest,challengeId,principal:p.principal,epoch:p.epoch}),'owner_confirmation_required');
  const prior=(await client.query('SELECT * FROM funding_owner_private.bindings WHERE request_id=$1',[input.requestId])).rows[0];
  if(prior){check(prior.digest===digest&&prior.kind===kind&&prior.principal===p.principal&&prior.epoch===p.epoch,'idempotency_conflict',409);return {decisionId:prior.decision_id,fundsMoved:false,replay:true};}
  const challenge=(await client.query('SELECT * FROM funding_owner_private.challenges WHERE id=$1 FOR UPDATE',[challengeId])).rows[0];
  check(challenge&&challenge.principal===p.principal&&challenge.epoch===p.epoch&&challenge.digest===digest&&!challenge.consumed&&new Date(challenge.expires_at).getTime()>Date.now(),'owner_confirmation_required');
  const review=createIsolatedReviewService({database:client,authenticator:auth,mode});
  const result=kind==='issue'?await review.decide(secret,input):await review.revoke(secret,input.decisionId,{requestId:input.requestId,evidenceRef:input.evidenceRef});
  await client.query('UPDATE funding_owner_private.challenges SET consumed=true WHERE id=$1',[challengeId]);
  await client.query('INSERT INTO funding_owner_private.bindings(request_id,decision_id,kind,principal,epoch,digest,challenge) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,result.decisionId,kind,p.principal,p.epoch,digest,challengeId]);return {...result,authority:'synthetic_verified_identity'};
 });}
 return {
  challenge:(credential,kind,input)=>tx(async client=>{const p=await verify(client,credential,true),digest=ownerOperationDigest(kind,input),id=randomUUID();await client.query("INSERT INTO funding_owner_private.challenges(id,principal,epoch,digest,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 minutes')",[id,p.principal,p.epoch,digest]);return {challengeId:id,testOnlyTTL:true};}),
  decide:(credential,input,challenge,confirmation)=>operate(credential,'issue',input,challenge,confirmation),
  revoke:(credential,input,challenge,confirmation)=>operate(credential,'revoke',input,challenge,confirmation),
  cases:credential=>tx(async client=>{await verify(client,credential);return createIsolatedReviewService({database:client,authenticator:auth,mode}).cases(secret);}),
 };
}
