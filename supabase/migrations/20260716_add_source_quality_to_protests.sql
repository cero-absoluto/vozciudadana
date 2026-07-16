-- Store the source-quality snapshot computed at creation time (evaluateSource()
-- in apps/api/src/lib/sourceCheck.js) directly on the protest row.
--
-- Why: the informational source-quality indicator (domain type, confidence
-- score) was previously only ever computed live in the CreateScreen preview
-- and thrown away — never persisted, so DetailScreen / the public report had
-- no way to show participants the same information. Storing the snapshot
-- taken at creation avoids a second live fetch of the source URL every time
-- someone views the convocatoria, and avoids the score silently drifting if
-- the source page changes or disappears after publication.
--
-- This is purely informational (see the design note in sourceCheck.js) —
-- it is never used to gate creation or participation.

alter table protests
  add column if not exists source_type              text,
  add column if not exists source_confidence_score   int,
  add column if not exists source_checked_at         timestamptz;

comment on column protests.source_type is
  'Domain classification computed at creation time (official_bulletin, official_government, public_institution, reputable_media, academic, ngo, unknown, ...). Informational only — see lib/sourceCheck.js.';
comment on column protests.source_confidence_score is
  '0-100 informational documentary-quality score computed at creation time. Never used to gate creation, participation, or visibility.';
