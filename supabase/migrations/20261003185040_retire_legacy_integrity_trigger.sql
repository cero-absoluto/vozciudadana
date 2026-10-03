-- Phase I3: VP-SEC-027 legacy integrity-trigger interference.
-- Authorised scoped change: remove the legacy trigger from future updates.
-- Production inspection found it present but disabled (tgenabled = 'D').
-- Preserve both integrity functions, all historical hashes/snapshots, all
-- participant rows, and the existing closure/anonymisation cron definitions.
-- VP-ISS-012 is not resolved by this migration: historical discrepancies and
-- the partial ON CONFLICT update in calculate_integrity_hash_v2 remain.
--
-- Historical rollback definition, for explicit review only (do not auto-run):
-- CREATE TRIGGER trigger_hash_integridad BEFORE UPDATE ON public.protests
-- FOR EACH ROW EXECUTE FUNCTION public.calcular_hash_integridad();
-- ALTER TABLE public.protests DISABLE TRIGGER trigger_hash_integridad;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.calculate_integrity_hash_v2(uuid)') IS NULL THEN
    RAISE EXCEPTION 'I3 precondition failed: integrity v2 function is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.protests'::regclass
      AND tgname = 'trigger_hash_integridad'
      AND (tgisinternal OR tgfoid IS DISTINCT FROM
           to_regprocedure('public.calcular_hash_integridad()')::oid)
  ) THEN
    RAISE EXCEPTION 'I3 precondition failed: unexpected legacy trigger function';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trigger_hash_integridad ON public.protests;
