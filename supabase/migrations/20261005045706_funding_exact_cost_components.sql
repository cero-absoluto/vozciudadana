-- Isolated exact-decimal facts and fixture completeness only. No ledger grants or FX.
CREATE ROLE funding_exact_cost_ingest NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE funding_exact_cost_calculator NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA funding_exact_cost_private;
REVOKE ALL ON SCHEMA funding_exact_cost_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA funding_exact_cost_private TO funding_exact_cost_ingest,funding_exact_cost_calculator,funding_review;
CREATE TABLE funding_exact_cost_private.operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_key text UNIQUE NOT NULL CHECK(operation_key~'^synthetic_exact_[a-z0-9_-]{1,96}$'),
 event_ref uuid,purpose text NOT NULL CHECK(purpose IN('event_sms','unassigned')),received_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_exact_cost_private.components(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL REFERENCES funding_exact_cost_private.operations,
 component_ref text UNIQUE NOT NULL CHECK(component_ref~'^synthetic_component_[a-z0-9_-]{1,96}$'),
 kind text NOT NULL CHECK(kind IN('channel_attempt','verification_fee')),source_domain text NOT NULL DEFAULT 'fixture_exact_costs' CHECK(source_domain='fixture_exact_costs'));
CREATE INDEX exact_component_operation_idx ON funding_exact_cost_private.components(operation_id);
CREATE TABLE funding_exact_cost_private.component_revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),component_id uuid NOT NULL REFERENCES funding_exact_cost_private.components,
 source_revision bigint NOT NULL CHECK(source_revision>0 AND source_revision<=9007199254740991),
 source_value text CHECK(source_value~'^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$'),
 amount numeric(30,12),currency text CHECK(currency~'^[A-Z]{3}$'),qualification text NOT NULL CHECK(qualification IN('provisional','final_fixture')),
 evidence_ref uuid NOT NULL,binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((source_value IS NULL AND amount IS NULL AND currency IS NULL AND qualification='provisional') OR (source_value IS NOT NULL AND amount IS NOT NULL AND currency IS NOT NULL AND source_value::numeric=amount AND amount>=0)),UNIQUE(component_id,source_revision));
CREATE TABLE funding_exact_cost_private.conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL REFERENCES funding_exact_cost_private.operations,
 component_ref text NOT NULL,source_revision bigint NOT NULL,kind text NOT NULL,source_value text,currency text,qualification text NOT NULL,
 evidence_ref uuid NOT NULL,binding_digest text NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(operation_id,component_ref,source_revision,binding_digest));
CREATE TABLE funding_exact_cost_private.aggregate_attestations(
 operation_id uuid PRIMARY KEY REFERENCES funding_exact_cost_private.operations,
 snapshot jsonb NOT NULL,manifest jsonb NOT NULL,fee_basis text NOT NULL CHECK(fee_basis IN('required','not_applicable')),
 evidence_ref uuid NOT NULL,binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['operations','components','component_revisions','conflicts','aggregate_attestations'] LOOP
 EXECUTE format('ALTER TABLE funding_exact_cost_private.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON funding_exact_cost_private.%I FROM PUBLIC,anon,authenticated',tab);
 EXECUTE format('CREATE TRIGGER exact_immutable BEFORE UPDATE OR DELETE ON funding_exact_cost_private.%I FOR EACH ROW EXECUTE FUNCTION funding_private.immutable()',tab);
 EXECUTE format('CREATE POLICY exact_calculator_read ON funding_exact_cost_private.%I FOR SELECT TO funding_exact_cost_calculator USING(true)',tab);
 EXECUTE format('GRANT SELECT ON funding_exact_cost_private.%I TO funding_exact_cost_calculator',tab);
 IF tab<>'aggregate_attestations' THEN
 EXECUTE format('CREATE POLICY exact_ingest ON funding_exact_cost_private.%I TO funding_exact_cost_ingest USING(true) WITH CHECK(true)',tab);
 EXECUTE format('GRANT SELECT,INSERT ON funding_exact_cost_private.%I TO funding_exact_cost_ingest',tab);
 END IF;
 END LOOP;
END $$;
GRANT INSERT ON funding_exact_cost_private.aggregate_attestations TO funding_exact_cost_calculator;
CREATE POLICY exact_attest_insert ON funding_exact_cost_private.aggregate_attestations FOR INSERT TO funding_exact_cost_calculator WITH CHECK(true);
CREATE POLICY exact_review_read ON funding_exact_cost_private.component_revisions FOR SELECT TO funding_review USING(true);
GRANT SELECT(id,component_id,source_revision,amount,currency,qualification,evidence_ref,received_at) ON funding_exact_cost_private.component_revisions TO funding_review;
CREATE FUNCTION funding_exact_cost_private.actor(p_role text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF p_role NOT IN('funding_exact_cost_ingest','funding_exact_cost_calculator') OR NOT pg_has_role(current_user,p_role,'MEMBER') OR pg_has_role(current_user,'funding_runtime','MEMBER') OR pg_has_role(current_user,'service_role','MEMBER') OR pg_has_role(current_user,'funding_review','MEMBER') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='funding_owner_enrollment' AND pg_has_role(current_user,oid,'MEMBER')) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'exact_actor_required';END IF;
END $$;
CREATE FUNCTION funding_exact_cost_private.open_operation(p_key text,p_event uuid,p_purpose text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_exact_cost_private AS $$
DECLARE op operations;BEGIN
 PERFORM actor('funding_exact_cost_ingest');
 IF p_key IS NULL OR p_key!~'^synthetic_exact_[a-z0-9_-]{1,96}$' OR p_purpose IS NULL OR p_purpose NOT IN('event_sms','unassigned') THEN RAISE EXCEPTION 'invalid_exact_operation';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('exact:operation:'||p_key,0));SELECT * INTO op FROM operations WHERE operation_key=p_key;
 IF FOUND THEN IF op.event_ref IS DISTINCT FROM p_event OR op.purpose<>p_purpose THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN op.id;END IF;
 INSERT INTO operations(operation_key,event_ref,purpose) VALUES(p_key,p_event,p_purpose) RETURNING id INTO op.id;RETURN op.id;
END $$;
CREATE FUNCTION funding_exact_cost_private.receive(p_op uuid,p_ref text,p_kind text,p_revision bigint,p_value text,p_currency text,p_qualification text,p_evidence uuid,p_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_exact_cost_private AS $$
DECLARE comp components;prior component_revisions;rid uuid;BEGIN
 PERFORM actor('funding_exact_cost_ingest');
 IF p_op IS NULL OR p_ref IS NULL OR p_ref!~'^synthetic_component_[a-z0-9_-]{1,96}$' OR p_kind IS NULL OR p_kind NOT IN('channel_attempt','verification_fee') OR p_revision IS NULL OR p_revision<=0 OR p_revision>9007199254740991 OR p_qualification IS NULL OR p_qualification NOT IN('provisional','final_fixture') OR p_evidence IS NULL OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' OR (p_value IS NULL AND (p_currency IS NOT NULL OR p_qualification<>'provisional')) OR (p_value IS NOT NULL AND (p_value!~'^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$' OR p_currency IS NULL OR p_currency!~'^[A-Z]{3}$')) THEN RAISE EXCEPTION 'invalid_exact_fact';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('exact:aggregate:'||p_op,0));
 IF NOT EXISTS(SELECT 1 FROM operations WHERE id=p_op) THEN RAISE EXCEPTION 'unknown_exact_operation';END IF;
 -- A component belongs to one operation; global reference uniqueness also serializes cross-operation collisions.
 PERFORM pg_advisory_xact_lock(hashtextextended('exact:component:'||p_ref,0));
 SELECT * INTO comp FROM components WHERE component_ref=p_ref;
 IF FOUND AND comp.operation_id<>p_op THEN RAISE EXCEPTION 'component_scope_conflict';END IF;
 IF NOT FOUND THEN INSERT INTO components(operation_id,component_ref,kind) VALUES(p_op,p_ref,p_kind) RETURNING * INTO comp;END IF;
 SELECT * INTO prior FROM component_revisions WHERE component_id=comp.id AND source_revision=p_revision;
 IF comp.kind<>p_kind OR (FOUND AND (prior.amount IS DISTINCT FROM p_value::numeric OR prior.currency IS DISTINCT FROM p_currency OR prior.qualification<>p_qualification OR prior.evidence_ref<>p_evidence OR prior.binding_digest<>p_digest)) THEN
 INSERT INTO conflicts(operation_id,component_ref,source_revision,kind,source_value,currency,qualification,evidence_ref,binding_digest) VALUES(p_op,p_ref,p_revision,p_kind,p_value,p_currency,p_qualification,p_evidence,p_digest) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('outcome','conflict');END IF;
 IF FOUND THEN RETURN jsonb_build_object('outcome','duplicate','revisionId',prior.id);END IF;
 INSERT INTO component_revisions(component_id,source_revision,source_value,amount,currency,qualification,evidence_ref,binding_digest) VALUES(comp.id,p_revision,p_value,p_value::numeric,p_currency,p_qualification,p_evidence,p_digest) RETURNING id INTO rid;
 RETURN jsonb_build_object('outcome','received','revisionId',rid);
END $$;
CREATE FUNCTION funding_exact_cost_private.snapshot(p_op uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_exact_cost_private AS $$
DECLARE op operations;body jsonb;totals jsonb;complete boolean;status text;att aggregate_attestations;BEGIN
 PERFORM actor('funding_exact_cost_calculator');PERFORM pg_advisory_xact_lock(hashtextextended('exact:aggregate:'||p_op,0));SELECT * INTO op FROM operations WHERE id=p_op;IF NOT FOUND THEN RAISE EXCEPTION 'unknown_exact_operation';END IF;
 WITH current AS(SELECT c.component_ref,c.kind,r.* FROM components c JOIN LATERAL(SELECT * FROM component_revisions WHERE component_id=c.id ORDER BY source_revision DESC LIMIT 1)r ON true WHERE c.operation_id=p_op)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('reference',component_ref,'kind',kind,'revision',source_revision,'value',CASE WHEN amount IS NULL THEN NULL ELSE trim_scale(amount)::text END,'currency',currency,'qualification',qualification) ORDER BY component_ref),'[]'::jsonb),COALESCE(bool_and(amount IS NOT NULL AND qualification='final_fixture'),false) INTO body,complete FROM current;
 WITH current AS(SELECT r.* FROM components c JOIN LATERAL(SELECT * FROM component_revisions WHERE component_id=c.id ORDER BY source_revision DESC LIMIT 1)r ON true WHERE c.operation_id=p_op),grouped AS(SELECT currency,trim_scale(sum(amount))::text AS value FROM current WHERE amount IS NOT NULL GROUP BY currency)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('currency',currency,'value',value) ORDER BY currency),'[]'::jsonb) INTO totals FROM grouped;
 status:=CASE WHEN EXISTS(SELECT 1 FROM conflicts WHERE operation_id=p_op) THEN 'review' ELSE 'provisional' END;
 body:=jsonb_build_object('operationId',p_op,'eventRef',op.event_ref,'purpose',op.purpose,'components',body,'totals',totals,'qualifiedComponents',complete,'status',status);
 SELECT * INTO att FROM aggregate_attestations WHERE operation_id=p_op;
 IF FOUND THEN body:=body||jsonb_build_object('status',CASE WHEN att.snapshot=body THEN 'completed_fixture' ELSE 'review' END);END IF;
 RETURN body;
END $$;
CREATE FUNCTION funding_exact_cost_private.attest(p_op uuid,p_snapshot jsonb,p_manifest jsonb,p_fee_basis text,p_evidence uuid,p_digest text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_exact_cost_private AS $$
DECLARE current jsonb;actual_refs jsonb;fees int;prior aggregate_attestations;BEGIN
 PERFORM actor('funding_exact_cost_calculator');PERFORM pg_advisory_xact_lock(hashtextextended('exact:aggregate:'||p_op,0));current:=snapshot(p_op);
 SELECT * INTO prior FROM aggregate_attestations WHERE operation_id=p_op;
 IF FOUND THEN IF prior.snapshot=p_snapshot AND prior.manifest=p_manifest AND prior.fee_basis=p_fee_basis AND prior.evidence_ref=p_evidence AND prior.binding_digest=p_digest THEN RETURN CASE WHEN current->>'status'='completed_fixture' THEN 'duplicate' ELSE 'review' END;END IF;RETURN 'review';END IF;
 IF p_snapshot IS NULL OR p_snapshot<>current THEN RAISE EXCEPTION 'exact_stale_binding';END IF;
 SELECT COALESCE(jsonb_agg(x->'reference' ORDER BY x->>'reference'),'[]'::jsonb),count(*) FILTER(WHERE x->>'kind'='verification_fee') INTO actual_refs,fees FROM jsonb_array_elements(current->'components')x;
 IF p_manifest IS NULL OR p_manifest<>actual_refs OR p_fee_basis IS NULL OR p_fee_basis NOT IN('required','not_applicable') OR (p_fee_basis='required' AND fees<>1) OR (p_fee_basis='not_applicable' AND fees<>0) OR NOT(current->>'qualifiedComponents')::boolean OR current->>'status'<>'provisional' OR current->>'eventRef' IS NULL OR current->>'purpose'<>'event_sms' OR jsonb_array_length(actual_refs)=0 OR p_evidence IS NULL OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'exact_incomplete';END IF;
 INSERT INTO aggregate_attestations VALUES(p_op,p_snapshot,p_manifest,p_fee_basis,p_evidence,p_digest,clock_timestamp());RETURN 'completed_fixture';
END $$;
DO $$ DECLARE fn record;BEGIN
 FOR fn IN SELECT oid,proname FROM pg_proc WHERE pronamespace='funding_exact_cost_private'::regnamespace LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,funding_runtime,funding_review',fn.oid::regprocedure);
 IF fn.proname IN('actor','open_operation','receive') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO funding_exact_cost_ingest',fn.oid::regprocedure);END IF;
 IF fn.proname IN('actor','snapshot','attest') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO funding_exact_cost_calculator',fn.oid::regprocedure);END IF;
 END LOOP;
END $$;
