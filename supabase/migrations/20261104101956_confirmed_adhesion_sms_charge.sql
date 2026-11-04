BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Preparation only: enabling both this database gate and the server feature
-- flag requires Owner approval. No historical OTP or adhesion is backfilled.
-- Proof age is a proposed 30-minute window, not a new retention/purge policy.
CREATE TABLE public.sms_billing_gate (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.sms_billing_gate(singleton,enabled) VALUES(true,false);
CREATE TABLE public.sms_provider_acceptances (
 request_id uuid PRIMARY KEY,
 provider_hash text NOT NULL CHECK(provider_hash ~ '^[0-9a-f]{64}$'),
 phone_hash text NOT NULL CHECK(phone_hash ~ '^[0-9a-f]{64}$'),
 requested_device_id text NOT NULL CHECK(length(requested_device_id) BETWEEN 8 AND 128),
 protest_id uuid NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 CHECK(expires_at>accepted_at AND expires_at<=accepted_at+interval '30 minutes 1 second')
);
CREATE INDEX sms_acceptance_provider_idx ON public.sms_provider_acceptances(provider_hash);
CREATE TABLE public.sms_verification_checks (
 check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES public.sms_provider_acceptances(request_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sms_verification_results (
 check_id uuid PRIMARY KEY REFERENCES public.sms_verification_checks(check_id),
 outcome text NOT NULL CHECK(outcome IN ('approved','rejected','uncertain','mismatch')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sms_approved_grants (
 provider_hash text PRIMARY KEY CHECK(provider_hash ~ '^[0-9a-f]{64}$'),
 check_id uuid NOT NULL UNIQUE REFERENCES public.sms_verification_checks(check_id),
 canonical_device_id text NOT NULL,
 phone_hash text NOT NULL CHECK(phone_hash ~ '^[0-9a-f]{64}$'),
 protest_id uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX sms_grant_identity_target_idx ON public.sms_approved_grants(canonical_device_id,phone_hash,protest_id,expires_at);
CREATE TABLE public.sms_charge_receipts (
 adhesion_id uuid PRIMARY KEY,
 provider_hash text NOT NULL UNIQUE REFERENCES public.sms_approved_grants(provider_hash),
 protest_id uuid NOT NULL,
 cost_cents bigint NOT NULL CHECK(cost_cents BETWEEN 1 AND 9999999999),
 charged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.sms_billing_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_billing_gate FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sms_billing_gate TO service_role;
CREATE POLICY sms_billing_gate_read ON public.sms_billing_gate FOR SELECT TO service_role USING(true);

ALTER TABLE public.sms_provider_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_provider_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ,INSERT ON public.sms_provider_acceptances TO service_role;
CREATE POLICY sms_provider_acceptances_read ON public.sms_provider_acceptances FOR SELECT TO service_role USING(true);
CREATE POLICY sms_provider_acceptances_insert ON public.sms_provider_acceptances FOR INSERT TO service_role WITH CHECK(true);

ALTER TABLE public.sms_verification_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_verification_checks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ,INSERT ON public.sms_verification_checks TO service_role;
CREATE POLICY sms_verification_checks_read ON public.sms_verification_checks FOR SELECT TO service_role USING(true);
CREATE POLICY sms_verification_checks_insert ON public.sms_verification_checks FOR INSERT TO service_role WITH CHECK(true);

ALTER TABLE public.sms_verification_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_verification_results FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ,INSERT ON public.sms_verification_results TO service_role;
CREATE POLICY sms_verification_results_read ON public.sms_verification_results FOR SELECT TO service_role USING(true);
CREATE POLICY sms_verification_results_insert ON public.sms_verification_results FOR INSERT TO service_role WITH CHECK(true);

ALTER TABLE public.sms_approved_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_approved_grants FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ,INSERT ON public.sms_approved_grants TO service_role;
CREATE POLICY sms_approved_grants_read ON public.sms_approved_grants FOR SELECT TO service_role USING(true);
CREATE POLICY sms_approved_grants_insert ON public.sms_approved_grants FOR INSERT TO service_role WITH CHECK(true);

ALTER TABLE public.sms_charge_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_charge_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ,INSERT ON public.sms_charge_receipts TO service_role;
CREATE POLICY sms_charge_receipts_read ON public.sms_charge_receipts FOR SELECT TO service_role USING(true);
CREATE POLICY sms_charge_receipts_insert ON public.sms_charge_receipts FOR INSERT TO service_role WITH CHECK(true);

CREATE FUNCTION public.get_sms_billing_status()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'enabled',coalesce((SELECT enabled FROM public.sms_billing_gate WHERE singleton),false),'proof_ttl_seconds',1800)
$$;

CREATE FUNCTION public.record_sms_provider_acceptance(p_request_id uuid,p_phone_hash text,p_requested_device_id text,p_protest_id uuid,p_provider_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE accepted public.sms_provider_acceptances%ROWTYPE; moment timestamptz:=clock_timestamp();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sms_billing_gate WHERE singleton AND enabled) THEN RAISE EXCEPTION 'SMS_BILLING_PAUSED'; END IF;
 IF p_request_id IS NULL OR p_phone_hash IS NULL OR p_phone_hash !~ '^[0-9a-f]{64}$' OR p_provider_hash IS NULL OR p_provider_hash !~ '^[0-9a-f]{64}$'
    OR p_requested_device_id IS NULL OR length(p_requested_device_id) NOT BETWEEN 8 AND 128 OR p_protest_id IS NULL THEN RAISE EXCEPTION 'SMS_CONTEXT_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-request:'||p_request_id::text,0));
 SELECT * INTO accepted FROM public.sms_provider_acceptances WHERE request_id=p_request_id;
 IF FOUND THEN
  IF accepted.phone_hash IS DISTINCT FROM p_phone_hash OR accepted.provider_hash IS DISTINCT FROM p_provider_hash
     OR accepted.requested_device_id IS DISTINCT FROM p_requested_device_id OR accepted.protest_id IS DISTINCT FROM p_protest_id THEN RAISE EXCEPTION 'SMS_CONTEXT_MISMATCH'; END IF;
 ELSE
  -- Quota history is NOT delivery evidence. Only the server calls this routine
  -- after Verify returned pending with a valid provider verification SID.
  IF NOT EXISTS(SELECT 1 FROM public.otp_requests WHERE id=p_request_id AND phone_hash=p_phone_hash AND device_id=p_requested_device_id
      AND protest_id=p_protest_id AND status='sent' AND requested_at>=moment-interval '30 minutes' AND requested_at<=moment) THEN RAISE EXCEPTION 'SMS_CONTEXT_MISMATCH'; END IF;
  INSERT INTO public.sms_provider_acceptances(request_id,provider_hash,phone_hash,requested_device_id,protest_id,accepted_at,expires_at)
   VALUES(p_request_id,p_provider_hash,p_phone_hash,p_requested_device_id,p_protest_id,moment,moment+interval '30 minutes') RETURNING * INTO accepted;
 END IF;
 -- Pending SID reuse across resend/context requests is allowed. Approval binds
 -- that provider verification globally once to the chosen checked request.
 RETURN jsonb_build_object('ok',true,'request_id',accepted.request_id,'provider_hash',accepted.provider_hash,
   'protest_id',accepted.protest_id,'requested_device_id',accepted.requested_device_id);
END $$;

CREATE FUNCTION public.begin_sms_verification_check(p_request_id uuid,p_phone_hash text,p_requested_device_id text,p_protest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE accepted public.sms_provider_acceptances%ROWTYPE; attempt uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sms_billing_gate WHERE singleton AND enabled) THEN RAISE EXCEPTION 'SMS_BILLING_PAUSED'; END IF;
 SELECT * INTO accepted FROM public.sms_provider_acceptances WHERE request_id=p_request_id;
 IF NOT FOUND OR accepted.phone_hash IS DISTINCT FROM p_phone_hash OR accepted.requested_device_id IS DISTINCT FROM p_requested_device_id
    OR accepted.protest_id IS DISTINCT FROM p_protest_id THEN RAISE EXCEPTION 'SMS_CONTEXT_MISMATCH'; END IF;
 IF accepted.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'SMS_PROOF_EXPIRED'; END IF;
 INSERT INTO public.sms_verification_checks(request_id) VALUES(accepted.request_id) RETURNING check_id INTO attempt;
 RETURN jsonb_build_object('ok',true,'check_id',attempt,'provider_hash',accepted.provider_hash,'request_id',accepted.request_id,
   'protest_id',accepted.protest_id,'requested_device_id',accepted.requested_device_id);
END $$;

CREATE FUNCTION public.resolve_sms_verification_check(p_check_id uuid,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous text;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('rejected','uncertain','mismatch') THEN RAISE EXCEPTION 'SMS_OUTCOME_INVALID'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-check:'||p_check_id::text,0));
 PERFORM 1 FROM public.sms_verification_checks WHERE check_id=p_check_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SMS_CONTEXT_MISMATCH'; END IF;
 SELECT outcome INTO previous FROM public.sms_verification_results WHERE check_id=p_check_id;
 IF FOUND THEN
  IF previous IS DISTINCT FROM p_outcome THEN RAISE EXCEPTION 'SMS_OUTCOME_CONFLICT'; END IF;
 ELSE INSERT INTO public.sms_verification_results(check_id,outcome) VALUES(p_check_id,p_outcome);
 END IF;
 RETURN jsonb_build_object('ok',true,'check_id',p_check_id,'outcome',p_outcome);
END $$;

CREATE FUNCTION public.approve_sms_verification_check(p_check_id uuid,p_provider_hash text,p_canonical_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE accepted public.sms_provider_acceptances%ROWTYPE; grant_row public.sms_approved_grants%ROWTYPE; previous text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sms_billing_gate WHERE singleton AND enabled) THEN RAISE EXCEPTION 'SMS_BILLING_PAUSED'; END IF;
 SELECT a.* INTO accepted FROM public.sms_provider_acceptances a JOIN public.sms_verification_checks c ON c.request_id=a.request_id WHERE c.check_id=p_check_id;
 IF NOT FOUND OR accepted.provider_hash IS DISTINCT FROM p_provider_hash OR accepted.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'SMS_CONTEXT_MISMATCH'; END IF;
 -- No canonical identity is taken from the caller until approval. The HTTP
 -- caller derives it from the existing verified phone row after SDK approved.
 IF NOT EXISTS(SELECT 1 FROM public.devices WHERE id=p_canonical_device_id AND phone_hash=accepted.phone_hash AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'SMS_CANONICAL_DEVICE_MISMATCH'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-context:'||accepted.phone_hash||':'||accepted.protest_id::text,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-provider:'||p_provider_hash,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-check:'||p_check_id::text,0));
 PERFORM 1 FROM public.sms_verification_checks WHERE check_id=p_check_id;
 SELECT outcome INTO previous FROM public.sms_verification_results WHERE check_id=p_check_id;
 IF FOUND AND previous<>'approved' THEN RAISE EXCEPTION 'SMS_OUTCOME_CONFLICT'; END IF;
 SELECT * INTO grant_row FROM public.sms_approved_grants WHERE provider_hash=p_provider_hash;
 IF FOUND THEN
  IF grant_row.canonical_device_id IS DISTINCT FROM p_canonical_device_id OR grant_row.phone_hash IS DISTINCT FROM accepted.phone_hash
      OR grant_row.protest_id IS DISTINCT FROM accepted.protest_id THEN RAISE EXCEPTION 'SMS_PROVIDER_REBIND_FORBIDDEN'; END IF;
 ELSE
  INSERT INTO public.sms_approved_grants(provider_hash,check_id,canonical_device_id,phone_hash,protest_id,expires_at)
   VALUES(p_provider_hash,p_check_id,p_canonical_device_id,accepted.phone_hash,accepted.protest_id,accepted.expires_at) RETURNING * INTO grant_row;
 END IF;
 IF previous IS NULL THEN INSERT INTO public.sms_verification_results(check_id,outcome) VALUES(p_check_id,'approved'); END IF;
 UPDATE public.otp_requests SET status='completed',completed_at=clock_timestamp() WHERE id=accepted.request_id AND phone_hash=accepted.phone_hash AND device_id=accepted.requested_device_id AND protest_id=accepted.protest_id AND status='sent';
 RETURN jsonb_build_object('ok',true,'check_id',p_check_id,'provider_hash',grant_row.provider_hash,'canonical_device_id',grant_row.canonical_device_id,'protest_id',grant_row.protest_id);
END $$;

-- Existing identity, admission, timestamp, nullifier and counter logic remains
-- in the current 17-argument routine. Only this new wrapper owns SMS charging.
CREATE FUNCTION public.create_verified_adhesion_with_sms_charge(
 p_protest_id uuid,p_identity_subject_hash text,p_verification_method text,p_nullifier text,p_device_id text,p_doc_hash text,
 p_ciudad text,p_region text,p_pais text,p_pais_code text,p_idioma text,p_adhesion_osm_id bigint,p_gps_confirmed boolean,
 p_fiabilidad integer,p_senales text,p_institutional_email_hash text,p_institutional_expires_at timestamptz,p_sms_cost_cents bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target public.protests%ROWTYPE; grant_row public.sms_approved_grants%ROWTYPE; created jsonb; charge boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sms_billing_gate WHERE singleton AND enabled) THEN RAISE EXCEPTION 'SMS_BILLING_PAUSED'; END IF;
 IF p_verification_method IS DISTINCT FROM 'phone_otp' OR p_sms_cost_cents IS NULL OR p_sms_cost_cents NOT BETWEEN 1 AND 9999999999 THEN RAISE EXCEPTION 'SMS_BILLING_CONFIGURATION_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.devices WHERE id=p_device_id AND phone_hash=p_identity_subject_hash AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'SMS_VERIFIED_DEVICE_REQUIRED'; END IF;
 SELECT * INTO target FROM public.protests WHERE id=p_protest_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VP_PROTEST_NOT_FOUND'; END IF;
 IF target.status='closed' OR target.hash_integridad IS NOT NULL THEN RAISE EXCEPTION 'VP_PROTEST_CLOSED'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms-context:'||p_identity_subject_hash||':'||p_protest_id::text,0));
 SELECT g.* INTO grant_row FROM public.sms_approved_grants g
  WHERE g.canonical_device_id=p_device_id AND g.phone_hash=p_identity_subject_hash AND g.protest_id=p_protest_id
    AND g.expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.sms_charge_receipts r WHERE r.provider_hash=g.provider_hash)
  ORDER BY g.approved_at,g.provider_hash LIMIT 1;
 charge:=FOUND;
 IF charge THEN
  IF target.saldo_euros IS NULL OR target.saldo_euros::text IN ('NaN','Infinity','-Infinity') OR target.saldo_euros<0 OR target.saldo_euros<>round(target.saldo_euros,2) THEN RAISE EXCEPTION 'SMS_BALANCE_REVIEW_REQUIRED'; END IF;
 END IF;
 created:=public.create_verified_adhesion(p_protest_id,p_identity_subject_hash,p_verification_method,p_nullifier,p_device_id,p_doc_hash,
   p_ciudad,p_region,p_pais,p_pais_code,p_idioma,p_adhesion_osm_id,p_gps_confirmed,p_fiabilidad,p_senales,p_institutional_email_hash,p_institutional_expires_at);
 IF charge THEN
  -- Preserve the core's existing duplicate response before the fee check.
  -- This is still one transaction: insufficient funds roll back the new
  -- adhesion, counters and device timestamp before any confirmation exists.
  IF target.saldo_euros<p_sms_cost_cents::numeric/100 THEN RAISE EXCEPTION 'VP_BALANCE_EXHAUSTED'; END IF;
  UPDATE public.protests SET saldo_euros=saldo_euros-p_sms_cost_cents::numeric/100 WHERE id=p_protest_id;
  INSERT INTO public.financial_movements(type,protest_id,adhesion_id,amount,currency,destination,description,tx_ref)
   VALUES('verification_sms',p_protest_id,(created->>'id')::uuid,p_sms_cost_cents::numeric/100,'EUR','verification_cost','Configured cost for server-approved SMS and confirmed adhesion','sms-charge:'||(created->>'id'));
  INSERT INTO public.sms_charge_receipts(adhesion_id,provider_hash,protest_id,cost_cents)
   VALUES((created->>'id')::uuid,grant_row.provider_hash,p_protest_id,p_sms_cost_cents);
 END IF;
 RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.get_sms_billing_status(),public.record_sms_provider_acceptance(uuid,text,text,uuid,text),public.begin_sms_verification_check(uuid,text,text,uuid),public.resolve_sms_verification_check(uuid,text),public.approve_sms_verification_check(uuid,text,text),public.create_verified_adhesion_with_sms_charge(uuid,text,text,text,text,text,text,text,text,text,text,bigint,boolean,integer,text,text,timestamptz,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sms_billing_status(),public.record_sms_provider_acceptance(uuid,text,text,uuid,text),public.begin_sms_verification_check(uuid,text,text,uuid),public.resolve_sms_verification_check(uuid,text),public.approve_sms_verification_check(uuid,text,text),public.create_verified_adhesion_with_sms_charge(uuid,text,text,text,text,text,text,text,text,text,text,bigint,boolean,integer,text,text,timestamptz,bigint) TO service_role;
COMMIT;
