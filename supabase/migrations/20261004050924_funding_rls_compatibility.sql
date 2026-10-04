-- Isolated I4 compatibility candidate. Never apply to production without its own gate.
-- UPDATE privilege is needed for SELECT FOR UPDATE; actual parent writes are denied.
REVOKE UPDATE (id) ON public.protests FROM funding_runtime;
GRANT UPDATE (ultima_donacion) ON public.protests TO funding_runtime;
CREATE POLICY protests_funding_lock ON public.protests FOR UPDATE TO funding_runtime
 USING (EXISTS (SELECT 1 FROM funding_private.accounts a WHERE a.event_id=protests.id))
 WITH CHECK (EXISTS (SELECT 1 FROM funding_private.accounts a WHERE a.event_id=protests.id));
CREATE FUNCTION funding_private.deny_parent_write() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 -- The schema owner/superuser already controls DDL; ordinary inherited actors do not.
 IF current_user='funding_runtime' OR
    (pg_has_role(current_user,'funding_runtime','USAGE')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
     AND current_user<>pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='funding_private'))) THEN
  RAISE EXCEPTION 'funding_parent_readonly';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION funding_private.deny_parent_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION funding_private.deny_parent_write() TO funding_runtime;
CREATE TRIGGER funding_parent_readonly BEFORE UPDATE ON public.protests
 FOR EACH STATEMENT EXECUTE FUNCTION funding_private.deny_parent_write();
-- No parent values, legacy triggers, balances, snapshots or hashes are updated.
