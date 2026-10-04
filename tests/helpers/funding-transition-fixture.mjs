// TEST FIXTURE ONLY. A cooperative barrier, never a production writer fence.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const transitionSQL=`
CREATE ROLE synthetic_transition_legacy NOLOGIN;
CREATE ROLE synthetic_transition_candidate NOLOGIN;
GRANT synthetic_transition_candidate TO funding_runtime;
CREATE SCHEMA synthetic_transition;
CREATE TABLE synthetic_transition.manifest(cohort text PRIMARY KEY,state text NOT NULL CHECK(state IN('PREPARED','FROZEN','ENROLLED','REHEARSAL_ACTIVE','PAUSED')),epoch int NOT NULL DEFAULT 1,inventory_complete boolean NOT NULL DEFAULT false,quota_known boolean NOT NULL DEFAULT false);
CREATE TABLE synthetic_transition.inventory(cohort text REFERENCES synthetic_transition.manifest,ref text,status text CHECK(status IN('pending','unknown','reconciled')),PRIMARY KEY(cohort,ref));
CREATE TABLE synthetic_transition.quota_evidence(cohort text PRIMARY KEY REFERENCES synthetic_transition.manifest,used_cents bigint CHECK(used_cents>=0));
CREATE TABLE synthetic_transition.operations(ref text PRIMARY KEY,cohort text NOT NULL,epoch int NOT NULL,digest text NOT NULL,result jsonb NOT NULL);
CREATE TABLE synthetic_transition.journal(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,cohort text NOT NULL,ref text NOT NULL,outcome text NOT NULL,actor text NOT NULL DEFAULT current_user);
CREATE TABLE synthetic_transition.finals(ref text PRIMARY KEY,balance_cents bigint NOT NULL,hash text NOT NULL);
INSERT INTO synthetic_transition.finals VALUES('invented_final',73,'invented_immutable_hash');
CREATE TRIGGER final_immutable BEFORE UPDATE OR DELETE ON synthetic_transition.finals FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER operations_immutable BEFORE UPDATE OR DELETE ON synthetic_transition.operations FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON synthetic_transition.journal FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
GRANT USAGE ON SCHEMA synthetic_transition TO funding_runtime,synthetic_transition_legacy;
GRANT SELECT ON ALL TABLES IN SCHEMA synthetic_transition TO funding_runtime,synthetic_transition_legacy;
GRANT UPDATE(state) ON synthetic_transition.manifest TO funding_runtime,synthetic_transition_legacy;
GRANT INSERT ON synthetic_transition.operations,synthetic_transition.journal TO funding_runtime,synthetic_transition_legacy;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA synthetic_transition TO funding_runtime,synthetic_transition_legacy;
`;
export async function cohort(admin,id,{known=true,complete=true,used=0}={}) {
 await admin.query('INSERT INTO synthetic_transition.manifest(cohort,state,inventory_complete,quota_known) VALUES($1,\'PREPARED\',$2,$3)',[id,complete,known]);
 await admin.query('INSERT INTO synthetic_transition.quota_evidence VALUES($1,$2)',[id,known?used:null]);
}
export async function transition(client,id,state) {
 assert.ok(['FROZEN','ENROLLED','REHEARSAL_ACTIVE','PAUSED'].includes(state));
 await client.query('BEGIN');try {
  const m=(await client.query('SELECT * FROM synthetic_transition.manifest WHERE cohort=$1 FOR UPDATE',[id])).rows[0];assert.ok(m);
  const permitted={FROZEN:['PREPARED'],ENROLLED:['FROZEN'],REHEARSAL_ACTIVE:['ENROLLED'],PAUSED:['REHEARSAL_ACTIVE']};
  if(!permitted[state].includes(m.state))throw Error('invalid_transition');
  if(['ENROLLED','REHEARSAL_ACTIVE'].includes(state)) {
   const count=Number((await client.query("SELECT count(*) AS n FROM synthetic_transition.inventory WHERE cohort=$1 AND status<>'reconciled'",[id])).rows[0].n);
   const q=(await client.query('SELECT used_cents FROM synthetic_transition.quota_evidence WHERE cohort=$1',[id])).rows[0];
   if(!m.inventory_complete||!m.quota_known||count||q?.used_cents==null)throw Error('transition_evidence_missing');
  }
  await client.query('UPDATE synthetic_transition.manifest SET state=$2 WHERE cohort=$1',[id,state]);
  await client.query("INSERT INTO synthetic_transition.journal(cohort,ref,outcome) VALUES($1,'transition',$2)",[id,state]);
  await client.query('COMMIT');return {state,productionActivation:false};
 }catch(e){await client.query('ROLLBACK');throw e;}
}
export async function write(client,{cohort:id,ref,writer,epoch=1,kind='new',binding={}},action=async()=>({synthetic:true})) {
 assert.notEqual(process.env.NODE_ENV,'production');
 assert.match(ref,/^synthetic_[a-z0-9_]{1,90}$/);assert.ok(['legacy','candidate'].includes(writer));
 // Only these fields form the fixture contract; arbitrary caller payload is discarded.
 const clean={intent:binding.intent??null,amount:binding.amount??null,currency:binding.currency??'EUR',paidAt:binding.paidAt??null};
 const digest=createHash('sha256').update(JSON.stringify({id,writer,epoch,kind,...clean})).digest('hex');
 await client.query('BEGIN');try {
  const m=(await client.query('SELECT * FROM synthetic_transition.manifest WHERE cohort=$1 FOR UPDATE',[id])).rows[0];assert.ok(m);
  const old=(await client.query('SELECT * FROM synthetic_transition.operations WHERE ref=$1',[ref])).rows[0];
  const record=async outcome=>{await client.query('INSERT INTO synthetic_transition.journal(cohort,ref,outcome) VALUES($1,$2,$3)',[id,ref,outcome]);return {outcome,productionActivation:false};};
  const role='synthetic_transition_'+writer;
  const member=(await client.query("SELECT pg_has_role(current_user,$1,'MEMBER') AS ok",[role])).rows[0].ok;
  let r;
  if(!member)r=await record('REJECTED_ROLE');
  else if(old)r=old.digest===digest?{outcome:'REPLAY',result:old.result,productionActivation:false}:await record('CONTRADICTION');
  else if(writer==='legacy'&&kind==='callback')r=await record('LEGACY_REVIEW');
  else if(epoch!==m.epoch||(writer==='legacy'&&m.state!=='PREPARED')||(writer==='candidate'&&!(['REHEARSAL_ACTIVE'].includes(m.state)||(kind==='completion'&&m.state==='PAUSED'))))r=await record('REJECTED_WRITER');
  else {
   const result=await action();
   await client.query('INSERT INTO synthetic_transition.operations VALUES($1,$2,$3,$4,$5)',[ref,id,epoch,digest,JSON.stringify(result)]);
   await record('ACCEPTED');r={outcome:'ACCEPTED',result,productionActivation:false};
  }
  await client.query('COMMIT');return r;
 }catch(e){await client.query('ROLLBACK');throw e;}
}
export async function snapshot(db) {
 const tables=['synthetic_transition.finals','synthetic_transition.operations','funding_private.annual_limits','funding_private.intents','funding_private.payments','funding_private.ledger_transactions','funding_private.ledger_entries','funding_private.accounts'];
 const out={};for(const t of tables)out[t]=(await db.query(`SELECT row_to_json(t) AS r FROM ${t} t ORDER BY row_to_json(t)::text`)).rows;
 return JSON.stringify(out);
}
