import {randomUUID} from 'node:crypto';
export const smsClosureMigration=new URL('../../supabase/migrations/20261005041716_funding_sms_closure_rehearsal.sql',import.meta.url);
export const smsFixtureSecret='synthetic_sms_evidence_secret_32_bytes_minimum';
export const smsProviderOptions={mode:'isolated',secret:smsFixtureSecret,fundingSecret:'synthetic_finance_distinct_secret_32_bytes',ownerSecret:'synthetic_owner_distinct_secret_32_bytes',participationSecret:'synthetic_participation_distinct_secret_32_bytes'};
export const smsPrepareInput=(eventId,key='x')=>({eventId,operationKey:'synthetic_sms_'+key,boundCents:10,currency:'EUR'});
export const smsFact=(operationId,key='price',delta={})=>({operationId,reference:'synthetic_sms_fact_'+key,kind:'priced',amountCents:5,currency:'EUR',...delta});
// Synthetic participation guard mirror, not a replacement of production RPCs.
// Budget is checked at SMS exposure; email requires no SMS charge.
export const smsParticipationFixtureSQL=`
CREATE SCHEMA sms_participation_fixture;
CREATE TABLE sms_participation_fixture.otp(id uuid PRIMARY KEY,consumed boolean NOT NULL DEFAULT false);
CREATE TABLE sms_participation_fixture.adhesions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES public.protests,nullifier text UNIQUE NOT NULL,method text NOT NULL CHECK(method IN('phone_otp','institutional_email_otp')));
CREATE FUNCTION sms_participation_fixture.join(p_event uuid,p_nullifier text,p_method text,p_otp uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE aid uuid;BEGIN
 PERFORM 1 FROM public.protests WHERE id=p_event AND ends_at>clock_timestamp() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'event_closed';END IF;
 IF p_method='institutional_email_otp' THEN UPDATE sms_participation_fixture.otp SET consumed=true WHERE id=p_otp AND NOT consumed;IF NOT FOUND THEN RAISE EXCEPTION 'otp_used';END IF;END IF;
 INSERT INTO sms_participation_fixture.adhesions(event_id,nullifier,method) VALUES(p_event,p_nullifier,p_method) RETURNING id INTO aid;RETURN aid;
END $$;
REVOKE ALL ON SCHEMA sms_participation_fixture FROM PUBLIC,anon,authenticated,funding_sms_executor,funding_sms_evidence_ingest;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sms_participation_fixture FROM PUBLIC;
`;
export async function seedSmsEvent(admin,balance=100){const id=randomUUID();await admin.query("INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',0.90,'synthetic_final_v2')",[id]);await admin.query("INSERT INTO funding_private.accounts(id,kind,event_id) VALUES($1,'event',$2)",['event:'+id,id]);if(balance>0){const token=randomUUID().replaceAll('-','').repeat(2);const intent=(await admin.query("SELECT funding_private.reserve(2026,$1,$1,$2,$3,clock_timestamp()+interval '10 minutes') AS id",[token,id,balance])).rows[0].id;await admin.query("SELECT funding_private.confirm($1,$2,$3,'EUR')",['synthetic-sms-seed:'+id,intent,balance]);}return id;}
