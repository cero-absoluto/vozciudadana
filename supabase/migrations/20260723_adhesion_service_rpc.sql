-- ============================================================================
-- AdhesionService consolidation (VP-SEC-008 fix, Fase 2 — Despliegue A)
-- 23 July 2026 — per the external auditor's detailed specification.
--
-- Revised same day after the auditor's staging-approval review (9.7/10
-- architecture, 9.2/10 SQL implementation, 9.6/10 transactional safety):
-- fixes VP-SEC-018, the one item required before a production
-- recommendation — every unique_violation used to become VP_ALREADY_JOINED
-- regardless of which constraint actually fired; it now inspects the real
-- constraint name (GET STACKED DIAGNOSTICS) and only maps the two that
-- genuinely mean "already joined," re-raising anything else unrecognised.
-- VP-SEC-016 (no row lock on devices) and VP-SEC-017 (count increment not
-- encapsulated behind its own function/trigger) are recorded as accepted,
-- non-urgent technical debt per the auditor's own assessment, not fixed here.
--
-- This migration does three things:
--   1. Adds identity_subject_hash / verification_method as new, additive
--      columns alongside the existing phone_hash — NOT a rename. phone_hash
--      keeps being written (dual-write) so existing reports, anonymisation
--      jobs and any other reader are unaffected during the transition. Per
--      the auditor: "No recomendaría efectuar el rename directo en la misma
--      migración... Añadir, rellenar y retirar después es más seguro."
--   2. Replaces the "SELECT to check, then INSERT" pattern — which several
--      real races could slip through (two near-simultaneous requests both
--      passing the SELECT before either INSERT commits) — with two real,
--      partial UNIQUE indexes as the actual authority. The application-level
--      SELECT can stay as an early, friendlier error; it is no longer what
--      prevents the race.
--   3. Adds create_verified_adhesion(...), a single PL/pgSQL function that
--      performs the whole adhesion-creation sequence — protest lookup and
--      lock, balance/closure check, optional institutional-membership
--      insert, the adhesion insert itself, and the count increment — inside
--      one transaction. Every Postgres function call is transactional by
--      default: if any step raises, everything in this function rolls back
--      together, closing the partial-state windows the auditor identified
--      (count incremented but adhesion insert failed; institutional_members
--      row created but no matching adhesion; etc.).
-- ============================================================================

-- ── 1. Additive identity columns (no rename, no drop) ────────────────────
ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS identity_subject_hash TEXT,
  ADD COLUMN IF NOT EXISTS verification_method TEXT
    CHECK (verification_method IS NULL OR verification_method IN
      ('phone_otp', 'institutional_email_otp', 'qr', 'eid'));

COMMENT ON COLUMN adhesions.identity_subject_hash IS
  'Generic verified-identity hash — phone_hash for phone_otp, email hash for institutional_email_otp, etc. Additive alongside phone_hash (23 July 2026); phone_hash is still dual-written during the transition and not yet the column any new code should read.';
COMMENT ON COLUMN adhesions.verification_method IS
  'How this adhesion''s identity was verified. NULL for rows created before 23 July 2026 (all of which were phone_otp in practice, since institutional adhesions predate this column too and can be backfilled separately).';

-- Backfill existing rows so identity_subject_hash/verification_method are
-- never silently empty for historical data. senales = 'email_otp' is how
-- routes/institucional.js has always tagged its own adhesions; everything
-- else through this schema has been phone-based.
UPDATE adhesions
SET identity_subject_hash = phone_hash,
    verification_method = CASE WHEN senales = 'email_otp' THEN 'institutional_email_otp' ELSE 'phone_otp' END
WHERE identity_subject_hash IS NULL AND phone_hash IS NOT NULL;

-- ── 2. Real partial UNIQUE indexes — the actual race-condition authority ──
-- Replaces relying on a SELECT-then-INSERT check alone. Partial (WHERE
-- deleted_at/anonymized_at IS NULL) so a soft-deleted or anonymised row
-- never blocks a genuinely new adhesion from reusing the same nullifier
-- slot, matching the existing soft-delete/anonymisation design.
CREATE UNIQUE INDEX IF NOT EXISTS adhesions_active_nullifier_unique
  ON adhesions (protest_id, nullifier)
  WHERE deleted_at IS NULL AND anonymized_at IS NULL AND nullifier IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS adhesions_active_device_unique
  ON adhesions (protest_id, device_id)
  WHERE deleted_at IS NULL AND anonymized_at IS NULL AND device_id IS NOT NULL;

-- institutional_members already exists (VOX Census / institutional design) —
-- add the same real-constraint treatment if it isn't already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'institutional_member_unique'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX institutional_member_unique ON institutional_members (protest_id, email_hash)';
  END IF;
END $$;

-- ── 3. The transactional RPC ──────────────────────────────────────────────
-- Stable error identifiers (errcode P0001 + a message the application layer
-- matches on) rather than free-text — per the auditor: "PostgreSQL no debe
-- conocer textos visibles al usuario." The service layer (lib/adhesionService.js)
-- translates these into the application's existing HTTP error shapes.
CREATE OR REPLACE FUNCTION create_verified_adhesion(
  p_protest_id                 uuid,
  p_identity_subject_hash      text,
  p_verification_method        text,
  p_nullifier                  text,
  p_device_id                  text,
  p_doc_hash                   text,
  p_ciudad                     text,
  p_region                     text,
  p_pais                       text,
  p_pais_code                  text,
  p_idioma                     text,
  p_adhesion_osm_id            bigint,
  p_gps_confirmed              boolean,
  p_fiabilidad                 int,
  p_senales                    text,
  p_institutional_email_hash   text,
  p_institutional_expires_at   timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_protest       record;
  v_adhesion_id   uuid;
  v_created_at    timestamptz;
BEGIN
  -- Lock the protest row for the duration of this transaction — this is
  -- what actually serialises concurrent joins against the same
  -- convocatoria's balance/closure state, not application-level checks.
  SELECT id, ends_at, saldo_euros
    INTO v_protest
    FROM protests
    WHERE id = p_protest_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VP_PROTEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_protest.ends_at < now() THEN
    RAISE EXCEPTION 'VP_PROTEST_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  IF v_protest.saldo_euros IS NOT NULL AND v_protest.saldo_euros <= 0 THEN
    RAISE EXCEPTION 'VP_BALANCE_EXHAUSTED' USING ERRCODE = 'P0001';
  END IF;

  -- Institutional membership, only for that verification method. Wrapped in
  -- the same exception block as the adhesion insert below (VP-SEC-018) so a
  -- duplicate here is identified by its own constraint name too, not folded
  -- into a generic "already joined."
  --
  -- ── DUAL WRITE — TEMPORARY, DO NOT REMOVE WITHOUT READING THIS ──────────
  -- phone_hash and identity_subject_hash are written with the SAME value
  -- below, deliberately, during the migration to generic identity columns
  -- (23 July 2026). phone_hash is the column every existing report,
  -- anonymisation job, and piece of documentation still reads; nothing
  -- should stop writing it until every reader has moved to
  -- identity_subject_hash/verification_method and that migration is
  -- recorded as complete in the Audit Trail. Removing this dual write
  -- early will silently break historical continuity for existing rows.
  BEGIN
    IF p_institutional_email_hash IS NOT NULL THEN
      INSERT INTO institutional_members (email_hash, protest_id, expires_at)
      VALUES (p_institutional_email_hash, p_protest_id, p_institutional_expires_at);
    END IF;

    -- Timestamp rounded to the hour — unchanged from the existing behaviour,
    -- kept for report/aggregate consistency with historical rows.
    v_created_at := date_trunc('hour', now());

    IF p_verification_method NOT IN ('phone_otp', 'institutional_email_otp', 'qr', 'eid') THEN
      -- The column CHECK constraint would catch this too, but a named
      -- exception here is a clearer error for whoever reads the logs than a
      -- generic constraint-violation message would be.
      RAISE EXCEPTION 'VP_INVALID_VERIFICATION_METHOD' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO adhesions (
      protest_id, device_id, phone_hash, identity_subject_hash, verification_method,
      doc_hash, ciudad, region, pais, pais_code, idioma, nullifier, created_at,
      fiabilidad, senales, gps_confirmed, adhesion_osm_id
    ) VALUES (
      p_protest_id, p_device_id, p_identity_subject_hash, p_identity_subject_hash, p_verification_method,
      p_doc_hash, p_ciudad, p_region, p_pais, p_pais_code, p_idioma, p_nullifier, v_created_at,
      p_fiabilidad, p_senales, p_gps_confirmed, p_adhesion_osm_id
    )
    RETURNING id INTO v_adhesion_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- VP-SEC-018 fix: every unique_violation used to become
      -- VP_ALREADY_JOINED regardless of which constraint actually fired —
      -- correct today (only three unique indexes exist, two of which do
      -- mean "already joined"), but a silent mislabel waiting to happen the
      -- day a fourth, unrelated constraint is added anywhere in this
      -- transaction's tables. GET STACKED DIAGNOSTICS retrieves the actual
      -- constraint name so each one maps to its own, correct error —
      -- anything unrecognised is re-raised as-is rather than mislabelled.
      DECLARE
        v_constraint text;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IN ('adhesions_active_nullifier_unique', 'adhesions_active_device_unique') THEN
          RAISE EXCEPTION 'VP_ALREADY_JOINED' USING ERRCODE = 'P0001';
        ELSIF v_constraint = 'institutional_member_unique' THEN
          RAISE EXCEPTION 'VP_MEMBERSHIP_ALREADY_EXISTS' USING ERRCODE = 'P0001';
        ELSE
          RAISE; -- unrecognised constraint — never mislabel, surface the real error
        END IF;
      END;
  END;

  -- Same transaction as the inserts above — if this were to fail, the whole
  -- function (including the adhesion insert and any institutional_members
  -- row) rolls back together. This is exactly the "count incremented but
  -- adhesion insert failed" / "adhesion inserted but count never moved"
  -- class of partial state the auditor's review found possible before.
  -- VP-SEC-017 (auditor, 23 July 2026, not urgent): this UPDATE trusts that
  -- an adhesion row genuinely exists at this point, which is true today by
  -- construction (it is the very next line after a successful insert in
  -- the same transaction) but would silently keep incrementing even if a
  -- future edit to this function reordered things. Recorded as accepted
  -- technical debt per the auditor's own framing ("no es obligatorio
  -- ahora"), not fixed in this pass — the safer long-term shape (an AFTER
  -- INSERT trigger, or treating protests.count as a derivable cache rather
  -- than a primary value) is a larger change than this migration's scope.
  UPDATE protests SET count = count + 1 WHERE id = p_protest_id;
  PERFORM update_cities_count(p_protest_id);

  -- VP-SEC-016 (auditor, 23 July 2026, not urgent): no FOR UPDATE lock is
  -- taken on the devices row before this update. Harmless today — the only
  -- state devices holds is last_seen — but noted so that if a device ever
  -- gains more state (e.g. a revocation flag), this update is revisited
  -- alongside it rather than assumed still safe by then.
  IF p_device_id IS NOT NULL THEN
    UPDATE devices SET last_seen = now() WHERE id = p_device_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_adhesion_id, 'created_at', v_created_at,
    'ciudad', p_ciudad, 'region', p_region, 'pais', p_pais,
    'adhesion_osm_id', p_adhesion_osm_id
  );
END;
$$;

COMMENT ON FUNCTION create_verified_adhesion IS
  'Single authorised path to create an adhesion (VP-SEC-008, 23 July 2026). Every step — protest lock, balance/closure check, optional institutional membership, the adhesion insert, and the count increment — runs in one transaction: any failure rolls back all of it. Called only from lib/adhesionService.js; no route should INSERT INTO adhesions directly.';
