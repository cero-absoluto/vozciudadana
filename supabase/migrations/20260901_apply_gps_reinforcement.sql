-- ============================================================================
-- apply_gps_reinforcement() — Gate 1: GPS post-closure evidence freeze
-- 1 September 2026 (reconciliation entry)
--
-- IMPORTANT: this migration documents a function that was already created
-- and verified directly in production, manually, before this repository
-- had any record of it. apps/api/src/routes/protests.js calls it via
-- supabase.rpc('apply_gps_reinforcement', ...) and, since that manual
-- creation, has been working correctly against the real, deployed function.
--
-- This is NOT the original reconstruction proposed earlier in this thread —
-- that first draft added extra RETURNING columns (gps_confirmed, fiabilidad,
-- adhesion_osm_id) and explicit schema-qualification/SECURITY INVOKER
-- wording that the real function does not have. Confirmed by running
-- pg_get_functiondef() and information_schema.role_routine_grants directly
-- against production: the real function returns only `id`, is not
-- schema-qualified in its own text, and does not declare SECURITY INVOKER
-- explicitly (Postgres defaults to invoker rights when omitted — same
-- effective behaviour). The text below is that real definition, verbatim,
-- so the repository matches what is actually running — not an improved or
-- corrected version.
--
-- Why this still matters as a migration, even though nothing changes in
-- production: without this entry, the codebase has no record of a function
-- its own route code depends on — anyone rebuilding the database from
-- migrations alone (a fresh environment, a disaster-recovery restore, the
-- staging environment once it exists) would hit exactly the "function does
-- not exist" failure this thread first set out to prevent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_gps_reinforcement(p_adhesion_id uuid, p_gps_confirmed boolean, p_adhesion_osm_id bigint, p_ciudad text, p_region text, p_pais text, p_pais_code text, p_fiabilidad integer, p_senales text)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.adhesions a
  SET
    gps_confirmed   = p_gps_confirmed,
    adhesion_osm_id = COALESCE(p_adhesion_osm_id, a.adhesion_osm_id),
    ciudad          = COALESCE(p_ciudad, a.ciudad),
    region          = COALESCE(p_region, a.region),
    pais            = COALESCE(p_pais, a.pais),
    pais_code       = COALESCE(p_pais_code, a.pais_code),
    fiabilidad      = p_fiabilidad,
    senales         = p_senales
  FROM public.protests p
  WHERE a.id = p_adhesion_id
    AND p.id = a.protest_id
    AND p.ends_at > clock_timestamp()
  RETURNING a.id;
END;
$function$;

COMMENT ON FUNCTION public.apply_gps_reinforcement IS
  'Gate 1 (GPS post-closure evidence freeze). Atomically checks p.ends_at > clock_timestamp() and applies the GPS-reinforcement write in one statement, closing the race where a slow reverse-geocode (Nominatim, up to 6s) could let a write land after closure. Returns zero rows (not an error) once the convocatoria has closed; the caller (protests.js) treats zero rows as 410 PROTEST_CLOSED and does not mark the one-time gps_update_token as used. Verbatim reconciliation of the function as manually created and verified in production, 1 September 2026 — see the Audit Trail for the design history (negative-control test, now() vs clock_timestamp() race test, 11/11 test suite).';

-- ACL confirmed directly against production (information_schema.role_routine_grants):
-- service_role has explicit EXECUTE; postgres has EXECUTE as the function's
-- owner (implicit, not something this migration needs to grant separately);
-- anon and authenticated have none. The statements below reproduce that
-- same end state on any environment run from these migrations.
REVOKE ALL ON FUNCTION public.apply_gps_reinforcement FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_gps_reinforcement FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_gps_reinforcement TO service_role;
