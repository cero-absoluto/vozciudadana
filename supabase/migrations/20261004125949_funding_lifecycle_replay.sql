-- Isolated candidate only: preserve exact replay while blocking new operations.
CREATE OR REPLACE FUNCTION funding_private.begin_lifecycle(p_operation uuid,p_year int,p_annual text,p_event_token text,p_event uuid,p_amount bigint) RETURNS uuid
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE prior provider_lifecycles;i intents;meta temporal_intents;new_intent uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 IF NOT EXISTS(SELECT 1 FROM provider_lifecycle_enrollment WHERE singleton AND test_only) THEN RAISE EXCEPTION 'lifecycle_fixture_enrollment_required';END IF;
 SELECT * INTO prior FROM provider_lifecycles WHERE operation_ref=p_operation;
 IF FOUND THEN
  SELECT * INTO STRICT i FROM intents WHERE id=prior.intent_id;
  IF i.policy_year IS DISTINCT FROM p_year OR i.annual_token IS DISTINCT FROM p_annual OR i.event_token IS DISTINCT FROM p_event_token OR i.event_id IS DISTINCT FROM p_event OR i.amount IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
  RETURN i.id;
 END IF;
 IF EXISTS(SELECT 1 FROM provider_applications a JOIN intents previous_intent ON previous_intent.id=a.intent_id WHERE a.result='exception' AND previous_intent.annual_token=p_annual AND previous_intent.policy_year=p_year) THEN RAISE EXCEPTION 'lifecycle_unresolved_exception';END IF;
 new_intent:=funding_private.reserve_with_fee_v3(p_year,p_annual,p_event_token,p_event,p_amount,60,0,true);
 SELECT * INTO STRICT meta FROM temporal_intents WHERE intent_id=new_intent;
 INSERT INTO provider_lifecycles(intent_id,operation_ref,local_deadline,created_at) VALUES(new_intent,p_operation,meta.valid_until,meta.created_at);
 INSERT INTO provider_commands(id,intent_id,kind) VALUES(p_operation,new_intent,'create');RETURN new_intent;
END $$;
