BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Additive preference storage. No historical preferences are invented/backfilled.
DO $$ BEGIN
  IF to_regprocedure('public.save_owned_push_subscription(text,text,text,text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'VP_PUSH_OWNED_RPC_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM (VALUES ('devices','id','text'),('devices','verified_at','timestamptz'),
    ('protests','id','uuid'),('protests','ends_at','timestamptz'),('adhesions','device_id','text'),
    ('adhesions','protest_id','uuid'),('adhesions','deleted_at','timestamptz'),('adhesions','anonymized_at','timestamptz'),
    ('push_subscriptions','device_id','text'),('push_subscriptions','endpoint','text'),
    ('push_subscriptions','protest_id','uuid'),('push_subscriptions','updated_at','timestamptz')) AS expected(relation,column_name,type_name)
    WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||expected.relation)
      AND a.attname=expected.column_name AND NOT a.attisdropped AND a.atttypid=expected.type_name::regtype)) THEN
    RAISE EXCEPTION 'VP_PUSH_CONSENT_CATALOG_REQUIRED';
  END IF;
END $$;

CREATE TABLE public.push_notification_preferences (
  device_id text NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  protest_id uuid NOT NULL REFERENCES public.protests(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id,protest_id)
);
ALTER TABLE public.push_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_notification_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.push_notification_preferences TO service_role;
CREATE POLICY push_preferences_service_only ON public.push_notification_preferences
  FOR ALL TO service_role USING(true) WITH CHECK(true);

-- All legacy and scoped registration/revocation paths serialize per identity.
-- A legacy registration may update its transport, but cannot erase a revocation.
CREATE OR REPLACE FUNCTION public.save_owned_push_subscription(
  p_device_id text,p_endpoint text,p_p256dh text,p_auth text,
  p_protest_id uuid,p_locale text,p_timezone text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE saved_id uuid; expiry timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('push-consent:'||p_device_id,0));
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
    WHERE existing.device_id=EXCLUDED.device_id RETURNING id INTO saved_id;
  RETURN saved_id IS NOT NULL;
END $$;

CREATE FUNCTION public.get_push_notification_preferences(p_device_id text,p_protest_id uuid,p_endpoint text DEFAULT NULL,p_p256dh text DEFAULT NULL,p_auth text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE pref public.push_notification_preferences%ROWTYPE; permitted boolean; registered boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('push-consent:'||p_device_id,0));
  IF NOT EXISTS(SELECT 1 FROM public.devices WHERE id=p_device_id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'VP_PUSH_DEVICE_UNVERIFIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.protests WHERE id=p_protest_id) THEN RAISE EXCEPTION 'VP_PUSH_PROTEST_NOT_FOUND'; END IF;
  SELECT * INTO pref FROM public.push_notification_preferences WHERE device_id=p_device_id AND protest_id=p_protest_id;
  IF FOUND THEN permitted:=pref.enabled;
  ELSE permitted:=EXISTS(SELECT 1 FROM public.push_subscriptions WHERE device_id=p_device_id AND protest_id=p_protest_id);
  END IF;
  -- Correspondence is only proved for the exact browser endpoint and keys.
  -- Without a browser snapshot, consent remains readable but transport is unknown.
  registered:=p_endpoint IS NOT NULL AND p_p256dh IS NOT NULL AND p_auth IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.push_subscriptions WHERE device_id=p_device_id
      AND endpoint=p_endpoint AND p256dh=p_p256dh AND auth=p_auth);
  RETURN jsonb_build_object('ok',true,'enabled',permitted,'revision',coalesce(pref.revision,0),
    'registration',CASE WHEN registered THEN 'present' ELSE 'missing' END);
END $$;

CREATE FUNCTION public.revoke_push_notification_preferences(p_device_id text,p_protest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_revision integer; next_revision integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('push-consent:'||p_device_id,0));
  IF NOT EXISTS(SELECT 1 FROM public.devices WHERE id=p_device_id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'VP_PUSH_DEVICE_UNVERIFIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.protests WHERE id=p_protest_id) THEN RAISE EXCEPTION 'VP_PUSH_PROTEST_NOT_FOUND'; END IF;
  SELECT revision INTO current_revision FROM public.push_notification_preferences WHERE device_id=p_device_id AND protest_id=p_protest_id;
  IF coalesce(current_revision,0)>=2147483647 THEN RAISE EXCEPTION 'VP_PUSH_REVISION_EXHAUSTED'; END IF;
  next_revision:=coalesce(current_revision,0)+1;
  INSERT INTO public.push_notification_preferences(device_id,protest_id,enabled,revision)
    VALUES(p_device_id,p_protest_id,false,next_revision)
    ON CONFLICT(device_id,protest_id) DO UPDATE SET enabled=false,revision=EXCLUDED.revision,updated_at=now();
  -- Keep the shared transport and every other event/identity's preference intact.
  RETURN jsonb_build_object('ok',true,'enabled',false,'revision',next_revision);
END $$;

CREATE FUNCTION public.save_scoped_push_subscription(
  p_device_id text,p_endpoint text,p_p256dh text,p_auth text,p_protest_id uuid,
  p_locale text,p_timezone text,p_consent_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_revision integer; next_revision integer; saved boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('push-consent:'||p_device_id,0));
  IF NOT EXISTS(SELECT 1 FROM public.devices WHERE id=p_device_id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'VP_PUSH_DEVICE_UNVERIFIED'; END IF;
  IF p_protest_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.protests WHERE id=p_protest_id) THEN RAISE EXCEPTION 'VP_PUSH_PROTEST_NOT_FOUND'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.adhesions WHERE device_id=p_device_id AND protest_id=p_protest_id AND deleted_at IS NULL AND anonymized_at IS NULL) THEN RAISE EXCEPTION 'VP_PUSH_PARTICIPATION_REQUIRED'; END IF;
  SELECT revision INTO current_revision FROM public.push_notification_preferences WHERE device_id=p_device_id AND protest_id=p_protest_id;
  current_revision:=coalesce(current_revision,0);
  IF p_consent_revision IS NULL OR p_consent_revision<>current_revision THEN RAISE EXCEPTION 'VP_PUSH_CONSENT_STALE'; END IF;
  IF current_revision>=2147483647 THEN RAISE EXCEPTION 'VP_PUSH_REVISION_EXHAUSTED'; END IF;
  saved:=public.save_owned_push_subscription(p_device_id,p_endpoint,p_p256dh,p_auth,p_protest_id,p_locale,p_timezone);
  IF NOT saved THEN RETURN jsonb_build_object('ok',false,'error','PUSH_ENDPOINT_OWNED'); END IF;
  next_revision:=current_revision+1;
  INSERT INTO public.push_notification_preferences(device_id,protest_id,enabled,revision)
    VALUES(p_device_id,p_protest_id,true,next_revision)
    ON CONFLICT(device_id,protest_id) DO UPDATE SET enabled=true,revision=EXCLUDED.revision,updated_at=now();
  RETURN jsonb_build_object('ok',true,'enabled',true,'revision',next_revision);
END $$;

CREATE FUNCTION public.list_scoped_push_subscriptions(p_protest_id uuid)
RETURNS TABLE(device_id text,endpoint text,p256dh text,auth text,locale text,timezone text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT s.device_id,s.endpoint,s.p256dh,s.auth,s.locale,s.timezone
  FROM public.push_subscriptions s JOIN public.devices d ON d.id=s.device_id AND d.verified_at IS NOT NULL
  LEFT JOIN public.push_notification_preferences pref ON pref.device_id=s.device_id AND pref.protest_id=p_protest_id
  WHERE coalesce(pref.enabled,s.protest_id=p_protest_id,false)
    AND EXISTS(SELECT 1 FROM public.adhesions a WHERE a.device_id=s.device_id AND a.protest_id=p_protest_id AND a.deleted_at IS NULL AND a.anonymized_at IS NULL)
$$;

CREATE FUNCTION public.push_subscription_can_deliver(p_device_id text,p_protest_id uuid,p_endpoint text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.list_scoped_push_subscriptions(p_protest_id) s WHERE s.device_id=p_device_id AND s.endpoint=p_endpoint)
$$;

CREATE FUNCTION public.prune_scoped_push_orphans()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE identity_id text; removed integer; total integer:=0; cutoff timestamptz:=now()-interval '24 hours';
BEGIN
  -- Only known, stale transports with no current/unknown recoverable consent.
  -- Null legacy provenance or timestamps are retained, never guessed away.
  FOR identity_id IN SELECT DISTINCT s.device_id FROM public.push_subscriptions s
    WHERE s.updated_at<cutoff AND s.protest_id IS NOT NULL
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('push-consent:'||identity_id,0)) THEN CONTINUE; END IF;
    DELETE FROM public.push_subscriptions s WHERE s.device_id=identity_id AND s.updated_at<cutoff
      AND s.protest_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.protests p WHERE p.id=s.protest_id AND p.ends_at<cutoff)
      AND NOT EXISTS(SELECT 1 FROM public.push_notification_preferences pref JOIN public.protests p ON p.id=pref.protest_id
        WHERE pref.device_id=identity_id AND pref.enabled AND p.ends_at>=cutoff)
      AND NOT EXISTS(SELECT 1 FROM public.adhesions a JOIN public.protests p ON p.id=a.protest_id
        LEFT JOIN public.push_notification_preferences pref ON pref.device_id=a.device_id AND pref.protest_id=a.protest_id
        WHERE a.device_id=identity_id AND a.deleted_at IS NULL AND a.anonymized_at IS NULL AND p.ends_at>=cutoff AND pref.device_id IS NULL);
    GET DIAGNOSTICS removed=ROW_COUNT;
    total:=total+removed;
  END LOOP;
  RETURN total;
END $$;

REVOKE ALL ON FUNCTION public.save_owned_push_subscription(text,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_push_notification_preferences(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.revoke_push_notification_preferences(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_scoped_push_subscription(text,text,text,text,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_scoped_push_subscriptions(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.push_subscription_can_deliver(text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prune_scoped_push_orphans() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_owned_push_subscription(text,text,text,text,uuid,text,text),
  public.get_push_notification_preferences(text,uuid,text,text,text),public.revoke_push_notification_preferences(text,uuid),
  public.save_scoped_push_subscription(text,text,text,text,uuid,text,text,integer),
  public.list_scoped_push_subscriptions(uuid),public.push_subscription_can_deliver(text,uuid,text),
  public.prune_scoped_push_orphans() TO service_role;
COMMIT;
