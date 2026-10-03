-- Phase I1 — restrict public mutation paths.
-- Applied to production Supabase as migration version 20261003173834.
-- No application rows are modified.

REVOKE EXECUTE ON FUNCTION public.increment_protest_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_protest_count(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_cities_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_cities_count(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_vouch(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_vouch(uuid, text, text) TO service_role;

DROP POLICY IF EXISTS push_service_only ON public.push_subscriptions;
CREATE POLICY push_service_only
ON public.push_subscriptions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public.push_subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO service_role;

DROP POLICY IF EXISTS donaciones_service_insert ON public.donaciones;
CREATE POLICY donaciones_service_insert
ON public.donaciones
FOR INSERT
TO service_role
WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.donaciones FROM anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.donaciones TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM anon, authenticated;
