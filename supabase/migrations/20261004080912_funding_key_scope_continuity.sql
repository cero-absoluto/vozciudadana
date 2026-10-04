-- Owner-approved policies1-5. Isolated fixtures only; no real key material or history repair.
CREATE TABLE funding_private.key_versions(purpose text NOT NULL CHECK(purpose IN('annual','event','rate','session','otp','provider','review')),version text NOT NULL CHECK(version~'^[a-z0-9_]{1,32}$'),provenance text NOT NULL CHECK(provenance IN('synthetic_v1_known','synthetic_split')),key_commitment text NOT NULL CHECK(key_commitment~'^[0-9a-f]{64}$'),PRIMARY KEY(purpose,version));
CREATE TABLE funding_private.continuity_enrollment(singleton boolean PRIMARY KEY CHECK(singleton),test_only boolean NOT NULL CHECK(test_only),provenance text NOT NULL CHECK(provenance='synthetic_closed_fixture'),evidence_ref uuid NOT NULL);
ALTER TABLE funding_private.continuity_enrollment ENABLE ROW LEVEL SECURITY;
CREATE POLICY continuity_enrollment_read ON funding_private.continuity_enrollment FOR SELECT TO funding_runtime USING(true);
GRANT SELECT ON funding_private.continuity_enrollment TO funding_runtime;
CREATE TABLE funding_private.quota_scopes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purpose text NOT NULL CHECK(purpose IN('annual','event','rate')),scope_ref text NOT NULL,canonical_token text NOT NULL CHECK(canonical_token~'^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(purpose,scope_ref,canonical_token),UNIQUE(id,purpose,scope_ref),CHECK((purpose='annual' AND scope_ref~'^[0-9]{4}$') OR (purpose='event' AND scope_ref~'^[0-9a-f-]{36}$') OR (purpose='rate' AND scope_ref='otp-window')));
CREATE TABLE funding_private.quota_aliases(purpose text NOT NULL,scope_ref text NOT NULL,version text NOT NULL,token text NOT NULL CHECK(token~'^[0-9a-f]{64}$'),scope_id uuid NOT NULL,PRIMARY KEY(purpose,scope_ref,version,token),FOREIGN KEY(purpose,version) REFERENCES funding_private.key_versions,FOREIGN KEY(scope_id,purpose,scope_ref) REFERENCES funding_private.quota_scopes(id,purpose,scope_ref));
CREATE INDEX quota_alias_scope_idx ON funding_private.quota_aliases(scope_id);
CREATE TABLE funding_auth_private.continuity_challenges(challenge_id uuid PRIMARY KEY REFERENCES funding_auth_private.otp_challenges ON DELETE CASCADE,candidates jsonb NOT NULL CHECK(jsonb_typeof(candidates)='object'),session_version text NOT NULL);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['key_versions','quota_scopes','quota_aliases'] LOOP
 EXECUTE format('ALTER TABLE funding_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY continuity_runtime ON funding_private.%I TO funding_runtime USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT ON funding_private.%I TO funding_runtime',t);
 EXECUTE format('CREATE TRIGGER continuity_immutable BEFORE UPDATE OR DELETE ON funding_private.%I FOR EACH ROW EXECUTE FUNCTION funding_private.immutable()',t);
 END LOOP;
END $$;
GRANT INSERT ON funding_private.quota_scopes,funding_private.quota_aliases TO funding_runtime;
ALTER TABLE funding_auth_private.continuity_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY continuity_auth_runtime ON funding_auth_private.continuity_challenges TO funding_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON funding_auth_private.continuity_challenges TO funding_runtime;
CREATE TRIGGER continuity_auth_immutable BEFORE UPDATE ON funding_auth_private.continuity_challenges FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE FUNCTION funding_private.assert_key_manifest(p_manifest jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM continuity_enrollment WHERE singleton AND test_only AND provenance='synthetic_closed_fixture') OR NOT EXISTS(SELECT 1 FROM key_versions) OR jsonb_typeof(p_manifest)<>'array' OR EXISTS(
 (SELECT purpose,version FROM key_versions EXCEPT SELECT x->>'purpose',x->>'version' FROM jsonb_array_elements(p_manifest) x)
 UNION ALL (SELECT x->>'purpose',x->>'version' FROM jsonb_array_elements(p_manifest) x EXCEPT SELECT purpose,version FROM key_versions))
 OR jsonb_array_length(p_manifest)<>(SELECT count(*) FROM key_versions) THEN RAISE EXCEPTION 'key_provenance_required';END IF;
END $$;
CREATE FUNCTION funding_private.resolve_quota_scope(p_purpose text,p_ref text,p_candidates jsonb) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private,funding_auth_private AS $$
DECLARE groups uuid[];existing text[];canonical text;sid uuid;x jsonb;
BEGIN
 -- Broad transaction lock avoids ordering ambiguity between candidate versions. No external work under lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:continuity:resolve',0));
 IF p_purpose NOT IN('annual','event','rate') OR jsonb_typeof(p_candidates)<>'array' OR jsonb_array_length(p_candidates)=0 THEN RAISE EXCEPTION 'key_provenance_required';END IF;
 IF EXISTS((SELECT version FROM key_versions WHERE purpose=p_purpose EXCEPT SELECT v->>'version' FROM jsonb_array_elements(p_candidates) v) UNION ALL (SELECT v->>'version' FROM jsonb_array_elements(p_candidates) v EXCEPT SELECT version FROM key_versions WHERE purpose=p_purpose)) OR jsonb_array_length(p_candidates)<>(SELECT count(*) FROM key_versions WHERE purpose=p_purpose) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_candidates) v WHERE (v->>'token') IS NULL OR (v->>'token')!~'^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'key_provenance_required';END IF;
 SELECT array_agg(DISTINCT a.scope_id) INTO groups FROM quota_aliases a JOIN jsonb_array_elements(p_candidates) v ON a.version=v->>'version' AND a.token=v->>'token' WHERE a.purpose=p_purpose AND a.scope_ref=p_ref;
 SELECT array_agg(DISTINCT token) INTO existing FROM (
 SELECT l.token FROM annual_limits l JOIN jsonb_array_elements(p_candidates) v ON l.token=v->>'token' WHERE p_purpose='annual' AND l.policy_year::text=p_ref
 UNION ALL SELECT l.token FROM event_limits l JOIN jsonb_array_elements(p_candidates) v ON l.token=v->>'token' WHERE p_purpose='event' AND l.event_id::text=p_ref
 UNION ALL SELECT l.rate_token FROM otp_rate_windows l JOIN jsonb_array_elements(p_candidates) v ON l.rate_token=v->>'token' WHERE p_purpose='rate') q;
 IF COALESCE(array_length(groups,1),0)>1 OR COALESCE(array_length(existing,1),0)>1 THEN RAISE EXCEPTION 'quota_alias_conflict';END IF;
 IF array_length(groups,1)=1 THEN sid:=groups[1];SELECT canonical_token INTO canonical FROM quota_scopes WHERE id=sid AND purpose=p_purpose AND scope_ref=p_ref;IF canonical IS NULL OR (array_length(existing,1)=1 AND existing[1]<>canonical) THEN RAISE EXCEPTION 'quota_alias_conflict';END IF;
 ELSE canonical:=COALESCE(existing[1],replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));INSERT INTO quota_scopes(purpose,scope_ref,canonical_token) VALUES(p_purpose,p_ref,canonical) RETURNING id INTO sid;END IF;
 FOR x IN SELECT v FROM jsonb_array_elements(p_candidates) v ORDER BY v->>'version',v->>'token' LOOP INSERT INTO quota_aliases VALUES(p_purpose,p_ref,x->>'version',x->>'token',sid) ON CONFLICT DO NOTHING;END LOOP;
 RETURN canonical;
END $$;
CREATE FUNCTION funding_auth_private.start_continuity(p_id uuid,p_payload jsonb,p_candidates jsonb,p_manifest jsonb,p_session_version text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private,funding_auth_private AS $$
DECLARE rate text;result jsonb;
BEGIN
 PERFORM assert_key_manifest(p_manifest);
 IF NOT EXISTS(SELECT 1 FROM key_versions WHERE purpose='session' AND version=p_session_version) THEN RAISE EXCEPTION 'key_provenance_required';END IF;
 rate:=resolve_quota_scope('rate','otp-window',p_candidates->'rate');
 result:=start_challenge(p_id,rate,p_payload);
 IF result ? 'error' THEN RETURN result;END IF;
 INSERT INTO continuity_challenges VALUES(p_id,p_candidates,p_session_version);RETURN result;
END $$;
CREATE FUNCTION funding_auth_private.finish_continuity(p_id uuid,p_operation uuid,p_outcome text,p_digest text,p_manifest jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private,funding_auth_private AS $$
DECLARE c otp_challenges;k continuity_challenges;a text;e text;result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:continuity:resolve',0));
 PERFORM assert_key_manifest(p_manifest);
 SELECT * INTO c FROM otp_challenges WHERE id=p_id FOR UPDATE;
 SELECT * INTO k FROM continuity_challenges WHERE challenge_id=p_id;
 IF k.challenge_id IS NULL OR c.state<>'verifying' OR c.operation_id IS DISTINCT FROM p_operation OR c.expires_at<=clock_timestamp() OR c.lease_until<=clock_timestamp() THEN RETURN jsonb_build_object('error','challenge_expired');END IF;
 IF p_outcome='valid' THEN
 a:=resolve_quota_scope('annual',c.payload->>'year',k.candidates->'annual');
 IF c.payload->>'eventId' IS NOT NULL THEN e:=resolve_quota_scope('event',c.payload->>'eventId',k.candidates->'event');END IF;
 UPDATE otp_challenges SET payload=jsonb_set(payload,'{tokens}',jsonb_build_object('annual',a,'event',e)) WHERE id=p_id;
 END IF;
 result:=finish_verification(p_id,p_operation,p_outcome,p_digest);RETURN result;
END $$;
CREATE FUNCTION funding_private.require_canonical_intent() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM key_versions) AND (NOT EXISTS(SELECT 1 FROM quota_scopes WHERE purpose='annual' AND scope_ref=NEW.policy_year::text AND canonical_token=NEW.annual_token) OR (NEW.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quota_scopes WHERE purpose='event' AND scope_ref=NEW.event_id::text AND canonical_token=NEW.event_token))) THEN RAISE EXCEPTION 'key_provenance_required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER intent_canonical_boundary BEFORE INSERT ON funding_private.intents FOR EACH ROW EXECUTE FUNCTION funding_private.require_canonical_intent();
REVOKE ALL ON FUNCTION funding_private.assert_key_manifest(jsonb),funding_private.resolve_quota_scope(text,text,jsonb),funding_private.require_canonical_intent(),funding_auth_private.start_continuity(uuid,jsonb,jsonb,jsonb,text),funding_auth_private.finish_continuity(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,funding_review;
GRANT EXECUTE ON FUNCTION funding_private.assert_key_manifest(jsonb),funding_private.resolve_quota_scope(text,text,jsonb),funding_private.require_canonical_intent(),funding_auth_private.start_continuity(uuid,jsonb,jsonb,jsonb,text),funding_auth_private.finish_continuity(uuid,uuid,text,text,jsonb) TO funding_runtime;
-- Bearer revocation is financial-auth state only; never real Owner authentication.
CREATE TABLE funding_auth_private.session_revocations(digest text PRIMARY KEY REFERENCES funding_auth_private.verified_sessions ON DELETE CASCADE,source text NOT NULL DEFAULT 'isolated_fixture' CHECK(source='isolated_fixture'),actor name NOT NULL DEFAULT current_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE funding_auth_private.session_revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY revocation_runtime ON funding_auth_private.session_revocations TO funding_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON funding_auth_private.session_revocations TO funding_runtime;
CREATE TRIGGER session_revocation_immutable BEFORE UPDATE ON funding_auth_private.session_revocations FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE OR REPLACE FUNCTION funding_auth_private.load_session(p_digest text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$ SELECT payload FROM verified_sessions WHERE digest=p_digest AND expires_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM session_revocations WHERE digest=p_digest) $$;
