-- ============================================================================
-- IndexNow on real closure (24 July 2026)
--
-- Now that the closure mechanism actually works (20260724_fix_closure_
-- mechanism.sql), this wires the IndexNow notification we built earlier
-- (lib/indexNow.js, fired only on convocatoria creation until now) into the
-- other event the auditor named as worth notifying: closure / final report
-- publication. Done here, inside the same pg_cron job that computes
-- hash_integridad, using pg_net (now enabled) — no separate polling
-- process in the Node backend needed.
--
-- This does not replace lib/indexNow.js's throttled notify-on-creation
-- call; it is a second, independent trigger for a different event, sharing
-- the same protests.indexnow_last_notified_at column for bookkeeping.
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
    surplus AS (
      INSERT INTO platform_fund (type, amount, source, protest_id, description)
      SELECT 'income', saldo_euros, 'protest_surplus', id, 'Surplus from closed protest: ' || title
      FROM hashed WHERE saldo_euros > 0
      RETURNING protest_id, amount
    ),
    movements AS (
      INSERT INTO financial_movements (type, protest_id, amount, destination, description)
      SELECT 'protest_surplus', protest_id, amount, 'platform_fund',
             'Surplus transferred to platform fund on protest close'
      FROM surplus
    ),
    balance_reset AS (
      UPDATE protests SET saldo_euros = 0 WHERE id IN (SELECT id FROM hashed) AND saldo_euros > 0
    ),
    -- IndexNow — one push per convocatoria that actually closed just now
    -- (never per adhesion, never on every 30-minute tick regardless of
    -- whether anything changed: only rows returned by `hashed` above, i.e.
    -- convocatorias that transitioned to closed in THIS run).
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
