-- DISPOSABLE REHEARSAL ONLY. Not an installation/activation migration.
DO $$ BEGIN
 IF to_regclass('public.fixture_parent_trigger_calls') IS NULL THEN
  RAISE EXCEPTION 'disposable_participation_fixture_required';
 END IF;
END $$;
CREATE SCHEMA funding_participation_private;
REVOKE ALL ON SCHEMA funding_participation_private FROM PUBLIC,anon,authenticated;
CREATE TABLE funding_participation_private.scopes(event_id uuid PRIMARY KEY REFERENCES public.protests(id));
ALTER TABLE funding_participation_private.scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_service_read ON funding_participation_private.scopes FOR SELECT TO service_role USING(true);
GRANT USAGE ON SCHEMA funding_participation_private TO service_role;
GRANT SELECT ON funding_participation_private.scopes TO service_role;
CREATE FUNCTION funding_participation_private.is_scoped(p_event uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER AS $$
 SELECT EXISTS(SELECT 1 FROM funding_participation_private.scopes WHERE event_id=p_event);
$$;
REVOKE ALL ON FUNCTION funding_participation_private.is_scoped(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION funding_participation_private.is_scoped(uuid) TO service_role;
CREATE FUNCTION funding_participation_private.immutable_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'scope_append_only';END $$;
CREATE TRIGGER scope_immutable BEFORE UPDATE OR DELETE ON funding_participation_private.scopes FOR EACH ROW EXECUTE FUNCTION funding_participation_private.immutable_scope();
CREATE FUNCTION funding_participation_private.fence_legacy() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE eid uuid; BEGIN
 IF TG_TABLE_NAME='protests' THEN
  eid:=NEW.id;
  IF funding_participation_private.is_scoped(eid) AND (
   NEW.saldo_euros IS DISTINCT FROM OLD.saldo_euros OR
   NEW.status IS DISTINCT FROM OLD.status AND NEW.status='closed'
  ) THEN RAISE EXCEPTION 'legacy_financial_writer_fenced'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN eid:=OLD.protest_id; ELSE eid:=NEW.protest_id;END IF;
  IF funding_participation_private.is_scoped(eid) OR
    (TG_OP='UPDATE' AND funding_participation_private.is_scoped(OLD.protest_id)) THEN
   RAISE EXCEPTION 'legacy_financial_writer_fenced';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA funding_participation_private FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA funding_participation_private TO service_role;
CREATE TRIGGER funding_scope_balance_fence BEFORE UPDATE ON public.protests FOR EACH ROW EXECUTE FUNCTION funding_participation_private.fence_legacy();
CREATE TRIGGER funding_scope_movements_fence BEFORE INSERT OR UPDATE OR DELETE ON public.financial_movements FOR EACH ROW EXECUTE FUNCTION funding_participation_private.fence_legacy();
CREATE TRIGGER funding_scope_donations_fence BEFORE INSERT OR UPDATE OR DELETE ON public.donaciones FOR EACH ROW EXECUTE FUNCTION funding_participation_private.fence_legacy();
-- This fixture prevents legacy status-closed trigger money. Real cutover must
-- split participation closure from settlement, not set closed through legacy.
DO $$ DECLARE signature regprocedure; body text; old_guard text; BEGIN
 SELECT p.oid::regprocedure INTO signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='create_verified_adhesion';
 IF signature IS NULL THEN RAISE EXCEPTION 'real_adhesion_authority_required';END IF;
 body:=pg_get_functiondef(signature);
 old_guard:='IF v_protest.saldo_euros IS NOT NULL AND v_protest.saldo_euros <= 0 THEN';
 IF position(old_guard IN body)=0 THEN RAISE EXCEPTION 'adhesion_definition_drift';END IF;
 body:=replace(body,old_guard,'IF NOT funding_participation_private.is_scoped(p_protest_id) AND v_protest.saldo_euros IS NOT NULL AND v_protest.saldo_euros <= 0 THEN');
 EXECUTE body;
END $$;
