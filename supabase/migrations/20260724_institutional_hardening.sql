-- ============================================================================
-- Institutional path hardening + migration to AdhesionService
-- (VP-SEC-008 Despliegue B, VP-SEC-009 through 015) — 24 July 2026
-- Per the external auditor's specification.
-- ============================================================================

-- ── VP-SEC-009: no more plaintext OTP storage ────────────────────────────
-- otp_code is left in place (harmless, unused going forward) rather than
-- dropped in this same migration — these rows already expire in minutes and
-- carry no historical value worth a careful multi-step migration, unlike
-- the identity/geography columns handled elsewhere this week.
ALTER TABLE email_otp_requests
  ADD COLUMN IF NOT EXISTS otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS institutional_domain TEXT;

ALTER TABLE email_otp_requests ALTER COLUMN otp_code DROP NOT NULL;

COMMENT ON COLUMN email_otp_requests.otp_hash IS
  'HMAC(EMAIL_OTP_SECRET, protest_id:email_hash:otp) — the code itself is never stored. A 6-digit code has a small search space, so this is a keyed HMAC, not a plain hash, and the secret never leaves the server (computed identically in JS at send and verify time — see routes/institucional.js).';

CREATE INDEX IF NOT EXISTS idx_email_otp_email_protest_time
  ON email_otp_requests (email_hash, protest_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_otp_ip_hash_time
  ON email_otp_requests (ip_hash, requested_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_otp_domain_protest_time
  ON email_otp_requests (institutional_domain, protest_id, requested_at) WHERE institutional_domain IS NOT NULL;

-- email_otp_rate_limit's SELECT-then-UPDATE/INSERT counter (VP-SEC-013) is
-- superseded by check_institutional_otp_rate_limit below, which counts real
-- rows instead of maintaining a separate mutable counter — the same
-- COUNT-based, race-free approach the SMS path already uses (see
-- check_otp_rate_limit, 20260609_otp_protection.sql). The table itself is
-- left in place, unused, rather than dropped in this pass.
COMMENT ON TABLE email_otp_rate_limit IS
  'Superseded 24 July 2026 by check_institutional_otp_rate_limit(), which counts email_otp_requests rows directly rather than maintaining a separate counter prone to read-then-write races. Left in place, unused, not dropped in this migration.';

-- ── VP-SEC-013: atomic, multi-dimensional rate limiting ──────────────────
CREATE OR REPLACE FUNCTION check_institutional_otp_rate_limit(
  p_email_hash TEXT,
  p_protest_id UUID,
  p_ip_hash    TEXT,
  p_domain     TEXT
) RETURNS JSONB AS $$
DECLARE
  v_email_count_window INTEGER;
  v_ip_count_hour       INTEGER;
  v_domain_count_hour   INTEGER;
  v_global_count_hour   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_email_count_window
  FROM email_otp_requests
  WHERE email_hash = p_email_hash AND protest_id = p_protest_id
    AND requested_at > NOW() - INTERVAL '10 minutes';
  IF v_email_count_window >= 3 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'email_rate_limit', 'wait_minutes', 10);
  END IF;

  IF p_ip_hash IS NOT NULL THEN
    SELECT COUNT(*) INTO v_ip_count_hour
    FROM email_otp_requests
    WHERE ip_hash = p_ip_hash AND requested_at > NOW() - INTERVAL '1 hour';
    IF v_ip_count_hour >= 10 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'ip_hourly_limit', 'wait_minutes', 60);
    END IF;
  END IF;

  IF p_domain IS NOT NULL THEN
    SELECT COUNT(*) INTO v_domain_count_hour
    FROM email_otp_requests
    WHERE institutional_domain = p_domain AND protest_id = p_protest_id
      AND requested_at > NOW() - INTERVAL '1 hour';
    IF v_domain_count_hour >= 30 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'domain_hourly_limit', 'wait_minutes', 60);
    END IF;
  END IF;

  -- Global safety valve — a distributed attacker spreading requests thinly
  -- across many emails/IPs would otherwise stay under every per-dimension
  -- limit above. Configurable ceiling, generous enough not to affect
  -- genuine traffic at today's scale.
  SELECT COUNT(*) INTO v_global_count_hour
  FROM email_otp_requests WHERE requested_at > NOW() - INTERVAL '1 hour';
  IF v_global_count_hour >= 500 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'global_hourly_limit', 'wait_minutes', 60);
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$ LANGUAGE plpgsql;

-- ── VP-SEC-015: OTP consumption and adhesion creation, atomically ────────
-- The auditor's preferred design: one RPC that locks and verifies/consumes
-- the OTP, then calls the SAME create_verified_adhesion() the SMS path
-- uses — internally, in the same transaction — rather than duplicating
-- adhesion-creation logic for a second time. If create_verified_adhesion
-- raises for any reason (closed convocatoria, balance exhausted, duplicate
-- nullifier, duplicate institutional membership), the OTP consumption
-- rolls back too: a failed adhesion never leaves an OTP burned with
-- nothing to show for it.
CREATE OR REPLACE FUNCTION verify_institutional_otp_and_create_adhesion(
  p_email_hash                TEXT,
  p_protest_id                UUID,
  p_submitted_otp_hash        TEXT,
  p_identity_subject_hash     TEXT,
  p_nullifier                 TEXT,
  p_ciudad                    TEXT,
  p_region                    TEXT,
  p_pais                      TEXT,
  p_pais_code                 TEXT,
  p_idioma                    TEXT,
  p_institutional_expires_at  TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_otp record;
  v_result jsonb;
BEGIN
  SELECT id, otp_hash, expires_at, consumed_at, attempt_count
    INTO v_otp
    FROM email_otp_requests
    WHERE email_hash = p_email_hash AND protest_id = p_protest_id
    ORDER BY requested_at DESC
    LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP_OTP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_otp.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'VP_OTP_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;

  IF v_otp.expires_at < now() THEN
    RAISE EXCEPTION 'VP_OTP_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  -- VP-SEC-014: failed attempts are counted transactionally against this
  -- specific request row, not left to an in-memory or per-process limiter
  -- alone. After 5 wrong codes the row is dead regardless of whether it has
  -- technically expired yet.
  IF v_otp.attempt_count >= 5 THEN
    RAISE EXCEPTION 'VP_TOO_MANY_ATTEMPTS' USING ERRCODE = 'P0001';
  END IF;

  IF v_otp.otp_hash IS DISTINCT FROM p_submitted_otp_hash THEN
    UPDATE email_otp_requests SET attempt_count = attempt_count + 1 WHERE id = v_otp.id;
    RAISE EXCEPTION 'VP_WRONG_OTP' USING ERRCODE = 'P0001';
  END IF;

  -- Consume now, before creating the adhesion — if create_verified_adhesion
  -- below raises, this UPDATE rolls back together with it (same
  -- transaction), so a failed adhesion never leaves the OTP burned.
  UPDATE email_otp_requests SET consumed_at = now() WHERE id = v_otp.id;

  v_result := create_verified_adhesion(
    p_protest_id               => p_protest_id,
    p_identity_subject_hash    => p_identity_subject_hash,
    p_verification_method      => 'institutional_email_otp',
    p_nullifier                => p_nullifier,
    p_device_id                => NULL,
    p_doc_hash                 => NULL,
    p_ciudad                   => p_ciudad,
    p_region                   => p_region,
    p_pais                     => p_pais,
    p_pais_code                => p_pais_code,
    p_idioma                   => p_idioma,
    p_adhesion_osm_id          => NULL,
    p_gps_confirmed            => false,
    p_fiabilidad               => 90,
    p_senales                  => 'email_otp,ip',
    p_institutional_email_hash => p_email_hash,
    p_institutional_expires_at => p_institutional_expires_at
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION verify_institutional_otp_and_create_adhesion IS
  'Locks and verifies the institutional OTP, consumes it, then calls create_verified_adhesion() internally in the same transaction (VP-SEC-015, 24 July 2026). Called only from routes/institucional.js. A failed adhesion (closed convocatoria, exhausted balance, duplicate) rolls back the OTP consumption too.';
