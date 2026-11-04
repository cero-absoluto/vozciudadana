BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- One immutable receipt per provider transaction. No donor identity or raw
-- transaction IDs; no backfill and no attempted repair/replay of legacy rows.
CREATE TABLE public.kofi_donation_receipts (
  tx_hash text PRIMARY KEY CHECK(tx_hash ~ '^[0-9a-f]{64}$'),
  protest_id uuid NOT NULL,
  paid_at timestamptz NOT NULL,
  cutover_at timestamptz NOT NULL,
  currency text NOT NULL CHECK(currency='EUR'),
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 9999999999),
  cap_cents bigint NOT NULL CHECK(cap_cents BETWEEN 1 AND 9999999999),
  fee_bps integer NOT NULL CHECK(fee_bps BETWEEN 0 AND 10000),
  computable_cents bigint NOT NULL,
  platform_cents bigint NOT NULL,
  protest_cents bigint NOT NULL,
  excess_cents bigint NOT NULL,
  donation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(paid_at>=cutover_at),
  CHECK(computable_cents=least(amount_cents,cap_cents)),
  CHECK(excess_cents=amount_cents-computable_cents),
  CHECK(platform_cents>=0 AND protest_cents>=0 AND platform_cents+protest_cents=computable_cents)
);
ALTER TABLE public.kofi_donation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kofi_donation_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.kofi_donation_receipts TO service_role;
CREATE POLICY kofi_receipts_service_read ON public.kofi_donation_receipts FOR SELECT TO service_role USING(true);
CREATE POLICY kofi_receipts_service_insert ON public.kofi_donation_receipts FOR INSERT TO service_role WITH CHECK(true);

CREATE FUNCTION public.record_kofi_donation_atomic(
  p_tx_hash text,p_amount_cents bigint,p_currency text,p_protest_id uuid,p_cap_cents bigint,p_fee_bps integer,p_paid_at timestamptz,p_cutover_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  receipt public.kofi_donation_receipts%ROWTYPE;
  computable bigint; platform_amount bigint; protest_amount bigint; excess bigint;
  donation uuid; target public.protests%ROWTYPE; fund public.platform_fund%ROWTYPE;
BEGIN
  IF p_tx_hash IS NULL OR p_tx_hash !~ '^[0-9a-f]{64}$' OR p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 1 AND 9999999999
     OR p_currency IS DISTINCT FROM 'EUR' OR p_protest_id IS NULL OR p_cap_cents IS NULL OR p_cap_cents NOT BETWEEN 1 AND 9999999999
     OR p_fee_bps IS NULL OR p_fee_bps NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'KOFI_INPUT_INVALID';
  END IF;
  IF p_paid_at IS NULL OR p_cutover_at IS NULL OR p_paid_at<p_cutover_at OR p_paid_at>clock_timestamp() OR p_cutover_at>clock_timestamp() THEN
    RAISE EXCEPTION 'KOFI_TIMESTAMP_REVIEW_REQUIRED';
  END IF;
  -- Duplicate deliveries serialize even before their receipt exists. Hash
  -- collisions only serialize unrelated transactions; they cannot deduplicate.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kofi:'||p_tx_hash,0));
  SELECT * INTO receipt FROM public.kofi_donation_receipts WHERE tx_hash=p_tx_hash;
  IF FOUND THEN
    IF receipt.protest_id IS DISTINCT FROM p_protest_id OR receipt.currency IS DISTINCT FROM p_currency
       OR receipt.amount_cents IS DISTINCT FROM p_amount_cents OR receipt.cap_cents IS DISTINCT FROM p_cap_cents
       OR receipt.fee_bps IS DISTINCT FROM p_fee_bps OR receipt.paid_at IS DISTINCT FROM p_paid_at THEN RAISE EXCEPTION 'KOFI_TRANSACTION_CONFLICT'; END IF;
    RETURN jsonb_build_object('ok',true,'duplicate',true,'over_limit',receipt.excess_cents>0,
      'importe_computable',receipt.computable_cents::numeric/100,'importe_excedente',receipt.excess_cents::numeric/100);
  END IF;
  -- The old handler may have changed a balance before its ledger insert failed.
  -- Existing partial references are not proof of a completed payment; never
  -- re-credit them automatically, even if only the excess reference survived.
  IF EXISTS(SELECT 1 FROM public.financial_movements WHERE tx_ref IN (left(p_tx_hash,16),left(p_tx_hash,16)||'_excess')) THEN
    RAISE EXCEPTION 'KOFI_LEGACY_REVIEW_REQUIRED';
  END IF;
  -- Match closure's lock order: campaign first, then platform singleton.
  SELECT * INTO target FROM public.protests WHERE id=p_protest_id FOR UPDATE;
  IF NOT FOUND OR target.ends_at IS NULL OR target.ends_at<=clock_timestamp() OR target.hash_integridad IS NOT NULL THEN
    RAISE EXCEPTION 'KOFI_TARGET_REVIEW_REQUIRED';
  END IF;
  SELECT * INTO fund FROM public.platform_fund WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR fund.currency IS DISTINCT FROM 'EUR' OR fund.balance IS NULL THEN RAISE EXCEPTION 'KOFI_FUND_REVIEW_REQUIRED'; END IF;
  computable:=least(p_amount_cents,p_cap_cents);
  platform_amount:=round(computable::numeric*p_fee_bps/10000)::bigint;
  protest_amount:=computable-platform_amount;
  excess:=p_amount_cents-computable;
  INSERT INTO public.donaciones(protest_id,importe,importe_original,importe_convocatoria,importe_plataforma,importe_excedente,fee_percent,proveedor,moneda,over_limit)
    VALUES(p_protest_id,computable::numeric/100,p_amount_cents::numeric/100,protest_amount::numeric/100,platform_amount::numeric/100,
      excess::numeric/100,round(p_fee_bps::numeric/100),'kofi','EUR',excess>0) RETURNING id INTO donation;
  UPDATE public.protests SET saldo_euros=coalesce(saldo_euros,0)+protest_amount::numeric/100,
    donaciones_count=coalesce(donaciones_count,0)+1,donaciones_total=coalesce(donaciones_total,0)+computable::numeric/100,
    ultima_donacion=now() WHERE id=p_protest_id;
  UPDATE public.platform_fund SET balance=balance+platform_amount::numeric/100,updated_at=now() WHERE id=1;
  -- Each ledger leg gets a distinct reference. The original schema has a
  -- globally unique tx_ref, so reusing one reference for both legs is invalid.
  INSERT INTO public.financial_movements(type,protest_id,donation_id,amount,currency,destination,description,tx_ref) VALUES
    ('donation_protest',p_protest_id,donation,protest_amount::numeric/100,'EUR','protest_balance','Ko-fi campaign allocation','kofi:'||p_tx_hash||':protest'),
    ('donation_platform',p_protest_id,donation,platform_amount::numeric/100,'EUR','platform_fund','Ko-fi platform allocation','kofi:'||p_tx_hash||':platform');
  -- Excess remains recorded for manual review in donaciones and this receipt;
  -- it is never credited, nor forced into unsupported legacy ledger types.
  INSERT INTO public.kofi_donation_receipts(tx_hash,protest_id,paid_at,cutover_at,currency,amount_cents,cap_cents,fee_bps,
    computable_cents,platform_cents,protest_cents,excess_cents,donation_id)
    VALUES(p_tx_hash,p_protest_id,p_paid_at,p_cutover_at,'EUR',p_amount_cents,p_cap_cents,p_fee_bps,computable,platform_amount,protest_amount,excess,donation);
  RETURN jsonb_build_object('ok',true,'duplicate',false,'over_limit',excess>0,
    'importe_computable',computable::numeric/100,'importe_excedente',excess::numeric/100);
END $$;
REVOKE ALL ON FUNCTION public.record_kofi_donation_atomic(text,bigint,text,uuid,bigint,integer,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_kofi_donation_atomic(text,bigint,text,uuid,bigint,integer,timestamptz,timestamptz) TO service_role;
COMMIT;
