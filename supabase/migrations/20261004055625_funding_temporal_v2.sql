-- Approved annual policy; ISOLATED ONLY. No production activation or legacy backfill.
CREATE TABLE funding_private.temporal_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),version int NOT NULL CHECK(version=2),
 timezone text NOT NULL CHECK(timezone='Europe/Amsterdam'),
 test_intent_ttl interval NOT NULL CHECK(test_intent_ttl>interval '0' AND test_intent_ttl<=interval '30 minutes'));
INSERT INTO funding_private.temporal_policy VALUES(true,2,'Europe/Amsterdam',interval '10 minutes');
CREATE TABLE funding_private.temporal_intents (
 intent_id uuid PRIMARY KEY REFERENCES funding_private.intents,
 created_at timestamptz NOT NULL,valid_until timestamptz NOT NULL CHECK(valid_until>created_at),
 policy_version int NOT NULL CHECK(policy_version=2),timezone text NOT NULL);
CREATE TABLE funding_private.temporal_receipts (
 event_ref text PRIMARY KEY CHECK(length(event_ref) BETWEEN 1 AND 128),
 payment_ref text NOT NULL CHECK(length(payment_ref) BETWEEN 1 AND 128),
 claimed_intent uuid NOT NULL,amount bigint NOT NULL CHECK(amount>0),currency text NOT NULL,
 effective_paid_at timestamptz,received_at timestamptz NOT NULL,semantic text NOT NULL,
 result text NOT NULL CHECK(result IN('confirmed','review','duplicate_payment')));
CREATE INDEX temporal_payment_ref_idx ON funding_private.temporal_receipts(payment_ref);
CREATE TRIGGER temporal_intents_immutable BEFORE UPDATE OR DELETE ON funding_private.temporal_intents FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER temporal_receipts_immutable BEFORE UPDATE OR DELETE ON funding_private.temporal_receipts FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
ALTER TABLE funding_private.temporal_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_private.temporal_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_private.temporal_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY temporal_policy_read ON funding_private.temporal_policy FOR SELECT TO funding_runtime USING(true);
CREATE POLICY temporal_intents_runtime ON funding_private.temporal_intents TO funding_runtime USING(true) WITH CHECK(true);
CREATE POLICY temporal_receipts_runtime ON funding_private.temporal_receipts TO funding_runtime USING(true) WITH CHECK(true);
GRANT SELECT ON funding_private.temporal_policy TO funding_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON funding_private.temporal_intents,funding_private.temporal_receipts TO funding_runtime;
CREATE FUNCTION funding_private.temporal_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT clock_timestamp() $$;
CREATE FUNCTION funding_private.temporal_context() RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
 SELECT jsonb_build_object('year',extract(year FROM t AT TIME ZONE p.timezone)::int,'timeZone',p.timezone,'now',t,'version',p.version)
 FROM funding_private.temporal_policy p CROSS JOIN LATERAL (SELECT funding_private.temporal_now() t) c
$$;
CREATE FUNCTION funding_private.reserve_v2(p_year int,p_annual text,p_event_token text,p_event uuid,p_amount bigint,p_minimum_seconds int DEFAULT 1) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE aid uuid; ev public.protests%ROWTYPE; a funding_private.annual_limits%ROWTYPE; e funding_private.event_limits%ROWTYPE; pol funding_private.temporal_policy%ROWTYPE; t timestamptz; p_expiry timestamptz; cutoff timestamptz;
BEGIN
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>100000 OR p_minimum_seconds IS NULL OR p_minimum_seconds<1 THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
 SELECT * INTO STRICT pol FROM funding_private.temporal_policy;
 IF p_event IS NOT NULL THEN
  SELECT * INTO ev FROM public.protests WHERE id=p_event FOR UPDATE;
  IF NOT FOUND OR ev.starts_at>funding_private.temporal_now() OR ev.ends_at<=funding_private.temporal_now() THEN RAISE EXCEPTION 'event_not_open'; END IF;
  PERFORM 1 FROM funding_private.accounts WHERE event_id=p_event AND state='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_enabled'; END IF;
 ELSIF p_event_token IS NOT NULL THEN RAISE EXCEPTION 'invalid_event_token'; END IF;
 t:=funding_private.temporal_now();
 IF p_year IS DISTINCT FROM extract(year FROM t AT TIME ZONE pol.timezone)::int THEN RAISE EXCEPTION 'reverify_for_policy_year'; END IF;
 cutoff:=make_timestamptz(p_year+1,1,1,0,0,0,pol.timezone);
 p_expiry:=least(t+pol.test_intent_ttl,cutoff,CASE WHEN p_event IS NOT NULL THEN ev.ends_at ELSE cutoff END);
 IF p_expiry-t<make_interval(secs=>p_minimum_seconds) THEN RAISE EXCEPTION 'funding_window_closed'; END IF;
 INSERT INTO funding_private.annual_limits(policy_year,token) VALUES(p_year,p_annual) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM funding_private.annual_limits WHERE policy_year=p_year AND token=p_annual FOR UPDATE;
 IF a.committed+a.reserved+p_amount>100000 THEN RAISE EXCEPTION 'annual_limit'; END IF;
 IF p_event IS NOT NULL THEN
  INSERT INTO funding_private.event_limits(event_id,token) VALUES(p_event,p_event_token) ON CONFLICT DO NOTHING;
  SELECT * INTO e FROM funding_private.event_limits WHERE event_id=p_event AND token=p_event_token FOR UPDATE;
  IF e.committed+e.reserved+p_amount>10000 THEN RAISE EXCEPTION 'event_limit'; END IF;
  PERFORM 1 FROM funding_private.accounts WHERE event_id=p_event AND state='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_open'; END IF;
  UPDATE funding_private.event_limits SET reserved=reserved+p_amount WHERE event_id=p_event AND token=p_event_token;
 END IF;
 UPDATE funding_private.annual_limits SET reserved=reserved+p_amount WHERE policy_year=p_year AND token=p_annual;
 INSERT INTO funding_private.intents(kind,event_id,policy_year,annual_token,event_token,amount,expires_at)
 VALUES(CASE WHEN p_event IS NULL THEN 'general' ELSE 'event' END,p_event,p_year,p_annual,p_event_token,p_amount,p_expiry) RETURNING id INTO aid;
 IF funding_private.temporal_now()>=p_expiry THEN RAISE EXCEPTION 'funding_window_closed'; END IF;
 INSERT INTO funding_private.temporal_intents(intent_id,created_at,valid_until,policy_version,timezone) VALUES(aid,t,p_expiry,pol.version,pol.timezone);
 RETURN aid;
END $$;

CREATE FUNCTION funding_private.confirm_legacy_v1(p_ref text,p_intent uuid,p_amount bigint,p_currency text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i funding_private.intents%ROWTYPE; old funding_private.provider_events%ROWTYPE; unmatched funding_private.unmatched_provider_events%ROWTYPE; tid uuid; account text; result text;
BEGIN
 IF EXISTS(SELECT 1 FROM funding_private.temporal_intents WHERE intent_id=p_intent) THEN RAISE EXCEPTION 'temporal_evidence_required'; END IF;
 -- Serialize the incoming idempotency key before inspecting any intent.
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:simulator:'||p_ref,0));
 SELECT * INTO unmatched FROM funding_private.unmatched_provider_events WHERE provider='simulator' AND event_ref=p_ref;
 IF FOUND THEN
  IF unmatched.claimed_intent<>p_intent OR unmatched.amount<>p_amount OR unmatched.currency<>p_currency THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN 'review';
 END IF;
 SELECT * INTO old FROM funding_private.provider_events WHERE provider='simulator' AND event_ref=p_ref;
 IF FOUND THEN
  IF old.intent_id<>p_intent OR old.amount<>p_amount OR old.currency<>p_currency THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN old.result;
 END IF;
 SELECT * INTO i FROM funding_private.intents WHERE id=p_intent FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO funding_private.unmatched_provider_events(provider,event_ref,claimed_intent,amount,currency) VALUES('simulator',p_ref,p_intent,p_amount,p_currency);
  RETURN 'review';
 END IF;
 IF i.state='confirmed' THEN result:='duplicate_payment';
 ELSIF i.state<>'reserved' OR i.amount<>p_amount OR p_currency<>'EUR' OR i.expires_at<=clock_timestamp() THEN
  result:='review';
  IF i.state='reserved' THEN UPDATE funding_private.intents SET state='review' WHERE id=i.id; END IF;
 ELSE
  result:='confirmed';
  PERFORM 1 FROM funding_private.annual_limits WHERE policy_year=i.policy_year AND token=i.annual_token FOR UPDATE;
  UPDATE funding_private.annual_limits SET reserved=reserved-i.amount,committed=committed+i.amount WHERE policy_year=i.policy_year AND token=i.annual_token;
  IF i.event_id IS NOT NULL THEN
   UPDATE funding_private.event_limits SET reserved=reserved-i.amount,committed=committed+i.amount WHERE event_id=i.event_id AND token=i.event_token;
   account:='event:'||i.event_id;
  ELSE account:='general'; END IF;
  PERFORM 1 FROM funding_private.accounts WHERE id IN (account,'clearing') ORDER BY id FOR UPDATE;
  INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('intent:'||i.id,'contribution') RETURNING id INTO tid;
  INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,account,i.amount),(tid,'clearing',-i.amount);
  UPDATE funding_private.accounts SET balance=balance+i.amount WHERE id=account;
  UPDATE funding_private.accounts SET balance=balance-i.amount WHERE id='clearing';
  INSERT INTO funding_private.payments(intent_id,gross,net,provider) VALUES(i.id,i.amount,i.amount,'simulator');
  UPDATE funding_private.intents SET state='confirmed' WHERE id=i.id;
 END IF;
 INSERT INTO funding_private.provider_events(provider,event_ref,intent_id,amount,currency,result) VALUES('simulator',p_ref,i.id,p_amount,p_currency,result);
 RETURN result;
END $$;

CREATE FUNCTION funding_private.confirm_v2(p_ref text,p_payment text,p_intent uuid,p_amount bigint,p_currency text,p_paid_at timestamptz,p_semantic text) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i funding_private.intents%ROWTYPE;m funding_private.temporal_intents%ROWTYPE;old funding_private.temporal_receipts%ROWTYPE;
 ev public.protests%ROWTYPE;tid uuid;account text;result text;t timestamptz;valid boolean;event_uuid uuid;
BEGIN
 IF p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 128 OR p_payment IS NULL OR length(p_payment) NOT BETWEEN 1 AND 128 OR p_intent IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_currency IS NULL OR p_semantic IS NULL THEN RAISE EXCEPTION 'invalid_provider_evidence'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:v2:payment:'||p_payment,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:v2:event:'||p_ref,0));
 SELECT * INTO old FROM funding_private.temporal_receipts WHERE event_ref=p_ref;
 IF FOUND THEN
  IF old.payment_ref IS DISTINCT FROM p_payment OR old.claimed_intent IS DISTINCT FROM p_intent OR old.amount IS DISTINCT FROM p_amount OR old.currency IS DISTINCT FROM p_currency OR old.effective_paid_at IS DISTINCT FROM p_paid_at OR old.semantic IS DISTINCT FROM p_semantic THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN old.result;
 END IF;
 SELECT * INTO old FROM funding_private.temporal_receipts WHERE payment_ref=p_payment ORDER BY received_at,event_ref LIMIT 1;
 IF FOUND THEN
  IF old.claimed_intent IS DISTINCT FROM p_intent OR old.amount IS DISTINCT FROM p_amount OR old.currency IS DISTINCT FROM p_currency OR old.effective_paid_at IS DISTINCT FROM p_paid_at OR old.semantic IS DISTINCT FROM p_semantic THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  INSERT INTO funding_private.temporal_receipts VALUES(p_ref,p_payment,p_intent,p_amount,p_currency,p_paid_at,funding_private.temporal_now(),p_semantic,old.result);
  RETURN old.result;
 END IF;
 SELECT event_id INTO event_uuid FROM funding_private.intents WHERE id=p_intent;
 IF event_uuid IS NOT NULL THEN SELECT * INTO ev FROM public.protests WHERE id=event_uuid FOR UPDATE; END IF;
 SELECT * INTO i FROM funding_private.intents WHERE id=p_intent FOR UPDATE;
 SELECT * INTO m FROM funding_private.temporal_intents WHERE intent_id=p_intent;
 t:=funding_private.temporal_now();
 valid:=m.intent_id IS NOT NULL AND p_semantic='simulator_successful_payment:v2' AND p_paid_at IS NOT NULL
  AND p_paid_at>=m.created_at AND p_paid_at<m.valid_until AND p_paid_at<=t
  AND extract(year FROM p_paid_at AT TIME ZONE m.timezone)::int=i.policy_year AND p_amount=i.amount AND p_currency='EUR';
 IF i.event_id IS NOT NULL THEN valid:=valid AND p_paid_at>=ev.starts_at AND p_paid_at<ev.ends_at; END IF;
 IF m.intent_id IS NULL THEN result:='review';
 ELSIF i.state='confirmed' THEN result:='duplicate_payment';
 ELSIF i.state<>'reserved' OR valid IS DISTINCT FROM true THEN
  result:='review';IF i.state='reserved' THEN UPDATE funding_private.intents SET state='review' WHERE id=p_intent;END IF;
 ELSE
  PERFORM 1 FROM funding_private.annual_limits WHERE policy_year=i.policy_year AND token=i.annual_token FOR UPDATE;
  IF i.event_id IS NOT NULL THEN PERFORM 1 FROM funding_private.event_limits WHERE event_id=i.event_id AND token=i.event_token FOR UPDATE;END IF;
  account:=CASE WHEN i.event_id IS NULL THEN 'general' ELSE 'event:'||i.event_id END;
  PERFORM 1 FROM funding_private.accounts WHERE id IN(account,'clearing') ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM funding_private.accounts WHERE id=account AND state NOT IN('open','closing')) OR EXISTS(SELECT 1 FROM funding_private.settlements WHERE event_id=i.event_id) THEN
   result:='review';UPDATE funding_private.intents SET state='review' WHERE id=p_intent;
  ELSE
   UPDATE funding_private.annual_limits SET reserved=reserved-i.amount,committed=committed+i.amount WHERE policy_year=i.policy_year AND token=i.annual_token;
   IF i.event_id IS NOT NULL THEN UPDATE funding_private.event_limits SET reserved=reserved-i.amount,committed=committed+i.amount WHERE event_id=i.event_id AND token=i.event_token;END IF;
   INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('intent:'||i.id,'contribution') RETURNING id INTO tid;
   INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,account,i.amount),(tid,'clearing',-i.amount);
   UPDATE funding_private.accounts SET balance=balance+i.amount WHERE id=account;
   UPDATE funding_private.accounts SET balance=balance-i.amount WHERE id='clearing';
   INSERT INTO funding_private.payments(intent_id,gross,net,provider) VALUES(i.id,i.amount,i.amount,'simulator');
   UPDATE funding_private.intents SET state='confirmed' WHERE id=p_intent;result:='confirmed';
  END IF;
 END IF;
 INSERT INTO funding_private.temporal_receipts VALUES(p_ref,p_payment,p_intent,p_amount,p_currency,p_paid_at,t,p_semantic,result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION funding_private.confirm(p_ref text,p_intent uuid,p_amount bigint,p_currency text) RETURNS text
 LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$ SELECT funding_private.confirm_legacy_v1(p_ref,p_intent,p_amount,p_currency) $$;
REVOKE ALL ON FUNCTION funding_private.temporal_now(),funding_private.temporal_context(),funding_private.reserve_v2(int,text,text,uuid,bigint,int),funding_private.confirm_legacy_v1(text,uuid,bigint,text),funding_private.confirm_v2(text,text,uuid,bigint,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION funding_private.temporal_now(),funding_private.temporal_context(),funding_private.reserve_v2(int,text,text,uuid,bigint,int),funding_private.confirm_legacy_v1(text,uuid,bigint,text),funding_private.confirm_v2(text,text,uuid,bigint,text,timestamptz,text) TO funding_runtime;
