-- Fix: Ko-fi donation crediting was neither atomic nor actually idempotent.
--
-- Found by code review (22 Nov 2026), not reproduced against production:
--
-- 1. routes/webhooks.js inserted two financial_movements rows in the SAME
--    statement ('donation_protest' and 'donation_platform') sharing one
--    tx_ref. financial_movements_tx_ref_idx (20260618) is a single-column
--    unique index, so that insert violates itself on every donation that
--    has a resolved Ko-fi transaction id — not only on retries. By the time
--    it fails, protests.saldo_euros/donaciones_total and the donaciones row
--    have already been written (separate round trips), so every retry
--    re-credits the balance while financial_movements — the audit trail —
--    never actually records anything for Ko-fi donations.
-- 2. The over-limit path inserted type='over_limit_pending_review' and
--    destination='pending_review', neither of which is in financial_movements'
--    CHECK constraints (phase1, 20260610) — that insert fails too.
-- 3. protests.saldo_euros/donaciones_count/donaciones_total were updated via
--    read-in-JS-then-write, not an atomic SQL increment, and the write was
--    spread across several independent Supabase round trips with no
--    transaction — a lost-update window independent of (1).
--
-- Fix: do the whole credit in one Postgres function, so it is one
-- transaction (atomic) and the FIRST statement is the idempotency gate
-- (INSERT ... ON CONFLICT DO NOTHING on tx_ref) — no balance mutation
-- happens before a duplicate is detected. The two/three financial_movements
-- rows per donation now get distinct tx_ref suffixes so they stop
-- conflicting with each other while the real transaction id still
-- dedupes retries via the first row.

ALTER TABLE financial_movements DROP CONSTRAINT IF EXISTS financial_movements_type_check;
ALTER TABLE financial_movements ADD CONSTRAINT financial_movements_type_check CHECK (type IN (
  'donation_protest',
  'donation_platform',
  'verification_sms',
  'verification_email',
  'protest_surplus',
  'platform_expense',
  'over_limit_pending_review'
));

ALTER TABLE financial_movements DROP CONSTRAINT IF EXISTS financial_movements_destination_check;
ALTER TABLE financial_movements ADD CONSTRAINT financial_movements_destination_check CHECK (
  destination IN ('protest_balance', 'platform_fund', 'verification_cost', 'pending_review')
);

CREATE OR REPLACE FUNCTION public.credit_kofi_donation(
  p_tx_ref               TEXT,
  p_protest_id           UUID,
  p_moneda               TEXT,
  p_importe_original     NUMERIC,
  p_importe_computable   NUMERIC,
  p_importe_convocatoria NUMERIC,
  p_importe_plataforma   NUMERIC,
  p_importe_excedente    NUMERIC,
  p_fee_percent          INTEGER,
  p_over_limit           BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_gate_id       UUID;
  v_donation_id   UUID;
  v_protest_found BOOLEAN := false;
  v_fk_protest_id UUID;   -- p_protest_id if it actually exists, else NULL
BEGIN
  -- Resolve protest existence FIRST, before any insert references it as a
  -- foreign key. A stale kofi_protest_map row or a misconfigured
  -- KOFI_DEFAULT_PROTEST_ID can point at an id that no longer exists —
  -- financial_movements.protest_id and platform_fund.protest_id are both
  -- nullable (ON DELETE SET NULL) specifically so that case is representable
  -- without failing the whole credit. (This FK violation existed in the
  -- original code too, just masked by the tx_ref bug below always failing
  -- first for any resolved protest.)
  IF p_protest_id IS NOT NULL THEN
    -- EXISTS always yields true/false, never NULL — a plain
    -- "SELECT true INTO ... WHERE ..." would silently overwrite the FALSE
    -- default with NULL when no row matches (SELECT INTO on zero rows sets
    -- the target to NULL), which would make v_fk_protest_id's CASE below
    -- still resolve correctly (NULL is not TRUE) but report a misleading
    -- protest_found: null to the caller instead of protest_found: false.
    SELECT EXISTS (SELECT 1 FROM protests WHERE id = p_protest_id) INTO v_protest_found;
  END IF;
  v_fk_protest_id := CASE WHEN v_protest_found THEN p_protest_id ELSE NULL END;

  -- Idempotency gate — the ONLY row that carries the raw tx_ref, so it is
  -- what the unique index actually protects. Nothing below this point runs
  -- if a row for this tx_ref already exists (a genuine Ko-fi retry).
  IF p_tx_ref IS NOT NULL THEN
    INSERT INTO financial_movements (type, protest_id, amount, destination, description, tx_ref)
    VALUES ('donation_protest', v_fk_protest_id, p_importe_computable, 'protest_balance',
            format('Ko-fi donation credited to protest (%s%%)', 100 - p_fee_percent), p_tx_ref)
    ON CONFLICT (tx_ref) WHERE tx_ref IS NOT NULL DO NOTHING
    RETURNING id INTO v_gate_id;

    IF v_gate_id IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true);
    END IF;
  ELSE
    -- No transaction id to dedupe on (shouldn't happen for a real Ko-fi
    -- payload, but the original code tolerated it) — just record it.
    INSERT INTO financial_movements (type, protest_id, amount, destination, description, tx_ref)
    VALUES ('donation_protest', v_fk_protest_id, p_importe_computable, 'protest_balance',
            format('Ko-fi donation credited to protest (%s%%)', 100 - p_fee_percent), NULL);
  END IF;

  INSERT INTO financial_movements (type, protest_id, amount, destination, description, tx_ref)
  VALUES ('donation_platform', v_fk_protest_id, p_importe_plataforma, 'platform_fund',
          format('Platform fee from Ko-fi donation (%s%%)', p_fee_percent),
          CASE WHEN p_tx_ref IS NOT NULL THEN p_tx_ref || ':platform' ELSE NULL END);

  IF p_over_limit THEN
    INSERT INTO financial_movements (type, protest_id, amount, destination, description, tx_ref)
    VALUES ('over_limit_pending_review', v_fk_protest_id, p_importe_excedente, 'pending_review',
            format('Excess above policy limit — requires manual review before any allocation (original %s %s)',
                   p_moneda, p_importe_original),
            CASE WHEN p_tx_ref IS NOT NULL THEN p_tx_ref || ':excess' ELSE NULL END);
  END IF;

  IF v_protest_found THEN
    -- Atomic increment in SQL — not a read-in-JS-then-write-back round trip.
    UPDATE protests
    SET saldo_euros      = COALESCE(saldo_euros, 0) + p_importe_convocatoria,
        donaciones_count = COALESCE(donaciones_count, 0) + 1,
        donaciones_total = COALESCE(donaciones_total, 0) + p_importe_computable,
        ultima_donacion  = NOW()
    WHERE id = p_protest_id;

    INSERT INTO donaciones (
      protest_id, importe, importe_original, importe_convocatoria, importe_plataforma,
      importe_excedente, fee_percent, proveedor, moneda, over_limit
    ) VALUES (
      p_protest_id, p_importe_computable, p_importe_original, p_importe_convocatoria, p_importe_plataforma,
      p_importe_excedente, p_fee_percent, 'kofi', p_moneda, p_over_limit
    )
    RETURNING id INTO v_donation_id;
  END IF;

  INSERT INTO platform_fund (type, amount, source, protest_id, description)
  VALUES ('income', p_importe_plataforma, 'donation_fee', v_fk_protest_id,
          format('%s%% platform fee from Ko-fi donation of %s %s%s',
                 p_fee_percent, p_moneda, p_importe_computable,
                 CASE WHEN p_over_limit
                      THEN format(' (original: %s, excess %s pending review)', p_importe_original, p_importe_excedente)
                      ELSE '' END));

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false,
    'donation_id', v_donation_id,
    'protest_found', v_protest_found
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.credit_kofi_donation(
  TEXT, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_kofi_donation(
  TEXT, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN
) TO service_role;

COMMENT ON FUNCTION public.credit_kofi_donation IS
  'Atomically credits one Ko-fi donation: idempotency gate on tx_ref (first '
  'statement, before any balance mutation), then donaciones/platform_fund/'
  'financial_movements rows and the protests balance increment, all in one '
  'transaction. Replaces the non-atomic, self-conflicting version previously '
  'inlined in routes/webhooks.js (fixed 22 Nov 2026).';
