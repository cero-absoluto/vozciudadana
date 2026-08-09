-- ============================================================================
-- Fix the real column mismatch blocking closure since 31 July 2026
--
-- Found via direct diagnosis (9 August 2026): manually running the closure
-- job's SQL body threw `column "type" of relation "platform_fund" does not
-- exist`. The migration that supposedly created platform_fund
-- (20260610_financial_infrastructure_phase1.sql) describes a ledger table
-- (type, amount, source, protest_id, description) — but the REAL table in
-- production (confirmed via information_schema.columns) is a single running
-- balance: (id, currency, balance, updated_at), one row, balance stuck at
-- 0.00 since 10 June 2026 — the day it was created. That migration file was
-- evidently never actually applied as written; the table was created some
-- other way, with a different design, and nobody had tried the surplus
-- transfer path since — until Las Llamas' saldo_euros (0.70) made it the
-- first real convocatoria to exercise it.
--
-- Because every CTE in the closure job runs as one atomic statement, this
-- single error rolled back the ENTIRE closure — not just the surplus
-- transfer, but the hash calculation too — every 30 minutes, for any
-- convocatoria in the same batch, since the first time a positive-balance
-- convocatoria closed after this job started running (31 July, Las Llamas).
-- ============================================================================

DO $$
DECLARE v_jobid INTEGER;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auto-close-protests' LIMIT 1;
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'auto-close-protests',
  '*/30 * * * *',
  $$
    WITH closing AS (
      SELECT id, saldo_euros, title
      FROM protests
      WHERE ends_at < NOW() AND hash_integridad IS NULL
    ),
    hashed AS (
      UPDATE protests
      SET
        hash_integridad          = calculate_integrity_hash_v2(id),
        integrity_version        = 2,
        integrity_calculated_at  = NOW()
      WHERE id IN (SELECT id FROM closing)
      RETURNING id, saldo_euros, title
    ),
    -- financial_movements matches its own migration's real design — logged
    -- as one row per surplus event, as originally intended.
    movements AS (
      INSERT INTO financial_movements (type, protest_id, amount, currency, destination, description)
      SELECT 'protest_surplus', id, saldo_euros, 'EUR', 'platform_fund',
             'Surplus transferred to platform fund on protest close: ' || title
      FROM hashed WHERE saldo_euros > 0
      RETURNING amount
    ),
    -- platform_fund is a single running balance (confirmed via
    -- information_schema, 9 August 2026), not a ledger — this adds the
    -- batch's total surplus to that one balance, rather than inserting a
    -- row that column-mismatched and broke everything downstream of it.
    fund_update AS (
      UPDATE platform_fund
      SET balance    = balance + COALESCE((SELECT SUM(amount) FROM movements), 0),
          updated_at = NOW()
      WHERE id = 1
      RETURNING balance
    ),
    balance_reset AS (
      UPDATE protests SET saldo_euros = 0 WHERE id IN (SELECT id FROM hashed) AND saldo_euros > 0
    ),
    notified AS (
      SELECT
        h.id,
        net.http_post(
          url := 'https://api.indexnow.org/indexnow',
          body := jsonb_build_object(
            'host', 'reports.voiceprotest.org',
            'key', 'e8122c52eea9425398ef936e7f559047',
            'keyLocation', 'https://reports.voiceprotest.org/e8122c52eea9425398ef936e7f559047.txt',
            'urlList', jsonb_build_array('https://reports.voiceprotest.org/' || h.id::TEXT)
          ),
          headers := jsonb_build_object('Content-Type', 'application/json; charset=utf-8'),
          timeout_milliseconds := 5000
        ) AS request_id
      FROM hashed h
    )
    UPDATE protests SET indexnow_last_notified_at = NOW()
    WHERE id IN (SELECT id FROM notified);
  $$
);

-- Immediate catch-up: close everything that has been silently stuck since
-- 31 July, right now, rather than waiting for the next tick.
DO $$
DECLARE v_protest RECORD; v_hash TEXT; v_surplus NUMERIC;
BEGIN
  FOR v_protest IN
    SELECT id, saldo_euros, title FROM protests WHERE ends_at < NOW() AND hash_integridad IS NULL
  LOOP
    v_hash := calculate_integrity_hash_v2(v_protest.id);
    UPDATE protests
    SET hash_integridad = v_hash, integrity_version = 2, integrity_calculated_at = NOW()
    WHERE id = v_protest.id;

    IF v_protest.saldo_euros > 0 THEN
      INSERT INTO financial_movements (type, protest_id, amount, currency, destination, description)
      VALUES ('protest_surplus', v_protest.id, v_protest.saldo_euros, 'EUR', 'platform_fund',
              'Surplus transferred to platform fund on protest close: ' || v_protest.title);

      UPDATE platform_fund SET balance = balance + v_protest.saldo_euros, updated_at = NOW() WHERE id = 1;
      UPDATE protests SET saldo_euros = 0 WHERE id = v_protest.id;
    END IF;
  END LOOP;
END $$;
