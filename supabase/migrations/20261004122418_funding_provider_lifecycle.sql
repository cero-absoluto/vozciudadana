-- Owner-authorized isolated fixture only. No production cohort or PSP integration.
CREATE ROLE funding_provider_ingest NOLOGIN;
GRANT USAGE ON SCHEMA funding_private TO funding_provider_ingest;
CREATE TABLE funding_private.provider_lifecycle_enrollment (
 singleton boolean PRIMARY KEY CHECK(singleton), source text NOT NULL CHECK(source='synthetic_closed_fixture'),
 evidence_id uuid NOT NULL, test_only boolean NOT NULL CHECK(test_only));
CREATE TABLE funding_private.provider_lifecycles (
 intent_id uuid PRIMARY KEY REFERENCES funding_private.intents,
 operation_ref uuid NOT NULL UNIQUE, provider text NOT NULL DEFAULT 'lifecycle_fixture' CHECK(provider='lifecycle_fixture'),
 contract_version text NOT NULL DEFAULT 'closed_lifecycle_fixture:v1' CHECK(contract_version='closed_lifecycle_fixture:v1'),
 binding_state text NOT NULL DEFAULT 'creation_pending' CHECK(binding_state IN('creation_pending','creation_uncertain','bound','terminal','review')),
 provider_ref text UNIQUE CHECK(provider_ref ~ '^lc_[a-z0-9]{32}$'), local_deadline timestamptz NOT NULL,
 remote_expires_at timestamptz, last_revision bigint NOT NULL DEFAULT 0 CHECK(last_revision>=0),
 last_status text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_private.provider_commands (
 id uuid PRIMARY KEY, intent_id uuid NOT NULL REFERENCES funding_private.provider_lifecycles,
 kind text NOT NULL CHECK(kind IN('create','cancel','retrieve')), state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','completed','uncertain')),
 lease_owner uuid, lease_until timestamptz, attempt_count int NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz);
CREATE TABLE funding_private.provider_observations (
 id uuid PRIMARY KEY, command_id uuid NOT NULL REFERENCES funding_private.provider_commands,
 worker_ref uuid NOT NULL,
 intent_id uuid NOT NULL REFERENCES funding_private.provider_lifecycles,
 provider_ref text CHECK(provider_ref ~ '^lc_[a-z0-9]{32}$'), revision bigint NOT NULL CHECK(revision>0),
 status text NOT NULL CHECK(length(status) BETWEEN 1 AND 48), amount bigint NOT NULL CHECK(amount>0),
 currency text NOT NULL CHECK(length(currency) BETWEEN 1 AND 12), successful_at timestamptz,
 remote_expires_at timestamptz, observed_at timestamptz NOT NULL,
 source text NOT NULL DEFAULT 'closed_lifecycle_fixture' CHECK(source='closed_lifecycle_fixture'),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[0-9a-f]{64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_private.provider_applications (
 observation_id uuid PRIMARY KEY REFERENCES funding_private.provider_observations,
 intent_id uuid NOT NULL REFERENCES funding_private.provider_lifecycles,
 result text NOT NULL CHECK(result IN('hold','bound','confirmed','cancelled','review','exception')),
 actor name NOT NULL DEFAULT current_user, creation_xid bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX lifecycle_commands_intent_idx ON funding_private.provider_commands(intent_id);
CREATE INDEX lifecycle_observations_command_idx ON funding_private.provider_observations(command_id);
CREATE INDEX lifecycle_observations_revision_idx ON funding_private.provider_observations(intent_id,revision);
CREATE INDEX lifecycle_applications_intent_idx ON funding_private.provider_applications(intent_id);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['provider_lifecycle_enrollment','provider_lifecycles','provider_commands','provider_observations','provider_applications'] LOOP
  EXECUTE format('ALTER TABLE funding_private.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON funding_private.%I FROM PUBLIC,anon,authenticated,funding_review,funding_cleanup',tab);
  EXECUTE format('CREATE POLICY lifecycle_runtime_read ON funding_private.%I FOR SELECT TO funding_runtime USING(true)',tab);
  EXECUTE format('GRANT SELECT ON funding_private.%I TO funding_runtime',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['provider_lifecycles','provider_commands','provider_applications'] LOOP
  EXECUTE format('CREATE POLICY lifecycle_runtime_insert ON funding_private.%I FOR INSERT TO funding_runtime WITH CHECK(true)',tab);
  EXECUTE format('GRANT INSERT ON funding_private.%I TO funding_runtime',tab);
 END LOOP;
 CREATE POLICY lifecycle_runtime_update ON funding_private.provider_lifecycles FOR UPDATE TO funding_runtime USING(true) WITH CHECK(true);
 GRANT UPDATE ON funding_private.provider_lifecycles TO funding_runtime;
 FOREACH tab IN ARRAY ARRAY['provider_commands','provider_observations'] LOOP
  EXECUTE format('CREATE POLICY lifecycle_ingest ON funding_private.%I TO funding_provider_ingest USING(true) WITH CHECK(true)',tab);
 END LOOP;
 GRANT SELECT,UPDATE ON funding_private.provider_commands TO funding_provider_ingest;
 GRANT SELECT,INSERT ON funding_private.provider_observations TO funding_provider_ingest;
 GRANT SELECT ON funding_private.provider_lifecycles,funding_private.provider_lifecycle_enrollment TO funding_provider_ingest;
 CREATE POLICY lifecycle_ingest_read ON funding_private.provider_lifecycles FOR SELECT TO funding_provider_ingest USING(true);
 CREATE POLICY lifecycle_enrollment_read ON funding_private.provider_lifecycle_enrollment FOR SELECT TO funding_provider_ingest USING(true);
END $$;
CREATE TRIGGER lifecycle_observations_immutable BEFORE UPDATE OR DELETE ON funding_private.provider_observations FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER lifecycle_applications_immutable BEFORE UPDATE OR DELETE ON funding_private.provider_applications FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER lifecycle_enrollment_immutable BEFORE UPDATE OR DELETE ON funding_private.provider_lifecycle_enrollment FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER lifecycle_no_delete BEFORE DELETE ON funding_private.provider_lifecycles FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER lifecycle_commands_no_delete BEFORE DELETE ON funding_private.provider_commands FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE FUNCTION funding_private.lifecycle_observation_claimed() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM provider_commands c WHERE c.id=NEW.command_id AND c.intent_id=NEW.intent_id AND c.state='leased' AND c.lease_owner=NEW.worker_ref AND c.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'lifecycle_lease_lost';END IF;RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_observation_claim BEFORE INSERT ON funding_private.provider_observations FOR EACH ROW EXECUTE FUNCTION funding_private.lifecycle_observation_claimed();
REVOKE ALL ON FUNCTION funding_private.lifecycle_observation_claimed() FROM PUBLIC,anon,authenticated,funding_runtime,funding_review,funding_cleanup;
GRANT EXECUTE ON FUNCTION funding_private.lifecycle_observation_claimed() TO funding_provider_ingest;
CREATE FUNCTION funding_private.lifecycle_binding_immutable() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF TG_TABLE_NAME='provider_lifecycles' THEN
  IF NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.operation_ref IS DISTINCT FROM OLD.operation_ref OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.contract_version IS DISTINCT FROM OLD.contract_version OR NEW.local_deadline IS DISTINCT FROM OLD.local_deadline OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (OLD.provider_ref IS NOT NULL AND (NEW.provider_ref IS DISTINCT FROM OLD.provider_ref OR NEW.remote_expires_at IS DISTINCT FROM OLD.remote_expires_at)) THEN RAISE EXCEPTION 'lifecycle_binding_immutable';END IF;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'lifecycle_command_immutable';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_binding_guard BEFORE UPDATE ON funding_private.provider_lifecycles FOR EACH ROW EXECUTE FUNCTION funding_private.lifecycle_binding_immutable();
CREATE TRIGGER lifecycle_command_binding_guard BEFORE UPDATE ON funding_private.provider_commands FOR EACH ROW EXECUTE FUNCTION funding_private.lifecycle_binding_immutable();
REVOKE ALL ON FUNCTION funding_private.lifecycle_binding_immutable() FROM PUBLIC,anon,authenticated,funding_review,funding_cleanup;
GRANT EXECUTE ON FUNCTION funding_private.lifecycle_binding_immutable() TO funding_runtime,funding_provider_ingest;
GRANT SELECT(id,amount) ON funding_private.intents TO funding_provider_ingest;
CREATE POLICY lifecycle_ingest_intent_read ON funding_private.intents FOR SELECT TO funding_provider_ingest USING(EXISTS(SELECT 1 FROM funding_private.provider_lifecycles l WHERE l.intent_id=id));

CREATE FUNCTION funding_private.begin_lifecycle(p_operation uuid,p_year int,p_annual text,p_event_token text,p_event uuid,p_amount bigint) RETURNS uuid
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE prior provider_lifecycles;i intents;meta temporal_intents;new_intent uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 IF NOT EXISTS(SELECT 1 FROM provider_lifecycle_enrollment WHERE singleton AND test_only) THEN RAISE EXCEPTION 'lifecycle_fixture_enrollment_required';END IF;
 IF EXISTS(SELECT 1 FROM provider_applications a JOIN intents previous_intent ON previous_intent.id=a.intent_id WHERE a.result='exception' AND previous_intent.annual_token=p_annual AND previous_intent.policy_year=p_year) THEN RAISE EXCEPTION 'lifecycle_unresolved_exception';END IF;
 SELECT * INTO prior FROM provider_lifecycles WHERE operation_ref=p_operation;
 IF FOUND THEN
  SELECT * INTO STRICT i FROM intents WHERE id=prior.intent_id;
  IF i.policy_year IS DISTINCT FROM p_year OR i.annual_token IS DISTINCT FROM p_annual OR i.event_token IS DISTINCT FROM p_event_token OR i.event_id IS DISTINCT FROM p_event OR i.amount IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
  RETURN i.id;
 END IF;
 new_intent:=funding_private.reserve_with_fee_v3(p_year,p_annual,p_event_token,p_event,p_amount,60,0,true);
 SELECT * INTO STRICT meta FROM temporal_intents WHERE intent_id=new_intent;
 INSERT INTO provider_lifecycles(intent_id,operation_ref,local_deadline,created_at) VALUES(new_intent,p_operation,meta.valid_until,meta.created_at);
 INSERT INTO provider_commands(id,intent_id,kind) VALUES(p_operation,new_intent,'create');RETURN new_intent;
END $$;
CREATE FUNCTION funding_private.request_lifecycle_command(p_intent uuid,p_operation uuid,p_kind text) RETURNS uuid
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE c provider_commands;
BEGIN
 IF p_kind NOT IN('retrieve','cancel') THEN RAISE EXCEPTION 'invalid_lifecycle_command';END IF;
 IF NOT EXISTS(SELECT 1 FROM provider_lifecycles WHERE intent_id=p_intent) THEN RAISE EXCEPTION 'unknown_lifecycle';END IF;
 INSERT INTO provider_commands(id,intent_id,kind) VALUES(p_operation,p_intent,p_kind) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT c FROM provider_commands WHERE id=p_operation;
 IF c.intent_id IS DISTINCT FROM p_intent OR c.kind IS DISTINCT FROM p_kind THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN c.id;
END $$;
CREATE FUNCTION funding_private.claim_lifecycle_command(p_command uuid,p_worker uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE c provider_commands;l provider_lifecycles;
BEGIN
 SELECT * INTO STRICT c FROM provider_commands WHERE id=p_command FOR UPDATE;
 IF c.state='completed' THEN RETURN jsonb_build_object('completed',true);END IF;
 IF c.state='leased' AND c.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'lifecycle_command_busy';END IF;
 UPDATE provider_commands SET state='leased',lease_owner=p_worker,lease_until=clock_timestamp()+interval '30 seconds',attempt_count=attempt_count+1 WHERE id=p_command;
 SELECT * INTO STRICT l FROM provider_lifecycles WHERE intent_id=c.intent_id;
 RETURN jsonb_build_object('commandId',c.id,'intentId',c.intent_id,'kind',c.kind,'operationRef',l.operation_ref,'providerRef',l.provider_ref,'expiresAt',l.local_deadline,'allowCreate',l.local_deadline>funding_private.temporal_now(),'amountCents',(SELECT amount FROM intents WHERE id=c.intent_id));
END $$;
CREATE FUNCTION funding_private.mark_lifecycle_uncertain(p_command uuid) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM provider_commands WHERE id=p_command AND state='uncertain') THEN RAISE EXCEPTION 'lifecycle_uncertainty_evidence_required';END IF;
 UPDATE provider_lifecycles SET binding_state='creation_uncertain',updated_at=clock_timestamp() WHERE intent_id=(SELECT intent_id FROM provider_commands WHERE id=p_command) AND provider_ref IS NULL AND binding_state='creation_pending';
END $$;
CREATE FUNCTION funding_private.uncertain_lifecycle_command(p_command uuid,p_worker uuid) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 UPDATE provider_commands SET state='uncertain',lease_until=NULL WHERE id=p_command AND lease_owner=p_worker AND state='leased';
 IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle_lease_lost';END IF;
END $$;
CREATE FUNCTION funding_private.record_lifecycle_observation(p_id uuid,p_command uuid,p_worker uuid,p_ref text,p_revision bigint,p_status text,p_amount bigint,p_currency text,p_paid timestamptz,p_expiry timestamptz,p_observed timestamptz,p_digest text) RETURNS uuid
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE c provider_commands;old provider_observations;
BEGIN
 SELECT * INTO STRICT c FROM provider_commands WHERE id=p_command FOR UPDATE;
 SELECT * INTO old FROM provider_observations WHERE id=p_id;
 IF FOUND THEN
  IF old.command_id IS DISTINCT FROM p_command OR old.provider_ref IS DISTINCT FROM p_ref OR old.revision IS DISTINCT FROM p_revision OR old.status IS DISTINCT FROM p_status OR old.amount IS DISTINCT FROM p_amount OR old.currency IS DISTINCT FROM p_currency OR old.successful_at IS DISTINCT FROM p_paid OR old.remote_expires_at IS DISTINCT FROM p_expiry OR old.observed_at IS DISTINCT FROM p_observed OR old.evidence_digest IS DISTINCT FROM p_digest THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN old.id;
 END IF;
 IF c.state<>'leased' OR c.lease_owner IS DISTINCT FROM p_worker OR c.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lifecycle_lease_lost';END IF;
 INSERT INTO provider_observations(id,command_id,worker_ref,intent_id,provider_ref,revision,status,amount,currency,successful_at,remote_expires_at,observed_at,evidence_digest)
 VALUES(p_id,p_command,p_worker,c.intent_id,p_ref,p_revision,p_status,p_amount,p_currency,p_paid,p_expiry,p_observed,p_digest);
 UPDATE provider_commands SET state='completed',completed_at=clock_timestamp(),lease_until=NULL WHERE id=p_command;RETURN p_id;
END $$;

CREATE FUNCTION funding_private.lifecycle_application_valid() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE o provider_observations;l provider_lifecycles;
BEGIN
 SELECT * INTO STRICT o FROM provider_observations WHERE id=NEW.observation_id;
 SELECT * INTO STRICT l FROM provider_lifecycles WHERE intent_id=NEW.intent_id;
 IF NEW.intent_id IS DISTINCT FROM o.intent_id OR NEW.actor IS DISTINCT FROM current_user OR NEW.creation_xid IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'invalid_lifecycle_application';END IF;
 IF NEW.result IN('cancelled','confirmed') AND (o.provider_ref IS DISTINCT FROM l.provider_ref OR o.amount IS DISTINCT FROM (SELECT amount FROM intents WHERE id=l.intent_id) OR o.currency<>'EUR' OR o.observed_at>clock_timestamp() OR o.observed_at<clock_timestamp()-interval '30 seconds' OR o.received_at<clock_timestamp()-interval '30 seconds') THEN RAISE EXCEPTION 'invalid_lifecycle_application';END IF;
 IF NEW.result='cancelled' AND o.status NOT IN('canceled','expired','failed','precreation_failed') THEN RAISE EXCEPTION 'terminal_evidence_required';END IF;
 IF NEW.result='confirmed' AND (o.status<>'paid' OR o.successful_at IS NULL OR o.successful_at>=l.local_deadline OR o.successful_at<l.created_at OR o.successful_at>o.observed_at) THEN RAISE EXCEPTION 'successful_evidence_required';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_application_proof BEFORE INSERT ON funding_private.provider_applications FOR EACH ROW EXECUTE FUNCTION funding_private.lifecycle_application_valid();
CREATE FUNCTION funding_private.guard_managed_intent_transition() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state AND EXISTS(SELECT 1 FROM provider_lifecycles WHERE intent_id=OLD.id) THEN
  IF OLD.state IN('confirmed','cancelled') OR NOT EXISTS(SELECT 1 FROM provider_applications WHERE intent_id=OLD.id AND result=NEW.state AND actor=current_user AND creation_xid=txid_current()) THEN RAISE EXCEPTION 'lifecycle_transition_evidence_required';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER managed_intent_transition BEFORE UPDATE ON funding_private.intents FOR EACH ROW EXECUTE FUNCTION funding_private.guard_managed_intent_transition();
CREATE FUNCTION funding_private.guard_lifecycle_settlement() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM provider_applications a JOIN intents i ON i.id=a.intent_id WHERE i.event_id=NEW.event_id AND a.result='exception') THEN RAISE EXCEPTION 'lifecycle_unresolved_exception';END IF;RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_settlement_guard BEFORE INSERT ON funding_private.settlements FOR EACH ROW EXECUTE FUNCTION funding_private.guard_lifecycle_settlement();
REVOKE ALL ON FUNCTION funding_private.guard_lifecycle_settlement() FROM PUBLIC,anon,authenticated,funding_review,funding_cleanup,funding_provider_ingest;
GRANT EXECUTE ON FUNCTION funding_private.guard_lifecycle_settlement() TO funding_runtime;
CREATE FUNCTION funding_private.lifecycle_application_committed() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE state text;
BEGIN
 SELECT i.state INTO state FROM intents i WHERE id=NEW.intent_id;
 IF NEW.result IN('confirmed','cancelled','review') AND state IS DISTINCT FROM NEW.result THEN RAISE EXCEPTION 'lifecycle_application_not_committed';END IF;
 IF NEW.result='confirmed' AND NOT EXISTS(SELECT 1 FROM payments WHERE intent_id=NEW.intent_id) THEN RAISE EXCEPTION 'lifecycle_payment_missing';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lifecycle_application_commit AFTER INSERT ON funding_private.provider_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.lifecycle_application_committed();

CREATE FUNCTION funding_private.apply_lifecycle_observation(p_intent uuid,p_observation uuid) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i intents;l provider_lifecycles;o provider_observations;prior provider_applications;ev uuid;r text;valid boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT event_id INTO ev FROM intents WHERE id=p_intent;
 IF ev IS NOT NULL THEN PERFORM 1 FROM public.protests WHERE id=ev FOR UPDATE;END IF;
 SELECT * INTO STRICT i FROM intents WHERE id=p_intent FOR UPDATE;
 SELECT * INTO STRICT l FROM provider_lifecycles WHERE intent_id=p_intent FOR UPDATE;
 SELECT * INTO STRICT o FROM provider_observations WHERE id=p_observation;
 IF o.intent_id IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'lifecycle_binding_mismatch';END IF;
 SELECT * INTO prior FROM provider_applications WHERE observation_id=p_observation;
 IF FOUND THEN RETURN prior.result;END IF;
 valid:=o.amount=i.amount AND o.currency='EUR' AND o.observed_at<=clock_timestamp() AND o.observed_at>=clock_timestamp()-interval '30 seconds' AND o.received_at>=clock_timestamp()-interval '30 seconds' AND o.revision>=l.last_revision;
 IF l.provider_ref IS NOT NULL THEN valid:=valid AND o.provider_ref=l.provider_ref AND o.remote_expires_at IS NOT DISTINCT FROM l.remote_expires_at;END IF;
 IF EXISTS(SELECT 1 FROM provider_observations old JOIN provider_applications a ON a.observation_id=old.id WHERE old.intent_id=p_intent AND old.revision=o.revision AND (old.status IS DISTINCT FROM o.status OR old.successful_at IS DISTINCT FROM o.successful_at OR old.amount IS DISTINCT FROM o.amount OR old.currency IS DISTINCT FROM o.currency OR old.provider_ref IS DISTINCT FROM o.provider_ref OR old.remote_expires_at IS DISTINCT FROM o.remote_expires_at)) THEN valid:=false;END IF;
 IF l.last_revision>0 AND o.revision=l.last_revision AND o.status IS DISTINCT FROM l.last_status THEN valid:=false;END IF;
 IF l.binding_state='review' OR i.state IN('confirmed','cancelled','review') THEN
  -- Preserve final money facts; new contradictory evidence is still visible in applications.
  r:=CASE WHEN valid AND o.status IS NOT DISTINCT FROM l.last_status THEN 'hold' ELSE 'exception' END;
  INSERT INTO provider_applications(observation_id,intent_id,result) VALUES(o.id,p_intent,r);
  RETURN r;
 END IF;
 IF valid IS DISTINCT FROM true OR o.status NOT IN('open','pending','authorized','cancel_requested','paid','canceled','expired','failed','precreation_failed') THEN r:='review';
 ELSIF o.status='precreation_failed' THEN
  IF l.provider_ref IS NOT NULL OR (SELECT kind FROM provider_commands WHERE id=o.command_id)<>'create' THEN r:='review';ELSE r:='cancelled';END IF;
 ELSIF o.provider_ref IS NULL OR o.remote_expires_at IS NULL OR o.remote_expires_at>l.local_deadline OR o.remote_expires_at<=l.created_at THEN r:='review';
 ELSIF o.status IN('canceled','expired','failed') THEN r:='cancelled';
 ELSIF o.status='paid' THEN
  IF o.successful_at IS NULL OR o.successful_at<l.created_at OR o.successful_at>=l.local_deadline OR o.successful_at>=o.remote_expires_at OR o.successful_at>o.observed_at OR o.successful_at>funding_private.temporal_now() OR extract(year FROM o.successful_at AT TIME ZONE (SELECT timezone FROM temporal_intents WHERE intent_id=i.id))::int IS DISTINCT FROM i.policy_year OR EXISTS(SELECT 1 FROM public.protests WHERE id=i.event_id AND (o.successful_at<starts_at OR o.successful_at>=ends_at)) OR EXISTS(SELECT 1 FROM settlements WHERE event_id=i.event_id) OR EXISTS(SELECT 1 FROM accounts WHERE event_id=i.event_id AND state='settled') THEN r:='review';ELSE r:='confirmed';END IF;
 ELSE r:='bound';END IF;
 IF l.provider_ref IS NULL AND o.provider_ref IS NOT NULL AND r<>'review' THEN UPDATE provider_lifecycles SET provider_ref=o.provider_ref,remote_expires_at=o.remote_expires_at WHERE intent_id=p_intent;END IF;
 INSERT INTO provider_applications(observation_id,intent_id,result) VALUES(o.id,p_intent,r);
 IF r='cancelled' THEN PERFORM funding_private.cancel(p_intent,true);
 ELSIF r='confirmed' THEN
  IF funding_private.confirm_v2('lifecycle:'||o.id,o.provider_ref,p_intent,o.amount,o.currency,o.successful_at,'simulator_successful_payment:v2')<>'confirmed' THEN RAISE EXCEPTION 'lifecycle_confirmation_rejected';END IF;
 ELSIF r='review' THEN UPDATE intents SET state='review' WHERE id=p_intent;
 END IF;
 UPDATE provider_lifecycles SET binding_state=CASE WHEN r IN('confirmed','cancelled') THEN 'terminal' WHEN r='review' THEN 'review' ELSE 'bound' END,last_revision=greatest(last_revision,o.revision),last_status=o.status,updated_at=clock_timestamp() WHERE intent_id=p_intent;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION funding_private.begin_lifecycle(uuid,int,text,text,uuid,bigint),funding_private.request_lifecycle_command(uuid,uuid,text),funding_private.claim_lifecycle_command(uuid,uuid),funding_private.uncertain_lifecycle_command(uuid,uuid),funding_private.record_lifecycle_observation(uuid,uuid,uuid,text,bigint,text,bigint,text,timestamptz,timestamptz,timestamptz,text),funding_private.apply_lifecycle_observation(uuid,uuid),funding_private.lifecycle_application_valid(),funding_private.guard_managed_intent_transition(),funding_private.lifecycle_application_committed() FROM PUBLIC,anon,authenticated,funding_review,funding_cleanup;
GRANT EXECUTE ON FUNCTION funding_private.begin_lifecycle(uuid,int,text,text,uuid,bigint),funding_private.request_lifecycle_command(uuid,uuid,text),funding_private.apply_lifecycle_observation(uuid,uuid),funding_private.lifecycle_application_valid(),funding_private.guard_managed_intent_transition(),funding_private.lifecycle_application_committed() TO funding_runtime;
GRANT EXECUTE ON FUNCTION funding_private.claim_lifecycle_command(uuid,uuid),funding_private.uncertain_lifecycle_command(uuid,uuid),funding_private.record_lifecycle_observation(uuid,uuid,uuid,text,bigint,text,bigint,text,timestamptz,timestamptz,timestamptz,text) TO funding_provider_ingest;
REVOKE ALL ON FUNCTION funding_private.mark_lifecycle_uncertain(uuid) FROM PUBLIC,anon,authenticated,funding_provider_ingest,funding_review,funding_cleanup;
GRANT EXECUTE ON FUNCTION funding_private.mark_lifecycle_uncertain(uuid) TO funding_runtime;
GRANT EXECUTE ON FUNCTION funding_private.temporal_now() TO funding_provider_ingest;
