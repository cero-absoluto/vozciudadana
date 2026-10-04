-- Isolated Owner-review candidate only; no real Owner authentication or PSP writes.
CREATE ROLE funding_review NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA funding_private TO funding_review;
CREATE TABLE funding_private.review_authorizations (
 request_id uuid PRIMARY KEY,decision_id uuid NOT NULL REFERENCES funding_private.financial_review_decisions,
 kind text NOT NULL CHECK(kind IN('issue','revoke')),movement_ref text REFERENCES funding_private.provider_movements,
 evidence_ref uuid NOT NULL,authority text NOT NULL DEFAULT 'simulated_owner' CHECK(authority='simulated_owner'),
 database_actor text NOT NULL DEFAULT current_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(decision_id,kind));
ALTER TABLE funding_private.review_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_authorization_read ON funding_private.review_authorizations FOR SELECT TO funding_review,funding_runtime USING(true);
CREATE POLICY review_authorization_insert ON funding_private.review_authorizations FOR INSERT TO funding_review WITH CHECK(authority='simulated_owner' AND database_actor=current_user);
GRANT SELECT,INSERT ON funding_private.review_authorizations TO funding_review;
GRANT SELECT ON funding_private.review_authorizations TO funding_runtime;
CREATE TRIGGER review_authorizations_immutable BEFORE UPDATE OR DELETE ON funding_private.review_authorizations FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['accounts','intents','temporal_intents','provider_movements','movement_allocations','fee_reservations','refund_reservations','cost_reservations','financial_review_decisions','financial_decision_revocations'] LOOP
  EXECUTE format('CREATE POLICY owner_review_read ON funding_private.%I FOR SELECT TO funding_review USING(true)',tab);
  IF tab='intents' THEN EXECUTE 'GRANT SELECT(id,kind,event_id,amount,state) ON funding_private.intents TO funding_review';
  ELSE EXECUTE format('GRANT SELECT ON funding_private.%I TO funding_review',tab);END IF;
 END LOOP;
END $$;
CREATE POLICY owner_review_issue ON funding_private.financial_review_decisions FOR INSERT TO funding_review WITH CHECK(true);
CREATE POLICY owner_review_revoke ON funding_private.financial_decision_revocations FOR INSERT TO funding_review WITH CHECK(true);
GRANT INSERT ON funding_private.financial_review_decisions,funding_private.financial_decision_revocations TO funding_review;
GRANT EXECUTE ON FUNCTION funding_private.temporal_now(),funding_private.available_operational(text,uuid,text) TO funding_review;

-- Commit must contain provenance for writes by the restricted review authority.
-- Existing DB-owner fixtures and previously recorded decisions are preserved.
CREATE FUNCTION funding_private.review_provenance_required() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE target uuid;expected text;
BEGIN
 IF pg_has_role(current_user,'funding_review','MEMBER') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
  IF TG_TABLE_NAME='financial_review_decisions' THEN target:=NEW.id;expected:='issue';ELSE target:=NEW.decision_id;expected:='revoke';END IF;
  IF NOT EXISTS(SELECT 1 FROM review_authorizations WHERE decision_id=target AND kind=expected) THEN RAISE EXCEPTION 'review_provenance_required';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_issue_provenance AFTER INSERT ON funding_private.financial_review_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.review_provenance_required();
CREATE CONSTRAINT TRIGGER owner_revoke_provenance AFTER INSERT ON funding_private.financial_decision_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.review_provenance_required();

CREATE FUNCTION funding_private.issue_review_decision(p_request uuid,p_action text,p_intent uuid,p_amount bigint,p_source text,p_expires timestamptz,p_evidence uuid,p_movement text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE prior review_authorizations;d financial_review_decisions;m provider_movements;event uuid;gross bigint;payment_state text;source accounts;used bigint;new_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:review-request:'||p_request,0));
 SELECT * INTO prior FROM review_authorizations WHERE request_id=p_request;
 IF FOUND THEN
  SELECT * INTO STRICT d FROM financial_review_decisions WHERE id=prior.decision_id;
  IF prior.kind<>'issue' OR prior.evidence_ref IS DISTINCT FROM p_evidence OR prior.movement_ref IS DISTINCT FROM p_movement OR d.action IS DISTINCT FROM p_action OR d.intent_id IS DISTINCT FROM p_intent OR d.amount IS DISTINCT FROM p_amount OR d.source_account IS DISTINCT FROM p_source OR d.expires_at IS DISTINCT FROM p_expires THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
  RETURN d.id;
 END IF;
 IF p_request IS NULL OR p_evidence IS NULL OR p_action NOT IN('refund_authorize','cover_exposure') OR p_action IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_expires IS NULL OR p_expires<=funding_private.temporal_now() THEN RAISE EXCEPTION 'invalid_review_decision';END IF;
 SELECT event_id,amount,state INTO event,gross,payment_state FROM intents WHERE id=p_intent;
 IF NOT FOUND OR payment_state<>'confirmed' OR NOT EXISTS(SELECT 1 FROM temporal_intents WHERE intent_id=p_intent) THEN RAISE EXCEPTION 'payment_not_eligible';END IF;
 SELECT * INTO source FROM accounts WHERE id=p_source;
 IF NOT FOUND OR source.kind NOT IN('event','general') OR source.state NOT IN('open','closing') OR (source.kind='event' AND source.event_id IS DISTINCT FROM event) THEN RAISE EXCEPTION 'source_not_eligible';END IF;
 IF p_action='refund_authorize' THEN
  IF p_movement IS NOT NULL OR EXISTS(SELECT 1 FROM provider_movements WHERE claimed_intent=p_intent AND kind='dispute_debit') THEN RAISE EXCEPTION 'dispute_review_required';END IF;
  SELECT COALESCE(-sum(pm.amount),0) INTO used FROM provider_movements pm JOIN movement_allocations ma ON ma.movement_ref=pm.movement_ref WHERE pm.claimed_intent=p_intent AND pm.kind IN('refund','refund_recovery');
  used:=used+COALESCE((SELECT sum(amount) FROM refund_reservations WHERE intent_id=p_intent AND state='held'),0);
  IF used+p_amount>gross THEN RAISE EXCEPTION 'refund_exceeds_gross';END IF;
 ELSE
  SELECT * INTO m FROM provider_movements WHERE movement_ref=p_movement;
  IF NOT FOUND OR m.claimed_intent<>p_intent OR m.amount>=0 OR m.amount<>-p_amount OR m.currency<>'EUR' OR m.kind NOT IN('processing_fee','fee','refund','dispute_debit') OR m.effective_at IS NULL OR m.effective_at>funding_private.temporal_now() OR p_source<>'general' OR EXISTS(SELECT 1 FROM movement_allocations WHERE movement_ref=p_movement) THEN RAISE EXCEPTION 'movement_not_eligible';END IF;
  IF m.kind IN('refund','dispute_debit') THEN
   SELECT COALESCE(-sum(pm.amount),0) INTO used FROM provider_movements pm JOIN movement_allocations ma ON ma.movement_ref=pm.movement_ref WHERE pm.claimed_intent=p_intent AND pm.kind IN('refund','dispute_debit','refund_recovery','dispute_recovery');
   IF used+p_amount>gross THEN RAISE EXCEPTION 'refund_exceeds_gross';END IF;
  END IF;
 END IF;
 IF funding_private.available_operational(p_source,CASE WHEN p_action='cover_exposure' AND m.kind='processing_fee' THEN p_intent ELSE NULL END)<p_amount THEN RAISE EXCEPTION 'review_source_insufficient';END IF;
 INSERT INTO financial_review_decisions(operation_ref,action,intent_id,amount,source_account,expires_at) VALUES(p_request::text,p_action,p_intent,p_amount,p_source,p_expires) RETURNING id INTO new_id;
 INSERT INTO review_authorizations(request_id,decision_id,kind,movement_ref,evidence_ref) VALUES(p_request,new_id,'issue',p_movement,p_evidence);
 RETURN new_id;
END $$;
CREATE FUNCTION funding_private.revoke_review_decision(p_request uuid,p_decision uuid,p_evidence uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE prior review_authorizations;
BEGIN
 IF p_request IS NULL OR p_decision IS NULL OR p_evidence IS NULL THEN RAISE EXCEPTION 'invalid_review_decision';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:review-request:'||p_request,0));
 SELECT * INTO prior FROM review_authorizations WHERE request_id=p_request;
 IF FOUND THEN
  IF prior.kind<>'revoke' OR prior.decision_id IS DISTINCT FROM p_decision OR prior.evidence_ref IS DISTINCT FROM p_evidence THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN prior.decision_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM financial_review_decisions WHERE id=p_decision) THEN RAISE EXCEPTION 'unknown_review_decision';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:review-revocation:'||p_decision,0));
 IF EXISTS(SELECT 1 FROM financial_decision_revocations WHERE decision_id=p_decision) THEN RAISE EXCEPTION 'review_already_revoked';END IF;
 INSERT INTO financial_decision_revocations(decision_id) VALUES(p_decision);
 INSERT INTO review_authorizations(request_id,decision_id,kind,evidence_ref) VALUES(p_request,p_decision,'revoke',p_evidence);
 RETURN p_decision;
END $$;
REVOKE ALL ON FUNCTION funding_private.review_provenance_required(),funding_private.issue_review_decision(uuid,text,uuid,bigint,text,timestamptz,uuid,text),funding_private.revoke_review_decision(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,funding_runtime;
GRANT EXECUTE ON FUNCTION funding_private.issue_review_decision(uuid,text,uuid,bigint,text,timestamptz,uuid,text),funding_private.revoke_review_decision(uuid,uuid,uuid) TO funding_review;
-- No membership of funding_review is granted to the financial runtime.
