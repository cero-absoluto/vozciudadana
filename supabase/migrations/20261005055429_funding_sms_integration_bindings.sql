-- Isolated composition only. No real transport, identity link or financial writes.
CREATE ROLE funding_sms_bridge NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE SCHEMA funding_sms_bridge_private;
REVOKE ALL ON SCHEMA funding_sms_bridge_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA funding_sms_bridge_private,funding_sms_fixture_private,funding_exact_cost_private TO funding_sms_bridge;
CREATE TABLE funding_sms_bridge_private.bindings(
 sms_operation_id uuid PRIMARY KEY REFERENCES funding_sms_fixture_private.operations,
 exact_operation_id uuid UNIQUE NOT NULL REFERENCES funding_exact_cost_private.operations,
 event_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='event_sms'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX sms_bridge_event_idx ON funding_sms_bridge_private.bindings(event_id);
ALTER TABLE funding_sms_bridge_private.bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON funding_sms_bridge_private.bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON funding_sms_bridge_private.bindings TO funding_sms_bridge;
CREATE POLICY bridge_actor ON funding_sms_bridge_private.bindings TO funding_sms_bridge USING(true) WITH CHECK(true);
CREATE TRIGGER bridge_immutable BEFORE UPDATE OR DELETE ON funding_sms_bridge_private.bindings FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
GRANT SELECT(id,event_id,purpose) ON funding_sms_fixture_private.operations TO funding_sms_bridge;
GRANT SELECT(id,event_ref,purpose) ON funding_exact_cost_private.operations TO funding_sms_bridge;
CREATE POLICY bridge_sms_scope ON funding_sms_fixture_private.operations FOR SELECT TO funding_sms_bridge USING(true);
CREATE POLICY bridge_exact_scope ON funding_exact_cost_private.operations FOR SELECT TO funding_sms_bridge USING(true);
CREATE FUNCTION funding_sms_bridge_private.actor() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_has_role(current_user,'funding_sms_bridge','MEMBER') OR pg_has_role(current_user,'funding_runtime','MEMBER') OR pg_has_role(current_user,'service_role','MEMBER') OR pg_has_role(current_user,'funding_review','MEMBER') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'bridge_actor_required';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='funding_owner_enrollment') THEN
 IF pg_has_role(current_user,'funding_owner_enrollment','MEMBER') THEN RAISE EXCEPTION 'bridge_actor_required';END IF;
 END IF;
END $$;
CREATE FUNCTION funding_sms_bridge_private.bind(p_sms uuid,p_exact uuid,p_event uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_bridge_private AS $$
DECLARE old bindings;BEGIN
 PERFORM actor();PERFORM pg_advisory_xact_lock(hashtextextended('funding:sms-bridge:'||p_sms::text,0));
 SELECT * INTO old FROM bindings WHERE sms_operation_id=p_sms;
 IF FOUND THEN IF old.exact_operation_id<>p_exact OR old.event_id<>p_event THEN RAISE EXCEPTION 'bridge_binding_conflict';END IF;RETURN to_jsonb(old);END IF;
 IF NOT EXISTS(SELECT 1 FROM funding_sms_fixture_private.operations WHERE id=p_sms AND event_id=p_event AND purpose='event_sms') OR NOT EXISTS(SELECT 1 FROM funding_exact_cost_private.operations WHERE id=p_exact AND event_ref=p_event AND purpose='event_sms') THEN RAISE EXCEPTION 'bridge_scope_mismatch';END IF;
 INSERT INTO bindings(sms_operation_id,exact_operation_id,event_id,purpose) VALUES(p_sms,p_exact,p_event,'event_sms') RETURNING * INTO old;RETURN to_jsonb(old);
END $$;
CREATE FUNCTION funding_sms_bridge_private.inspect(p_sms uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_bridge_private AS $$
DECLARE b bindings;BEGIN PERFORM actor();SELECT * INTO b FROM bindings WHERE sms_operation_id=p_sms;IF NOT FOUND THEN RAISE EXCEPTION 'bridge_unknown_operation';END IF;RETURN to_jsonb(b);END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA funding_sms_bridge_private FROM PUBLIC,anon,authenticated,service_role,funding_runtime,funding_review;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA funding_sms_bridge_private TO funding_sms_bridge;
