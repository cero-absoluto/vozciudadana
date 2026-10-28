-- LOCAL PROPOSAL. Requires explicit production approval before application.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='endpoint'
    WHERE i.indrelid=to_regclass('public.push_subscriptions') AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) THEN
    RAISE EXCEPTION 'VP_PUSH_ENDPOINT_UNIQUE_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','device_id','endpoint','p256dh','auth','protest_id','ends_at','locale','timezone','updated_at']) AS required(name)
    WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='push_subscriptions' AND c.column_name=required.name)) THEN
    RAISE EXCEPTION 'VP_PUSH_COLUMNS_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('devices','id','text'),('devices','verified_at','timestamptz'),
    ('protests','id','uuid'),('protests','ends_at','timestamptz'),
    ('push_subscriptions','id','uuid'),('push_subscriptions','device_id','text'),
    ('push_subscriptions','endpoint','text'),('push_subscriptions','p256dh','text'),
    ('push_subscriptions','auth','text'),('push_subscriptions','protest_id','uuid'),
    ('push_subscriptions','ends_at','timestamptz'),('push_subscriptions','locale','text'),
    ('push_subscriptions','timezone','text'),('push_subscriptions','updated_at','timestamptz')
  ) AS expected(relation,column_name,type_name)
    WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||expected.relation)
      AND a.attname=expected.column_name AND NOT a.attisdropped AND a.atttypid=expected.type_name::regtype)) THEN
    RAISE EXCEPTION 'VP_PUSH_CATALOG_TYPES_REQUIRED';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.save_owned_push_subscription(
  p_device_id text,p_endpoint text,p_p256dh text,p_auth text,
  p_protest_id uuid,p_locale text,p_timezone text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved_id uuid; expiry timestamptz;
BEGIN
  -- HTTP authenticates device possession; only service_role can call this RPC.
  IF NOT EXISTS(SELECT 1 FROM public.devices WHERE id=p_device_id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'VP_PUSH_DEVICE_UNVERIFIED'; END IF;
  IF p_protest_id IS NOT NULL THEN
    SELECT ends_at INTO expiry FROM public.protests WHERE id=p_protest_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VP_PUSH_PROTEST_NOT_FOUND'; END IF;
  END IF;
  INSERT INTO public.push_subscriptions AS existing(device_id,endpoint,p256dh,auth,protest_id,ends_at,locale,timezone,updated_at)
    VALUES(p_device_id,p_endpoint,p_p256dh,p_auth,p_protest_id,expiry,p_locale,p_timezone,now())
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
      protest_id=EXCLUDED.protest_id,ends_at=EXCLUDED.ends_at,locale=EXCLUDED.locale,
      timezone=EXCLUDED.timezone,updated_at=EXCLUDED.updated_at
    WHERE existing.device_id=EXCLUDED.device_id
    RETURNING id INTO saved_id;
  RETURN saved_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.save_owned_push_subscription(text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_owned_push_subscription(text,text,text,text,uuid,text,text) TO service_role;
COMMIT;
