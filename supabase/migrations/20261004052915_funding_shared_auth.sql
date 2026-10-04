-- Owner-authorized ISOLATED candidate only; not production policy or activation.
CREATE SCHEMA funding_auth_private;
REVOKE ALL ON SCHEMA funding_auth_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA funding_auth_private TO funding_runtime;
CREATE TABLE funding_auth_private.test_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 max_starts int NOT NULL CHECK(max_starts>0),window_ttl interval NOT NULL CHECK(window_ttl>interval '0'),
 max_attempts int NOT NULL CHECK(max_attempts>0),challenge_ttl interval NOT NULL CHECK(challenge_ttl>interval '0'),
 session_ttl interval NOT NULL CHECK(session_ttl>interval '0'),lease_ttl interval NOT NULL CHECK(lease_ttl>interval '0'));
INSERT INTO funding_auth_private.test_policy VALUES(true,3,interval '10 minutes',5,interval '5 minutes',interval '10 minutes',interval '30 seconds');
CREATE TABLE funding_auth_private.otp_rate_windows (
 rate_token text PRIMARY KEY CHECK(rate_token~'^[0-9a-f]{64}$'),count int NOT NULL CHECK(count>0),expires_at timestamptz NOT NULL);
CREATE TABLE funding_auth_private.otp_challenges (
 id uuid PRIMARY KEY,rate_token text NOT NULL REFERENCES funding_auth_private.otp_rate_windows,
 payload jsonb NOT NULL CHECK(payload ?& ARRAY['tokens','year','eventId'] AND (payload->'tokens') ?& ARRAY['annual','event']) CHECK(payload-ARRAY['tokens','year','eventId']='{}'::jsonb AND jsonb_typeof(payload->'tokens')='object' AND (payload->'tokens')-ARRAY['annual','event']='{}'::jsonb AND (payload->'tokens'->>'annual')~'^[0-9a-f]{64}$' AND (payload->'tokens'->'event'='null'::jsonb OR (payload->'tokens'->>'event')~'^[0-9a-f]{64}$') AND jsonb_typeof(payload->'year')='number' AND (payload->'eventId'='null'::jsonb OR jsonb_typeof(payload->'eventId')='string')),
 attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0),
 state text NOT NULL CHECK(state IN('pending_send','ready','verifying','consumed','failed','expired')),
 operation_id uuid,lease_until timestamptz,expires_at timestamptz NOT NULL);
CREATE TABLE funding_auth_private.verified_sessions (
 digest text PRIMARY KEY CHECK(digest~'^[0-9a-f]{64}$'),
 challenge_id uuid NOT NULL UNIQUE REFERENCES funding_auth_private.otp_challenges,
 payload jsonb NOT NULL CHECK(payload ?& ARRAY['tokens','year','eventId'] AND (payload->'tokens') ?& ARRAY['annual','event']) CHECK(payload-ARRAY['tokens','year','eventId']='{}'::jsonb AND jsonb_typeof(payload->'tokens')='object' AND (payload->'tokens')-ARRAY['annual','event']='{}'::jsonb AND (payload->'tokens'->>'annual')~'^[0-9a-f]{64}$' AND (payload->'tokens'->'event'='null'::jsonb OR (payload->'tokens'->>'event')~'^[0-9a-f]{64}$') AND jsonb_typeof(payload->'year')='number' AND (payload->'eventId'='null'::jsonb OR jsonb_typeof(payload->'eventId')='string')),expires_at timestamptz NOT NULL);
CREATE INDEX auth_challenge_rate_idx ON funding_auth_private.otp_challenges(rate_token);
CREATE INDEX auth_challenge_expiry_idx ON funding_auth_private.otp_challenges(expires_at);
CREATE INDEX auth_session_expiry_idx ON funding_auth_private.verified_sessions(expires_at);
-- Runtime is trusted to operate auth state, not a hostile SQL client. Client roles have no access.
GRANT SELECT ON funding_auth_private.test_policy TO funding_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON funding_auth_private.otp_rate_windows,funding_auth_private.otp_challenges,funding_auth_private.verified_sessions TO funding_runtime;
ALTER TABLE funding_auth_private.test_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_auth_private.otp_rate_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_auth_private.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_auth_private.verified_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_policy_read ON funding_auth_private.test_policy FOR SELECT TO funding_runtime USING(true);
CREATE POLICY runtime_rate ON funding_auth_private.otp_rate_windows TO funding_runtime USING(true) WITH CHECK(true);
CREATE POLICY runtime_challenges ON funding_auth_private.otp_challenges TO funding_runtime USING(true) WITH CHECK(true);
CREATE POLICY runtime_sessions ON funding_auth_private.verified_sessions TO funding_runtime USING(true) WITH CHECK(true);
CREATE FUNCTION funding_auth_private.start_challenge(p_id uuid,p_rate text,p_payload jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
DECLARE pol test_policy; r otp_rate_windows; t timestamptz;
BEGIN
 SELECT * INTO STRICT pol FROM test_policy;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding-auth-rate:'||p_rate,0));
 t:=clock_timestamp();
 SELECT * INTO r FROM otp_rate_windows WHERE rate_token=p_rate FOR UPDATE;
 IF FOUND AND r.expires_at>t AND r.count>=pol.max_starts THEN RETURN jsonb_build_object('error','otp_rate_limit'); END IF;
 INSERT INTO otp_rate_windows(rate_token,count,expires_at) VALUES(p_rate,1,t+pol.window_ttl)
 ON CONFLICT(rate_token) DO UPDATE SET count=CASE WHEN otp_rate_windows.expires_at<=t THEN 1 ELSE otp_rate_windows.count+1 END,
 expires_at=CASE WHEN otp_rate_windows.expires_at<=t THEN t+pol.window_ttl ELSE otp_rate_windows.expires_at END;
 INSERT INTO otp_challenges(id,rate_token,payload,state,expires_at) VALUES(p_id,p_rate,p_payload,'pending_send',t+pol.challenge_ttl);
 RETURN jsonb_build_object('expiresInSeconds',extract(epoch FROM pol.challenge_ttl),'sendTimeoutMilliseconds',extract(epoch FROM pol.lease_ttl)*1000);
END $$;
CREATE FUNCTION funding_auth_private.finish_send(p_id uuid,p_ok boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
DECLARE c otp_challenges; t timestamptz;
BEGIN
 SELECT * INTO c FROM otp_challenges WHERE id=p_id FOR UPDATE;t:=clock_timestamp();
 IF NOT FOUND OR c.state<>'pending_send' THEN RETURN jsonb_build_object('error','challenge_expired'); END IF;
 UPDATE otp_challenges SET state=CASE WHEN NOT p_ok THEN 'failed' WHEN expires_at<=t THEN 'expired' ELSE 'ready' END WHERE id=p_id;
 IF NOT p_ok THEN RETURN '{}'::jsonb; END IF;
 IF c.expires_at<=t THEN RETURN jsonb_build_object('error','challenge_expired'); END IF;
 RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION funding_auth_private.claim_challenge(p_id uuid,p_operation uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
DECLARE c otp_challenges;pol test_policy;t timestamptz;
BEGIN
 SELECT * INTO STRICT pol FROM test_policy;
 SELECT * INTO c FROM otp_challenges WHERE id=p_id FOR UPDATE;t:=clock_timestamp();
 IF NOT FOUND THEN RETURN jsonb_build_object('error','challenge_expired'); END IF;
 IF c.expires_at<=t OR (c.state='verifying' AND c.lease_until<=t) THEN
  UPDATE otp_challenges SET state=CASE WHEN expires_at<=t THEN 'expired' ELSE 'failed' END WHERE id=p_id;
  RETURN jsonb_build_object('error','challenge_expired');
 END IF;
 IF c.state<>'ready' OR c.attempts>=pol.max_attempts THEN RETURN jsonb_build_object('error','challenge_expired'); END IF;
 UPDATE otp_challenges SET attempts=attempts+1,state='verifying',operation_id=p_operation,
 lease_until=least(t+pol.lease_ttl,expires_at) WHERE id=p_id;
 RETURN jsonb_build_object('claimed',true,'leaseMilliseconds',extract(epoch FROM least(t+pol.lease_ttl,c.expires_at)-t)*1000);
END $$;
CREATE FUNCTION funding_auth_private.finish_verification(p_id uuid,p_operation uuid,p_outcome text,p_digest text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
DECLARE c otp_challenges;pol test_policy;t timestamptz;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN('valid','invalid','uncertain') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
 SELECT * INTO STRICT pol FROM test_policy;
 SELECT * INTO c FROM otp_challenges WHERE id=p_id FOR UPDATE;t:=clock_timestamp();
 IF NOT FOUND OR c.state<>'verifying' OR c.operation_id IS DISTINCT FROM p_operation THEN RETURN jsonb_build_object('error','challenge_expired'); END IF;
 IF c.expires_at<=t OR c.lease_until<=t THEN
  UPDATE otp_challenges SET state=CASE WHEN expires_at<=t THEN 'expired' ELSE 'failed' END WHERE id=p_id;
  RETURN jsonb_build_object('error','challenge_expired');
 END IF;
 IF p_outcome<>'valid' THEN
  UPDATE otp_challenges SET state=CASE WHEN p_outcome='uncertain' OR attempts>=pol.max_attempts THEN 'failed' ELSE 'ready' END,
   operation_id=NULL,lease_until=NULL WHERE id=p_id;
  RETURN jsonb_build_object('error',CASE WHEN p_outcome='invalid' THEN 'invalid_otp' ELSE 'otp_verification_unavailable' END);
 END IF;
 INSERT INTO verified_sessions(digest,challenge_id,payload,expires_at) VALUES(p_digest,p_id,c.payload,t+pol.session_ttl);
 UPDATE otp_challenges SET state='consumed',operation_id=NULL,lease_until=NULL WHERE id=p_id;
 RETURN jsonb_build_object('year',c.payload->'year','expiresInSeconds',extract(epoch FROM pol.session_ttl));
END $$;
CREATE FUNCTION funding_auth_private.load_session(p_digest text) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
 SELECT payload FROM verified_sessions WHERE digest=p_digest AND expires_at>clock_timestamp()
$$;
CREATE FUNCTION funding_auth_private.cleanup_expired() RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
BEGIN
 DELETE FROM verified_sessions WHERE expires_at<=clock_timestamp();
 DELETE FROM otp_challenges c WHERE c.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM verified_sessions s WHERE s.challenge_id=c.id);
 DELETE FROM otp_rate_windows r WHERE r.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM otp_challenges c WHERE c.rate_token=r.rate_token);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA funding_auth_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA funding_auth_private TO funding_runtime;
