-- Migration: Financial infrastructure Phase 1
-- Date: 2026-06-10
-- Purpose: Create financial_movements table, platform_fund tracking,
--          update donations table with split fields,
--          handle surplus transfer on protest close.

-- ── 1. Update donations table with split fields ───────────────────────────
ALTER TABLE donaciones
  ADD COLUMN IF NOT EXISTS importe_convocatoria NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS importe_plataforma   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fee_percent          INTEGER DEFAULT 10;

-- Backfill existing donations (assume 90/10 split retroactively)
UPDATE donaciones
SET
  importe_convocatoria = ROUND(importe * 0.90, 2),
  importe_plataforma   = ROUND(importe * 0.10, 2),
  fee_percent          = 10
WHERE importe_convocatoria IS NULL;

-- ── 2. Create financial_movements table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL CHECK (type IN (
    'donation_protest',    -- donation credited to protest
    'donation_platform',   -- platform fee from donation
    'verification_sms',    -- SMS verification cost deducted
    'verification_email',  -- email verification cost deducted
    'protest_surplus',     -- surplus transferred to platform fund on close
    'platform_expense'     -- operational expense from platform fund
  )),
  protest_id   UUID REFERENCES protests(id) ON DELETE SET NULL,
  adhesion_id  UUID REFERENCES adhesions(id) ON DELETE SET NULL,
  donation_id  UUID REFERENCES donaciones(id) ON DELETE SET NULL,
  amount       NUMERIC(10,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EUR',
  destination  TEXT NOT NULL CHECK (destination IN ('protest_balance', 'platform_fund', 'verification_cost')),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_movements_protest
  ON financial_movements(protest_id, created_at);

CREATE INDEX IF NOT EXISTS idx_financial_movements_type
  ON financial_movements(type, created_at);

-- ── 3. Create platform_fund table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_fund (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount      NUMERIC(10,2) NOT NULL,
  source      TEXT NOT NULL CHECK (source IN (
    'donation_fee',     -- 10% from donations
    'protest_surplus',  -- unused balance when protest closes
    'manual_credit',    -- manual admin credit
    'operational_cost', -- server, domain, SMS infrastructure
    'audit',            -- security audit
    'other'
  )),
  protest_id  UUID REFERENCES protests(id) ON DELETE SET NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_fund_created
  ON platform_fund(created_at);

-- ── 4. Update auto-close job to transfer surplus to platform fund ──────────
SELECT cron.unschedule('auto-close-protests');

SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    -- Close active protests and handle surplus
    WITH closing AS (
      UPDATE protests
      SET
        status = 'closed',
        hash_integridad = calculate_integrity_hash(id)
      WHERE status = 'active'
        AND ends_at < NOW()
      RETURNING id, saldo_euros, title
    )
    -- Transfer surplus to platform fund
    INSERT INTO platform_fund (type, amount, source, protest_id, description)
    SELECT
      'income',
      saldo_euros,
      'protest_surplus',
      id,
      'Surplus from closed protest: ' || title
    FROM closing
    WHERE saldo_euros > 0;

    -- Zero out protest balances
    UPDATE protests
    SET saldo_euros = 0
    WHERE status = 'closed'
      AND ends_at < NOW() - INTERVAL '30 minutes'
      AND saldo_euros > 0;
  $$
);

-- ── 5. Add max donation limit check function ──────────────────────────────
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
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_amount');
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$ LANGUAGE plpgsql;

-- ── 6. Comments ───────────────────────────────────────────────────────────
COMMENT ON TABLE financial_movements IS 'Immutable log of all financial movements. Used for transparency reporting and audit trail.';
COMMENT ON TABLE platform_fund IS 'Platform operational fund. Receives 10% of donations and protest surpluses. Used for infrastructure, audits, and sustainability.';
COMMENT ON COLUMN donaciones.importe_convocatoria IS '90% of donation credited to protest balance (configurable via PLATFORM_FEE_PERCENT env var).';
COMMENT ON COLUMN donaciones.importe_plataforma IS '10% of donation credited to platform fund (configurable via PLATFORM_FEE_PERCENT env var).';
