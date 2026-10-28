-- PROPOSAL ONLY. Requires production approval; install before the API.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('public.otp_quota_buckets') IS NOT NULL OR
    to_regprocedure('public.consume_shared_otp_quota(text,text,text)') IS NOT NULL OR
    to_regprocedure('public.reserve_sms_otp(text,text,text,uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'VP_OTP_QUOTA_ALREADY_PRESENT';
 END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
  ('id','uuid'),('phone_hash','text'),('device_id','text'),('ip_hash','text'),
  ('protest_id','uuid'),('status','text'),('requested_at','timestamptz')
 ) AS expected(column_name,type_name) WHERE NOT EXISTS(
  SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.otp_requests')
   AND a.attname=expected.column_name AND NOT a.attisdropped AND a.atttypid=expected.type_name::regtype
 )) THEN RAISE EXCEPTION 'VP_OTP_CATALOG_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.otp_requests'::regclass
   AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef
   AND a.attidentity='' AND a.attgenerated=''
   AND a.attname NOT IN ('id','phone_hash','device_id','ip_hash','protest_id','status','requested_at')) THEN
   RAISE EXCEPTION 'VP_OTP_REQUIRED_COLUMNS_UNSUPPORTED';
 END IF;
END $$;

CREATE TABLE public.otp_quota_buckets(
 scope text NOT NULL CHECK(scope IN ('delivery_network','verify_network','verify_subject_network')),
 key_hash text NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
 hits timestamptz[] NOT NULL CHECK(cardinality(hits) BETWEEN 1 AND 30),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(scope,key_hash)
);
CREATE INDEX otp_quota_buckets_expiry ON public.otp_quota_buckets(expires_at);
ALTER TABLE public.otp_quota_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otp_quota_buckets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.otp_quota_buckets TO service_role;
CREATE POLICY otp_quota_service_only ON public.otp_quota_buckets TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION public.consume_shared_otp_quota(p_action text,p_network_hash text,p_subject_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='1500ms' AS $$
DECLARE r record; n timestamptz; active timestamptz[]; delay integer;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'VP_OTP_ISOLATION_REQUIRED'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('delivery','verify') OR p_network_hash IS NULL OR p_network_hash !~ '^[0-9a-f]{64}$'
  OR (p_subject_hash IS NOT NULL AND (p_action <> 'verify' OR p_subject_hash !~ '^[0-9a-f]{64}$')) THEN RAISE EXCEPTION 'VP_OTP_QUOTA_ARGUMENTS'; END IF;
 FOR r IN SELECT DISTINCT hashtextextended('vp-otp-quota:'||scope||':'||key,0) AS lock_key FROM (
   SELECT CASE WHEN p_action='delivery' THEN 'delivery_network' ELSE 'verify_network' END AS scope,p_network_hash AS key
   UNION ALL SELECT 'verify_subject_network',p_subject_hash WHERE p_subject_hash IS NOT NULL
  ) keys ORDER BY lock_key LOOP PERFORM pg_advisory_xact_lock(r.lock_key); END LOOP;
 n:=clock_timestamp();
 -- Check every dimension before charging any, with a fresh snapshot after locks.
 FOR r IN SELECT * FROM (VALUES
  (CASE WHEN p_action='delivery' THEN 'delivery_network' ELSE 'verify_network' END,p_network_hash,CASE WHEN p_action='delivery' THEN 30 ELSE 10 END,CASE WHEN p_action='delivery' THEN 600 ELSE 300 END),
  ('verify_subject_network',p_subject_hash,5,600)
 ) AS rules(scope,key,lim,seconds) WHERE key IS NOT NULL LOOP
  SELECT coalesce(array_agg(h ORDER BY h),'{}'::timestamptz[]) INTO active
    FROM public.otp_quota_buckets b CROSS JOIN LATERAL unnest(b.hits) h
    WHERE b.scope=r.scope AND b.key_hash=r.key AND h>n-make_interval(secs=>r.seconds);
  IF cardinality(active)>=r.lim THEN
   delay:=greatest(1,ceil(extract(epoch FROM active[1]+make_interval(secs=>r.seconds)-n))::integer);
   RETURN jsonb_build_object('allowed',false,'retry_after',delay);
  END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
  (CASE WHEN p_action='delivery' THEN 'delivery_network' ELSE 'verify_network' END,p_network_hash,CASE WHEN p_action='delivery' THEN 600 ELSE 300 END),
  ('verify_subject_network',p_subject_hash,600)
 ) AS rules(scope,key,seconds) WHERE key IS NOT NULL LOOP
  SELECT coalesce(array_agg(h ORDER BY h),'{}'::timestamptz[]) INTO active
    FROM public.otp_quota_buckets b CROSS JOIN LATERAL unnest(b.hits) h
    WHERE b.scope=r.scope AND b.key_hash=r.key AND h>n-make_interval(secs=>r.seconds);
  INSERT INTO public.otp_quota_buckets(scope,key_hash,hits,expires_at)
   VALUES(r.scope,r.key,array_append(active,n),n+make_interval(secs=>r.seconds))
   ON CONFLICT(scope,key_hash) DO UPDATE SET hits=EXCLUDED.hits,expires_at=EXCLUDED.expires_at;
 END LOOP;
 RETURN jsonb_build_object('allowed',true);
END $$;

CREATE FUNCTION public.reserve_sms_otp(p_phone_hash text,p_device_id text,p_ip_hash text,p_protest_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='1500ms' AS $$
DECLARE l bigint; n timestamptz; incomplete integer; latest timestamptz; delay integer; release_at timestamptz; wait_until timestamptz; challenge uuid;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'VP_OTP_ISOLATION_REQUIRED'; END IF;
 IF p_phone_hash IS NULL OR p_phone_hash !~ '^[0-9a-f]{64}$' OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{32}$'
   OR (p_device_id IS NOT NULL AND length(p_device_id) NOT BETWEEN 8 AND 128) THEN RAISE EXCEPTION 'VP_OTP_QUOTA_ARGUMENTS'; END IF;
 FOR l IN SELECT DISTINCT hashtextextended('vp-sms-reserve:'||key,0) FROM unnest(ARRAY[
  'phone:'||p_phone_hash,'ip:'||p_ip_hash,CASE WHEN p_device_id IS NOT NULL THEN 'device:'||p_device_id END
 ]) key WHERE key IS NOT NULL ORDER BY 1 LOOP PERFORM pg_advisory_xact_lock(l); END LOOP;
 n:=clock_timestamp();wait_until:=n;
 IF p_device_id IS NOT NULL THEN
  SELECT count(*)::integer,max(requested_at) INTO incomplete,latest FROM public.otp_requests
   WHERE device_id=p_device_id AND status IN ('sent','expired') AND requested_at>n-interval '24 hours';
  delay:=CASE WHEN incomplete>=4 THEN 86400 WHEN incomplete>=3 THEN 3600 WHEN incomplete>=2 THEN 600 WHEN incomplete>=1 THEN 120 ELSE 0 END;
  IF delay>0 AND latest+make_interval(secs=>delay)>n THEN
   wait_until:=greatest(wait_until,latest+make_interval(secs=>delay));
  END IF;
 END IF;
 SELECT requested_at+interval '24 hours' INTO release_at FROM public.otp_requests
  WHERE phone_hash=p_phone_hash AND requested_at>n-interval '24 hours' AND status<>'blocked' ORDER BY requested_at DESC OFFSET 2 LIMIT 1;
 wait_until:=greatest(wait_until,release_at);
 IF p_device_id IS NOT NULL THEN
  SELECT requested_at+interval '1 hour' INTO release_at FROM public.otp_requests
   WHERE device_id=p_device_id AND requested_at>n-interval '1 hour' AND status<>'blocked' ORDER BY requested_at DESC OFFSET 2 LIMIT 1;
  wait_until:=greatest(wait_until,release_at);
 END IF;
 SELECT requested_at+interval '1 hour' INTO release_at FROM public.otp_requests
  WHERE ip_hash=p_ip_hash AND requested_at>n-interval '1 hour' AND status<>'blocked' ORDER BY requested_at DESC OFFSET 9 LIMIT 1;
 wait_until:=greatest(wait_until,release_at);
 IF p_device_id IS NOT NULL AND p_protest_id IS NOT NULL THEN
  SELECT requested_at+interval '1 hour' INTO release_at FROM public.otp_requests
   WHERE device_id=p_device_id AND protest_id=p_protest_id AND requested_at>n-interval '1 hour' AND status<>'blocked' ORDER BY requested_at DESC OFFSET 1 LIMIT 1;
  wait_until:=greatest(wait_until,release_at);
 END IF;
 IF wait_until>n THEN RETURN jsonb_build_object('allowed',false,'retry_after',greatest(1,ceil(extract(epoch FROM wait_until-n))::integer)); END IF;
 INSERT INTO public.otp_requests(id,phone_hash,device_id,ip_hash,protest_id,status,requested_at)
  VALUES(gen_random_uuid(),p_phone_hash,p_device_id,p_ip_hash,p_protest_id,'sent',n) RETURNING id INTO challenge;
 RETURN jsonb_build_object('allowed',true,'request_id',challenge);
END $$;
REVOKE ALL ON FUNCTION public.consume_shared_otp_quota(text,text,text),public.reserve_sms_otp(text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_shared_otp_quota(text,text,text),public.reserve_sms_otp(text,text,text,uuid) TO service_role;
COMMIT;
