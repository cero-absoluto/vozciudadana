ALTER TABLE otp_requests
  ADD COLUMN IF NOT EXISTS device_id     TEXT,
  ADD COLUMN IF NOT EXISTS ip_hash       TEXT,
  ADD COLUMN IF NOT EXISTS protest_id    UUID REFERENCES protests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'completed', 'expired', 'blocked')),
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_otp_phone_hash_time
  ON otp_requests(phone_hash, requested_at);

CREATE INDEX IF NOT EXISTS idx_otp_device_id_time
  ON otp_requests(device_id, requested_at)
  WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_otp_ip_hash_time
  ON otp_requests(ip_hash, requested_at)
  WHERE ip_hash IS NOT NULL;
CREATE OR REPLACE FUNCTION check_otp_rate_limit(
  p_phone_hash  TEXT,
  p_device_id   TEXT,
  p_ip_hash     TEXT,
  p_protest_id  UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_phone_count_day   INTEGER;
  v_device_count_hour INTEGER;
  v_ip_count_hour     INTEGER;
  v_combo_count_hour  INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_phone_count_day
  FROM otp_requests
  WHERE phone_hash = p_phone_hash
    AND requested_at > NOW() - INTERVAL '24 hours'
    AND status != 'blocked';

  IF v_phone_count_day >= 3 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'phone_daily_limit', 'wait_minutes', 60);
  END IF;

  SELECT COUNT(*) INTO v_device_count_hour
  FROM otp_requests
  WHERE device_id = p_device_id
    AND requested_at > NOW() - INTERVAL '1 hour'
    AND status != 'blocked'
    AND p_device_id IS NOT NULL;

  IF v_device_count_hour >= 3 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'device_hourly_limit', 'wait_minutes', 60);
  END IF;

  SELECT COUNT(*) INTO v_ip_count_hour
  FROM otp_requests
  WHERE ip_hash = p_ip_hash
    AND requested_at > NOW() - INTERVAL '1 hour'
    AND status != 'blocked'
    AND p_ip_hash IS NOT NULL;

  IF v_ip_count_hour >= 10 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'ip_hourly_limit', 'wait_minutes', 60);
  END IF;

  IF p_protest_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_combo_count_hour
    FROM otp_requests
    WHERE device_id = p_device_id
      AND protest_id = p_protest_id
      AND requested_at > NOW() - INTERVAL '1 hour'
      AND p_device_id IS NOT NULL;

    IF v_combo_count_hour >= 2 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'device_protest_limit', 'wait_minutes', 60);
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_otp_cooldown(p_device_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_incomplete INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_incomplete
  FROM otp_requests
  WHERE device_id = p_device_id
    AND status IN ('sent', 'expired')
    AND requested_at > NOW() - INTERVAL '24 hours';

  RETURN CASE
    WHEN v_incomplete >= 4 THEN 1440
    WHEN v_incomplete >= 3 THEN 60
    WHEN v_incomplete >= 2 THEN 10
    WHEN v_incomplete >= 1 THEN 2
    ELSE 0
  END;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'expire-otp-requests',
  '*/10 * * * *',
  $$
    UPDATE otp_requests
    SET status = 'expired'
    WHERE status = 'sent'
      AND requested_at < NOW() - INTERVAL '10 minutes';
  $$
);

SELECT cron.schedule(
  'cleanup-otp-requests',
  '0 2 * * *',
  $$
    DELETE FROM otp_requests
    WHERE requested_at < NOW() - INTERVAL '7 days';
  $$
);
