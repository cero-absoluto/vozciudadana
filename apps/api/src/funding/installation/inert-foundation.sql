-- REVIEW CANDIDATE. Not registered in Supabase migration history; not authorised to apply.
-- Foundation only: no financial runtime, exposure authorisation or live integration.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_setting('server_version_num')::int<170000 THEN RAISE EXCEPTION 'postgres_17_required';END IF;
 IF to_regclass('public.protests') IS NULL OR NOT EXISTS(
 SELECT 1 FROM pg_attribute WHERE attrelid='public.protests'::regclass AND attname='id' AND atttypid='uuid'::regtype AND NOT attisdropped
 ) THEN RAISE EXCEPTION 'parent_uuid_required';END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('funding_installation_private','funding_route_private','funding_lookup_private')) THEN RAISE EXCEPTION 'installation_namespace_collision';END IF;
END$$;
CREATE SCHEMA funding_installation_private;
CREATE SCHEMA funding_route_private;
CREATE SCHEMA funding_lookup_private;
REVOKE ALL ON SCHEMA funding_installation_private,funding_route_private,funding_lookup_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE funding_installation_private.manifest(
 singleton boolean PRIMARY KEY CHECK(singleton),
 package text NOT NULL CHECK(package='i4-inert-foundation-v1'),
 activation_allowed boolean NOT NULL DEFAULT false CHECK(NOT activation_allowed),
 installed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO funding_installation_private.manifest(singleton,package) VALUES(true,'i4-inert-foundation-v1');
-- No enrollment path. A separately reviewed migration must create scope authority.
CREATE TABLE funding_route_private.bindings(
 binding text PRIMARY KEY CHECK(binding ~ '^[a-f0-9]{64}$'),
 event_id uuid NOT NULL REFERENCES public.protests(id) ON DELETE RESTRICT,
 operation_key text NOT NULL UNIQUE,
 operation_id uuid UNIQUE,
 state text NOT NULL CHECK(state IN('preparing','bound')),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK((state='preparing' AND operation_id IS NULL) OR (state='bound' AND operation_id IS NOT NULL))
);
CREATE TABLE funding_lookup_private.references(
 operation_id uuid PRIMARY KEY,
 iv text NOT NULL CHECK(iv ~ '^[a-f0-9]{24}$'),
 tag text NOT NULL CHECK(tag ~ '^[a-f0-9]{32}$'),
 ciphertext text NOT NULL CHECK(ciphertext ~ '^[a-f0-9]{68}$'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '30 days',
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
-- No plaintext phone/SID/key. Retention job and purpose-end deletion are not activated.
ALTER TABLE funding_installation_private.manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_installation_private.manifest FORCE ROW LEVEL SECURITY;
ALTER TABLE funding_route_private.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_route_private.bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE funding_lookup_private.references ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_lookup_private.references FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA funding_installation_private,funding_route_private,funding_lookup_private FROM PUBLIC,anon,authenticated,service_role;
-- No policies, login roles, memberships, functions, parent triggers or RPC changes.
COMMIT;
