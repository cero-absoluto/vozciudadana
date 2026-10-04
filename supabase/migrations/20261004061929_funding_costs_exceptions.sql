-- Owner-approved policy; isolated synthetic implementation only. No PSP writes.
CREATE TABLE funding_private.fee_reservations (
 intent_id uuid PRIMARY KEY REFERENCES funding_private.intents,
 bound bigint NOT NULL CHECK(bound>=0),state text NOT NULL DEFAULT 'held' CHECK(state IN('held','final','released')));
CREATE TABLE funding_private.financial_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_ref text NOT NULL UNIQUE,
 action text NOT NULL CHECK(action IN('refund_authorize','cover_exposure')),
 intent_id uuid NOT NULL REFERENCES funding_private.intents,amount bigint NOT NULL CHECK(amount>0),
 source_account text NOT NULL REFERENCES funding_private.accounts,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_private.financial_decision_revocations (
 decision_id uuid PRIMARY KEY REFERENCES funding_private.financial_review_decisions,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_private.refund_reservations (
 operation_ref text PRIMARY KEY REFERENCES funding_private.financial_review_decisions(operation_ref),
 decision_id uuid NOT NULL UNIQUE REFERENCES funding_private.financial_review_decisions,
 intent_id uuid NOT NULL REFERENCES funding_private.intents,source_account text NOT NULL REFERENCES funding_private.accounts,
 amount bigint NOT NULL CHECK(amount>0),state text NOT NULL DEFAULT 'held' CHECK(state IN('held','consumed','released')),
 authorized_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_private.provider_movements (
 movement_ref text PRIMARY KEY CHECK(length(movement_ref) BETWEEN 1 AND 128),
 claimed_intent uuid NOT NULL,kind text NOT NULL CHECK(length(kind) BETWEEN 1 AND 64),
 amount bigint NOT NULL,currency text NOT NULL CHECK(length(currency) BETWEEN 1 AND 12),
 operation_ref text,related_ref text,effective_at timestamptz,received_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE funding_private.movement_allocations (
 movement_ref text PRIMARY KEY REFERENCES funding_private.provider_movements,
 source_account text REFERENCES funding_private.accounts,transaction_id uuid REFERENCES funding_private.ledger_transactions,
 decision_id uuid UNIQUE REFERENCES funding_private.financial_review_decisions,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX provider_movement_intent_idx ON funding_private.provider_movements(claimed_intent);
CREATE INDEX provider_movement_related_idx ON funding_private.provider_movements(related_ref);
ALTER TABLE funding_private.ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE funding_private.ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check CHECK(kind IN('contribution','verification_cost','surplus','grant','provider_fee','refund','dispute','compensation'));
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['financial_review_decisions','financial_decision_revocations','provider_movements','movement_allocations'] LOOP
  EXECUTE format('CREATE TRIGGER costs_immutable BEFORE UPDATE OR DELETE ON funding_private.%I FOR EACH ROW EXECUTE FUNCTION funding_private.immutable()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['fee_reservations','financial_review_decisions','financial_decision_revocations','refund_reservations','provider_movements','movement_allocations'] LOOP
  EXECUTE format('ALTER TABLE funding_private.%I ENABLE ROW LEVEL SECURITY',name);
  IF name IN('financial_review_decisions','financial_decision_revocations') THEN
   EXECUTE format('CREATE POLICY costs_owner_decisions_read ON funding_private.%I FOR SELECT TO funding_runtime USING(true)',name);
   EXECUTE format('GRANT SELECT ON funding_private.%I TO funding_runtime',name);
  ELSE
   EXECUTE format('CREATE POLICY costs_runtime ON funding_private.%I TO funding_runtime USING(true) WITH CHECK(true)',name);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON funding_private.%I TO funding_runtime',name);
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION funding_private.has_pending_exposure() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
 SELECT EXISTS(SELECT 1 FROM provider_movements m WHERE amount<0 AND NOT EXISTS(SELECT 1 FROM movement_allocations a WHERE a.movement_ref=m.movement_ref))
$$;
CREATE FUNCTION funding_private.available_operational(p_account text,p_ignore_fee uuid DEFAULT NULL,p_ignore_refund text DEFAULT NULL) RETURNS bigint
 LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
 SELECT a.balance
  -CASE WHEN a.id='general' THEN COALESCE((SELECT sum(bound) FROM fee_reservations f WHERE state='held' AND (p_ignore_fee IS NULL OR intent_id<>p_ignore_fee)),0) ELSE 0 END
  -COALESCE((SELECT sum(amount) FROM refund_reservations r WHERE state='held' AND source_account=a.id AND (p_ignore_refund IS NULL OR operation_ref<>p_ignore_refund)),0)
  -COALESCE((SELECT sum(c.amount) FROM cost_reservations c WHERE c.event_id=a.event_id AND state='reserved'),0)
 FROM accounts a WHERE id=p_account
$$;
CREATE FUNCTION funding_private.reserve_with_fee_v3(p_year int,p_annual text,p_event_token text,p_event uuid,p_amount bigint,p_minimum_seconds int,p_bound bigint,p_bound_known boolean) RETURNS uuid
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE new_intent uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 IF p_bound_known IS DISTINCT FROM true OR p_bound IS NULL OR p_bound<0 THEN RAISE EXCEPTION 'fee_bound_required';END IF;
 IF funding_private.has_pending_exposure() THEN RAISE EXCEPTION 'financial_exposure_pending';END IF;
 -- Parent/quota locks precede account locks; failure rolls the entire reservation back.
 new_intent:=funding_private.reserve_v2(p_year,p_annual,p_event_token,p_event,p_amount,p_minimum_seconds);
 PERFORM 1 FROM accounts WHERE id='general' FOR UPDATE;
 IF funding_private.available_operational('general')<p_bound THEN RAISE EXCEPTION 'operational_budget_insufficient';END IF;
 INSERT INTO fee_reservations(intent_id,bound) VALUES(new_intent,p_bound);RETURN new_intent;
END $$;
CREATE FUNCTION funding_private.reserve_refund(p_operation text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE d financial_review_decisions;i intents;a accounts;outstanding bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 IF EXISTS(SELECT 1 FROM refund_reservations WHERE operation_ref=p_operation) THEN RETURN 'already_reserved';END IF;
 SELECT * INTO d FROM financial_review_decisions WHERE operation_ref=p_operation AND action='refund_authorize';
 IF NOT FOUND OR d.expires_at<=funding_private.temporal_now() OR EXISTS(SELECT 1 FROM financial_decision_revocations WHERE decision_id=d.id) THEN RAISE EXCEPTION 'owner_decision_required';END IF;
 SELECT * INTO i FROM intents WHERE id=d.intent_id;
 IF i.state<>'confirmed' OR NOT EXISTS(SELECT 1 FROM temporal_intents WHERE intent_id=i.id) THEN RAISE EXCEPTION 'payment_not_eligible';END IF;
 IF i.event_id IS NOT NULL THEN PERFORM 1 FROM public.protests WHERE id=i.event_id FOR UPDATE;END IF;
 SELECT * INTO a FROM accounts WHERE id=d.source_account FOR UPDATE;
 IF a.kind NOT IN('general','event') OR (a.kind='event' AND a.event_id IS DISTINCT FROM i.event_id) OR a.state NOT IN('open','closing') THEN RAISE EXCEPTION 'source_not_eligible';END IF;
 IF EXISTS(SELECT 1 FROM provider_movements WHERE claimed_intent=i.id AND kind='dispute_debit') THEN RAISE EXCEPTION 'dispute_review_required';END IF;
 SELECT COALESCE(-sum(m.amount),0) INTO outstanding FROM provider_movements m JOIN movement_allocations allocation ON allocation.movement_ref=m.movement_ref WHERE claimed_intent=i.id AND kind IN('refund','refund_recovery');
 outstanding:=outstanding+COALESCE((SELECT sum(amount) FROM refund_reservations WHERE intent_id=i.id AND state='held'),0);
 IF outstanding+d.amount>i.amount THEN RAISE EXCEPTION 'refund_exceeds_gross';END IF;
 IF funding_private.available_operational(a.id)<d.amount THEN RAISE EXCEPTION 'refund_source_insufficient';END IF;
 INSERT INTO refund_reservations(operation_ref,decision_id,intent_id,source_account,amount) VALUES(d.operation_ref,d.id,i.id,d.source_account,d.amount);RETURN 'reserved';
END $$;
-- Pure allocation function, no external transfer. Runtime is a trusted journal operator.
CREATE FUNCTION funding_private.apply_movement(p_ref text,p_source text,p_decision uuid DEFAULT NULL) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE m provider_movements;a accounts;t uuid;k text;i intents;d financial_review_decisions;r refund_reservations;related provider_movements;original_source text;used bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO STRICT m FROM provider_movements WHERE movement_ref=p_ref;
 IF EXISTS(SELECT 1 FROM movement_allocations WHERE movement_ref=p_ref) THEN RETURN 'allocated';END IF;
 SELECT * INTO i FROM intents WHERE id=m.claimed_intent;
 IF NOT FOUND OR i.state<>'confirmed' OR NOT EXISTS(SELECT 1 FROM temporal_intents WHERE intent_id=i.id) OR m.effective_at IS NULL OR m.effective_at>funding_private.temporal_now() THEN RETURN 'review';END IF;
 IF i.event_id IS NOT NULL THEN PERFORM 1 FROM public.protests WHERE id=i.event_id FOR UPDATE;END IF;
 -- Same sorted account order as confirmation; never source-before-clearing.
 PERFORM 1 FROM accounts WHERE id IN(p_source,'clearing') ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM accounts WHERE id=p_source;
 IF NOT FOUND THEN RETURN 'review';END IF;
 IF m.currency<>'EUR' OR a.kind NOT IN('general','event') OR a.state NOT IN('open','closing') THEN RETURN 'review';END IF;
 -- Validate again here: the helper cannot be a shortcut around Owner decisions.
 IF p_decision IS NOT NULL THEN
  SELECT * INTO d FROM financial_review_decisions WHERE id=p_decision;
  IF NOT FOUND OR d.intent_id<>i.id OR d.amount<>-m.amount OR d.source_account<>p_source OR EXISTS(SELECT 1 FROM financial_decision_revocations WHERE decision_id=d.id) THEN RETURN 'review';END IF;
  IF d.action='cover_exposure' THEN
   IF d.expires_at<=funding_private.temporal_now() OR p_source<>'general' OR m.kind NOT IN('processing_fee','fee','refund','dispute_debit') OR m.amount>=0 THEN RETURN 'review';END IF;
  ELSIF d.action='refund_authorize' THEN
   SELECT * INTO r FROM refund_reservations WHERE decision_id=d.id AND operation_ref=m.operation_ref AND intent_id=i.id AND state='held';
   IF NOT FOUND OR m.kind<>'refund' OR -m.amount<>r.amount OR EXISTS(SELECT 1 FROM provider_movements WHERE claimed_intent=i.id AND kind='dispute_debit') THEN RETURN 'review';END IF;
  ELSE RETURN 'review';END IF;
 ELSIF m.kind='processing_fee' AND m.amount<=0 THEN
  IF p_source<>'general' OR NOT EXISTS(SELECT 1 FROM fee_reservations WHERE intent_id=i.id AND state='held' AND bound>=-m.amount) THEN RETURN 'review';END IF;
 ELSIF m.kind='dispute_debit' AND m.amount<0 THEN
  IF p_source<>(CASE WHEN i.event_id IS NULL THEN 'general' ELSE 'event:'||i.event_id END) THEN RETURN 'review';END IF;
 ELSIF m.kind IN('refund_recovery','fee_recovery','dispute_recovery') AND m.amount>0 THEN
  SELECT * INTO related FROM provider_movements WHERE movement_ref=m.related_ref;
  IF NOT FOUND OR related.claimed_intent<>i.id OR related.amount>=0 OR related.currency<>m.currency OR related.kind<>(CASE m.kind WHEN 'refund_recovery' THEN 'refund' WHEN 'fee_recovery' THEN 'processing_fee' ELSE 'dispute_debit' END) THEN RETURN 'review';END IF;
  SELECT source_account INTO original_source FROM movement_allocations WHERE movement_ref=m.related_ref;
  IF original_source IS NULL THEN RETURN 'review';END IF;
  IF EXISTS(SELECT 1 FROM accounts WHERE id=original_source AND state='settled') THEN original_source:='general';END IF;
  SELECT COALESCE(sum(pm.amount),0) INTO used FROM provider_movements pm JOIN movement_allocations ma ON ma.movement_ref=pm.movement_ref WHERE pm.related_ref=m.related_ref AND pm.amount>0;
  IF p_source<>original_source OR used+m.amount>-related.amount THEN RETURN 'review';END IF;
 ELSE RETURN 'review';END IF;
 IF m.kind IN('refund','dispute_debit') AND m.amount<0 THEN
  SELECT COALESCE(-sum(pm.amount),0) INTO used FROM provider_movements pm JOIN movement_allocations ma ON ma.movement_ref=pm.movement_ref WHERE pm.claimed_intent=i.id AND pm.kind IN('refund','dispute_debit','refund_recovery','dispute_recovery');
  IF used-m.amount>i.amount THEN RETURN 'review';END IF;
 END IF;
 IF m.amount<0 AND funding_private.available_operational(a.id,CASE WHEN m.kind='processing_fee' THEN m.claimed_intent ELSE NULL END,CASE WHEN m.kind='refund' THEN m.operation_ref ELSE NULL END)<-m.amount THEN RETURN 'review';END IF;
 IF m.amount<>0 THEN
  k:=CASE WHEN m.kind IN('processing_fee','fee') THEN 'provider_fee' WHEN m.kind='refund' THEN 'refund' WHEN m.kind='dispute_debit' THEN 'dispute' ELSE 'compensation' END;
  INSERT INTO ledger_transactions(operation_key,kind) VALUES('psp-movement:'||p_ref,k) RETURNING id INTO t;
  INSERT INTO ledger_entries(transaction_id,account_id,amount) VALUES(t,a.id,m.amount),(t,'clearing',-m.amount);
  UPDATE accounts SET balance=balance+m.amount WHERE id=a.id;UPDATE accounts SET balance=balance-m.amount WHERE id='clearing';
 END IF;
 INSERT INTO movement_allocations(movement_ref,source_account,transaction_id,decision_id) VALUES(p_ref,p_source,t,p_decision);
 IF m.kind='processing_fee' THEN UPDATE fee_reservations SET state='final' WHERE intent_id=m.claimed_intent AND state='held';END IF;
 IF m.kind='refund' THEN UPDATE refund_reservations SET state='consumed' WHERE operation_ref=m.operation_ref;END IF;
 RETURN 'allocated';
END $$;
CREATE FUNCTION funding_private.record_provider_movement(p_ref text,p_intent uuid,p_kind text,p_amount bigint,p_currency text,p_operation text,p_related text,p_effective timestamptz) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE old provider_movements;i intents;r refund_reservations;related provider_movements;source text;recovered bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO old FROM provider_movements WHERE movement_ref=p_ref;
 IF FOUND THEN
  IF old.claimed_intent IS DISTINCT FROM p_intent OR old.kind IS DISTINCT FROM p_kind OR old.amount IS DISTINCT FROM p_amount OR old.currency IS DISTINCT FROM p_currency OR old.operation_ref IS DISTINCT FROM p_operation OR old.related_ref IS DISTINCT FROM p_related OR old.effective_at IS DISTINCT FROM p_effective THEN RAISE EXCEPTION 'idempotency_conflict';END IF;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM movement_allocations WHERE movement_ref=p_ref) THEN 'allocated' ELSE 'review' END;
 END IF;
 -- Record first, even when allocation/coverage is impossible. No raw payload stored.
 INSERT INTO provider_movements VALUES(p_ref,p_intent,p_kind,p_amount,p_currency,p_operation,p_related,p_effective,clock_timestamp());
 SELECT * INTO i FROM intents WHERE id=p_intent;
 IF NOT FOUND OR i.state<>'confirmed' OR NOT EXISTS(SELECT 1 FROM temporal_intents WHERE intent_id=p_intent) OR p_currency<>'EUR' OR p_effective IS NULL OR p_effective>funding_private.temporal_now() THEN RETURN 'review';END IF;
 IF i.event_id IS NOT NULL THEN PERFORM 1 FROM public.protests WHERE id=i.event_id FOR UPDATE;END IF;
 IF p_kind='processing_fee' AND p_amount<=0 AND EXISTS(SELECT 1 FROM fee_reservations WHERE intent_id=i.id AND state='held' AND bound>=-p_amount) THEN
  RETURN funding_private.apply_movement(p_ref,'general');
 ELSIF p_kind='refund' AND p_amount<0 THEN
  SELECT * INTO r FROM refund_reservations WHERE operation_ref=p_operation AND intent_id=p_intent AND state='held';
  IF NOT FOUND OR -p_amount<>r.amount OR EXISTS(SELECT 1 FROM provider_movements WHERE claimed_intent=i.id AND kind='dispute_debit') THEN RETURN 'review';END IF;
  RETURN funding_private.apply_movement(p_ref,r.source_account,r.decision_id);
 ELSIF p_kind IN('refund_pending','refund_failed') AND p_amount=0 THEN
  SELECT * INTO r FROM refund_reservations WHERE operation_ref=p_operation AND intent_id=p_intent;
  IF NOT FOUND THEN RETURN 'review';END IF;
  IF p_kind='refund_failed' AND r.state='held' THEN UPDATE refund_reservations SET state='released' WHERE operation_ref=p_operation;END IF;
  INSERT INTO movement_allocations(movement_ref) VALUES(p_ref);RETURN 'allocated';
 ELSIF p_kind IN('dispute_opened','dispute_resolved') AND p_amount=0 THEN
  INSERT INTO movement_allocations(movement_ref) VALUES(p_ref);RETURN 'allocated';
 ELSIF p_kind='dispute_debit' AND p_amount<0 AND -p_amount<=i.amount THEN
  source:=CASE WHEN i.event_id IS NULL THEN 'general' ELSE 'event:'||i.event_id END;
  RETURN funding_private.apply_movement(p_ref,source);
 ELSIF p_kind IN('refund_recovery','fee_recovery','dispute_recovery') AND p_amount>0 THEN
  SELECT * INTO related FROM provider_movements WHERE movement_ref=p_related;
  IF NOT FOUND OR related.claimed_intent<>p_intent OR related.amount>=0 OR related.currency<>p_currency OR related.kind<>(CASE p_kind WHEN 'refund_recovery' THEN 'refund' WHEN 'fee_recovery' THEN 'processing_fee' ELSE 'dispute_debit' END) THEN RETURN 'review';END IF;
  SELECT COALESCE(sum(amount),0) INTO recovered FROM provider_movements m JOIN movement_allocations allocation ON allocation.movement_ref=m.movement_ref WHERE related_ref=p_related AND m.amount>0;
  IF recovered+p_amount>-related.amount THEN RETURN 'review';END IF;
  SELECT source_account INTO source FROM movement_allocations WHERE movement_ref=p_related;
  -- If the debit remains unallocated, the positive cash fact stays visible for review.
  IF source IS NULL THEN RETURN 'review';END IF;
  IF EXISTS(SELECT 1 FROM accounts WHERE id=source AND state='settled') THEN source:='general';END IF;
  RETURN funding_private.apply_movement(p_ref,source);
 END IF;
 RETURN 'review';
END $$;
CREATE FUNCTION funding_private.cover_provider_exposure(p_ref text,p_operation text) RETURNS text
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE d financial_review_decisions;m provider_movements;i intents;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 SELECT * INTO STRICT m FROM provider_movements WHERE movement_ref=p_ref;
 SELECT * INTO d FROM financial_review_decisions WHERE operation_ref=p_operation AND action='cover_exposure';
 IF NOT FOUND OR d.expires_at<=funding_private.temporal_now() OR EXISTS(SELECT 1 FROM financial_decision_revocations WHERE decision_id=d.id) OR d.intent_id<>m.claimed_intent OR d.amount<>-m.amount OR d.source_account<>'general' OR m.kind NOT IN('processing_fee','fee','refund','dispute_debit') OR m.currency<>'EUR' OR m.amount>=0 THEN RAISE EXCEPTION 'owner_decision_required';END IF;
 SELECT * INTO i FROM intents WHERE id=m.claimed_intent;
 IF i.state<>'confirmed' OR NOT EXISTS(SELECT 1 FROM temporal_intents WHERE intent_id=i.id) THEN RAISE EXCEPTION 'payment_not_eligible';END IF;
 -- Extraordinary debits are retained; Owner coverage never makes unknown evidence valid.
 IF m.effective_at IS NULL OR m.effective_at>funding_private.temporal_now() THEN RAISE EXCEPTION 'movement_evidence_required';END IF;
 IF i.event_id IS NOT NULL THEN PERFORM 1 FROM public.protests WHERE id=i.event_id FOR UPDATE;END IF;
 RETURN funding_private.apply_movement(p_ref,'general',d.id);
END $$;
REVOKE ALL ON FUNCTION funding_private.has_pending_exposure(),funding_private.available_operational(text,uuid,text),funding_private.reserve_with_fee_v3(int,text,text,uuid,bigint,int,bigint,boolean),funding_private.reserve_refund(text),funding_private.apply_movement(text,text,uuid),funding_private.record_provider_movement(text,uuid,text,bigint,text,text,text,timestamptz),funding_private.cover_provider_exposure(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION funding_private.has_pending_exposure(),funding_private.available_operational(text,uuid,text),funding_private.reserve_with_fee_v3(int,text,text,uuid,bigint,int,bigint,boolean),funding_private.reserve_refund(text),funding_private.apply_movement(text,text,uuid),funding_private.record_provider_movement(text,uuid,text,bigint,text,text,text,timestamptz),funding_private.cover_provider_exposure(text,text) TO funding_runtime;
CREATE OR REPLACE FUNCTION funding_private.reserve_cost(p_event uuid,p_amount bigint,p_key text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE a funding_private.accounts%ROWTYPE; ev public.protests%ROWTYPE; held bigint; prior funding_private.cost_reservations%ROWTYPE; cid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 -- Same parent-before-account lock order as reserve and close_event.
 SELECT * INTO ev FROM public.protests WHERE id=p_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_not_open'; END IF;
 SELECT * INTO a FROM funding_private.accounts WHERE event_id=p_event FOR UPDATE;
 IF NOT FOUND OR a.state<>'open' THEN RAISE EXCEPTION 'event_not_open'; END IF;
 SELECT * INTO prior FROM funding_private.cost_reservations WHERE operation_key=p_key;
 IF FOUND THEN
  IF prior.event_id<>p_event OR prior.amount<>p_amount THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN prior.id;
 END IF;
 IF funding_private.has_pending_exposure() THEN RAISE EXCEPTION 'financial_exposure_pending';END IF;
 -- A retry of an existing reservation is not a new cost commitment.
 IF ev.starts_at IS NULL OR ev.ends_at IS NULL OR ev.starts_at>clock_timestamp() OR ev.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_not_open'; END IF;
 SELECT COALESCE(sum(amount),0) INTO held FROM funding_private.cost_reservations WHERE event_id=p_event AND state='reserved';
 IF p_amount<=0 OR funding_private.available_operational(a.id)<p_amount THEN RAISE EXCEPTION 'insufficient_event_funds'; END IF;
 INSERT INTO funding_private.cost_reservations(event_id,amount,operation_key) VALUES(p_event,p_amount,p_key) RETURNING id INTO cid;
 RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION funding_private.settle(p_event uuid) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE a funding_private.accounts%ROWTYPE; amount bigint; tid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 PERFORM 1 FROM public.protests WHERE id=p_event FOR UPDATE;
 PERFORM 1 FROM funding_private.accounts WHERE id IN ('event:'||p_event,'general') ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM funding_private.accounts WHERE event_id=p_event;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_not_enabled'; END IF;
 SELECT surplus INTO amount FROM funding_private.settlements WHERE event_id=p_event;
 IF FOUND THEN RETURN amount; END IF;
 IF a.state<>'closing' OR EXISTS(SELECT 1 FROM public.protests WHERE id=p_event AND ends_at>clock_timestamp()) THEN RAISE EXCEPTION 'not_ready'; END IF;
 IF EXISTS(SELECT 1 FROM funding_private.intents WHERE event_id=p_event AND state IN ('reserved','review')) OR EXISTS(SELECT 1 FROM funding_private.cost_reservations WHERE event_id=p_event AND state='reserved') THEN RAISE EXCEPTION 'pending_items'; END IF;
 IF EXISTS(SELECT 1 FROM funding_private.refund_reservations WHERE source_account=a.id AND state='held') THEN RAISE EXCEPTION 'pending_items';END IF;
 IF EXISTS(SELECT 1 FROM funding_private.provider_movements m JOIN funding_private.intents i ON i.id=m.claimed_intent WHERE i.event_id=p_event AND m.amount<0 AND NOT EXISTS(SELECT 1 FROM funding_private.movement_allocations ma WHERE ma.movement_ref=m.movement_ref)) THEN RAISE EXCEPTION 'pending_items';END IF;
 amount:=a.balance;
 IF amount>0 THEN
  INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('settlement:'||p_event,'surplus') RETURNING id INTO tid;
  INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,'event:'||p_event,-amount),(tid,'general',amount);
  UPDATE funding_private.accounts SET balance=balance+amount WHERE id='general';
 END IF;
 UPDATE funding_private.accounts SET balance=0,state='settled' WHERE event_id=p_event;
 INSERT INTO funding_private.settlements(event_id,surplus) VALUES(p_event,amount);
 RETURN amount;
END $$;

CREATE OR REPLACE FUNCTION funding_private.cancel(p_intent uuid,p_provider_final boolean) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i funding_private.intents%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:operational-budget:v3',0));
 IF p_provider_final IS DISTINCT FROM true THEN RAISE EXCEPTION 'provider_may_still_charge'; END IF;
 SELECT * INTO i FROM funding_private.intents WHERE id=p_intent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_intent'; END IF;
 IF i.state='cancelled' THEN RETURN 'cancelled'; END IF;
 IF i.state<>'reserved' THEN RAISE EXCEPTION 'cannot_cancel'; END IF;
 UPDATE funding_private.annual_limits SET reserved=reserved-i.amount WHERE policy_year=i.policy_year AND token=i.annual_token;
 IF i.event_id IS NOT NULL THEN UPDATE funding_private.event_limits SET reserved=reserved-i.amount WHERE event_id=i.event_id AND token=i.event_token; END IF;
 UPDATE funding_private.fee_reservations SET state='released' WHERE intent_id=p_intent AND state='held';
 UPDATE funding_private.intents SET state='cancelled' WHERE id=i.id;
 RETURN 'cancelled';
END $$;

