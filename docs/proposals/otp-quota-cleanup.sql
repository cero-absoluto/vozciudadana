-- Separate approved maintenance step after otp-quotas.sql. No existing job altered.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.otp_quota_buckets') IS NULL OR to_regclass('cron.job') IS NULL THEN RAISE EXCEPTION 'VP_OTP_CLEANUP_PREREQUISITES'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='vp-otp-quota-cleanup') THEN RAISE EXCEPTION 'VP_OTP_CLEANUP_ALREADY_PRESENT'; END IF;
END $$;
SELECT cron.schedule('vp-otp-quota-cleanup','* * * * *',
 $job$SET lock_timeout='1s'; SET statement_timeout='10s'; WITH expired AS (SELECT scope,key_hash FROM public.otp_quota_buckets WHERE expires_at<now() ORDER BY expires_at LIMIT 5000 FOR UPDATE SKIP LOCKED)
 DELETE FROM public.otp_quota_buckets b USING expired e WHERE b.scope=e.scope AND b.key_hash=e.key_hash$job$);
COMMIT;
