BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Applying this proposal pauses automatic closure and rejects new status
-- transitions to closed until an Owner-approved boundary is configured.
-- No financial history is repaired, reopened, backfilled or transferred here.
CREATE TABLE public.financial_closure_gate (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 cutover_at timestamptz,
 CHECK(NOT enabled OR cutover_at IS NOT NULL)
);
INSERT INTO public.financial_closure_gate(singleton,enabled) VALUES(true,false);
ALTER TABLE public.financial_closure_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_closure_gate FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.financial_closure_gate TO service_role;
CREATE POLICY closure_gate_read ON public.financial_closure_gate FOR SELECT TO service_role USING(true);

CREATE TABLE public.protest_closure_receipts (
 protest_id uuid PRIMARY KEY,
 transferred_amount numeric(10,2) NOT NULL CHECK(transferred_amount>=0),
 currency text NOT NULL CHECK(currency='EUR'),
 integrity_hash text NOT NULL CHECK(integrity_hash ~ '^[0-9a-f]{64}$'),
 cutover_at timestamptz NOT NULL,
 closed_at timestamptz NOT NULL DEFAULT now(),
 indexnow_pending boolean NOT NULL DEFAULT true CHECK(indexnow_pending)
);
ALTER TABLE public.protest_closure_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.protest_closure_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.protest_closure_receipts TO service_role;
CREATE POLICY closure_receipts_read ON public.protest_closure_receipts FOR SELECT TO service_role USING(true);
CREATE POLICY closure_receipts_insert ON public.protest_closure_receipts FOR INSERT TO service_role WITH CHECK(true);

-- Closure receipts signal pending indexing only. The current production job
-- does not submit HTTP; this financial proposal adds no provider calls and
-- never marks indexnow_last_notified_at as successful delivery.

-- Stop if the installed writer changed since the read-only review. The
-- replacement is not allowed to silently erase another trigger configuration.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger
  WHERE tgrelid='public.protests'::regclass AND tgname='trg_transfer_protest_surplus_to_platform_fund'
   AND NOT tgisinternal AND tgenabled='O' AND tgtype=17
   AND tgfoid=to_regprocedure('public.transfer_protest_surplus_to_platform_fund()')) THEN
  RAISE EXCEPTION 'CLOSURE_TRIGGER_REVIEW_REQUIRED';
 END IF;
END $$;

-- Replace only the known status closure path; never update the same campaign
-- recursively from a trigger. Both direct transitions and the cron use this
-- BEFORE function, and the outer UPDATE commits the final balance/hash/status.
CREATE OR REPLACE FUNCTION public.transfer_protest_surplus_to_platform_fund()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE boundary timestamptz; fund public.platform_fund%ROWTYPE; amount numeric; final_hash text;
BEGIN
 IF TG_WHEN<>'BEFORE' OR TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'CLOSURE_TRIGGER_CONFIGURATION_INVALID'; END IF;
 IF OLD.status='closed' AND NEW.status IS DISTINCT FROM OLD.status
    AND EXISTS(SELECT 1 FROM public.protest_closure_receipts WHERE protest_id=OLD.id) THEN
  RAISE EXCEPTION 'CLOSURE_REOPEN_REVIEW_REQUIRED';
 END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status IS DISTINCT FROM 'closed' THEN RETURN NEW; END IF;
 SELECT cutover_at INTO boundary FROM public.financial_closure_gate WHERE singleton AND enabled;
 IF NOT FOUND OR boundary IS NULL OR boundary>clock_timestamp() THEN RAISE EXCEPTION 'CLOSURE_DISABLED'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at']) THEN
  RAISE EXCEPTION 'CLOSURE_COMBINED_UPDATE_REVIEW_REQUIRED';
 END IF;
 -- Strict future cohort only. Owner must decide eligibility and any early
 -- administrative closure policy; legacy cases remain outside this proposal.
 IF OLD.created_at IS NULL OR OLD.created_at<boundary OR OLD.ends_at IS NULL OR OLD.ends_at<boundary
    OR OLD.ends_at>clock_timestamp() OR OLD.hash_integridad IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.integrity_records WHERE protest_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.financial_movements WHERE protest_id=OLD.id AND type='protest_surplus')
    OR EXISTS(SELECT 1 FROM public.protest_closure_receipts WHERE protest_id=OLD.id) THEN
  RAISE EXCEPTION 'CLOSURE_HISTORY_REVIEW_REQUIRED';
 END IF;
 amount:=OLD.saldo_euros;
 IF amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR amount<0 OR amount<>round(amount,2) OR amount>99999999.99 THEN
  RAISE EXCEPTION 'CLOSURE_BALANCE_REVIEW_REQUIRED';
 END IF;
 -- Outer UPDATE already holds the campaign lock. Then lock the singleton,
 -- exactly as Ko-fi/manual registration; no SUM of gross donations is used.
 SELECT * INTO fund FROM public.platform_fund WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR fund.currency IS DISTINCT FROM 'EUR' OR fund.balance IS NULL
    OR fund.balance::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'CLOSURE_FUND_REVIEW_REQUIRED'; END IF;
 -- Existing immutable version-2 method is called unchanged. Its current body
 -- qualifies public relations and extensions.digest; no alternate hash method.
 final_hash:=public.calculate_integrity_hash_v2(OLD.id);
 IF final_hash IS NULL OR final_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'CLOSURE_HASH_INVALID'; END IF;
 IF amount>0 THEN
  INSERT INTO public.financial_movements(type,protest_id,amount,currency,destination,description,tx_ref)
   VALUES('protest_surplus',OLD.id,amount,'EUR','platform_fund','Atomic campaign surplus transfer','closure:'||OLD.id::text);
  UPDATE public.platform_fund SET balance=balance+amount,updated_at=now() WHERE id=1;
 END IF;
 INSERT INTO public.protest_closure_receipts(protest_id,transferred_amount,currency,integrity_hash,cutover_at)
  VALUES(OLD.id,amount,'EUR',final_hash,boundary);
 NEW.saldo_euros:=0;
 NEW.hash_integridad:=final_hash;
 NEW.integrity_version:=2;
 NEW.integrity_calculated_at:=now();
 -- Indexing stays explicitly pending; no request or delivery is asserted.
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.transfer_protest_surplus_to_platform_fund() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_protest_surplus_to_platform_fund() TO service_role;
DROP TRIGGER IF EXISTS trg_transfer_protest_surplus_to_platform_fund ON public.protests;
CREATE TRIGGER trg_transfer_protest_surplus_to_platform_fund BEFORE UPDATE OF status ON public.protests
 FOR EACH ROW EXECUTE FUNCTION public.transfer_protest_surplus_to_platform_fund();

CREATE FUNCTION public.close_protest_atomic(p_protest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt public.protest_closure_receipts%ROWTYPE; target public.protests%ROWTYPE;
BEGIN
 IF p_protest_id IS NULL THEN RAISE EXCEPTION 'CLOSURE_INPUT_INVALID'; END IF;
 SELECT * INTO target FROM public.protests WHERE id=p_protest_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLOSURE_TARGET_NOT_FOUND'; END IF;
 SELECT * INTO receipt FROM public.protest_closure_receipts WHERE protest_id=p_protest_id;
 IF FOUND THEN
  RETURN jsonb_build_object('ok',true,'duplicate',true,'transferred_amount',receipt.transferred_amount,'integrity_hash',receipt.integrity_hash);
 END IF;
 IF target.status='closed' THEN RAISE EXCEPTION 'CLOSURE_HISTORY_REVIEW_REQUIRED'; END IF;
 UPDATE public.protests SET status='closed' WHERE id=p_protest_id;
 SELECT * INTO STRICT receipt FROM public.protest_closure_receipts WHERE protest_id=p_protest_id;
 RETURN jsonb_build_object('ok',true,'duplicate',false,'transferred_amount',receipt.transferred_amount,'integrity_hash',receipt.integrity_hash);
END $$;

CREATE FUNCTION public.close_due_protests_atomic()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE boundary timestamptz; candidate record; closed_count integer:=0; review_count integer:=0;
BEGIN
 SELECT cutover_at INTO boundary FROM public.financial_closure_gate WHERE singleton AND enabled;
 IF NOT FOUND OR boundary IS NULL OR boundary>clock_timestamp() THEN RETURN jsonb_build_object('paused',true,'closed',0,'review',0); END IF;
 FOR candidate IN SELECT id FROM public.protests
   WHERE status IS DISTINCT FROM 'closed' AND created_at>=boundary AND ends_at>=boundary AND ends_at<=clock_timestamp()
     AND hash_integridad IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED
 LOOP
  BEGIN
   PERFORM public.close_protest_atomic(candidate.id);
   closed_count:=closed_count+1;
  EXCEPTION WHEN OTHERS THEN review_count:=review_count+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('paused',false,'closed',closed_count,'review',review_count);
END $$;
REVOKE ALL ON FUNCTION public.close_protest_atomic(uuid),public.close_due_protests_atomic() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.close_protest_atomic(uuid),public.close_due_protests_atomic() TO service_role;

-- One existing schedule is replaced, never an immediate historical catch-up.
-- With the gate OFF this job pauses closure instead of running the unsafe CTE.
DO $$ DECLARE previous integer;
BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname='auto-close-protests')<>1 THEN RAISE EXCEPTION 'CLOSURE_CRON_REVIEW_REQUIRED'; END IF;
 SELECT jobid INTO previous FROM cron.job WHERE jobname='auto-close-protests' AND active AND schedule='*/30 * * * *' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLOSURE_CRON_REVIEW_REQUIRED'; END IF;
 PERFORM cron.unschedule(previous);
 PERFORM cron.schedule('auto-close-protests','*/30 * * * *','SELECT public.close_due_protests_atomic();');
END $$;
COMMIT;
