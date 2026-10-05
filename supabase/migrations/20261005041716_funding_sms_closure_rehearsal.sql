-- Owner-approved isolated rehearsal; no production transport, jobs or historical imports.
CREATE ROLE funding_sms_executor NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE funding_sms_evidence_ingest NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE SCHEMA funding_sms_fixture_private;
REVOKE ALL ON SCHEMA funding_sms_fixture_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA funding_sms_fixture_private TO funding_sms_executor,funding_sms_evidence_ingest,funding_review;
GRANT USAGE ON SCHEMA funding_private TO funding_sms_executor;
CREATE TABLE funding_sms_fixture_private.operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES public.protests,
 operation_key text UNIQUE NOT NULL CHECK(operation_key~'^synthetic_sms_[a-z0-9_-]{1,96}$'),
 bound_cents bigint NOT NULL CHECK(bound_cents>0 AND bound_cents<=9007199254740991),
 currency text NOT NULL CHECK(currency='EUR'),provider text NOT NULL DEFAULT 'fixture_sms' CHECK(provider='fixture_sms'),
 purpose text NOT NULL DEFAULT 'event_sms' CHECK(purpose='event_sms'),
 reservation_id uuid UNIQUE NOT NULL REFERENCES funding_private.cost_reservations,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX sms_operation_event_idx ON funding_sms_fixture_private.operations(event_id);
CREATE TABLE funding_sms_fixture_private.execution(
 operation_id uuid PRIMARY KEY REFERENCES funding_sms_fixture_private.operations,
 state text NOT NULL CHECK(state IN('prepared','dispatching','accepted','unknown','review','charged','cancelled')),
 claim_id uuid,allocation_id uuid UNIQUE REFERENCES funding_private.ledger_transactions);
CREATE TABLE funding_sms_fixture_private.facts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL REFERENCES funding_sms_fixture_private.operations,
 reference text NOT NULL CHECK(reference~'^synthetic_sms_fact_[a-z0-9_-]{1,96}$'),
 kind text NOT NULL CHECK(kind IN('accepted','failed','unknown','priced','no_charge')),
 amount_cents bigint,currency text,evidence_ref uuid NOT NULL,binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='priced' AND amount_cents IS NOT NULL AND currency IS NOT NULL AND amount_cents>0 AND amount_cents<=9007199254740991 AND currency~'^[A-Z]{3}$') OR (kind<>'priced' AND amount_cents IS NULL AND currency IS NULL)),
 UNIQUE(operation_id,reference));
CREATE TABLE funding_sms_fixture_private.conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL REFERENCES funding_sms_fixture_private.operations,
 reference text NOT NULL,kind text NOT NULL,amount_cents bigint,currency text,evidence_ref uuid NOT NULL,binding_digest text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(operation_id,reference,binding_digest));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['operations','execution','facts','conflicts'] LOOP
 EXECUTE format('ALTER TABLE funding_sms_fixture_private.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON funding_sms_fixture_private.%I FROM PUBLIC,anon,authenticated',tab);
 EXECUTE format('CREATE POLICY sms_executor ON funding_sms_fixture_private.%I TO funding_sms_executor USING(true) WITH CHECK(true)',tab);
 EXECUTE format('GRANT SELECT ON funding_sms_fixture_private.%I TO funding_sms_executor',tab);
 IF tab<>'execution' THEN EXECUTE format('CREATE TRIGGER sms_immutable BEFORE UPDATE OR DELETE ON funding_sms_fixture_private.%I FOR EACH ROW EXECUTE FUNCTION funding_private.immutable()',tab); END IF;
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['facts','conflicts'] LOOP
 EXECUTE format('CREATE POLICY sms_ingest ON funding_sms_fixture_private.%I TO funding_sms_evidence_ingest USING(true) WITH CHECK(true)',tab);
 EXECUTE format('GRANT SELECT,INSERT ON funding_sms_fixture_private.%I TO funding_sms_evidence_ingest',tab);
 EXECUTE format('CREATE POLICY sms_review ON funding_sms_fixture_private.%I FOR SELECT TO funding_review USING(true)',tab);
 END LOOP;
END $$;
GRANT INSERT ON funding_sms_fixture_private.operations TO funding_sms_executor;
GRANT INSERT,UPDATE ON funding_sms_fixture_private.execution TO funding_sms_executor;
CREATE POLICY sms_ingest_operation ON funding_sms_fixture_private.operations FOR SELECT TO funding_sms_evidence_ingest USING(true);
GRANT SELECT(id) ON funding_sms_fixture_private.operations TO funding_sms_evidence_ingest;
GRANT SELECT(id,operation_id,kind,amount_cents,currency,evidence_ref,received_at) ON funding_sms_fixture_private.facts TO funding_review;
GRANT SELECT(id,operation_id,kind,amount_cents,currency,evidence_ref,received_at) ON funding_sms_fixture_private.conflicts TO funding_review;
-- Minimum existing-core dependencies; no annual/event donor tokens or Owner enrollment grants.
GRANT SELECT,UPDATE ON funding_private.accounts,funding_private.cost_reservations TO funding_sms_executor;
GRANT SELECT,INSERT ON funding_private.ledger_transactions,funding_private.ledger_entries,funding_private.settlements TO funding_sms_executor;
GRANT SELECT ON funding_private.fee_reservations,funding_private.refund_reservations,funding_private.provider_movements,funding_private.movement_allocations TO funding_sms_executor;
GRANT SELECT(id,event_id,state) ON funding_private.intents TO funding_sms_executor;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['accounts','cost_reservations','ledger_transactions','ledger_entries','settlements','fee_reservations','refund_reservations','provider_movements','movement_allocations','intents'] LOOP
 EXECUTE format('CREATE POLICY sms_core_access ON funding_private.%I TO funding_sms_executor USING(true) WITH CHECK(true)',tab);
 END LOOP;
END $$;
GRANT INSERT ON funding_private.cost_reservations TO funding_sms_executor;
GRANT SELECT ON public.protests TO funding_sms_executor;
GRANT UPDATE(id) ON public.protests TO funding_sms_executor;
CREATE POLICY sms_parent_lock ON public.protests FOR UPDATE TO funding_sms_executor USING(true) WITH CHECK(true);
GRANT EXECUTE ON FUNCTION funding_private.reserve_cost(uuid,bigint,text),funding_private.finish_cost(uuid,boolean),funding_private.available_operational(text,uuid,text),funding_private.has_pending_exposure(),funding_private.close_event(uuid),funding_private.settle(uuid) TO funding_sms_executor;
CREATE FUNCTION funding_sms_fixture_private.actor(p_role text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF p_role NOT IN('funding_sms_executor','funding_sms_evidence_ingest') OR NOT pg_has_role(current_user,p_role,'MEMBER') OR pg_has_role(current_user,'service_role','MEMBER') OR pg_has_role(current_user,'funding_runtime','MEMBER') OR pg_has_role(current_user,'funding_review','MEMBER') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='funding_owner_enrollment' AND pg_has_role(current_user,oid,'MEMBER')) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'sms_actor_required';END IF;
END $$;
CREATE FUNCTION funding_sms_fixture_private.prepare(p_event uuid,p_key text,p_bound bigint,p_currency text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_fixture_private AS $$
DECLARE op operations; hold uuid; BEGIN
 PERFORM actor('funding_sms_executor');
 IF p_key IS NULL OR p_key!~'^synthetic_sms_[a-z0-9_-]{1,96}$' OR p_bound IS NULL OR p_bound<=0 OR p_bound>9007199254740991 OR p_currency IS DISTINCT FROM 'EUR' THEN RAISE EXCEPTION 'invalid_sms_operation';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO op FROM operations WHERE operation_key=p_key;
 IF FOUND THEN IF op.event_id<>p_event OR op.bound_cents<>p_bound OR op.currency<>p_currency THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
 RETURN jsonb_build_object('operationId',op.id,'duplicate',true);END IF;
 hold:=funding_private.reserve_cost(p_event,p_bound,'sms-fixture:'||p_key);
 INSERT INTO operations(event_id,operation_key,bound_cents,currency,reservation_id) VALUES(p_event,p_key,p_bound,p_currency,hold) RETURNING * INTO op;
 INSERT INTO execution VALUES(op.id,'prepared',NULL,NULL);
 RETURN jsonb_build_object('operationId',op.id,'duplicate',false);
END $$;
CREATE FUNCTION funding_sms_fixture_private.claim(p_op uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_fixture_private AS $$
DECLARE op operations; ex execution; BEGIN
 PERFORM actor('funding_sms_executor');PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO op FROM operations WHERE id=p_op;IF NOT FOUND THEN RAISE EXCEPTION 'unknown_sms_operation';END IF;
 PERFORM 1 FROM public.protests WHERE id=op.event_id FOR UPDATE;
 SELECT * INTO ex FROM execution WHERE operation_id=p_op;
 IF ex.state<>'prepared' THEN RETURN jsonb_build_object('claimed',false,'state',ex.state);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.protests p JOIN funding_private.accounts a ON a.event_id=p.id WHERE p.id=op.event_id AND a.state='open' AND p.starts_at<=clock_timestamp() AND p.ends_at>clock_timestamp()) THEN RAISE EXCEPTION 'sms_dispatch_closed';END IF;
 UPDATE execution SET state='dispatching',claim_id=gen_random_uuid() WHERE operation_id=p_op;
 RETURN jsonb_build_object('claimed',true,'state','dispatching');
END $$;
CREATE FUNCTION funding_sms_fixture_private.receive(p_op uuid,p_ref text,p_kind text,p_amount bigint,p_currency text,p_evidence uuid,p_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_fixture_private AS $$
DECLARE prior facts; fid uuid; BEGIN
 PERFORM actor('funding_sms_evidence_ingest');
 IF p_ref IS NULL OR p_ref!~'^synthetic_sms_fact_[a-z0-9_-]{1,96}$' OR p_kind IS NULL OR p_kind NOT IN('accepted','failed','unknown','priced','no_charge') OR p_evidence IS NULL OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' OR (p_kind='priced' AND (p_amount IS NULL OR p_amount<=0 OR p_amount>9007199254740991 OR p_currency IS NULL OR p_currency!~'^[A-Z]{3}$')) OR (p_kind<>'priced' AND (p_amount IS NOT NULL OR p_currency IS NOT NULL)) THEN RAISE EXCEPTION 'invalid_sms_fact';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 IF NOT EXISTS(SELECT id FROM operations WHERE id=p_op) THEN RAISE EXCEPTION 'unknown_sms_operation';END IF;
 SELECT * INTO prior FROM facts WHERE operation_id=p_op AND reference=p_ref;
 IF FOUND THEN
 IF prior.kind=p_kind AND prior.amount_cents IS NOT DISTINCT FROM p_amount AND prior.currency IS NOT DISTINCT FROM p_currency AND prior.evidence_ref=p_evidence AND prior.binding_digest=p_digest THEN RETURN jsonb_build_object('outcome','duplicate','factId',prior.id);END IF;
 IF prior.binding_digest=p_digest THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
 INSERT INTO conflicts(operation_id,reference,kind,amount_cents,currency,evidence_ref,binding_digest) VALUES(p_op,p_ref,p_kind,p_amount,p_currency,p_evidence,p_digest) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('outcome','conflict','factId',prior.id);
 END IF;
 INSERT INTO facts(operation_id,reference,kind,amount_cents,currency,evidence_ref,binding_digest) VALUES(p_op,p_ref,p_kind,p_amount,p_currency,p_evidence,p_digest) RETURNING id INTO fid;
 RETURN jsonb_build_object('outcome','received','factId',fid);
END $$;
CREATE FUNCTION funding_sms_fixture_private.project(p_op uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_fixture_private AS $$
DECLARE op operations; priced facts; result text; BEGIN
 PERFORM actor('funding_sms_executor');PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO op FROM operations WHERE id=p_op;IF NOT FOUND THEN RAISE EXCEPTION 'unknown_sms_operation';END IF;
 PERFORM 1 FROM public.protests WHERE id=op.event_id FOR UPDATE;
 PERFORM 1 FROM funding_private.accounts WHERE id IN('event:'||op.event_id,'verification_cost') ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM conflicts WHERE operation_id=p_op) OR (SELECT count(DISTINCT (amount_cents,currency)) FROM facts WHERE operation_id=p_op AND kind='priced')>1 OR (EXISTS(SELECT 1 FROM facts WHERE operation_id=p_op AND kind='priced') AND EXISTS(SELECT 1 FROM facts WHERE operation_id=p_op AND kind='no_charge')) THEN UPDATE execution SET state='review' WHERE operation_id=p_op;RETURN 'review';END IF;
 IF EXISTS(SELECT 1 FROM execution WHERE operation_id=p_op AND claim_id IS NULL) AND NOT EXISTS(SELECT 1 FROM facts WHERE operation_id=p_op AND kind='no_charge') THEN UPDATE execution SET state='review' WHERE operation_id=p_op;RETURN 'review';END IF;
 SELECT * INTO priced FROM facts WHERE operation_id=p_op AND kind='priced' ORDER BY received_at,id LIMIT 1;
 IF FOUND THEN
 IF priced.currency<>op.currency OR priced.amount_cents>op.bound_cents THEN UPDATE execution SET state='review' WHERE operation_id=p_op;RETURN 'review';END IF;
 IF (SELECT state FROM funding_private.cost_reservations WHERE id=op.reservation_id)='reserved' THEN UPDATE funding_private.cost_reservations SET amount=priced.amount_cents WHERE id=op.reservation_id;END IF;
 result:=funding_private.finish_cost(op.reservation_id,true);
 UPDATE execution SET state=result,allocation_id=(SELECT id FROM funding_private.ledger_transactions WHERE operation_key='cost:'||op.reservation_id) WHERE operation_id=p_op;RETURN result;
 END IF;
 IF EXISTS(SELECT 1 FROM facts WHERE operation_id=p_op AND kind='no_charge') THEN result:=funding_private.finish_cost(op.reservation_id,false);UPDATE execution SET state=result WHERE operation_id=p_op;RETURN result;END IF;
 result:=CASE WHEN EXISTS(SELECT 1 FROM facts WHERE operation_id=p_op AND kind='accepted') AND NOT EXISTS(SELECT 1 FROM facts WHERE operation_id=p_op AND kind IN('unknown','failed')) THEN 'accepted' ELSE 'unknown' END;
 UPDATE execution SET state=result WHERE operation_id=p_op;RETURN result;
END $$;
CREATE FUNCTION funding_sms_fixture_private.close(p_event uuid,p_settle boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_sms_fixture_private AS $$
DECLARE surplus bigint; BEGIN
 PERFORM actor('funding_sms_executor');IF p_settle IS NULL THEN RAISE EXCEPTION 'invalid_sms_operation';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 PERFORM funding_private.close_event(p_event);
 IF p_settle THEN
 IF EXISTS(SELECT 1 FROM operations o JOIN execution e ON e.operation_id=o.id WHERE o.event_id=p_event AND e.state NOT IN('charged','cancelled')) OR EXISTS(SELECT 1 FROM conflicts c JOIN operations o ON o.id=c.operation_id WHERE o.event_id=p_event) THEN RAISE EXCEPTION 'sms_pending_items';END IF;
 surplus:=funding_private.settle(p_event);
 END IF;
 RETURN jsonb_build_object('closed',true,'settled',p_settle,'surplusCents',surplus,'finalsChanged',false);
END $$;
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT oid,proname FROM pg_proc WHERE pronamespace='funding_sms_fixture_private'::regnamespace LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,funding_runtime,funding_review',fn.oid::regprocedure);
 IF fn.proname IN('actor','receive') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO funding_sms_evidence_ingest',fn.oid::regprocedure);END IF;
 IF fn.proname<>'receive' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO funding_sms_executor',fn.oid::regprocedure);END IF;
 END LOOP;
END $$;
-- Executors' raw DML/core RPC grants are trusted rehearsal boundaries, not hostile-operator containment.
