-- IndexNow throttling (24 July 2026) — per the auditor's explicit
-- recommendation: notify on meaningful events only (creation, closure,
-- final report), never per-adhesion. This column is the throttle's source
-- of truth — not an in-memory counter, which would reset on every deploy
-- and allow a burst right after each restart.
ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS indexnow_last_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN protests.indexnow_last_notified_at IS
  'Last time this convocatoria''s report URL was pushed to IndexNow (Bing/Yandex/Seznam/Naver). Enforces at most one notification per hour per URL, regardless of how many events would otherwise trigger one — see lib/indexNow.js.';
