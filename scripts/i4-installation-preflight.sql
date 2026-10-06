-- Read-only inventory, NOT an installer. No participant/phone/donor rows.
BEGIN READ ONLY;
SELECT current_setting('server_version_num') AS postgres_version;
SELECT n.nspname AS schema,p.proname,p.prosecdef,
 md5(pg_get_functiondef(p.oid)) AS definition_fingerprint,
 p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname='public' AND p.proname IN
 ('create_verified_adhesion','transfer_protest_surplus_to_platform_fund');
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text AS acl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN('protests','donaciones','financial_movements','platform_fund');
SELECT c.relname,t.tgname,t.tgenabled,md5(pg_get_triggerdef(t.oid)) AS fingerprint
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
 AND c.relname IN('protests','donaciones','financial_movements','platform_fund');
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN('protests','donaciones','financial_movements','platform_fund');
SELECT nspname FROM pg_namespace WHERE nspname LIKE 'funding%';
COMMIT;
-- Cron source/configuration needs a separate minimised inspection when pg_cron exists.
-- This inventory does NOT certify that all writers have been excluded.
