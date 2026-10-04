-- Synthetic Owner authority contract only. No production enrollment or IdP.
CREATE ROLE funding_owner_enrollment NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA funding_owner_private;
REVOKE ALL ON SCHEMA funding_owner_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA funding_owner_private TO funding_review,funding_runtime,funding_owner_enrollment;
CREATE TABLE funding_owner_private.principals(id uuid PRIMARY KEY,issuer text NOT NULL CHECK(issuer='synthetic_owner_issuer'),subject text NOT NULL UNIQUE,epoch integer NOT NULL CHECK(epoch>0),active boolean NOT NULL,fixture boolean NOT NULL CHECK(fixture),evidence uuid NOT NULL);
CREATE TABLE funding_owner_private.challenges(id uuid PRIMARY KEY,principal uuid NOT NULL REFERENCES funding_owner_private.principals,epoch integer NOT NULL,digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,consumed boolean NOT NULL DEFAULT false);
CREATE TABLE funding_owner_private.bindings(request_id uuid PRIMARY KEY,decision_id uuid NOT NULL REFERENCES funding_private.financial_review_decisions,kind text NOT NULL CHECK(kind IN('issue','revoke')),principal uuid NOT NULL REFERENCES funding_owner_private.principals,epoch integer NOT NULL,digest text NOT NULL,challenge uuid NOT NULL UNIQUE REFERENCES funding_owner_private.challenges,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_owner_private.recovery_audit(id uuid PRIMARY KEY,principal uuid NOT NULL REFERENCES funding_owner_private.principals,epoch integer NOT NULL,action text NOT NULL CHECK(action IN('suspend','reenroll')),evidence uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['principals','challenges','bindings','recovery_audit'] LOOP
 EXECUTE format('ALTER TABLE funding_owner_private.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON funding_owner_private.%I FROM PUBLIC,anon,authenticated',tab);
 END LOOP;
END $$;
CREATE POLICY principal_read ON funding_owner_private.principals FOR SELECT TO funding_review,funding_runtime,funding_owner_enrollment USING(true);
CREATE POLICY principal_enroll ON funding_owner_private.principals FOR ALL TO funding_owner_enrollment USING(true) WITH CHECK(fixture AND issuer='synthetic_owner_issuer');
GRANT SELECT ON funding_owner_private.principals TO funding_review,funding_runtime,funding_owner_enrollment;
GRANT INSERT,UPDATE ON funding_owner_private.principals TO funding_owner_enrollment;
CREATE POLICY challenge_read ON funding_owner_private.challenges FOR SELECT TO funding_review USING(true);
CREATE POLICY challenge_insert ON funding_owner_private.challenges FOR INSERT TO funding_review WITH CHECK(true);
CREATE POLICY challenge_consume ON funding_owner_private.challenges FOR UPDATE TO funding_review USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE(consumed) ON funding_owner_private.challenges TO funding_review;
CREATE POLICY binding_read ON funding_owner_private.bindings FOR SELECT TO funding_review,funding_runtime USING(true);
CREATE POLICY binding_insert ON funding_owner_private.bindings FOR INSERT TO funding_review WITH CHECK(true);
GRANT SELECT ON funding_owner_private.bindings TO funding_review,funding_runtime;
GRANT INSERT ON funding_owner_private.bindings TO funding_review;
CREATE TRIGGER bindings_immutable BEFORE UPDATE OR DELETE ON funding_owner_private.bindings FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE POLICY recovery_read ON funding_owner_private.recovery_audit FOR SELECT TO funding_owner_enrollment USING(true);
CREATE POLICY recovery_insert ON funding_owner_private.recovery_audit FOR INSERT TO funding_owner_enrollment WITH CHECK(true);
GRANT SELECT,INSERT ON funding_owner_private.recovery_audit TO funding_owner_enrollment;
CREATE TRIGGER recovery_immutable BEFORE UPDATE OR DELETE ON funding_owner_private.recovery_audit FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE FUNCTION funding_owner_private.check_authority(p_principal uuid,p_epoch integer) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_owner_private AS $$
DECLARE p principals; BEGIN
 -- Advisory locks avoid UPDATE grants/RLS row-lock ambiguity; all authority paths use this lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:owner:'||p_principal,0));
 SELECT * INTO p FROM principals WHERE id=p_principal;
 IF NOT FOUND OR NOT p.active OR p.epoch<>p_epoch OR NOT p.fixture THEN RAISE EXCEPTION 'owner_authority_revoked';END IF;
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
DECLARE b bindings; BEGIN
 IF NEW.decision_id IS NOT NULL THEN
 SELECT * INTO b FROM bindings WHERE decision_id=NEW.decision_id AND kind='issue';
 IF FOUND THEN PERFORM funding_owner_private.check_authority(b.principal,b.epoch);
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
