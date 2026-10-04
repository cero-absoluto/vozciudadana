-- Synthetic Owner authority contract only. No production enrollment or IdP.
CREATE ROLE funding_owner_enrollment NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA funding_owner_private;
REVOKE ALL ON SCHEMA funding_owner_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA funding_owner_private TO funding_review,funding_runtime,funding_owner_enrollment;
CREATE TABLE funding_owner_private.principals(id uuid PRIMARY KEY,issuer text NOT NULL CHECK(issuer='synthetic_owner_issuer'),subject text NOT NULL UNIQUE,epoch integer NOT NULL CHECK(epoch>0),active boolean NOT NULL,fixture boolean NOT NULL CHECK(fixture),evidence uuid NOT NULL);
CREATE TABLE funding_owner_private.challenges(id uuid PRIMARY KEY,principal uuid NOT NULL REFERENCES funding_owner_private.principals,epoch integer NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,consumed boolean NOT NULL DEFAULT false);
CREATE TABLE funding_owner_private.bindings(request_id uuid PRIMARY KEY,decision_id uuid NOT NULL REFERENCES funding_private.financial_review_decisions,kind text NOT NULL CHECK(kind IN('issue','revoke')),principal uuid NOT NULL REFERENCES funding_owner_private.principals,epoch integer NOT NULL,digest text NOT NULL,challenge uuid NOT NULL UNIQUE REFERENCES funding_owner_private.challenges,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(decision_id,kind));
CREATE TABLE funding_owner_private.recovery_audit(id uuid PRIMARY KEY,principal uuid NOT NULL REFERENCES funding_owner_private.principals,epoch integer NOT NULL,action text NOT NULL CHECK(action IN('suspend','reenroll')),evidence uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['principals','challenges','bindings','recovery_audit'] LOOP
 EXECUTE format('ALTER TABLE funding_owner_private.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON funding_owner_private.%I FROM PUBLIC,anon,authenticated',tab);
 END LOOP;
END $$;
CREATE POLICY principal_read ON funding_owner_private.principals FOR SELECT TO funding_review,funding_runtime,funding_owner_enrollment USING(true);
CREATE POLICY principal_enroll ON funding_owner_private.principals FOR ALL TO funding_owner_enrollment USING(true) WITH CHECK(fixture AND issuer='synthetic_owner_issuer');
GRANT SELECT ON funding_owner_private.principals TO funding_review,funding_owner_enrollment;
GRANT SELECT(id,epoch,active,fixture) ON funding_owner_private.principals TO funding_runtime;
GRANT INSERT,UPDATE ON funding_owner_private.principals TO funding_owner_enrollment;
CREATE POLICY challenge_read ON funding_owner_private.challenges FOR SELECT TO funding_review USING(true);
CREATE POLICY challenge_insert ON funding_owner_private.challenges FOR INSERT TO funding_review WITH CHECK(true);
CREATE POLICY challenge_consume ON funding_owner_private.challenges FOR UPDATE TO funding_review USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE(consumed) ON funding_owner_private.challenges TO funding_review;
CREATE POLICY binding_read ON funding_owner_private.bindings FOR SELECT TO funding_review,funding_runtime USING(true);
CREATE POLICY binding_insert ON funding_owner_private.bindings FOR INSERT TO funding_review WITH CHECK(true);
GRANT SELECT ON funding_owner_private.bindings TO funding_review;
GRANT SELECT(decision_id,kind,principal,epoch) ON funding_owner_private.bindings TO funding_runtime;
GRANT INSERT ON funding_owner_private.bindings TO funding_review;
CREATE TRIGGER bindings_immutable BEFORE UPDATE OR DELETE ON funding_owner_private.bindings FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE POLICY recovery_read ON funding_owner_private.recovery_audit FOR SELECT TO funding_owner_enrollment USING(true);
CREATE POLICY recovery_insert ON funding_owner_private.recovery_audit FOR INSERT TO funding_owner_enrollment WITH CHECK(true);
GRANT SELECT,INSERT ON funding_owner_private.recovery_audit TO funding_owner_enrollment;
CREATE TRIGGER recovery_immutable BEFORE UPDATE OR DELETE ON funding_owner_private.recovery_audit FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE FUNCTION funding_owner_private.check_authority(p_principal uuid,p_epoch integer) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_owner_private AS $$
DECLARE valid boolean; current_epoch integer; is_fixture boolean; BEGIN
 -- Advisory locks avoid UPDATE grants/RLS row-lock ambiguity; all authority paths use this lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:owner:'||p_principal,0));
 SELECT active,epoch,fixture INTO valid,current_epoch,is_fixture FROM principals WHERE id=p_principal;
 IF NOT FOUND OR NOT valid OR current_epoch<>p_epoch OR NOT is_fixture THEN RAISE EXCEPTION 'owner_authority_revoked';END IF;
END $$;
CREATE FUNCTION funding_owner_private.recover(p_id uuid,p_principal uuid,p_action text,p_evidence uuid) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_owner_private AS $$
DECLARE p principals; prior recovery_audit; next_epoch integer;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:owner:'||p_principal,0));
 SELECT * INTO prior FROM recovery_audit WHERE id=p_id;
 IF FOUND THEN IF prior.principal<>p_principal OR prior.action<>p_action OR prior.evidence<>p_evidence THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN prior.epoch;END IF;
 SELECT * INTO STRICT p FROM principals WHERE id=p_principal;
 IF p_action NOT IN('suspend','reenroll') OR p_action IS NULL OR p_evidence IS NULL OR (p_action='reenroll' AND p.active) THEN RAISE EXCEPTION 'invalid_owner_recovery';END IF;
 next_epoch:=p.epoch+1;
 UPDATE principals SET epoch=next_epoch,active=(p_action='reenroll'),evidence=p_evidence WHERE id=p_principal;
 INSERT INTO recovery_audit VALUES(p_id,p_principal,next_epoch,p_action,p_evidence,clock_timestamp());RETURN next_epoch;
END $$;
CREATE FUNCTION funding_owner_private.financial_authority_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_owner_private AS $$
DECLARE principal_id uuid; authority_epoch integer; BEGIN
 IF NEW.decision_id IS NOT NULL THEN
 SELECT principal,epoch INTO principal_id,authority_epoch FROM bindings WHERE decision_id=NEW.decision_id AND kind='issue';
 IF FOUND THEN PERFORM funding_owner_private.check_authority(principal_id,authority_epoch);
 ELSIF EXISTS(SELECT 1 FROM principals) THEN RAISE EXCEPTION 'owner_binding_required';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_refund_authority BEFORE INSERT ON funding_private.refund_reservations FOR EACH ROW EXECUTE FUNCTION funding_owner_private.financial_authority_guard();
CREATE TRIGGER owner_allocation_authority BEFORE INSERT ON funding_private.movement_allocations FOR EACH ROW EXECUTE FUNCTION funding_owner_private.financial_authority_guard();
REVOKE ALL ON FUNCTION funding_owner_private.check_authority(uuid,integer),funding_owner_private.recover(uuid,uuid,text,uuid),funding_owner_private.financial_authority_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION funding_owner_private.check_authority(uuid,integer) TO funding_review,funding_runtime;
GRANT EXECUTE ON FUNCTION funding_owner_private.recover(uuid,uuid,text,uuid) TO funding_owner_enrollment;
-- Legacy fixture decisions remain explicitly unbound; this is not a production activation switch.

CREATE FUNCTION funding_owner_private.binding_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_owner_private AS $$
DECLARE target uuid; k text;BEGIN
 IF EXISTS(SELECT 1 FROM principals) THEN
 IF TG_TABLE_NAME='financial_review_decisions' THEN target:=NEW.id;k:='issue';ELSE target:=NEW.decision_id;k:='revoke';END IF;
 IF NOT EXISTS(SELECT 1 FROM bindings WHERE decision_id=target AND kind=k) THEN RAISE EXCEPTION 'owner_binding_required';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_bound_issue AFTER INSERT ON funding_private.financial_review_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_owner_private.binding_required();
CREATE CONSTRAINT TRIGGER owner_bound_revoke AFTER INSERT ON funding_private.financial_decision_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_owner_private.binding_required();
REVOKE ALL ON FUNCTION funding_owner_private.binding_required() FROM PUBLIC,anon,authenticated;

CREATE TABLE funding_owner_private.session_revocations(session_id uuid PRIMARY KEY,principal uuid NOT NULL REFERENCES funding_owner_private.principals,evidence uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE funding_owner_private.session_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON funding_owner_private.session_revocations FROM PUBLIC,anon,authenticated;
CREATE POLICY session_revoke_read ON funding_owner_private.session_revocations FOR SELECT TO funding_review,funding_owner_enrollment USING(true);
CREATE POLICY session_revoke_insert ON funding_owner_private.session_revocations FOR INSERT TO funding_owner_enrollment WITH CHECK(true);
GRANT SELECT ON funding_owner_private.session_revocations TO funding_review,funding_owner_enrollment;
GRANT INSERT ON funding_owner_private.session_revocations TO funding_owner_enrollment;
CREATE TRIGGER session_revocations_immutable BEFORE UPDATE OR DELETE ON funding_owner_private.session_revocations FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();

CREATE INDEX owner_challenge_principal ON funding_owner_private.challenges(principal);
CREATE INDEX owner_binding_principal ON funding_owner_private.bindings(principal);
CREATE INDEX owner_recovery_principal ON funding_owner_private.recovery_audit(principal);
CREATE INDEX owner_session_principal ON funding_owner_private.session_revocations(principal);
CREATE FUNCTION funding_owner_private.lock_authority_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='principals' THEN PERFORM pg_advisory_xact_lock(hashtextextended('funding:owner:'||NEW.id,0));
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('funding:owner:'||NEW.principal,0));END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_principal_mutation_lock BEFORE UPDATE ON funding_owner_private.principals FOR EACH ROW EXECUTE FUNCTION funding_owner_private.lock_authority_mutation();
CREATE TRIGGER owner_session_revocation_lock BEFORE INSERT ON funding_owner_private.session_revocations FOR EACH ROW EXECUTE FUNCTION funding_owner_private.lock_authority_mutation();
REVOKE ALL ON FUNCTION funding_owner_private.lock_authority_mutation() FROM PUBLIC,anon,authenticated;

-- Preserve real/synthetic incoming cash evidence even when its allocation authority is stale.
CREATE FUNCTION funding_owner_private.decision_current(p_decision uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_owner_private AS $$
DECLARE principal_id uuid; authority_epoch integer; current_epoch integer; valid boolean; BEGIN
 SELECT principal,epoch INTO principal_id,authority_epoch FROM bindings WHERE decision_id=p_decision AND kind='issue';
 IF NOT FOUND THEN RETURN NOT EXISTS(SELECT 1 FROM principals);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:owner:'||principal_id,0));
 SELECT active,epoch INTO valid,current_epoch FROM principals WHERE id=principal_id;
 RETURN FOUND AND valid AND current_epoch=authority_epoch;
END $$;
REVOKE ALL ON FUNCTION funding_owner_private.decision_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION funding_owner_private.decision_current(uuid) TO funding_runtime;

CREATE OR REPLACE FUNCTION funding_private.apply_movement(p_ref text,p_source text,p_decision uuid DEFAULT NULL) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE m provider_movements;a accounts;t uuid;k text;i intents;d financial_review_decisions;r refund_reservations;related provider_movements;original_source text;used bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO STRICT m FROM provider_movements WHERE movement_ref=p_ref;
 IF EXISTS(SELECT 1 FROM movement_allocations WHERE movement_ref=p_ref) THEN RETURN 'allocated';END IF;
 IF p_decision IS NOT NULL AND NOT funding_owner_private.decision_current(p_decision) THEN RETURN 'review';END IF;
 SELECT * INTO i FROM intents WHERE id=m.claimed_intent;
 IF NOT FOUND OR i.state<>'confirmed' OR NOT EXISTS(SELECT 1 FROM temporal_intents WHERE intent_id=i.id) OR m.effective_at IS NULL OR m.effective_at>funding_private.temporal_now() THEN RETURN 'review';END IF;
 IF i.event_id IS NOT NULL THEN PERFORM 1 FROM public.protests WHERE id=i.event_id FOR UPDATE;END IF;
 -- Same sorted account order as confirmation; never source-before-clearing.
 PERFORM 1 FROM accounts WHERE id IN(p_source,'clearing') ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM accounts WHERE id=p_source;
 IF NOT FOUND THEN RETURN 'review';END IF;
 IF m.currency<>'EUR' OR a.kind NOT IN('general','event') OR a.state NOT IN('open','closing') THEN RETURN 'review';END IF;
 -- Validate again here: the helper cannot be a shortcut around Owner decisions.
 IF p_decision IS NOT NULL THEN
  SELECT * INTO d FROM financial_review_decisions WHERE id=p_decision;
  IF NOT FOUND OR d.intent_id<>i.id OR d.amount<>-m.amount OR d.source_account<>p_source OR EXISTS(SELECT 1 FROM financial_decision_revocations WHERE decision_id=d.id) THEN RETURN 'review';END IF;
  IF d.action='cover_exposure' THEN
   IF d.expires_at<=funding_private.temporal_now() OR p_source<>'general' OR m.kind NOT IN('processing_fee','fee','refund','dispute_debit') OR m.amount>=0 THEN RETURN 'review';END IF;
  ELSIF d.action='refund_authorize' THEN
   SELECT * INTO r FROM refund_reservations WHERE decision_id=d.id AND operation_ref=m.operation_ref AND intent_id=i.id AND state='held';
   IF NOT FOUND OR m.kind<>'refund' OR -m.amount<>r.amount OR EXISTS(SELECT 1 FROM provider_movements WHERE claimed_intent=i.id AND kind='dispute_debit') THEN RETURN 'review';END IF;
  ELSE RETURN 'review';END IF;
 ELSIF m.kind='processing_fee' AND m.amount<=0 THEN
  IF p_source<>'general' OR NOT EXISTS(SELECT 1 FROM fee_reservations WHERE intent_id=i.id AND state='held' AND bound>=-m.amount) THEN RETURN 'review';END IF;
 ELSIF m.kind='dispute_debit' AND m.amount<0 THEN
  IF p_source<>(CASE WHEN i.event_id IS NULL THEN 'general' ELSE 'event:'||i.event_id END) THEN RETURN 'review';END IF;
 ELSIF m.kind IN('refund_recovery','fee_recovery','dispute_recovery') AND m.amount>0 THEN
  SELECT * INTO related FROM provider_movements WHERE movement_ref=m.related_ref;
  IF NOT FOUND OR related.claimed_intent<>i.id OR related.amount>=0 OR related.currency<>m.currency OR related.kind<>(CASE m.kind WHEN 'refund_recovery' THEN 'refund' WHEN 'fee_recovery' THEN 'processing_fee' ELSE 'dispute_debit' END) THEN RETURN 'review';END IF;
  SELECT source_account INTO original_source FROM movement_allocations WHERE movement_ref=m.related_ref;
  IF original_source IS NULL THEN RETURN 'review';END IF;
  IF EXISTS(SELECT 1 FROM accounts WHERE id=original_source AND state='settled') THEN original_source:='general';END IF;
  SELECT COALESCE(sum(pm.amount),0) INTO used FROM provider_movements pm JOIN movement_allocations ma ON ma.movement_ref=pm.movement_ref WHERE pm.related_ref=m.related_ref AND pm.amount>0;
  IF p_source<>original_source OR used+m.amount>-related.amount THEN RETURN 'review';END IF;
 ELSE RETURN 'review';END IF;
 IF m.kind IN('refund','dispute_debit') AND m.amount<0 THEN
  SELECT COALESCE(-sum(pm.amount),0) INTO used FROM provider_movements pm JOIN movement_allocations ma ON ma.movement_ref=pm.movement_ref WHERE pm.claimed_intent=i.id AND pm.kind IN('refund','dispute_debit','refund_recovery','dispute_recovery');
  IF used-m.amount>i.amount THEN RETURN 'review';END IF;
 END IF;
 IF m.amount<0 AND funding_private.available_operational(a.id,CASE WHEN m.kind='processing_fee' THEN m.claimed_intent ELSE NULL END,CASE WHEN m.kind='refund' THEN m.operation_ref ELSE NULL END)<-m.amount THEN RETURN 'review';END IF;
 IF m.amount<>0 THEN
  k:=CASE WHEN m.kind IN('processing_fee','fee') THEN 'provider_fee' WHEN m.kind='refund' THEN 'refund' WHEN m.kind='dispute_debit' THEN 'dispute' ELSE 'compensation' END;
  INSERT INTO ledger_transactions(operation_key,kind) VALUES('psp-movement:'||p_ref,k) RETURNING id INTO t;
  INSERT INTO ledger_entries(transaction_id,account_id,amount) VALUES(t,a.id,m.amount),(t,'clearing',-m.amount);
  UPDATE accounts SET balance=balance+m.amount WHERE id=a.id;UPDATE accounts SET balance=balance-m.amount WHERE id='clearing';
 END IF;
 INSERT INTO movement_allocations(movement_ref,source_account,transaction_id,decision_id) VALUES(p_ref,p_source,t,p_decision);
 IF m.kind='processing_fee' THEN UPDATE fee_reservations SET state='final' WHERE intent_id=m.claimed_intent AND state='held';END IF;
 IF m.kind='refund' THEN UPDATE refund_reservations SET state='consumed' WHERE operation_ref=m.operation_ref;END IF;
 RETURN 'allocated';
END $$;
