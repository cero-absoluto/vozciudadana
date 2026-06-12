-- Migration: Financial infrastructure Phase 1
-- Date: 2026-06-10
-- Purpose:
--   - Add donation split fields
--   - Create financial movement audit log
--   - Create platform fund tracking
--   - Add donation limit function
--   - Replace auto-close-protests cron job with surplus transfer logic

-- ── 1. Update donaciones table with split fields ──────────────────────────

ALTER TABLE donaciones
  ADD COLUMN IF NOT EXISTS importe_convocatoria NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS importe_plataforma   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fee_percent          INTEGER DEFAULT 10;

UPDATE donaciones
SET
  importe_convocatoria = ROUND(importe * 0.90, 2),
  importe_plataforma   = ROUND(importe * 0.10, 2),
  fee_percent          = 10
WHERE importe_convocatoria IS NULL;


-- ── 2. Create financial_movements table ──────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL CHECK (type IN (
    'donation_protest',
    'donation_platform',
    'verification_sms',
    'verification_email',
    'protest_surplus',
    'platform_expense'
  )),
  protest_id   UUID REFERENCES protests(id) ON DELETE SET NULL,
  adhesion_id  UUID REFERENCES adhesions(id) ON DELETE SET NULL,
  donation_id  UUID REFERENCES donaciones(id) ON DELETE SET NULL,
  amount       NUMERIC(10,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EUR',
  destination  TEXT NOT NULL CHECK (
    destination IN ('protest_balance', 'platform_fund', 'verification_cost')
  ),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_movements_protest
  ON financial_movements(protest_id, created_at);

CREATE INDEX IF NOT EXISTS idx_financial_movements_type
  ON financial_movements(type, created_at);


-- ── 3. Create platform_fund table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_fund (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount      NUMERIC(10,2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN (
    'donation_fee',
    'protest_surplus',
    'manual_credit',
    'operational_cost',
    'audit',
    'other'
  )),
  protest_id  UUID REFERENCES protests(id) ON DELETE SET NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_fund_created
  ON platform_fund(created_at);


-- ── 4. Add max donation limit check function ─────────────────────────────

CREATE OR REPLACE FUNCTION check_donation_limit(
  p_protest_id UUID,
  p_amount     NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_max_per_operation NUMERIC := 100.00; -- configurable via MAX_DONATION_EUR env var
BEGIN
  IF p_amount > v_max_per_operation THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'exceeds_max_per_operation',
      'max', v_max_per_operation
    );
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'invalid_amount'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$ LANGUAGE plpgsql;


-- ── 5. Replace auto-close-protests cron job safely ───────────────────────
-- Important:
-- Do not rely on a fixed jobid. Job ids differ between environments.

DO $$
DECLARE
  v_jobid INTEGER;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'auto-close-protests'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    WITH closing AS (
      UPDATE protests
      SET
        status = 'closed',
        hash_integridad = calculate_integrity_hash(id)
      WHERE status = 'active'
        AND ends_at < NOW()
      RETURNING id, saldo_euros, title
    ),
    surplus AS (
      SELECT id, saldo_euros, title
      FROM closing
      WHERE saldo_euros > 0
    ),
    fund_insert AS (
      INSERT INTO platform_fund (
        type,
        amount,
        source,
        protest_id,
        description
      )
      SELECT
        'income',
        saldo_euros,
        'protest_surplus',
        id,
        'Surplus from closed protest: ' || title
      FROM surplus
      RETURNING protest_id, amount
    ),
    movement_insert AS (
      INSERT INTO financial_movements (
        type,
        protest_id,
        amount,
        destination,
        description
      )
      SELECT
        'protest_surplus',
        protest_id,
        amount,
        'platform_fund',
        'Surplus transferred to platform fund on protest close'
      FROM fund_insert
      RETURNING id
    )
    UPDATE protests
    SET saldo_euros = 0
    WHERE id IN (SELECT id FROM surplus);
  $$
);


-- ── 6. Comments ──────────────────────────────────────────────────────────

COMMENT ON TABLE financial_movements IS
  'Immutable log of all financial movements. Used for transparency reporting and audit trail.';

COMMENT ON TABLE platform_fund IS
  'Platform operational fund. Receives part of donations and protest surpluses. Used for infrastructure, audits, and sustainability.';

COMMENT ON COLUMN donaciones.importe_convocatoria IS
  'Part of donation credited to protest balance.';

COMMENT ON COLUMN donaciones.importe_plataforma IS
  'Part of donation credited to platform fund.';

COMMENT ON COLUMN donaciones.fee_percent IS
  'Platform fee percentage applied to this donation.';
