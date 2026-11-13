BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- New operator-generated UUIDs identify new manual registrations; legacy rows
-- are never replayed or repaired automatically. A receipt keeps the original
-- result, not the current campaign balance. No admin secret is persisted.
CREATE TABLE public.manual_donation_receipts (
  operation_id uuid PRIMARY KEY,
  protest_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 50 AND 10000),
  fee_bps integer NOT NULL CHECK(fee_bps BETWEEN 0 AND 10000),
  message_hash text NOT NULL CHECK(message_hash ~ '^[0-9a-f]{64}$'),
  sms_cost_cents bigint NOT NULL CHECK(sms_cost_cents BETWEEN 1 AND 9999999999),
  platform_cents bigint NOT NULL,
  protest_cents bigint NOT NULL,
  donation_id uuid NOT NULL,
  resulting_balance numeric NOT NULL CHECK(resulting_balance>=0),
  possible_adhesions bigint NOT NULL CHECK(possible_adhesions>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(platform_cents>=0 AND protest_cents>=0 AND platform_cents+protest_cents=amount_cents)
);
ALTER TABLE public.manual_donation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_donation_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.manual_donation_receipts TO service_role;
CREATE POLICY manual_receipts_service_read ON public.manual_donation_receipts FOR SELECT TO service_role USING(true);
CREATE POLICY manual_receipts_service_insert ON public.manual_donation_receipts FOR INSERT TO service_role WITH CHECK(true);

CREATE FUNCTION public.record_manual_donation_atomic(
 p_operation_id uuid,p_protest_id uuid,p_amount_cents bigint,p_fee_bps integer,p_message text,p_sms_cost_cents bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 receipt public.manual_donation_receipts%ROWTYPE;
 target public.protests%ROWTYPE;
 fund public.platform_fund%ROWTYPE;
 donation uuid; platform_amount bigint; protest_amount bigint; resulting_balance numeric; possible bigint;
 message_hash text;
BEGIN
 IF p_operation_id IS NULL OR p_protest_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 50 AND 10000
    OR p_fee_bps IS NULL OR p_fee_bps NOT BETWEEN 0 AND 10000 OR p_sms_cost_cents IS NULL OR p_sms_cost_cents NOT BETWEEN 1 AND 9999999999
    OR length(p_message)>200 THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
 message_hash:=encode(sha256(convert_to(coalesce(p_message,''),'UTF8')),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('manual-donation:'||p_operation_id::text,0));
 SELECT * INTO receipt FROM public.manual_donation_receipts WHERE operation_id=p_operation_id;
 IF FOUND THEN
   IF receipt.protest_id IS DISTINCT FROM p_protest_id OR receipt.amount_cents IS DISTINCT FROM p_amount_cents
      OR receipt.fee_bps IS DISTINCT FROM p_fee_bps OR receipt.message_hash IS DISTINCT FROM message_hash
      OR receipt.sms_cost_cents IS DISTINCT FROM p_sms_cost_cents THEN RAISE EXCEPTION 'MANUAL_TRANSACTION_CONFLICT'; END IF;
   RETURN jsonb_build_object('ok',true,'duplicate',true,'saldo_nuevo',receipt.resulting_balance,'adhesiones_posibles',receipt.possible_adhesions);
 END IF;
 -- Match Ko-fi and campaign closure: campaign lock before platform lock.
 SELECT * INTO target FROM public.protests WHERE id=p_protest_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_TARGET_NOT_FOUND'; END IF;
 IF target.ends_at IS NULL OR target.ends_at<=clock_timestamp() OR target.hash_integridad IS NOT NULL OR target.status='closed' THEN RAISE EXCEPTION 'MANUAL_TARGET_REVIEW_REQUIRED'; END IF;
 SELECT * INTO fund FROM public.platform_fund WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR fund.currency IS DISTINCT FROM 'EUR' OR fund.balance IS NULL THEN RAISE EXCEPTION 'MANUAL_FUND_REVIEW_REQUIRED'; END IF;
 platform_amount:=round(p_amount_cents::numeric*p_fee_bps/10000)::bigint;
 protest_amount:=p_amount_cents-platform_amount;
 INSERT INTO public.donaciones(protest_id,importe,importe_original,importe_convocatoria,importe_plataforma,fee_percent,mensaje,proveedor,moneda)
   VALUES(p_protest_id,p_amount_cents::numeric/100,p_amount_cents::numeric/100,protest_amount::numeric/100,platform_amount::numeric/100,
     round(p_fee_bps::numeric/100),nullif(p_message,''),'manual','EUR') RETURNING id INTO donation;
 UPDATE public.protests SET saldo_euros=coalesce(saldo_euros,0)+protest_amount::numeric/100,
   donaciones_count=coalesce(donaciones_count,0)+1,donaciones_total=coalesce(donaciones_total,0)+p_amount_cents::numeric/100,
   ultima_donacion=now() WHERE id=p_protest_id RETURNING saldo_euros INTO resulting_balance;
 IF resulting_balance<0 THEN RAISE EXCEPTION 'MANUAL_TARGET_REVIEW_REQUIRED'; END IF;
 possible:=floor(resulting_balance/(p_sms_cost_cents::numeric/100))::bigint;
 UPDATE public.platform_fund SET balance=balance+platform_amount::numeric/100,updated_at=now() WHERE id=1;
 INSERT INTO public.financial_movements(type,protest_id,donation_id,amount,currency,destination,description,tx_ref) VALUES
   ('donation_protest',p_protest_id,donation,protest_amount::numeric/100,'EUR','protest_balance','Manual campaign allocation','manual:'||p_operation_id::text||':protest'),
   ('donation_platform',p_protest_id,donation,platform_amount::numeric/100,'EUR','platform_fund','Manual platform allocation','manual:'||p_operation_id::text||':platform');
 INSERT INTO public.manual_donation_receipts(operation_id,protest_id,amount_cents,fee_bps,message_hash,sms_cost_cents,platform_cents,protest_cents,donation_id,resulting_balance,possible_adhesions)
   VALUES(p_operation_id,p_protest_id,p_amount_cents,p_fee_bps,message_hash,p_sms_cost_cents,platform_amount,protest_amount,donation,resulting_balance,possible);
 RETURN jsonb_build_object('ok',true,'duplicate',false,'saldo_nuevo',resulting_balance,'adhesiones_posibles',possible);
END $$;
REVOKE ALL ON FUNCTION public.record_manual_donation_atomic(uuid,uuid,bigint,integer,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_donation_atomic(uuid,uuid,bigint,integer,text,bigint) TO service_role;
COMMIT;
