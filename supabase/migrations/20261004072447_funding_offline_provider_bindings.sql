-- OFFLINE FIXTURES ONLY. No provider adoption, transport or live-payment semantic.
CREATE TABLE funding_private.fixture_otp_bindings(
 challenge_id uuid PRIMARY KEY REFERENCES funding_auth_private.otp_challenges ON DELETE CASCADE,
 verification_ref text NOT NULL UNIQUE CHECK(verification_ref~'^VE[0-9a-f]{32}$'),
 service_domain text NOT NULL CHECK(service_domain='fixture_funding_verify'),expires_at timestamptz NOT NULL);
CREATE TABLE funding_private.fixture_checkout_bindings(
 intent_id uuid PRIMARY KEY REFERENCES funding_private.intents,
 checkout_ref text NOT NULL UNIQUE CHECK(checkout_ref~'^cs_fixture_[0-9a-f]{32}$'),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,minimum_seconds int NOT NULL CHECK(minimum_seconds>0),
 CHECK(expires_at>=created_at+minimum_seconds*interval '1 second'));
CREATE TABLE funding_private.fixture_ingress_events(
 event_ref text PRIMARY KEY CHECK(event_ref~'^evt_[A-Za-z0-9_]{1,120}$'),
 checkout_ref text,payment_ref text,claimed_intent uuid,amount bigint,currency text,effective_paid_at timestamptz,
 event_kind text NOT NULL CHECK(length(event_kind)<=64),proof_valid boolean NOT NULL,
 source text NOT NULL DEFAULT 'offline_fixture' CHECK(source='offline_fixture'),
 result text NOT NULL CHECK(result IN('review','confirmed','duplicate_payment')),
 reason text NOT NULL CHECK(reason IN('binding_missing','binding_mismatch','unsupported_type','evidence_missing','financial_result')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX fixture_ingress_payment_idx ON funding_private.fixture_ingress_events(payment_ref);
CREATE INDEX fixture_ingress_intent_idx ON funding_private.fixture_ingress_events(claimed_intent);
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['fixture_otp_bindings','fixture_checkout_bindings','fixture_ingress_events'] LOOP
  EXECUTE format('ALTER TABLE funding_private.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY fixture_runtime ON funding_private.%I TO funding_runtime USING(true) WITH CHECK(true)',tab);
  EXECUTE format('GRANT SELECT,INSERT ON funding_private.%I TO funding_runtime',tab);
  EXECUTE format('CREATE TRIGGER fixture_immutable BEFORE UPDATE ON funding_private.%I FOR EACH ROW EXECUTE FUNCTION funding_private.immutable()',tab);
 END LOOP;
END $$;
CREATE TRIGGER fixture_checkout_no_delete BEFORE DELETE ON funding_private.fixture_checkout_bindings FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER fixture_ingress_no_delete BEFORE DELETE ON funding_private.fixture_ingress_events FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
-- OTP binding can disappear only with the existing authorized challenge cleanup.
CREATE FUNCTION funding_private.bind_fixture_otp(p_challenge uuid,p_reference text,p_domain text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private,funding_auth_private AS $$
DECLARE c otp_challenges;prior fixture_otp_bindings;
BEGIN
 SELECT * INTO c FROM otp_challenges WHERE id=p_challenge FOR UPDATE;
 IF NOT FOUND OR c.state<>'pending_send' OR c.expires_at<=clock_timestamp() OR p_domain IS DISTINCT FROM 'fixture_funding_verify' THEN RAISE EXCEPTION 'fixture_otp_binding_invalid';END IF;
 SELECT * INTO prior FROM fixture_otp_bindings WHERE challenge_id=p_challenge;
 IF FOUND THEN IF prior.verification_ref IS DISTINCT FROM p_reference OR prior.service_domain IS DISTINCT FROM p_domain THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN prior.verification_ref;END IF;
 INSERT INTO fixture_otp_bindings VALUES(p_challenge,p_reference,p_domain,c.expires_at);RETURN p_reference;
END $$;
CREATE FUNCTION funding_private.fixture_otp_reference(p_challenge uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private,funding_auth_private AS $$
DECLARE reference text;
BEGIN
 SELECT b.verification_ref INTO reference FROM fixture_otp_bindings b JOIN otp_challenges c ON c.id=b.challenge_id
 WHERE b.challenge_id=p_challenge AND b.expires_at>clock_timestamp() AND c.state='verifying' AND c.lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'fixture_otp_binding_invalid';END IF;RETURN reference;
END $$;
CREATE FUNCTION funding_private.bind_fixture_checkout(p_intent uuid,p_reference text,p_created timestamptz,p_expires timestamptz,p_minimum int) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i intents;meta temporal_intents;prior fixture_checkout_bindings;
BEGIN
 SELECT * INTO i FROM intents WHERE id=p_intent FOR UPDATE;SELECT * INTO meta FROM temporal_intents WHERE intent_id=p_intent;
 SELECT * INTO prior FROM fixture_checkout_bindings WHERE intent_id=p_intent;
 IF FOUND THEN IF prior.checkout_ref IS DISTINCT FROM p_reference OR prior.created_at IS DISTINCT FROM p_created OR prior.expires_at IS DISTINCT FROM p_expires OR prior.minimum_seconds IS DISTINCT FROM p_minimum THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN prior.checkout_ref;END IF;
 IF meta.intent_id IS NULL OR i.state<>'reserved' OR p_created IS NULL OR p_expires IS NULL OR p_minimum IS NULL OR p_minimum<=0 OR p_created<date_trunc('milliseconds',meta.created_at) OR p_created>funding_private.temporal_now() OR p_expires>meta.valid_until OR p_expires<=p_created OR p_expires<p_created+p_minimum*interval '1 second' THEN RAISE EXCEPTION 'fixture_checkout_binding_invalid';END IF;
 INSERT INTO fixture_checkout_bindings VALUES(p_intent,p_reference,p_created,p_expires,p_minimum);RETURN p_reference;
END $$;
CREATE FUNCTION funding_private.ingest_fixture_payment(p_event text,p_checkout text,p_payment text,p_intent uuid,p_amount bigint,p_currency text,p_paid timestamptz,p_kind text,p_proof boolean) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE old fixture_ingress_events;b fixture_checkout_bindings;i intents;result text;reason text;semantic text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:offline-fixture:'||p_event,0));
 SELECT * INTO old FROM fixture_ingress_events WHERE event_ref=p_event;
 IF FOUND THEN
  IF old.checkout_ref IS DISTINCT FROM p_checkout OR old.payment_ref IS DISTINCT FROM p_payment OR old.claimed_intent IS DISTINCT FROM p_intent OR old.amount IS DISTINCT FROM p_amount OR old.currency IS DISTINCT FROM p_currency OR old.effective_paid_at IS DISTINCT FROM p_paid OR old.event_kind IS DISTINCT FROM p_kind OR old.proof_valid IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN old.result;
 END IF;
 SELECT * INTO b FROM fixture_checkout_bindings WHERE checkout_ref=p_checkout;
 SELECT * INTO i FROM intents WHERE id=p_intent;
 IF b.intent_id IS NULL THEN result:='review';reason:='binding_missing';
 ELSIF b.intent_id IS DISTINCT FROM p_intent OR i.amount IS DISTINCT FROM p_amount OR p_currency IS DISTINCT FROM 'EUR' THEN result:='review';reason:='binding_mismatch';
 ELSIF p_kind<>'payment_intent.succeeded' THEN result:='review';reason:='unsupported_type';
 ELSIF p_proof IS DISTINCT FROM true OR p_paid IS NULL OR p_payment IS NULL THEN result:='review';reason:='evidence_missing';
 ELSE
  semantic:=CASE WHEN p_paid>=b.created_at AND p_paid<b.expires_at THEN 'simulator_successful_payment:v2' ELSE 'offline_fixture_outside_checkout' END;
  result:=funding_private.confirm_v2(p_event,p_payment,p_intent,p_amount,p_currency,p_paid,semantic);reason:='financial_result';
 END IF;
 INSERT INTO fixture_ingress_events(event_ref,checkout_ref,payment_ref,claimed_intent,amount,currency,effective_paid_at,event_kind,proof_valid,result,reason) VALUES(p_event,p_checkout,p_payment,p_intent,p_amount,p_currency,p_paid,p_kind,p_proof,result,reason);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION funding_private.bind_fixture_otp(uuid,text,text),funding_private.fixture_otp_reference(uuid),funding_private.bind_fixture_checkout(uuid,text,timestamptz,timestamptz,int),funding_private.ingest_fixture_payment(text,text,text,uuid,bigint,text,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated,funding_review;
GRANT EXECUTE ON FUNCTION funding_private.bind_fixture_otp(uuid,text,text),funding_private.fixture_otp_reference(uuid),funding_private.bind_fixture_checkout(uuid,text,timestamptz,timestamptz,int),funding_private.ingest_fixture_payment(text,text,text,uuid,bigint,text,timestamptz,text,boolean) TO funding_runtime;
