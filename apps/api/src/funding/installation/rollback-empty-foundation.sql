-- Only after a separate Owner Gate. Not an operational ledger rollback.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$BEGIN
 IF (SELECT package FROM funding_installation_private.manifest WHERE singleton) IS DISTINCT FROM 'i4-inert-foundation-v1'
 OR EXISTS(SELECT 1 FROM funding_route_private.bindings)
 OR EXISTS(SELECT 1 FROM funding_lookup_private.references)
 THEN RAISE EXCEPTION 'nonempty_or_unknown_installation_stop';END IF;
END$$;
DROP TABLE funding_route_private.bindings;
DROP TABLE funding_lookup_private.references;
DROP TABLE funding_installation_private.manifest;
-- RESTRICT intentionally stops if subsequent objects/dependencies exist. Never CASCADE.
DROP SCHEMA funding_route_private RESTRICT;
DROP SCHEMA funding_lookup_private RESTRICT;
DROP SCHEMA funding_installation_private RESTRICT;
COMMIT;
