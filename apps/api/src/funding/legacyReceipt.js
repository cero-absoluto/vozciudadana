import {createHash,timingSafeEqual} from 'node:crypto';
import {FundingError} from './isolatedService.js';
const check=(v,c,s=400)=>{if(!v)throw new FundingError(c,s);};
const guard=mode=>check(mode==='isolated'&&process.env.NODE_ENV!=='production','isolated_legacy_receipt_required',503);
export function createLegacyReceiptFixtureAdapter({secret,fundingSecret,ownerSecret,participationSecret,mode}){
 guard(mode);check([secret,fundingSecret,ownerSecret,participationSecret].every(s=>typeof s==='string'&&Buffer.byteLength(s)>=32)&&![fundingSecret,ownerSecret,participationSecret].includes(secret),'fixture_receipt_secret_required',503);
 return {kind:'synthetic_legacy_receipt',normalize(credential,input){
  const a=Buffer.from(typeof credential==='string'?credential:''),b=Buffer.from(secret);check(a.length===b.length&&timingSafeEqual(a,b),'legacy_receipt_auth_required',401);
  check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['reference','amountCents','currency','effectiveAt','eventRef'].includes(k)),'invalid_legacy_receipt');
  const {reference,amountCents,currency,effectiveAt=null,eventRef=null}=input;
  check(typeof reference==='string'&&/^synthetic_legacy_[a-z0-9_-]{1,96}$/.test(reference)&&Number.isSafeInteger(amountCents)&&amountCents>0&&typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)&&(effectiveAt===null||(typeof effectiveAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(effectiveAt)&&Number.isFinite(Date.parse(effectiveAt))))&&(eventRef===null||(typeof eventRef==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(eventRef))),'invalid_legacy_receipt');
  const normalized={reference,amountCents,currency,effectiveAt:effectiveAt===null?null:new Date(effectiveAt).toISOString(),eventRef:eventRef===null?null:eventRef.toLowerCase()};
  return {...normalized,digest:createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),evidenceRef:'e0000000-0000-0000-0000-000000000001'};
 }};
}
export function createLegacyReceiptService({database,adapter,mode}){
 guard(mode);check(adapter?.kind==='synthetic_legacy_receipt','fixture_receipt_adapter_required',503);
 return {async receive(credential,input){
  const notice=adapter.normalize(credential,input),client=await database.connect();
  try{await client.query('BEGIN');const result=(await client.query('SELECT funding_legacy_receipt_private.receive($1,$2,$3,$4,$5,$6,$7) AS result',[notice.reference,notice.amountCents,notice.currency,notice.effectiveAt,notice.eventRef,notice.digest,notice.evidenceRef])).rows[0].result;
   await client.query('COMMIT');return {...result,received:true,simulated:true};
  }catch(e){try{await client.query('ROLLBACK');}catch{}const code=['idempotency_conflict','invalid_legacy_receipt','legacy_receipt_actor_required'].find(c=>e.message?.includes(c));throw new FundingError(code??'legacy_receipt_unavailable',code?409:503);
  }finally{client.release();}
 }};
}
// Isolated HTTP fixture only; never registered in the production server.
export async function legacyReceiptFixtureRoutes(app,{service}){
 app.post('/fixture/legacy-receipts',{bodyLimit:4096},async(req,reply)=>{try{return await service.receive(req.headers['x-fixture-receipt-auth'],req.body);}catch(e){return reply.code(e.statusCode??503).send({error:e.code??'legacy_receipt_unavailable'});}});
}
