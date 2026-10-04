-- Synthetic legacy intake only: receiving a notice never allocates or verifies a payment.
CREATE ROLE funding_legacy_receipt_ingest NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA funding_legacy_receipt_private;
REVOKE ALL ON SCHEMA funding_legacy_receipt_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA funding_legacy_receipt_private TO funding_legacy_receipt_ingest,funding_review;
CREATE TABLE funding_legacy_receipt_private.operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL CHECK(provider='fixture_kofi'),
 cohort text NOT NULL CHECK(cohort='synthetic_legacy_notice_v1'),
 source_domain text NOT NULL CHECK(source_domain='fixture_legacy_receipts'),
 operation_ref text NOT NULL CHECK(operation_ref~'^synthetic_legacy_[a-z0-9_-]{1,96}$'),
 amount_cents bigint NOT NULL CHECK(amount_cents>0 AND amount_cents<=9007199254740991),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 claimed_effective_at timestamptz,claimed_event uuid,
 binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),
 evidence_ref uuid NOT NULL,
 authentication_evidence text NOT NULL CHECK(authentication_evidence='fixture_shared_token_check'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 allocation text NOT NULL DEFAULT 'review' CHECK(allocation='review'),
 UNIQUE(provider,cohort,source_domain,operation_ref));
CREATE TABLE funding_legacy_receipt_private.conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL REFERENCES funding_legacy_receipt_private.operations,
 amount_cents bigint NOT NULL CHECK(amount_cents>0 AND amount_cents<=9007199254740991),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 claimed_effective_at timestamptz,claimed_event uuid,
 binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),evidence_ref uuid NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(operation_id,binding_digest));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['operations','conflicts'] LOOP
 EXECUTE format('ALTER TABLE funding_legacy_receipt_private.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON funding_legacy_receipt_private.%I FROM PUBLIC,anon,authenticated',tab);
 EXECUTE format('CREATE POLICY receipt_ingest_read ON funding_legacy_receipt_private.%I FOR SELECT TO funding_legacy_receipt_ingest USING(true)',tab);
 EXECUTE format('CREATE POLICY receipt_ingest_insert ON funding_legacy_receipt_private.%I FOR INSERT TO funding_legacy_receipt_ingest WITH CHECK(true)',tab);
 EXECUTE format('CREATE POLICY receipt_review_read ON funding_legacy_receipt_private.%I FOR SELECT TO funding_review USING(true)',tab);
 EXECUTE format('GRANT SELECT,INSERT ON funding_legacy_receipt_private.%I TO funding_legacy_receipt_ingest',tab);
 EXECUTE format('CREATE TRIGGER receipt_immutable BEFORE UPDATE OR DELETE ON funding_legacy_receipt_private.%I FOR EACH ROW EXECUTE FUNCTION funding_private.immutable()',tab);
 END LOOP;
END $$;
GRANT SELECT(id,amount_cents,currency,claimed_effective_at,claimed_event,evidence_ref,received_at,allocation) ON funding_legacy_receipt_private.operations TO funding_review;
GRANT SELECT(id,operation_id,amount_cents,currency,claimed_effective_at,claimed_event,evidence_ref,received_at) ON funding_legacy_receipt_private.conflicts TO funding_review;
CREATE FUNCTION funding_legacy_receipt_private.receive(p_ref text,p_amount bigint,p_currency text,p_effective timestamptz,p_event uuid,p_digest text,p_evidence uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_legacy_receipt_private AS $$
DECLARE prior operations; clash conflicts; receipt uuid; conflict_id uuid; BEGIN
 IF NOT pg_has_role(current_user,'funding_legacy_receipt_ingest','MEMBER') OR pg_has_role(current_user,'funding_runtime','MEMBER') OR pg_has_role(current_user,'funding_review','MEMBER') OR pg_has_role(current_user,'service_role','MEMBER') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'legacy_receipt_actor_required';END IF;
 IF p_ref IS NULL OR p_ref!~'^synthetic_legacy_[a-z0-9_-]{1,96}$' OR p_amount IS NULL OR p_amount<=0 OR p_amount>9007199254740991 OR p_currency IS NULL OR p_currency!~'^[A-Z]{3}$' OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' OR p_evidence IS NULL THEN RAISE EXCEPTION 'invalid_legacy_receipt';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fixture_legacy_receipts:synthetic_legacy_notice_v1:'||p_ref,0));
 SELECT * INTO prior FROM operations WHERE provider='fixture_kofi' AND cohort='synthetic_legacy_notice_v1' AND source_domain='fixture_legacy_receipts' AND operation_ref=p_ref;
 IF NOT FOUND THEN
 INSERT INTO operations(provider,cohort,source_domain,operation_ref,amount_cents,currency,claimed_effective_at,claimed_event,binding_digest,evidence_ref,authentication_evidence)
 VALUES('fixture_kofi','synthetic_legacy_notice_v1','fixture_legacy_receipts',p_ref,p_amount,p_currency,p_effective,p_event,p_digest,p_evidence,'fixture_shared_token_check') RETURNING id INTO receipt;
 RETURN jsonb_build_object('receiptId',receipt,'outcome','received','allocation','review','fundsMoved',false,'paymentVerified',false);
 END IF;
 IF prior.amount_cents=p_amount AND prior.currency=p_currency AND prior.claimed_effective_at IS NOT DISTINCT FROM p_effective AND prior.claimed_event IS NOT DISTINCT FROM p_event AND prior.binding_digest=p_digest AND prior.evidence_ref=p_evidence THEN
 RETURN jsonb_build_object('receiptId',prior.id,'outcome','duplicate','allocation','review','fundsMoved',false,'paymentVerified',false);
 END IF;
 IF prior.binding_digest=p_digest THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
 SELECT * INTO clash FROM conflicts WHERE operation_id=prior.id AND binding_digest=p_digest;
 IF FOUND THEN
 IF clash.amount_cents<>p_amount OR clash.currency<>p_currency OR clash.claimed_effective_at IS DISTINCT FROM p_effective OR clash.claimed_event IS DISTINCT FROM p_event OR clash.evidence_ref<>p_evidence THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
 conflict_id:=clash.id;
 ELSE
 INSERT INTO conflicts(operation_id,amount_cents,currency,claimed_effective_at,claimed_event,binding_digest,evidence_ref) VALUES(prior.id,p_amount,p_currency,p_effective,p_event,p_digest,p_evidence) RETURNING id INTO conflict_id;
 END IF;
 RETURN jsonb_build_object('receiptId',prior.id,'conflictId',conflict_id,'outcome','conflict','allocation','review','fundsMoved',false,'paymentVerified',false);
END $$;
REVOKE ALL ON FUNCTION funding_legacy_receipt_private.receive(text,bigint,text,timestamptz,uuid,text,uuid) FROM PUBLIC,anon,authenticated,funding_runtime,funding_review;
GRANT EXECUTE ON FUNCTION funding_legacy_receipt_private.receive(text,bigint,text,timestamptz,uuid,text,uuid) TO funding_legacy_receipt_ingest;
-- No finance role can read or assign this receipt; raw ingest DML remains a trusted journal boundary.
