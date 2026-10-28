-- READ-ONLY METADATA SNAPSHOT. Context only, never a migration.
-- Checked UTC: 2026-10-28 10:53:00.874976+00
-- MD5 metadata fingerprint of server representation (not a security digest): 695365709e7837b68124dc0eb22e45f0
CREATE OR REPLACE FUNCTION public.check_otp_rate_limit(p_phone_hash text, p_device_id text, p_ip_hash text, p_protest_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
    AND status != 'blocked';

  IF v_device_count_hour >= 3 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'device_hourly_limit', 'wait_minutes', 60);
  END IF;

  SELECT COUNT(*) INTO v_ip_count_hour
  FROM otp_requests
  WHERE ip_hash = p_ip_hash
    AND requested_at > NOW() - INTERVAL '1 hour'
    AND status != 'blocked';

  IF v_ip_count_hour >= 10 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'ip_hourly_limit', 'wait_minutes', 60);
  END IF;

  IF p_protest_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_combo_count_hour
    FROM otp_requests
    WHERE device_id = p_device_id
      AND protest_id = p_protest_id
      AND requested_at > NOW() - INTERVAL '1 hour'
      AND status != 'blocked';

    IF v_combo_count_hour >= 2 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'device_protest_limit', 'wait_minutes', 60);
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$function$
