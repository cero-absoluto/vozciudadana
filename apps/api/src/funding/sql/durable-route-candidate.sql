-- DRAFT, NOT A SUPABASE MIGRATION. Apply only to an explicitly disposable DB.
-- No public routing, no scope enrolment, no credentials, no money imports.
DO $$BEGIN
 IF to_regclass('public.fixture_parent_trigger_calls') IS NULL THEN
  RAISE EXCEPTION 'disposable_route_fixture_required';
 END IF;
END$$;
CREATE ROLE funding_route_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA funding_route_private;
REVOKE ALL ON SCHEMA funding_route_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE funding_route_private.cutoffs(event_id uuid PRIMARY KEY REFERENCES public.protests(id),closed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE funding_route_private.cutoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_cutoff ON funding_route_private.cutoffs TO funding_route_runtime USING(true) WITH CHECK(true);
GRANT SELECT ON funding_route_private.cutoffs TO funding_route_runtime;
GRANT INSERT(event_id) ON funding_route_private.cutoffs TO funding_route_runtime;
CREATE TABLE funding_route_private.bindings(
 binding text PRIMARY KEY CHECK(binding ~ '^[a-f0-9]{64}$'),
 event_id uuid NOT NULL REFERENCES public.protests(id),
 operation_key text NOT NULL UNIQUE CHECK(operation_key ~ '^synthetic_sms_route_[a-f0-9]{64}$'),
 operation_id uuid UNIQUE,
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN('preparing','bound')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='bound')=(operation_id IS NOT NULL))
);
ALTER TABLE funding_route_private.bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_operator ON funding_route_private.bindings TO funding_route_runtime
 USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA funding_route_private TO funding_route_runtime;
GRANT SELECT,INSERT ON funding_route_private.bindings TO funding_route_runtime;
GRANT UPDATE(operation_id,state) ON funding_route_private.bindings TO funding_route_runtime;
GRANT SELECT(id,starts_at,ends_at) ON public.protests TO funding_route_runtime;
GRANT UPDATE(id) ON public.protests TO funding_route_runtime;
CREATE POLICY route_parent_read ON public.protests FOR SELECT TO funding_route_runtime USING(true);
CREATE POLICY route_parent_lock ON public.protests FOR UPDATE TO funding_route_runtime USING(true) WITH CHECK(true);
CREATE FUNCTION funding_route_private.claim(p_binding text,p_event uuid,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE b funding_route_private.bindings; won boolean;
BEGIN
 PERFORM 1 FROM public.protests WHERE id=p_event AND starts_at IS NOT NULL
  AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'route_event_closed'; END IF;
 IF EXISTS(SELECT 1 FROM funding_route_private.cutoffs WHERE event_id=p_event) THEN RAISE EXCEPTION 'route_event_closed';END IF;
 INSERT INTO funding_route_private.bindings(binding,event_id,operation_key)
 VALUES(p_binding,p_event,p_key) ON CONFLICT(binding) DO NOTHING;
 won:=FOUND;
 SELECT * INTO b FROM funding_route_private.bindings WHERE binding=p_binding FOR UPDATE;
 IF b.event_id IS DISTINCT FROM p_event OR b.operation_key IS DISTINCT FROM p_key THEN
  RAISE EXCEPTION 'unresolved_attempt_requires_review';
 END IF;
 RETURN jsonb_build_object('won',won,'state',b.state,'operationId',b.operation_id);
END$$;
CREATE FUNCTION funding_route_private.bind(p_binding text,p_key text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE b funding_route_private.bindings;
BEGIN
 SELECT * INTO b FROM funding_route_private.bindings WHERE binding=p_binding FOR UPDATE;
 IF NOT FOUND OR b.operation_key IS DISTINCT FROM p_key THEN RAISE EXCEPTION 'route_binding_conflict';END IF;
 IF b.state='bound' THEN
  IF b.operation_id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'route_binding_conflict';END IF;
 ELSE
  -- Bind only an already committed exposure for this exact event and operation key.
  IF NOT EXISTS(SELECT 1 FROM funding_sms_fixture_private.operations o
   WHERE o.id=p_id AND o.event_id=b.event_id AND o.operation_key=p_key) THEN
   RAISE EXCEPTION 'route_exposure_required';END IF;
  UPDATE funding_route_private.bindings SET operation_id=p_id,state='bound' WHERE binding=p_binding;
 END IF;
 RETURN jsonb_build_object('operationId',p_id);
END$$;
CREATE FUNCTION funding_route_private.lookup(p_binding text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('state',state,'operationId',operation_id) FROM funding_route_private.bindings WHERE binding=p_binding;
$$;
CREATE FUNCTION funding_route_private.close_participation(p_event uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public.protests WHERE id=p_event AND ends_at<=clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM funding_route_private.bindings WHERE event_id=p_event) THEN RAISE EXCEPTION 'route_close_not_eligible';END IF;
 INSERT INTO funding_route_private.cutoffs(event_id) VALUES(p_event) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('closed',true,'settled',false,'fundsMoved',false);
END$$;
CREATE FUNCTION funding_route_private.protect() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.binding IS DISTINCT FROM OLD.binding OR NEW.event_id IS DISTINCT FROM OLD.event_id
 OR NEW.operation_key IS DISTINCT FROM OLD.operation_key OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR OLD.state='bound' OR NEW.state<>'bound' THEN RAISE EXCEPTION 'route_binding_immutable';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER route_binding_protect BEFORE UPDATE OR DELETE ON funding_route_private.bindings
 FOR EACH ROW EXECUTE FUNCTION funding_route_private.protect();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA funding_route_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION funding_route_private.claim(text,uuid,text),funding_route_private.bind(text,text,uuid),
 funding_route_private.lookup(text),funding_route_private.close_participation(uuid) TO funding_route_runtime;
GRANT USAGE ON SCHEMA funding_sms_fixture_private TO funding_route_runtime;
GRANT SELECT(id,event_id,operation_key) ON funding_sms_fixture_private.operations TO funding_route_runtime;
CREATE POLICY route_exposure_read ON funding_sms_fixture_private.operations FOR SELECT TO funding_route_runtime USING(true);
-- Lock privilege is not mutation authority.
CREATE FUNCTION funding_route_private.protect_parent() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AND pg_has_role(current_user,'funding_route_runtime','MEMBER') THEN RAISE EXCEPTION 'route_parent_read_only';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION funding_route_private.protect_parent() FROM PUBLIC;
CREATE TRIGGER route_parent_read_only BEFORE UPDATE ON public.protests
 FOR EACH ROW EXECUTE FUNCTION funding_route_private.protect_parent();
CREATE ROLE funding_lookup_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA funding_lookup_private;
REVOKE ALL ON SCHEMA funding_lookup_private FROM PUBLIC,anon,authenticated,service_role,funding_route_runtime;
CREATE TABLE funding_lookup_private.references(
 operation_id uuid PRIMARY KEY,
 iv text NOT NULL CHECK(iv ~ '^[a-f0-9]{24}$'),
 tag text NOT NULL CHECK(tag ~ '^[a-f0-9]{32}$'),
 ciphertext text NOT NULL CHECK(ciphertext ~ '^[a-f0-9]{68}$'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '30 days',
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
ALTER TABLE funding_lookup_private.references ENABLE ROW LEVEL SECURITY;
CREATE POLICY lookup_operator ON funding_lookup_private.references TO funding_lookup_runtime USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA funding_lookup_private TO funding_lookup_runtime;
GRANT SELECT(operation_id,iv,tag,ciphertext,expires_at),INSERT(operation_id,iv,tag,ciphertext)
 ON funding_lookup_private.references TO funding_lookup_runtime;
-- No runtime update/delete/TTL extension. Purge is a separate retention operator job.
CREATE FUNCTION funding_lookup_private.purge_expired() RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE n bigint;BEGIN DELETE FROM funding_lookup_private.references WHERE expires_at<=clock_timestamp();GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END$$;
REVOKE ALL ON FUNCTION funding_lookup_private.purge_expired() FROM PUBLIC,anon,authenticated,service_role,funding_lookup_runtime;
CREATE ROLE funding_lookup_cleanup NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA funding_lookup_private TO funding_lookup_cleanup;
GRANT SELECT(expires_at),DELETE ON funding_lookup_private.references TO funding_lookup_cleanup;
CREATE POLICY lookup_cleanup_read ON funding_lookup_private.references FOR SELECT TO funding_lookup_cleanup USING(expires_at<=clock_timestamp());
CREATE POLICY lookup_cleanup_delete ON funding_lookup_private.references FOR DELETE TO funding_lookup_cleanup USING(expires_at<=clock_timestamp());
GRANT EXECUTE ON FUNCTION funding_lookup_private.purge_expired() TO funding_lookup_cleanup;
