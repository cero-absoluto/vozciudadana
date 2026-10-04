-- No production retention periods. Policy deliberately absent until fixture owner configures it.
CREATE ROLE funding_cleanup NOLOGIN;
GRANT USAGE ON SCHEMA funding_auth_private,funding_private TO funding_cleanup;
CREATE TABLE funding_auth_private.retention_policy(purpose text PRIMARY KEY CHECK(purpose IN('session','challenge','rate')),version int NOT NULL CHECK(version>0),test_only boolean NOT NULL CHECK(test_only),grace_seconds int NOT NULL CHECK(grace_seconds>=0));
CREATE TABLE funding_auth_private.cleanup_batches(request_id uuid PRIMARY KEY,policy_versions jsonb NOT NULL,session_count int NOT NULL,challenge_count int NOT NULL,rate_count int NOT NULL,scope_count int NOT NULL,actor name NOT NULL,source text NOT NULL CHECK(source='isolated_fixture'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),transaction_id bigint NOT NULL DEFAULT txid_current());
ALTER TABLE funding_auth_private.retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_auth_private.cleanup_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleanup_policy ON funding_auth_private.retention_policy FOR SELECT TO funding_cleanup USING(true);
CREATE POLICY cleanup_audit ON funding_auth_private.cleanup_batches TO funding_cleanup USING(true) WITH CHECK(true);
GRANT SELECT ON funding_auth_private.retention_policy TO funding_cleanup;
GRANT SELECT,INSERT ON funding_auth_private.cleanup_batches TO funding_cleanup;
CREATE TRIGGER cleanup_audit_immutable BEFORE UPDATE OR DELETE ON funding_auth_private.cleanup_batches FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['verified_sessions','otp_challenges','otp_rate_windows','continuity_challenges'] LOOP
 EXECUTE format('CREATE POLICY cleanup_read ON funding_auth_private.%I FOR SELECT TO funding_cleanup USING(true)',t);

 END LOOP;END $$;
GRANT SELECT(challenge_id,expires_at) ON funding_auth_private.verified_sessions TO funding_cleanup;
GRANT SELECT(id,rate_token,expires_at) ON funding_auth_private.otp_challenges TO funding_cleanup;
GRANT SELECT(rate_token,expires_at) ON funding_auth_private.otp_rate_windows TO funding_cleanup;
GRANT DELETE ON funding_auth_private.verified_sessions,funding_auth_private.otp_challenges,funding_auth_private.otp_rate_windows TO funding_cleanup;
CREATE POLICY cleanup_sessions ON funding_auth_private.verified_sessions FOR DELETE TO funding_cleanup USING((SELECT count(*) FROM funding_auth_private.retention_policy)=3 AND expires_at+make_interval(secs=>(SELECT grace_seconds FROM funding_auth_private.retention_policy WHERE purpose='session'))<=clock_timestamp());
CREATE POLICY cleanup_challenges ON funding_auth_private.otp_challenges FOR DELETE TO funding_cleanup USING((SELECT count(*) FROM funding_auth_private.retention_policy)=3 AND expires_at+make_interval(secs=>(SELECT grace_seconds FROM funding_auth_private.retention_policy WHERE purpose='challenge'))<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM funding_auth_private.verified_sessions s WHERE s.challenge_id=otp_challenges.id));
CREATE POLICY cleanup_rates ON funding_auth_private.otp_rate_windows FOR DELETE TO funding_cleanup USING((SELECT count(*) FROM funding_auth_private.retention_policy)=3 AND expires_at+make_interval(secs=>(SELECT grace_seconds FROM funding_auth_private.retention_policy WHERE purpose='rate'))<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM funding_auth_private.otp_challenges c WHERE c.rate_token=otp_rate_windows.rate_token));
-- Runtime can operate auth state but cannot silently erase it outside the audited operator.
REVOKE DELETE ON funding_auth_private.verified_sessions,funding_auth_private.otp_challenges,funding_auth_private.otp_rate_windows FROM funding_runtime;
GRANT SELECT,DELETE ON funding_private.quota_aliases,funding_private.quota_scopes TO funding_cleanup;
CREATE POLICY cleanup_scope_read ON funding_private.quota_scopes FOR SELECT TO funding_cleanup USING(purpose='rate');
CREATE POLICY cleanup_alias_read ON funding_private.quota_aliases FOR SELECT TO funding_cleanup USING(purpose='rate');
CREATE POLICY cleanup_scope_delete ON funding_private.quota_scopes FOR DELETE TO funding_cleanup USING(purpose='rate' AND (SELECT count(*) FROM funding_auth_private.retention_policy)=3 AND NOT EXISTS(SELECT 1 FROM funding_auth_private.otp_rate_windows w WHERE w.rate_token=canonical_token));
CREATE POLICY cleanup_alias_delete ON funding_private.quota_aliases FOR DELETE TO funding_cleanup USING(purpose='rate' AND (SELECT count(*) FROM funding_auth_private.retention_policy)=3 AND NOT EXISTS(SELECT 1 FROM funding_auth_private.otp_rate_windows w JOIN funding_private.quota_scopes s ON s.canonical_token=w.rate_token WHERE s.id=scope_id));
-- Quota records remain immutable; only authorized rate-purpose cleanup can delete aliases/scopes.
DROP TRIGGER continuity_immutable ON funding_private.quota_aliases;
DROP TRIGGER continuity_immutable ON funding_private.quota_scopes;
CREATE FUNCTION funding_private.continuity_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF TG_OP='DELETE' AND OLD.purpose='rate' AND pg_has_role(current_user,'funding_cleanup','MEMBER') THEN RETURN OLD;END IF;RAISE EXCEPTION 'immutable';END $$;
CREATE TRIGGER continuity_immutable BEFORE UPDATE OR DELETE ON funding_private.quota_aliases FOR EACH ROW EXECUTE FUNCTION funding_private.continuity_immutable();
CREATE TRIGGER continuity_immutable BEFORE UPDATE OR DELETE ON funding_private.quota_scopes FOR EACH ROW EXECUTE FUNCTION funding_private.continuity_immutable();
CREATE FUNCTION funding_auth_private.run_cleanup(p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private,funding_private AS $$
DECLARE prior cleanup_batches;pol jsonb;s int;c int;r int;sc int;g_session int;g_challenge int;g_rate int;t timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:continuity:resolve',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:isolated:cleanup',0));
 SELECT * INTO prior FROM cleanup_batches WHERE request_id=p_request;
 IF FOUND THEN RETURN to_jsonb(prior)-ARRAY['actor','created_at','transaction_id'];END IF;
 IF (SELECT count(*) FROM retention_policy)<>3 THEN RAISE EXCEPTION 'cleanup_policy_required';END IF;
 SELECT jsonb_object_agg(purpose,version) INTO pol FROM retention_policy;
 SELECT grace_seconds INTO g_session FROM retention_policy WHERE purpose='session';SELECT grace_seconds INTO g_challenge FROM retention_policy WHERE purpose='challenge';SELECT grace_seconds INTO g_rate FROM retention_policy WHERE purpose='rate';t:=clock_timestamp();
 DELETE FROM verified_sessions WHERE expires_at+make_interval(secs=>g_session)<=t;GET DIAGNOSTICS s=ROW_COUNT;
 DELETE FROM otp_challenges ch WHERE ch.expires_at+make_interval(secs=>g_challenge)<=t AND NOT EXISTS(SELECT 1 FROM verified_sessions v WHERE v.challenge_id=ch.id);GET DIAGNOSTICS c=ROW_COUNT;
 DELETE FROM otp_rate_windows w WHERE w.expires_at+make_interval(secs=>g_rate)<=t AND NOT EXISTS(SELECT 1 FROM otp_challenges ch WHERE ch.rate_token=w.rate_token);GET DIAGNOSTICS r=ROW_COUNT;
 DELETE FROM quota_aliases a WHERE a.purpose='rate' AND NOT EXISTS(SELECT 1 FROM quota_scopes qs JOIN otp_rate_windows w ON w.rate_token=qs.canonical_token WHERE qs.id=a.scope_id);
 DELETE FROM quota_scopes qs WHERE qs.purpose='rate' AND NOT EXISTS(SELECT 1 FROM otp_rate_windows w WHERE w.rate_token=qs.canonical_token);GET DIAGNOSTICS sc=ROW_COUNT;
 INSERT INTO cleanup_batches VALUES(p_request,pol,s,c,r,sc,current_user,'isolated_fixture',clock_timestamp(),txid_current());
 RETURN jsonb_build_object('request_id',p_request,'policy_versions',pol,'session_count',s,'challenge_count',c,'rate_count',r,'scope_count',sc,'source','isolated_fixture');
END $$;
CREATE OR REPLACE FUNCTION funding_auth_private.cleanup_expired() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$ BEGIN PERFORM run_cleanup(gen_random_uuid());END $$;
REVOKE ALL ON FUNCTION funding_auth_private.run_cleanup(uuid),funding_auth_private.cleanup_expired(),funding_private.continuity_immutable() FROM PUBLIC,anon,authenticated,funding_runtime,funding_review;
GRANT EXECUTE ON FUNCTION funding_auth_private.run_cleanup(uuid),funding_auth_private.cleanup_expired(),funding_private.continuity_immutable() TO funding_cleanup;
GRANT EXECUTE ON FUNCTION funding_private.continuity_immutable() TO funding_runtime;

-- A delete cannot commit without a minimal batch provenance in the same transaction.
CREATE FUNCTION funding_auth_private.require_cleanup_provenance() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_auth_private AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM cleanup_batches WHERE transaction_id=txid_current() AND actor=current_user AND source='isolated_fixture') THEN RAISE EXCEPTION 'cleanup_provenance_required';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER cleanup_session_proof AFTER DELETE ON funding_auth_private.verified_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_auth_private.require_cleanup_provenance();
CREATE CONSTRAINT TRIGGER cleanup_challenge_proof AFTER DELETE ON funding_auth_private.otp_challenges DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_auth_private.require_cleanup_provenance();
CREATE CONSTRAINT TRIGGER cleanup_rate_proof AFTER DELETE ON funding_auth_private.otp_rate_windows DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_auth_private.require_cleanup_provenance();
CREATE CONSTRAINT TRIGGER cleanup_scope_proof AFTER DELETE ON funding_private.quota_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_auth_private.require_cleanup_provenance();
CREATE CONSTRAINT TRIGGER cleanup_alias_proof AFTER DELETE ON funding_private.quota_aliases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_auth_private.require_cleanup_provenance();
REVOKE ALL ON FUNCTION funding_auth_private.require_cleanup_provenance() FROM PUBLIC,anon,authenticated,funding_runtime,funding_review;
GRANT EXECUTE ON FUNCTION funding_auth_private.require_cleanup_provenance() TO funding_cleanup;
